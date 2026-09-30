"""所有测试的费用账本隔离，禁止自动化测试改写真实日额度。"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.core.config import settings
from app.services import ai_budget


@pytest.fixture(autouse=True)
def budget_db(tmp_path, monkeypatch):
    # 原有真实生成/预算测试继续验证正式模式；演示拦截用例显式开启。
    monkeypatch.setattr(settings, "preset_demo", False)
    engine = create_engine(f"sqlite:///{tmp_path / 'budget.db'}", connect_args={"timeout": 30})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(ai_budget, "SessionLocal", factory)
    yield factory
    engine.dispose()
