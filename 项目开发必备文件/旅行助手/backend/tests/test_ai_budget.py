from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.errors import AppError, error_body
from app.models import AIBudgetDay, AIUsage
from app.services import ai_budget as budget, extract, model_gateway, planner

MESSAGES = [{"role": "user", "content": "重庆两天"}]


@pytest.fixture(autouse=True)
def known_pricing(monkeypatch):
    monkeypatch.setattr(budget.settings, "deepseek_base_url", "https://api.deepseek.com")
    monkeypatch.setattr(budget.settings, "deepseek_model", "deepseek-chat")
    monkeypatch.setattr(budget.settings, "deepseek_api_key", "test-only")


def freeze(monkeypatch, iso):
    moment = datetime.fromisoformat(iso)
    monkeypatch.setattr(budget, "utc_now", lambda: moment)


def seed(factory, spent):
    day, _ = budget.day_and_reset()
    with factory.begin() as db:
        db.add(AIBudgetDay(day=day, limit_nano=budget.DAILY_LIMIT_NANO,
                          spent_nano=spent, reserved_nano=0, blocked=False))


def quote(max_tokens=100):
    inp, out = budget.pricing("deepseek-chat")
    return budget.input_token_ceiling(MESSAGES) * inp + max_tokens * out


def call(max_tokens=100):
    return budget.reserve(MESSAGES, max_tokens, "deepseek-chat", "test")


def test_exact_ten_yuan_boundary_and_preflight(budget_db):
    seed(budget_db, budget.DAILY_LIMIT_NANO - quote())
    identifier = call()
    assert budget.snapshot()["remaining_cny"] == "0.000000000"
    for operation in (call, budget.assert_available):
        with pytest.raises(AppError) as exc:
            operation()
        assert exc.value.code == "AI_DAILY_BUDGET_EXHAUSTED"
        assert exc.value.status_code == 429
    budget.settle(identifier)  # 超时按整笔计入，不能恢复额度。
    assert budget.snapshot()["used_upper_bound_cny"] == "10.000000000"


def test_parallel_requests_never_overbook_shared_budget(budget_db):
    amount = quote()
    seed(budget_db, budget.DAILY_LIMIT_NANO - 5 * amount)
    def attempt(_):
        try:
            return call()
        except AppError as exc:
            assert exc.status_code == 429
            return None
    with ThreadPoolExecutor(max_workers=16) as pool:
        accepted = [result for result in pool.map(attempt, range(32)) if result]
    assert len(accepted) == 5
    status = budget.snapshot()
    assert Decimal(status["used_upper_bound_cny"]) + Decimal(status["reserved_cny"]) == Decimal(10)
    assert not status["can_generate"]


def test_usage_settlement_releases_only_unused_reservation_once(budget_db):
    identifier = call()
    budget.mark_sent(identifier)
    usage = SimpleNamespace(prompt_tokens=20, completion_tokens=10,
                            prompt_cache_hit_tokens=20, prompt_cache_miss_tokens=0)
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda _: budget.settle(identifier, usage), range(6)))
    # 即使全缓存命中仍按保守未命中价格；并发回调只结算一次。
    assert budget.snapshot()["used_upper_bound_cny"] == "0.000450000"
    assert budget.snapshot()["reserved_cny"] == "0.000000000"
    with budget_db() as db:
        assert db.get(AIUsage, identifier).status == "settled"


@pytest.mark.parametrize("usage", [None, SimpleNamespace(total_tokens=10),
                                   SimpleNamespace(prompt_tokens=-1, completion_tokens=3)])
def test_unknown_usage_is_charged_at_full_reservation(usage):
    identifier = call()
    budget.settle(identifier, usage)
    assert Decimal(budget.snapshot()["used_upper_bound_cny"]) == Decimal(quote()) / budget.NANO_PER_YUAN


def test_constructor_failure_can_release_but_sent_request_cannot():
    before = call()
    budget.settle(before, not_sent=True)
    assert budget.snapshot()["used_upper_bound_cny"] == "0.000000000"
    sent = call()
    budget.mark_sent(sent)
    budget.settle(sent, not_sent=True)
    assert Decimal(budget.snapshot()["used_upper_bound_cny"]) > 0


def test_restart_keeps_spending_and_converts_pending_to_conservative_charge():
    identifier = call()
    before = budget.snapshot()
    budget.recover_interrupted()
    after = budget.snapshot()
    assert after["remaining_cny"] == before["remaining_cny"]
    assert after["reserved_cny"] == "0.000000000"
    # 迟到的回调不可再释放已确认保守扣除的额度。
    budget.settle(identifier, SimpleNamespace(prompt_tokens=1, completion_tokens=1))
    assert budget.snapshot() == after


@pytest.mark.parametrize("iso, tomorrow", [
    ("2026-09-30T15:59:59+00:00", "2026-10-01"),
    ("2026-12-31T15:59:59+00:00", "2027-01-01"),
])
def test_midnight_beijing_resets_without_server_restart(budget_db, monkeypatch, iso, tomorrow):
    freeze(monkeypatch, iso)
    seed(budget_db, budget.DAILY_LIMIT_NANO)
    assert not budget.snapshot()["can_generate"]
    assert budget.snapshot()["resets_at"] == tomorrow + "T00:00:00+08:00"
    freeze(monkeypatch, tomorrow + "T00:00:00+08:00")
    assert budget.snapshot()["can_generate"]
    assert budget.snapshot()["remaining_cny"] == "10.000000000"
    call()
    with budget_db() as db:
        assert len(list(db.scalars(select(AIBudgetDay)))) == 2


