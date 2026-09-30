"""地点结构化抽取（DeepSeek）。"""
from __future__ import annotations

import json
import re
from pathlib import Path

from pydantic import BaseModel, ValidationError

from ..core.config import settings
from ..core.errors import AppError
from ..core.logging import get_logger
from . import model_gateway

log = get_logger(__name__)

PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "extract.txt"


class ExtractedPlace(BaseModel):
    day: int
    seq: int
    name: str
    type: str = "景点"


def load_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


def parse_extraction(content: str) -> list[dict]:
    """宽容解析模型输出（纯函数，便于单测）。

    兼容：```json 代码块、前后多余文字、顶层对象或数组、places 字段或直接列表。
    """
    if not content:
        return []
    text = re.sub(r"```(?:json)?", "", content.strip()).strip()
    for open_ch, close_ch in (("{", "}"), ("[", "]")):
        start = text.find(open_ch)
        end = text.rfind(close_ch)
        if start == -1 or end == -1 or end <= start:
            continue
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            continue
        raw = data.get("places") if isinstance(data, dict) else data
        if isinstance(raw, list):
            return _validate_places(raw)
    return []


def _validate_places(raw: list) -> list[dict]:
    out: list[dict] = []
    for p in raw:
        if not isinstance(p, dict):
            continue
        try:
            v = ExtractedPlace(
                day=int(p.get("day", 1)),
                seq=int(p.get("seq", 1)),
                name=str(p.get("name", "")).strip(),
                type=str(p.get("type", "景点")).strip() or "景点",
            )
        except (ValidationError, ValueError, TypeError):
            continue
        if v.name:
            out.append(v.model_dump())
    return out


def extract_places(city: str, ocr_text: str, max_retries: int = 3) -> tuple[list[dict], dict]:
    """调用 DeepSeek 抽取地点。失败有限重试；仍失败抛 AppError。"""
    if not settings.deepseek_api_key:
        raise AppError("NO_MODEL_KEY", "未配置 DeepSeek API Key", status_code=503)

    prompt = load_prompt().format(city=city, ocr_text=ocr_text)
    tokens = 0
    for attempt in range(1, max_retries + 1):
        try:
            resp = model_gateway.create_completion(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1, max_tokens=8192, purpose="extract",
            )
            usage = getattr(resp, "usage", None)
            tokens += usage.total_tokens if usage else 0
            content = resp.choices[0].message.content or ""
            places = parse_extraction(content)
            if places:
                return places, {"attempts": attempt, "tokens": tokens, "compliant_on_first": attempt == 1}
            log.warning("抽取结果为空（第 %s 次）", attempt)
        except AppError:
            raise
        except Exception as e:  # noqa: BLE001
            log.warning("抽取第 %s 次失败 type=%s", attempt, type(e).__name__)
    raise AppError("EXTRACT_FAILED", f"地点抽取失败（已重试 {max_retries} 次）", status_code=502)
