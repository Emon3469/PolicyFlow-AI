from typing import Literal

from typing_extensions import TypedDict

Route = Literal["kb", "direct"]
Grade = Literal["good", "weak"]


class TraceStep(TypedDict):
    step: str
    detail: str
    status: str
    ms: int


class AgentState(TypedDict, total=False):
    question: str
    history: list[dict]
    current_query: str
    standalone: str
    route: str
    kb_docs: list[dict]
    kb_query: str
    kb_grade: str
    web_results: list[dict]
    web_answer: str
    web_grade: str
    retry_count: int
    answer: str
    source_used: str
    provider: str
    citations: list[dict]
    trace: list[TraceStep]
