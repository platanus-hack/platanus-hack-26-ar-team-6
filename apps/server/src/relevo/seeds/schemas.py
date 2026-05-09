"""Pydantic schemas for seed YAML files.

These models lock the YAML shape so authors of seed files (Jorf for personas,
Jerf for memories, etc.) get a clear error when shapes drift instead of silent
garbage at insert time.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

MemoryTier = Literal["personal", "pool", "timeline"]
TaskStatus = Literal["proposed", "open", "in_progress", "blocked", "review", "done"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PersonaVoice(StrictModel):
    tone: str
    first_person: bool = True
    signature_phrases: list[str] = Field(default_factory=list)


class PersonaDomain(StrictModel):
    primary: str
    tags: list[str] = Field(default_factory=list)
    expertise_summary: str


class PersonaEntry(StrictModel):
    """One row in seeds/personas.yaml.

    Maps to: a `person` row + an `agent` row (1-to-1). The full persona JSON is
    stored on `agent.persona`.
    """

    key: str = Field(description="Stable handle used to reference this persona from other seed files (e.g. memories/<key>.yaml).")
    display_name: str
    domain_summary: str = Field(description="Stored on person.domain_summary.")
    voice: PersonaVoice
    domain: PersonaDomain


class PersonasFile(StrictModel):
    personas: list[PersonaEntry]


class MemoryEntry(StrictModel):
    """One row in seeds/memories/<persona_key>.yaml or pool.yaml.

    For personal-tier memories the file path implies the agent (filename = persona key).
    For pool-tier memories agent_key must be omitted.
    """

    tier: MemoryTier
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class PersonalMemoriesFile(StrictModel):
    """seeds/memories/<persona_key>.yaml — every entry is tier='personal'."""

    persona_key: str
    entries: list[MemoryEntry]


class PoolFile(StrictModel):
    entries: list[MemoryEntry]


class TimelineEventEntry(StrictModel):
    occurred_at: datetime
    actor_persona_key: str | None = None
    event_type: str
    subject_type: str | None = None
    subject_id: UUID | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class TimelineFile(StrictModel):
    events: list[TimelineEventEntry]


class TaskEntry(StrictModel):
    title: str
    description: str | None = None
    owner_persona_key: str | None = None
    status: TaskStatus = "proposed"
    dependencies: list[str] = Field(default_factory=list, description="Titles of tasks this depends on; resolved to UUIDs at insert time.")


class TasksFile(StrictModel):
    tasks: list[TaskEntry]
