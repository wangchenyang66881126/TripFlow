import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import baidu_map
from app.core.errors import AppError, error_body
from fastapi.responses import JSONResponse


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.include_router(baidu_map.router, prefix="/api/v1")

    @app.exception_handler(AppError)
    async def error_handler(_, error):
        return JSONResponse(error_body(error.code, error.message), status_code=error.status_code)

    monkeypatch.setattr(baidu_map.settings, "baidu_jsapi_ak", "test-browser-key")
    return TestClient(app)


def mock_upstream(monkeypatch, handler):
    original = httpx.AsyncClient
    monkeypatch.setattr(baidu_map.httpx, "AsyncClient", lambda **_: original(transport=httpx.MockTransport(handler)))


def test_sdk_uses_browser_key_only_on_fixed_upstream_and_strips_it_from_response(client, monkeypatch):
    def handler(request):
        assert request.url.host == "api.map.baidu.com"
        assert request.url.scheme == "https"
        assert request.url.params["ak"] == "test-browser-key"
        assert request.headers["referer"] == "http://testserver/"
        return httpx.Response(200, text='s.src="https://api.map.baidu.com/getscript?ak=test-browser-key";', headers={"content-type": "application/javascript"})
    mock_upstream(monkeypatch, handler)
    response = client.get("/api/v1/baidu-map/api?v=1.0&type=webgl&callback=ready")
    assert response.status_code == 200
    assert "/api/v1/baidu-map/getscript" in response.text
    assert "test-browser-key" not in response.text
    assert "api.map.baidu.com" not in response.text


@pytest.mark.parametrize("path", ["https://example.com/file", "place/v2/search", "res/../secret", "getscript/extra"])
def test_only_map_resource_paths_are_allowed(path):
    assert not baidu_map._allowed_path(path)


def test_missing_browser_key_is_explicit(client, monkeypatch):
    monkeypatch.setattr(baidu_map.settings, "baidu_jsapi_ak", "")
    response = client.get("/api/v1/baidu-map/api")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "MAP_CONFIG"


def test_proxy_rejects_script_in_callback(client):
    response = client.get("/api/v1/baidu-map/api", params={"callback": "alert(1)"})
    assert response.status_code == 400


def test_proxy_failure_is_sanitized(client, monkeypatch):
    def handler(request):
        raise httpx.ConnectError("sensitive upstream request", request=request)
    mock_upstream(monkeypatch, handler)
    response = client.get("/api/v1/baidu-map/getscript")
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "MAP_UPSTREAM"
    assert "sensitive" not in response.text


def test_images_are_passed_through_without_text_rewriting(client, monkeypatch):
    data = b"\x89PNG\r\n\x1a\n"
    mock_upstream(monkeypatch, lambda _: httpx.Response(200, content=data, headers={"content-type": "image/png"}))
    response = client.get("/api/v1/baidu-map/res/webgl/test.png")
    assert response.content == data
    assert response.headers["content-type"] == "image/png"


def test_tile_requests_use_fixed_https_shard_and_browser_key(client, monkeypatch):
    def handler(request):
        assert str(request.url).startswith("https://apimaponline2.bdimg.com/pvd/")
        assert request.url.params["ak"] == "test-browser-key"
        assert "is_has_bmap_proxy" not in request.url.params
        return httpx.Response(200, content=b"map-tile\xff\x00", headers={"content-type": "text/javascript"})
    mock_upstream(monkeypatch, handler)
    assert client.get("/api/v1/baidu-map/tiles/2/pvd/?qt=vtile&is_has_bmap_proxy=true").content == b"map-tile\xff\x00"
    assert not baidu_map._allowed_path("tiles/9/pvd/")


def test_sdk_tile_hosts_rewrite_to_same_origin():
    result = baidu_map._rewrite_text('var hosts=["apimaponline0.bdimg.com"]', "", "localhost:8000")
    assert '"localhost:8000/api/v1/baidu-map/tiles/0"' in result


def test_map_access_log_omits_all_query_credentials():
    import logging
    from app.core.logging import MapAccessFilter
    record = logging.LogRecord("uvicorn.access", 20, "", 1, "%s %s %s %s %s", ("client", "GET", "/api/v1/baidu-map/?seckey=private&sign=signature", "1.1", 200), None)
    assert MapAccessFilter().filter(record)
    assert "private" not in record.getMessage()
    assert "signature" not in record.getMessage()
