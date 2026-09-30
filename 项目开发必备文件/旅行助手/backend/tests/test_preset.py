"""演示必须无付费调用，首次打开不依赖本机历史数据库。"""
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.api import trips
from app.core.config import settings
from app.core.db import get_db
from app.core.errors import AppError, error_body
from app.models import AIBudgetDay, AIUsage, Place, Task, Trip
from app.services import ai_budget, hotels, photos, pipeline, preset, runner


@pytest.fixture
def demo(budget_db, tmp_path, monkeypatch):
    monkeypatch.setattr(preset, "ASSETS_DIR", tmp_path / "assets")
    monkeypatch.setattr(pipeline, "ASSETS_DIR", tmp_path / "assets")
    monkeypatch.setattr(settings, "deepseek_api_key", "")
    forbidden = MagicMock(side_effect=AssertionError("固定演示不得调用生成/检索服务"))
    for module, name in [(runner, "start_task"), (ai_budget, "reserve"),
                         (hotels, "recommend"), (photos, "photos_for_trip")]:
        monkeypatch.setattr(module, name, forbidden)
    app = FastAPI()
    app.include_router(trips.router, prefix="/api/v1")

    @app.exception_handler(AppError)
    async def handle_error(_, exc):
        return JSONResponse(status_code=exc.status_code, content=error_body(exc.code, exc.message))

    def get_session():
        with budget_db() as db:
            yield db

    app.dependency_overrides[get_db] = get_session
    with TestClient(app) as client:
        yield client, budget_db
    forbidden.assert_not_called()


def test_preset_works_without_key_or_existing_data_and_never_spends(demo):
    client, factory = demo
    before = ai_budget.snapshot()
    result = client.post("/api/v1/trips/preset")
    assert result.status_code == 200
    assert result.json() == {"trip_id": preset.TRIP_ID, "status": "done", "preset": True}
    places = client.get(f"/api/v1/trips/{preset.TRIP_ID}/places").json()
    assert places["preset"] and places["input_text"] == preset.data()["source_text"]
    assert len(places["places"]) == 16 and places["task_id"] is None
    route = client.get(f"/api/v1/trips/{preset.TRIP_ID}/route").json()
    assert [len(d["places"]) for d in route["days"]] == [8, 8]
    for day in route["days"]:
        assert len(day["segments"]) == 7
        assert [s["from_place"] for s in day["segments"]] == [p["name"] for p in day["places"][:-1]]
        assert [s["to_place"] for s in day["segments"]] == [p["name"] for p in day["places"]][1:]
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(AIUsage)) == 0
        assert db.scalar(select(func.count()).select_from(Task)) == 0
    assert ai_budget.snapshot() == before


def test_hotels_photos_and_navigation_are_available_without_lookup(demo):
    client, _ = demo
    client.post("/api/v1/trips/preset")
    root = f"/api/v1/trips/{preset.TRIP_ID}"
    accommodation = client.get(root + "/hotels").json()
    assert [len(d["hotels"]) for d in accommodation["days"]] == [3, 3]
    for day in accommodation["days"]:
        for hotel in day["hotels"]:
            assert hotel["uid"] in hotel["link"]["web_uri"]
            assert 29 < hotel["lat"] < 30 and 106 < hotel["lng"] < 107
    images = client.get(root + "/photos").json()["photos"]
    assert len(images) == 11
    for photo in images.values():
        image = client.get(photo["src"])
        assert image.status_code == 200 and image.content.startswith(b"\xff\xd8")
    navigation = client.get(root + "/app-nav").json()
    assert len(navigation["days"]) == 2
    assert [len(d["segments"]) for d in navigation["days"]] == [7, 7]


def test_demo_is_read_only_even_with_direct_api_requests(demo):
    client, _ = demo
    client.post("/api/v1/trips/preset")
    root = f"/api/v1/trips/{preset.TRIP_ID}"
    before = client.get(root + "/places").json()
    place_id = before["places"][0]["id"]
    edits = [client.patch(f"{root}/places/{place_id}", json={"name": "成都", "day": 3}),
             client.post(root + "/route")]
    for result in edits:
        assert result.status_code == 409
        assert result.json()["error"]["code"] == "PRESET_READ_ONLY"
    assert client.get(root + "/places").json() == before
    assert client.get(root + "/photos/999999.jpg").status_code == 404


def test_concurrent_and_repeated_demo_requests_do_not_duplicate_places(demo):
    _, factory = demo
    def open_once(_):
        with factory() as db:
            return preset.ensure_trip(db).id
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert set(pool.map(open_once, range(16))) == {preset.TRIP_ID}
    # 新会话读取持久化数据，与进程内缓存无关。
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(Trip)) == 1
        assert db.scalar(select(func.count()).select_from(Place)) == 16
    assert len(pipeline.load_route_json(preset.TRIP_ID)["days"]) == 2


def test_demo_remains_available_when_paid_budget_is_exhausted(demo):
    client, factory = demo
    today = ai_budget.snapshot()["day"]
    with factory() as db:
        db.add(AIBudgetDay(day=today, limit_nano=10_000_000_000, spent_nano=10_000_000_000))
        db.commit()
    exhausted = ai_budget.snapshot()
    assert not exhausted["can_generate"]
    assert client.post("/api/v1/trips/preset").status_code == 200
    assert ai_budget.snapshot() == exhausted


def test_reopening_demo_repairs_missing_route_file(demo):
    client, _ = demo
    client.post("/api/v1/trips/preset")
    path = preset.ASSETS_DIR / preset.TRIP_ID / "route.json"
    expected = path.read_bytes()
    path.unlink()
    assert client.post("/api/v1/trips/preset").status_code == 200
    assert path.read_bytes() == expected


@pytest.mark.parametrize("mode", ["guide", "idea"])
def test_demo_mode_blocks_paid_requests_from_old_pages(demo, monkeypatch, mode):
    client, factory = demo
    monkeypatch.setattr(settings, "preset_demo", True)
    before = ai_budget.snapshot()
    response = client.post("/api/v1/trips", json={"source_link": "重庆两天", "mode": mode})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DEMO_MODE_ONLY"
    assert ai_budget.snapshot() == before
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(Trip)) == 0
        assert db.scalar(select(func.count()).select_from(Task)) == 0
    assert client.post("/api/v1/trips/preset").status_code == 200
