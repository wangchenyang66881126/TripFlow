"""推荐住宿纯函数测试。"""
import json
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

from app.services import hotels as hotels_svc
from app.services.hotels import pick_hotels

SRC = "webapp.tripflow.tripflow"
ANCHOR = SimpleNamespace(name="解放碑", lat=29.5585, lng=106.5770)


def _hotel(uid, grade, rating, comments, lat=29.56, lng=106.58):
    return {
        "name": f"酒店{uid}",
        "uid": uid,
        "address": "渝中区",
        "location": {"lat": lat, "lng": lng},
        "detail_info": {
            "classified_poi_tag": f"酒店;{grade}",
            "overall_rating": str(rating),
            "comment_num": str(comments),
        },
    }


def test_one_hotel_per_tier_in_order():
    results = [
        _hotel("a", "豪华型", 4.8, 86),
        _hotel("b", "经济型", 4.3, 42),
        _hotel("c", "舒适型", 4.7, 72),
        _hotel("d", "公寓式酒店", 4.9, 50),
    ]
    hotels = pick_hotels(results, ANCHOR, SRC)
    assert [h["tier"] for h in hotels] == ["budget", "comfort", "premium"]
    assert [h["uid"] for h in hotels] == ["b", "c", "a"]
    assert hotels[0]["link"]["uri"].startswith("baidumap://map/marker")
    web = urlsplit(hotels[0]["link"]["web_uri"])
    x, y, zoom = web.path.split("/@")[1].split(",")
    assert 11800000 < float(x) < 11900000  # 重庆的 BD09MC 范围，不是经纬度
    assert 3400000 < float(y) < 3450000
    assert zoom == "16z"
    assert parse_qs(web.query)["uid"] == ["b"]


def test_prefers_rating_with_enough_comments():
    results = [
        _hotel("few", "舒适型", 4.9, 3),
        _hotel("many", "舒适型", 4.6, 51),
        _hotel("zero", "舒适型", 0, 0),
    ]
    hotels = pick_hotels(results, ANCHOR, SRC)
    assert [h["uid"] for h in hotels] == ["many"]


def test_falls_back_when_all_have_few_comments():
    hotels = pick_hotels([_hotel("x", "经济型", 4.1, 2), _hotel("y", "经济型", 4.5, 4)], ANCHOR, SRC)
    assert hotels[0]["uid"] == "y"


def test_days_follow_route_order(monkeypatch):
    pts = [SimpleNamespace(id=i, day=1 if i < 3 else 2, seq=i, lat=29.5 + i / 100, lng=106.5) for i in range(1, 5)]
    route = {"days": [{"day": 1, "place_ids": [2, 1]}, {"day": 2, "place_ids": [3, 4]}]}
    monkeypatch.setattr(hotels_svc.pipeline, "load_route_json", lambda _: route)
    days = hotels_svc._ordered_days("t", pts)
    assert [(d, [p.id for p in ps]) for d, ps in days] == [(1, [2, 1]), (2, [3, 4])]
    monkeypatch.setattr(hotels_svc.pipeline, "load_route_json", lambda _: None)
    assert [p.id for p in hotels_svc._ordered_days("t", pts)[0][1]] == [1, 2]


def test_old_cache_links_are_repaired_without_api_key_or_new_search(monkeypatch, tmp_path):
    anchor = SimpleNamespace(id=1, day=1, seq=1, name="解放碑", lat=29.563326, lng=106.583439, skipped=False)
    days = [(1, [anchor])]
    hotel = pick_hotels([_hotel("saved", "经济型", 4.7, 51)], anchor, SRC)[0]
    original_details = {k: v for k, v in hotel.items() if k != "link"}
    hotel["link"]["web_uri"] = "https://map.baidu.com/@106.580000,29.560000,16z"
    cached = {"trip_id": "saved-trip", "signature": hotels_svc._signature(days), "days": [{"day": 1, "hotels": [hotel]}]}
    cache = tmp_path / "saved-trip" / "hotels.json"
    cache.parent.mkdir()
    cache.write_text(json.dumps(cached), encoding="utf-8")
    monkeypatch.setattr(hotels_svc, "ASSETS_DIR", tmp_path)
    monkeypatch.setattr(hotels_svc.settings, "baidu_map_ak", "")
    monkeypatch.setattr(hotels_svc, "_ordered_days", lambda *_: days)

    def no_search(*_):
        raise AssertionError("修正缓存不应调用百度 API")
    monkeypatch.setattr(hotels_svc, "_recommend_near", no_search)
    first = hotels_svc.recommend("saved-trip", [anchor])
    repaired = first["days"][0]["hotels"][0]
    assert {k: v for k, v in repaired.items() if k != "link"} == original_details
    x, y, _ = urlsplit(repaired["link"]["web_uri"]).path.split("/@")[1].split(",")
    assert 11800000 < float(x) < 11900000 and 3400000 < float(y) < 3450000
    assert parse_qs(urlsplit(repaired["link"]["web_uri"]).query)["uid"] == ["saved"]
    assert json.loads(cache.read_text(encoding="utf-8")) == first
    assert hotels_svc.recommend("saved-trip", [anchor]) == first
