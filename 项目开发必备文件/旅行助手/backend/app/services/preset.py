"""固定演示方案：仅使用随源码打包的数据，不调用模型、抓取或 POI 检索。"""
from __future__ import annotations

import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from types import SimpleNamespace

from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session

from ..core.config import ASSETS_DIR, settings
from ..core.errors import AppError
from ..models import Place, Trip
from . import nav

TRIP_ID = "cqpreset01"
FIXTURE_DIR = Path(__file__).resolve().parents[1] / "presets" / "chongqing"


def data() -> dict:
    return json.loads((FIXTURE_DIR / "itinerary.json").read_text(encoding="utf-8"))


def is_preset(trip_id: str) -> bool:
    return trip_id == TRIP_ID


def reject_edit(trip_id: str) -> None:
    if is_preset(trip_id):
        raise AppError("PRESET_READ_ONLY", "这是固定演示行程，暂不支持修改或重新规划。", 409)


def ensure_trip(db: Session) -> Trip:
    """SQLite 写锁保护首次建档；重复/并发点击复用同一份只读演示。"""
    fixture = data()
    result = db.execute(insert(Trip).values(
        id=TRIP_ID, source_link=fixture["source_text"], title=fixture["title"],
        city=fixture["city"], note_id="preset:chongqing:v1", status="done",
    ).on_conflict_do_nothing(index_elements=[Trip.id]))
    if result.rowcount:
        for item in fixture["places"]:
            db.add(Place(trip_id=TRIP_ID, confirmed=True,
                         **{key: value for key, value in item.items() if key != "photo"}))
        db.flush()
    trip = db.get(Trip, TRIP_ID)
    places = sorted(trip.places, key=lambda p: (p.day, p.seq))
    route = {"schema_version": 1, "trip_id": TRIP_ID, "preset": True, "days": [
        {**day, "place_ids": [p.id for p in places if p.day == day["day"]]}
        for day in fixture["days"]
    ]}
    # 先完整替换路线文件，再提交数据库；中断后再次进入可重建文件。
    path = ASSETS_DIR / TRIP_ID / "route.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as tmp:
        json.dump(route, tmp, ensure_ascii=False)
        temporary = Path(tmp.name)
    temporary.replace(path)
    db.commit()
    return trip


def hotels() -> dict:
    days = data()["hotels"]
    for day in days:
        for hotel in day["hotels"]:
            point = SimpleNamespace(name=hotel["name"], lat=hotel["lat"], lng=hotel["lng"],
                                    poi_address=hotel["address"], poi_uid=hotel["uid"])
            hotel["link"] = {
                "uri": nav.build_marker_uri(point, settings.baidu_uri_src),
                "web_uri": nav.build_web_marker_uri(point, settings.baidu_uri_src),
            }
    return {"trip_id": TRIP_ID, "days": days}


def photos(places: list[Place]) -> dict:
    metadata = {(p["day"], p["seq"]): p.get("photo") for p in data()["places"]}
    return {str(p.id): {**metadata[p.day, p.seq], "src": f"/api/v1/trips/{TRIP_ID}/photos/{p.id}.jpg"}
            for p in places if metadata.get((p.day, p.seq)) and photo_path(p).exists()}


def photo_path(place: Place) -> Path:
    return FIXTURE_DIR / f"{place.day}-{place.seq}.jpg"