def test_late_response_is_charged_to_request_day(budget_db, monkeypatch):
    freeze(monkeypatch, "2026-09-30T23:59:59+08:00")
    identifier = call()
    freeze(monkeypatch, "2026-10-01T00:00:01+08:00")
    budget.settle(identifier, SimpleNamespace(prompt_tokens=20, completion_tokens=10))
    assert budget.snapshot()["remaining_cny"] == "10.000000000"
    with budget_db() as db:
        assert db.get(AIBudgetDay, "2026-09-30").spent_nano == 450000


@pytest.mark.parametrize("messages, max_tokens", [
    ([{"role": "user", "content": "a" * 200001}], 100),
    ([{"role": "user", "content": [{"type": "image"}]}], 100),
    (MESSAGES, 0), (MESSAGES, 8193), (MESSAGES, True),
])
def test_unbounded_input_or_output_never_calls_model(messages, max_tokens):
    with pytest.raises(AppError):
        budget.reserve(messages, max_tokens, "deepseek-chat", "test")
    assert budget.snapshot()["remaining_cny"] == "10.000000000"


def test_unknown_supplier_or_model_fails_closed(monkeypatch):
    with pytest.raises(AppError):
        budget.reserve(MESSAGES, 100, "unknown", "test")
    monkeypatch.setattr(budget.settings, "deepseek_base_url", "https://different-provider.example")
    with pytest.raises(AppError):
        call()


def test_usage_beyond_claimed_upper_bound_blocks_further_calls():
    identifier = call(100)
    budget.settle(identifier, SimpleNamespace(prompt_tokens=10, completion_tokens=101))
    assert not budget.snapshot()["can_generate"]
    with pytest.raises(AppError):
        call()


def fake_sdk(monkeypatch, response=None, error=None):
    import openai
    ctor = MagicMock()
    client = ctor.return_value.__enter__.return_value
    client.chat.completions.create.return_value = response
    client.chat.completions.create.side_effect = error
    monkeypatch.setattr(openai, "OpenAI", ctor)
    return ctor, client


def test_budget_rejection_happens_before_any_provider_call(budget_db, monkeypatch):
    seed(budget_db, budget.DAILY_LIMIT_NANO)
    ctor, _ = fake_sdk(monkeypatch)
    with pytest.raises(AppError) as exc:
        model_gateway.create_completion(messages=MESSAGES, max_tokens=100, temperature=0.1, purpose="test")
    assert exc.value.status_code == 429
    ctor.assert_not_called()


def test_retry_attempts_each_have_a_persisted_charge(budget_db, monkeypatch):
    ctor, _ = fake_sdk(monkeypatch, error=TimeoutError())
    monkeypatch.setattr(planner.settings, "planner_attempts", 2)
    with pytest.raises(AppError, match="暂时没能整理出行程"):
        planner.generate_itinerary("重庆两天", "idea")
    assert ctor.call_count == 2
    assert ctor.call_args.kwargs["max_retries"] == 0
    with budget_db() as db:
        calls = list(db.scalars(select(AIUsage)))
        assert len(calls) == 2
        assert all(c.status == "uncertain" and c.charged_nano == c.reserved_nano for c in calls)


def test_both_business_paths_propagate_budget_error_without_retries(budget_db, monkeypatch):
    seed(budget_db, budget.DAILY_LIMIT_NANO - 1)
    ctor, _ = fake_sdk(monkeypatch)
    for operation in (lambda: planner.generate_itinerary("重庆两天", "idea"),
                      lambda: extract.extract_places("重庆", "第一天解放碑")):
        with pytest.raises(AppError) as exc:
            operation()
        assert exc.value.code == "AI_DAILY_BUDGET_EXHAUSTED"
    ctor.assert_not_called()


def test_extract_success_also_uses_shared_ledger(budget_db, monkeypatch):
    response = SimpleNamespace(usage=SimpleNamespace(prompt_tokens=30, completion_tokens=20, total_tokens=50),
                               choices=[SimpleNamespace(message=SimpleNamespace(content='{"places":[{"name":"解放碑","day":1,"seq":1}]}'))])
    _, client = fake_sdk(monkeypatch, response=response)
    places, meta = extract.extract_places("重庆", "第一天解放碑")
    assert places[0]["name"] == "解放碑" and meta["tokens"] == 50
    assert client.chat.completions.create.call_args.kwargs["max_tokens"] == 8192
    assert budget.snapshot()["used_upper_bound_cny"] == "0.000810000"


def test_http_429_has_clear_reset_message_and_no_trip_created(budget_db, monkeypatch):
    from app.api import trips
    seed(budget_db, budget.DAILY_LIMIT_NANO)
    application = FastAPI()
    application.include_router(trips.router, prefix="/api/v1")
    @application.exception_handler(AppError)
    async def error_handler(request, exc):
        return JSONResponse(status_code=exc.status_code, content=error_body(exc.code, exc.message))
    from app.core.db import get_db
    def isolated_db():
        with budget_db() as db:
            yield db
    application.dependency_overrides[get_db] = isolated_db
    start = MagicMock()
    monkeypatch.setattr(trips.runner, "start_task", start)
    with TestClient(application) as client:
        result = client.post("/api/v1/trips", json={"source_link":"重庆两天","mode":"idea"})
    assert result.status_code == 429
    assert result.json()["error"]["code"] == "AI_DAILY_BUDGET_EXHAUSTED"
    assert "00:00" in result.json()["error"]["message"]
    start.assert_not_called()
