"""后台任务执行器：线程 + DB 持久化状态（重启可恢复）。"""
from __future__ import annotations

import threading
import uuid

from sqlalchemy import select, update

from ..core.db import SessionLocal
from ..core.errors import AppError
from ..core.logging import get_logger
from ..models import Task, Trip

log = get_logger(__name__)


def start_task(trip_id: str, kind: str) -> str:
    """创建任务并启动后台线程，返回 task_id。"""
    db = SessionLocal()
    try:
        task = Task(id=str(uuid.uuid4()), trip_id=trip_id, kind=kind, status="pending", progress="排队中")
        db.add(task)
        db.commit()
        db.refresh(task)
        task_id = task.id
    finally:
        db.close()

    threading.Thread(target=_run, args=(task_id,), daemon=True).start()
    return task_id


def _run(task_id: str) -> None:
    from . import pipeline  # noqa: PLC0415

    db = SessionLocal()
    try:
        task = db.get(Task, task_id)
        if not task:
            return
        trip = db.get(Trip, task.trip_id)
        if not trip:
            return
        task.status = "running"
        if task.kind in ("parse", "guide", "plan"):
            trip.status = "parsing"
        elif task.kind == "route":
            trip.status = "routing"
        db.commit()

        if task.kind == "parse":
            pipeline.run_parse(db, trip, task)
        elif task.kind in ("guide", "plan"):
            pipeline.run_text(db, trip, task)
        elif task.kind == "route":
            pipeline.run_route(db, trip, task)
        elif task.kind == "export":
            pipeline.run_export(db, trip, task)
        else:
            raise ValueError(f"未知任务类型 {task.kind}")

        task.status = "done"
        db.commit()
    except Exception as e:  # noqa: BLE001
        log.warning("任务失败 task=%s type=%s", task_id, type(e).__name__)
        try:
            db.rollback()
            task = db.get(Task, task_id)
            if task:
                task.status = "failed"
                task.error = e.message if isinstance(e, AppError) else "任务暂时未能完成，请稍后重试。攻略链接读取失败时，可改为粘贴正文。"
                trip = db.get(Trip, task.trip_id)
                if trip and trip.status in ("parsing", "routing"):
                    trip.status = "failed"
                db.commit()
        except Exception:  # noqa: BLE001
            pass
    finally:
        db.close()


def recover_stale_tasks() -> None:
    """新文字任务自动恢复检查点；旧任务保持中断提示，不重复执行外部操作。"""
    db = SessionLocal()
    resumed = []
    try:
        resumed = list(db.scalars(select(Task.id).where(
            Task.status.in_(["running", "pending"]), Task.kind.in_(["plan", "guide"]))))
        db.execute(
            update(Task)
            .where(Task.status.in_(["running", "pending"]), Task.kind.not_in(["plan", "guide"]))
            .values(status="failed", error="服务重启，任务中断")
        )
        db.commit()
    finally:
        db.close()
    for task_id in resumed:
        threading.Thread(target=_run, args=(task_id,), daemon=True).start()
