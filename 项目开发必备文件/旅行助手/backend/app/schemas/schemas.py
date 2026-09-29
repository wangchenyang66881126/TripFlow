"""Pydantic 输入输出结构。"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class TripCreate(BaseModel):
    source_link: str = Field(min_length=1, max_length=2048)


class TripOut(BaseModel):
    id: str
    source_link: str
    note_id: str | None = None
    title: str | None = None
    city: str | None = None
    status: str
    created_at: Any = None


class TaskOut(BaseModel):
    id: str
    trip_id: str
    kind: str
    status: str
    progress: str | None = None
    error: str | None = None
    result_path: str | None = None


class Candidate(BaseModel):
    name: str
    uid: str | None = None
    address: str | None = None
    lat: float | None = None
    lng: float | None = None


class PlaceOut(BaseModel):
    id: int
    day: int
    seq: int
    name: str
    type: str
    source_text: str | None = None
    confirmed: bool
    skipped: bool
    poi_name: str | None = None
    poi_uid: str | None = None
    poi_address: str | None = None
    lat: float | None = None
    lng: float | None = None
    geocode_status: str
    candidates: list[Candidate] | None = None


class PlaceUpdate(BaseModel):
    name: str | None = None
    day: int | None = None
    seq: int | None = None
    type: str | None = None
    confirmed: bool | None = None
    skipped: bool | None = None
    poi_uid: str | None = None
    poi_name: str | None = None
    poi_address: str | None = None
    lat: float | None = None
    lng: float | None = None


class RouteSegment(BaseModel):
    from_place: str
    to_place: str
    mode: str
    distance_m: int
    duration_s: int
    duration_text: str


class RouteDay(BaseModel):
    day: int
    places: list[PlaceOut]
    segments: list[RouteSegment]
    map_url: str | None = None


class RouteOut(BaseModel):
    trip_id: str
    days: list[RouteDay]


class AppNavOut(BaseModel):
    uris: list[str]


class ShareOut(BaseModel):
    trip: TripOut
    places: list[PlaceOut]
    route: RouteOut | None = None
