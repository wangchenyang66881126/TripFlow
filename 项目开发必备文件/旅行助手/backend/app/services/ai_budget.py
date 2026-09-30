"""本站全部模型调用的日预算。先原子预留，再请求，最后保守结算。"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.dialects.sqlite import insert

from ..core.config import settings
from ..core.db import SessionLocal
from ..core.errors import AppError
from ..models import AIBudgetDay, AIUsage

SHANGHAI = ZoneInfo("Asia/Shanghai")
NANO_PER_YUAN = 1_000_000_000
DAILY_LIMIT_NANO = 10 * NANO_PER_YUAN
PRICES = json.loads((Path(__file__).parent / "deepseek_pricing.json").read_text(encoding="utf-8"))


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def day_and_reset(now: datetime | None = None) -> tuple[str, datetime]:
    current = (now or utc_now()).astimezone(SHANGHAI)
    reset = (current + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return current.date().isoformat(), reset


def denied() -> AppError:
    _, reset = day_and_reset()
    return AppError("AI_DAILY_BUDGET_EXHAUSTED",
                    f"今日全站 AI 可用额度不足（每日上限 10 元，含正在生成的任务）。请稍后再试，或北京时间 {reset:%m月%d日} 00:00 额度恢复后再来；已有行程仍可查看。", 429)


def pricing(model: str) -> tuple[int, int]:
    # 更换供应商或未知模型不能沿用不匹配的费率静默放行。
    if urlsplit(settings.deepseek_base_url).hostname != "api.deepseek.com" or model not in PRICES["models"]:
        raise AppError("AI_PRICING_UNAVAILABLE", "模型计费配置尚未核对，已暂停生成以保护每日额度。", 503)
    row = PRICES["models"][model]
    return tuple(int(Decimal(row[key]) * 1000) for key in ("input_per_million", "output_per_million"))


def input_token_ceiling(messages: list[dict]) -> int:
    """仅接受本站纯文本消息。UTF-8 字节数 + 每条 1024 token 模板余量。"""
    if not messages or len(messages) > 16:
        raise AppError("AI_INPUT_LIMIT", "输入内容过长，请精简后再试。", 422)
    size = 0
    for message in messages:
        if set(message) != {"role", "content"} or message["role"] not in ("system", "user", "assistant") or not isinstance(message["content"], str):
            raise AppError("AI_INPUT_LIMIT", "当前预算保护仅支持纯文字生成。", 422)
        size += len(message["content"].encode("utf-8")) + 1024
    if size > 200_000:
        raise AppError("AI_INPUT_LIMIT", "攻略内容过长，请分段或精简后再试。", 422)
    return size


def snapshot() -> dict:
    day, reset = day_and_reset()
    with SessionLocal() as db:
        row = db.get(AIBudgetDay, day)
        spent, reserved = (row.spent_nano, row.reserved_nano) if row else (0, 0)
        available = max(0, DAILY_LIMIT_NANO - spent - reserved)
        return {"day": day, "timezone": "Asia/Shanghai", "limit_cny": "10.00",
                "used_upper_bound_cny": format(Decimal(spent) / NANO_PER_YUAN, ".9f"),
                "reserved_cny": format(Decimal(reserved) / NANO_PER_YUAN, ".9f"),
                "remaining_cny": format(Decimal(available) / NANO_PER_YUAN, ".9f"),
                "can_generate": available > 0 and not (row and row.blocked),
                "resets_at": reset.isoformat()}


def assert_available() -> None:
    if not snapshot()["can_generate"]:
        raise denied()


def reserve(messages: list[dict], max_tokens: int, model: str, purpose: str) -> str:
    if type(max_tokens) is not int or not 1 <= max_tokens <= 8192:
        raise AppError("AI_OUTPUT_LIMIT", "生成长度配置超出预算保护范围。", 503)
    in_rate, out_rate = pricing(model)
    bound = input_token_ceiling(messages)
    amount = bound * in_rate + max_tokens * out_rate
    day, _ = day_and_reset()
    call_id = str(uuid.uuid4())
    # SQLite 单条条件 UPDATE 是并发准入闸门。不得改成读取余额再 Python 判断。
    with SessionLocal.begin() as db:
        db.execute(insert(AIBudgetDay).values(day=day, limit_nano=DAILY_LIMIT_NANO,
                                             spent_nano=0, reserved_nano=0, blocked=False)
                   .on_conflict_do_nothing(index_elements=["day"]))
        claimed = db.execute(update(AIBudgetDay).where(
            AIBudgetDay.day == day, AIBudgetDay.blocked.is_(False),
            AIBudgetDay.spent_nano + AIBudgetDay.reserved_nano + amount <= DAILY_LIMIT_NANO,
        ).values(reserved_nano=AIBudgetDay.reserved_nano + amount))
        if claimed.rowcount != 1:
            raise denied()
        db.add(AIUsage(id=call_id, day=day, model=model, purpose=purpose,
                       reserved_nano=amount, input_bound=bound, output_bound=max_tokens,
                       input_rate_nano=in_rate, output_rate_nano=out_rate,
                       pricing_version=PRICES["version"], status="reserved"))
    return call_id


def mark_sent(call_id: str) -> None:
    with SessionLocal.begin() as db:
        result = db.execute(update(AIUsage).where(AIUsage.id == call_id, AIUsage.status == "reserved")
                            .values(status="sent"))
        if result.rowcount != 1:
            raise AppError("AI_BUDGET_STATE", "生成额度状态异常，请稍后重试。", 503)


def settle(call_id: str, usage=None, *, not_sent: bool = False) -> None:
    """结算幂等；缺 usage / 超时 / 中断保留整笔上限，绝不当作免费请求。"""
    with SessionLocal.begin() as db:
        # 先取得 SQLite 写锁，避免两个结算者同时释放同一笔额度。
        db.execute(update(AIUsage).where(AIUsage.id == call_id).values(status=AIUsage.status))
        call = db.get(AIUsage, call_id)
        if not call or call.status not in ("reserved", "sent"):
            return
        charged = call.reserved_nano
        state = "uncertain"
        anomaly = False
        if not_sent and call.status == "reserved":
            charged, state = 0, "released"
        elif usage is not None:
            prompt = getattr(usage, "prompt_tokens", None)
            completion = getattr(usage, "completion_tokens", None)
            if type(prompt) is int and type(completion) is int and prompt >= 0 and completion >= 0:
                call.prompt_tokens, call.completion_tokens = prompt, completion
                if prompt <= call.input_bound and completion <= call.output_bound:
                    charged = prompt * call.input_rate_nano + completion * call.output_rate_nano
                    state = "settled"
                else:
                    anomaly = True
        row = db.get(AIBudgetDay, call.day)
        row.reserved_nano -= call.reserved_nano
        row.spent_nano += charged
        if anomaly:
            row.blocked = True
        call.charged_nano, call.status, call.settled_at = charged, state, utc_now()


def recover_interrupted() -> None:
    """单进程服务启动时保守结算遗留预留，重启不能恢复花掉的额度。"""
    with SessionLocal() as db:
        ids = list(db.scalars(select(AIUsage.id).where(AIUsage.status.in_(["reserved", "sent"]))))
    for call_id in ids:
        settle(call_id)
