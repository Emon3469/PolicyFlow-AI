from typing import Literal

from pydantic import BaseModel, Field


class HistoryTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=3000)
    history: list[HistoryTurn] = Field(default_factory=list, max_length=20)


class FeedbackRequest(BaseModel):
    query_id: str = Field(min_length=8, max_length=64)
    rating: Literal[-1, 1]
    comment: str = Field(default="", max_length=1000)
