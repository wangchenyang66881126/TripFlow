"""只读预算状态；不能通过 HTTP 清空或修改全站费用。"""
from fastapi import APIRouter
from pydantic import BaseModel

from ..services import ai_budget

router = APIRouter(tags=["ai-budget"])


class BudgetStatus(BaseModel):
    day: str
    timezone: str
    limit_cny: str
    used_upper_bound_cny: str
    reserved_cny: str
    remaining_cny: str
    can_generate: bool
    resets_at: str


@router.get("/ai-budget", response_model=BudgetStatus)
def get_budget():
    return ai_budget.snapshot()
