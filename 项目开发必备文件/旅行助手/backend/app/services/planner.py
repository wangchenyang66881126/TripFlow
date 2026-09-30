"""攻略正文 / 一句话规划：结构校验、有限调用、可恢复的结构化结果。"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..core.config import settings
from ..core.errors import AppError
from ..core.logging import get_logger
from . import model_gateway

log = get_logger(__name__)
PROMPT_PATH = Path(__file__).parent / "prompts" / "plan.txt"


class PlannedPlace(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    day: int = Field(ge=1, le=7)
    seq: int = Field(ge=1, le=56)
    name: str = Field(min_length=1, max_length=128)
    type: str = Field(default="景点", min_length=1, max_length=32)
    note: str = Field(default="", max_length=160)


class Itinerary(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    clarification: Literal["", "destination", "scope", "places"] = ""
    city: str = Field(default="", max_length=32)
    title: str = Field(default="", max_length=128)
    summary: str = Field(default="", max_length=400)
    places: list[PlannedPlace] = Field(default_factory=list, max_length=56)

    @model_validator(mode="after")
    def valid_itinerary(self):
        if self.clarification:
            if self.places:
                raise ValueError("待补充信息时不能同时生成地点")
            return self
        if not self.city or not self.title or not self.places:
            raise ValueError("行程缺少城市、标题或地点")
        days = {p.day for p in self.places}
        if days != set(range(1, max(days) + 1)):
            raise ValueError("天数不连续")
        pairs = {(p.day, p.seq) for p in self.places}
        if len(pairs) != len(self.places):
            raise ValueError("同一天内地点序号重复")
        self.places.sort(key=lambda p: (p.day, p.seq))
        for day in sorted(days):
            for seq, place in enumerate((p for p in self.places if p.day == day), 1):
                place.seq = seq
        return self


def parse_itinerary(content: str) -> Itinerary:
    """兼容 JSON 代码块和外围说明，内容不合法时整体拒绝，不默默丢地点。"""
    start, end = content.find("{"), content.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("无结构化行程")
    return Itinerary.model_validate_json(content[start:end + 1])


def classify_input(text: str, mode: str) -> tuple[str, str]:
    """服务端决定任务类型；从分享文案提取真正链接，禁止任意地址抓取。"""
    if mode == "idea":
        return "plan", text
    urls = re.findall(r"https?://[^\s<>\"'，。！、）]+", text)
    for url in urls:
        host = (urlsplit(url).hostname or "").lower()
        if host in {"xhslink.com", "xhslink.cn", "www.xiaohongshu.com", "xiaohongshu.com"}:
            return "parse", url.rstrip(").,;；")
    if urls and text.strip() == urls[0]:
        raise AppError("UNSUPPORTED_LINK", "目前支持小红书链接；其他平台请直接粘贴攻略正文。", 422)
    return "guide", text


def generate_itinerary(text: str, mode: str) -> tuple[Itinerary, dict]:
    if not settings.deepseek_api_key:
        raise AppError("NO_MODEL_KEY", "旅行规划服务尚未配置，请联系管理员。", 503)
    started = time.monotonic()
    total_tokens = 0
    for attempt in range(1, settings.planner_attempts + 1):
        try:
            response = model_gateway.create_completion(
                messages=[
                    {"role": "system", "content": PROMPT_PATH.read_text(encoding="utf-8")},
                    {"role": "user", "content": json.dumps({"mode": mode, "text": text}, ensure_ascii=False)},
                ], temperature=0.2, max_tokens=settings.planner_max_tokens, purpose=mode,
            )
            usage = getattr(response, "usage", None)
            total_tokens += usage.total_tokens if usage else 0
            plan = parse_itinerary(response.choices[0].message.content or "")
            meta = {"model": settings.deepseek_model, "attempts": attempt,
                    "tokens": total_tokens,
                    "elapsed_s": round(time.monotonic() - started, 2),
                    "compliant_on_first": attempt == 1}
            log.info("旅行规划完成 mode=%s attempts=%s tokens=%s elapsed_s=%s",
                     mode, attempt, meta["tokens"], meta["elapsed_s"])
            break
        except AppError:
            # 额度不足、计费配置异常等确定性拒绝不重试、不改写成普通生成失败。
            raise
        except Exception as exc:
            # 供应商异常可能包含请求原文 / URL 凭证，只记录异常类别。
            log.warning("旅行规划失败 attempt=%s type=%s", attempt, type(exc).__name__)
    else:
        raise AppError("PLAN_FAILED", "暂时没能整理出行程，请稍后重试或补充目的地、天数。", 502)
    messages = {
        "destination": "请补充想去的城市，例如：重庆玩 2 天，想吃美食、看夜景。",
        "scope": "目前支持单个城市的 1–7 天行程，请按城市分开规划。",
        "places": "请粘贴包含具体地点的攻略；只有旅行想法时，请切换到「一句话规划」。",
    }
    if plan.clarification:
        raise AppError("NEEDS_INPUT", messages[plan.clarification], 422)
    return plan, meta
