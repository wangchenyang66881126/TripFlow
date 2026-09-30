import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.core.errors import AppError
from app.models import Place, Task, Trip
from app.schemas import TripCreate
from app.services import pipeline, planner, runner


def plan_data():
    return {"city": "重庆", "title": "重庆慢游", "summary": "慢慢走",
            "places": [{"day": 1, "seq": 1, "name": "解放碑", "note": "散步"},
                       {"day": 2, "seq": 1, "name": "洪崖洞"}]}


def test_input_compatibility_and_share_text():
    assert planner.classify_input("https://xhslink.cn/o/abc", "guide")[0] == "parse"
    assert planner.classify_input("重庆攻略 https://xhslink.cn/o/abc，复制打开", "guide") == ("parse", "https://xhslink.cn/o/abc")
    assert planner.classify_input("重庆两天，第一天解放碑", "guide")[0] == "guide"
    assert planner.classify_input("去重庆玩两天", "idea")[0] == "plan"
    with pytest.raises(AppError, match="目前支持小红书链接"):
        planner.classify_input("https://xhslink.cn.evil.example/path", "guide")


@pytest.mark.parametrize("body", [{"source_link": "   "}, {"source_link": "a" * 12001},
                                 {"source_link": "重庆", "mode": "invalid"}])
def test_input_validation(body):
    with pytest.raises(ValidationError):
        TripCreate(**body)


def test_old_request_defaults_to_guide():
    assert TripCreate(source_link=" https://xhslink.cn/o/abc ").mode == "guide"


def test_plan_parser_tolerates_fence():
    plan = planner.parse_itinerary("结果：```json\n" + json.dumps(plan_data()) + "\n```")
    assert [p.name for p in plan.places] == ["解放碑", "洪崖洞"]


@pytest.mark.parametrize("mutation", ["city", "empty", "days", "duplicates", "too_many"])
def test_plan_rejects_incomplete_or_unbounded_results(mutation):
    data = plan_data()
    if mutation == "city":
        data["city"] = ""
    elif mutation == "empty":
        data["places"] = []
    elif mutation == "days":
        data["places"][1]["day"] = 8
    elif mutation == "duplicates":
        data["places"][1]["day"] = 1
    else:
        data["places"] *= 30
    with pytest.raises(ValidationError):
        planner.Itinerary.model_validate(data)


def mock_sdk(monkeypatch, content):
    import openai
    constructor = MagicMock()
    client = constructor.return_value.__enter__.return_value
    client.chat.completions.create.return_value = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(total_tokens=120))
    monkeypatch.setattr(openai, "OpenAI", constructor)
    monkeypatch.setattr(planner.settings, "deepseek_api_key", "test-only")
    monkeypatch.setattr(planner.settings, "planner_attempts", 2)
    return constructor, client


def test_sdk_init_failure_is_bounded_and_safe(monkeypatch):
    ctor, _ = mock_sdk(monkeypatch, "")
    ctor.side_effect = RuntimeError("sensitive-provider-details")
    with pytest.raises(AppError) as exc:
        planner.generate_itinerary("重庆两天", "idea")
    assert exc.value.code == "PLAN_FAILED"
    assert "sensitive" not in exc.value.message
    assert ctor.call_count == 2


def test_timeout_is_bounded(monkeypatch):
    ctor, client = mock_sdk(monkeypatch, "")
    client.chat.completions.create.side_effect = TimeoutError()
    with pytest.raises(AppError):
        planner.generate_itinerary("重庆", "idea")
    assert ctor.call_count == 2
    assert ctor.call_args.kwargs["max_retries"] == 0


def test_missing_destination_does_not_retry(monkeypatch):
    ctor, _ = mock_sdk(monkeypatch, '{"clarification":"destination","places":[]}')
    with pytest.raises(AppError) as exc:
        planner.generate_itinerary("想玩两天", "idea")
    assert exc.value.code == "NEEDS_INPUT"
    assert "城市" in exc.value.message
    assert ctor.call_count == 1


def test_invalid_model_json_retries_then_succeeds(monkeypatch):
    ctor, client = mock_sdk(monkeypatch, "")
    client.chat.completions.create.side_effect = [
        SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="bad"))]),
        SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(plan_data())))], usage=None)]
    plan, meta = planner.generate_itinerary("重庆", "idea")
    assert len(plan.places) == 2
    assert meta["attempts"] == 2 and not meta["compliant_on_first"]
    assert ctor.call_count == 2


