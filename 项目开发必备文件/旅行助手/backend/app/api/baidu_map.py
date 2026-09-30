"""百度 JSAPI 的同源资源入口；固定上游，不接受任意代理地址。"""
from __future__ import annotations

import re

import httpx
from fastapi import APIRouter, Request, Response

from ..core.config import settings
from ..core.errors import AppError

router = APIRouter()
PROXY_PATH = "/api/v1/baidu-map/"
UPSTREAM = "https://api.map.baidu.com/"


def _allowed_path(path: str) -> bool:
    return not any(part in {".", ".."} for part in path.split("/")) and bool(
        re.fullmatch(r"(?:api|getscript|getmodules|jsapi_monitor/sla|tiles/[0-3]/(?:pvd|starpic)/?|(?:res|images)/[A-Za-z0-9_./-]+)?", path)
    )


def _rewrite_text(text: str, key: str, local_host: str = "") -> str:
    # 官方 API 引导脚本中的脚本/CSS 地址也走同源；后续服务由 serviceHost 处理。
    for origin in ("https://api.map.baidu.com/", "http://api.map.baidu.com/", "//api.map.baidu.com/"):
        text = text.replace(origin, PROXY_PATH)
    text = text.replace(PROXY_PATH + "getscript?", PROXY_PATH + "getscript?tripflow_rev=1&")
    if local_host:
        for shard in range(4):
            text = text.replace(f"apimaponline{shard}.bdimg.com", f"{local_host}{PROXY_PATH}tiles/{shard}")
    return text.replace(key, "") if key else text


@router.get("/baidu-map/{path:path}", include_in_schema=False)
async def baidu_resource(path: str, request: Request):
    # GL 的部分模块会在 serviceHost 末尾再加一次斜杠。
    path = path.lstrip("/")
    if not _allowed_path(path):
        raise AppError("MAP_RESOURCE", "不支持的地图资源", status_code=404)
    key = settings.baidu_jsapi_ak
    if not key:
        raise AppError("MAP_CONFIG", "尚未配置百度交互地图", status_code=503)
    if len(request.url.query) > 8192:
        raise AppError("MAP_QUERY", "地图请求过长", status_code=400)
    params = dict(request.query_params)
    params.pop("tripflow_rev", None)
    # SDK 的代理标志只供本机路由使用，透传到瓦片 CDN 会被拒绝。
    params.pop("is_has_bmap_proxy", None)
    for name in ("callback", "cb", "fn"):
        if name in params and not re.fullmatch(r"[A-Za-z_$][\w.$]*", params[name]):
            raise AppError("MAP_QUERY", "地图请求参数有误", status_code=400)
    params["ak"] = key
    tile = re.fullmatch(r"tiles/([0-3])/(pvd|starpic)/?", path)
    upstream_url = f"https://apimaponline{tile[1]}.bdimg.com/{tile[2]}/" if tile else UPSTREAM + path
    try:
        async with httpx.AsyncClient(timeout=15, trust_env=False, follow_redirects=False) as client:
            upstream = await client.get(
                upstream_url, params=params,
                headers={"Referer": str(request.base_url), "User-Agent": "TripFlow-Map/1.0"},
            )
        if upstream.status_code != 200 or len(upstream.content) > 8 * 1024 * 1024:
            raise AppError("MAP_UPSTREAM", "百度地图暂时未连接，请重试", status_code=502)
    except httpx.HTTPError:
        raise AppError("MAP_UPSTREAM", "百度地图暂时未连接，请重试", status_code=502) from None
    content_type = upstream.headers.get("content-type", "application/octet-stream")
    # 百度矢量瓦片可能标成 text/javascript，仍须原样返回二进制。
    textual = not tile and any(kind in content_type for kind in ("javascript", "json", "text/"))
    local_host = request.url.netloc
    if not re.fullmatch(r"[A-Za-z0-9.\-:\[\]]+", local_host):
        raise AppError("MAP_HOST", "地图访问地址有误", status_code=400)
    body = _rewrite_text(upstream.text, key, local_host).encode("utf-8") if textual else upstream.content
    return Response(body, headers={
        "Content-Type": content_type,
        "Cache-Control": "private, max-age=3600" if path.startswith("res/") else "no-store",
        "X-Content-Type-Options": "nosniff",
    })
