"""唯一付费模型出口。所有业务与每次重试必须经过全站日预算。"""
from __future__ import annotations

import httpx

from ..core.config import settings
from ..core.errors import AppError
from . import ai_budget


def create_completion(*, messages: list[dict], max_tokens: int, temperature: float, purpose: str):
    if not settings.deepseek_api_key:
        raise AppError("NO_MODEL_KEY", "旅行规划服务尚未配置，请联系管理员。", 503)
    call_id = ai_budget.reserve(messages, max_tokens, settings.deepseek_model, purpose)
    sent = False
    response = None
    try:
        from openai import OpenAI

        with httpx.Client(trust_env=False, timeout=settings.planner_timeout) as http:
            with OpenAI(api_key=settings.deepseek_api_key, base_url=settings.deepseek_base_url,
                        timeout=settings.planner_timeout, max_retries=0, http_client=http) as client:
                ai_budget.mark_sent(call_id)
                sent = True
                response = client.chat.completions.create(
                    model=settings.deepseek_model, messages=messages,
                    response_format={"type": "json_object"}, temperature=temperature,
                    max_tokens=max_tokens,
                )
    finally:
        ai_budget.settle(call_id, getattr(response, "usage", None), not_sent=not sent)
    return response