def test_no_key_is_a_configuration_error(monkeypatch):
    monkeypatch.setattr(planner.settings, "deepseek_api_key", "")
    with pytest.raises(AppError) as exc:
        planner.generate_itinerary("重庆", "idea")
    assert exc.value.code == "NO_MODEL_KEY"


@pytest.fixture
def db_factory(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(runner, "SessionLocal", factory)
    monkeypatch.setattr(pipeline, "ASSETS_DIR", tmp_path / "assets")
    yield factory
    engine.dispose()


def test_saved_plan_resumes_without_model_or_duplicate_places(db_factory, monkeypatch):
    model = MagicMock(return_value=(planner.Itinerary.model_validate(plan_data()), {"tokens": 120}))
    geo = MagicMock(return_value=({"name": "真实地点", "lat": 29.5, "lng": 106.5}, []))
    monkeypatch.setattr(planner, "generate_itinerary", model)
    monkeypatch.setattr(pipeline.geocode, "geocode_place", geo)
    with db_factory() as db:
        trip = Trip(id="testplan", source_link="重庆玩两天", status="parsing")
        task = Task(id="task", trip_id=trip.id, kind="plan", status="running")
        db.add_all([trip, task]); db.commit()
        pipeline.run_text(db, trip, task)
        task.status = "running"; trip.status = "parsing"; db.commit()
    # 模拟进程重启后的全新 DB session；已有检查点应直接复用。
    runner._run("task")
    with db_factory() as db:
        assert db.get(Task, "task").status == "done"
        assert db.get(Trip, "testplan").status == "awaiting_confirm"
        assert len(list(db.scalars(select(Place)))) == 2
    assert model.call_count == 1 and geo.call_count == 2
    assert geo.call_args_list[0].args == ("解放碑", "重庆")  # 没有使用示例坐标。


def test_failed_geocode_preserves_places_and_blocks_route(db_factory, monkeypatch):
    monkeypatch.setattr(planner, "generate_itinerary", lambda *_: (planner.Itinerary.model_validate(plan_data()), {}))
    monkeypatch.setattr(pipeline.geocode, "geocode_place", MagicMock(side_effect=TimeoutError()))
    with db_factory() as db:
        trip = Trip(id="failgeo", source_link="重庆", status="parsing")
        task = Task(id="task2", trip_id=trip.id, kind="guide", status="running")
        db.add_all([trip, task]); db.commit()
        pipeline.run_text(db, trip, task)
        db.expire(trip, ["places"])
        assert len(trip.places) == 2
        assert all(p.geocode_status == "failed" and p.lat is None for p in trip.places)
        with pytest.raises(AppError) as exc:
            pipeline.validate_route_ready(trip.status, trip.places)
        assert exc.value.code == "INCOMPLETE_PLACES"


def test_create_trip_dispatches_persisted_input(db_factory, monkeypatch):
    from app.api.trips import create_trip, get_places
    dispatched = []
    def start(trip_id, kind):
        dispatched.append(kind)
        with db_factory() as db:
            db.add(Task(id=f"task-{trip_id}", trip_id=trip_id, kind=kind, status="pending")); db.commit()
        return f"task-{trip_id}"
    monkeypatch.setattr(runner, "start_task", start)
    with db_factory() as db:
        out = create_trip(TripCreate(source_link="成都三天，慢慢玩", mode="idea"), db)
        data = get_places(out["trip_id"], db)
        assert data["input_text"] == "成都三天，慢慢玩"
        assert data["input_mode"] == "idea" and data["task_status"] == "pending"
        assert dispatched == ["plan"]


def test_startup_only_resumes_checkpoint_capable_tasks(db_factory, monkeypatch):
    with db_factory() as db:
        db.add(Trip(id="restart", source_link="重庆", status="parsing"))
        db.add_all([Task(id="new", trip_id="restart", kind="plan", status="running"),
                    Task(id="old", trip_id="restart", kind="parse", status="pending")])
        db.commit()
    thread = MagicMock()
    monkeypatch.setattr(runner.threading, "Thread", thread)
    runner.recover_stale_tasks()
    assert thread.call_count == 1
    assert thread.call_args.kwargs["args"] == ("new",)
    assert thread.return_value.start.call_count == 1
    with db_factory() as db:
        assert db.get(Task, "old").status == "failed"
