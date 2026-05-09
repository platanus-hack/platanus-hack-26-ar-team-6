"""Pydantic schemas for demo seed YAML files.

These models lock the YAML shape so authors of seed files get a clear error
when shapes drift instead of silent garbage at insert time.

Storage recap (see migrations/0001_init.sql):
  - Single project per demo install.
  - app_user rows hold per-user identity, auth token, and a domain_summary.
  - context_entry holds per-user content, partitioned by user_id; the seed
    file contributes kind='seed' rows.
  - project_context_entry holds shared project-scoped content (read by V3).
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

ContextEntryKind = Literal["seed", "prompt_answer", "cross_user_qa"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class UserProfileVoice(StrictModel):
    """Optional voice fields. Carried over from the old persona contract so the
    on-demand agent (V2) can read them; nothing in V1 enforces their use.
    """

    tone: str | None = None
    first_person: bool = True
    signature_phrases: list[str] = Field(default_factory=list)


class UserProfileDomain(StrictModel):
    primary: str
    tags: list[str] = Field(default_factory=list)
    expertise_summary: str = Field(min_length=20, max_length=280)


class UserEntry(StrictModel):
    """One row in seeds/users.yaml.

    Maps to: an app_user row. The voice + domain blocks are denormalized into
    app_user.profile JSONB for the on-demand agent to consume.
    """

    key: str = Field(
        description="Stable handle used to reference this user from other seed files (e.g. context/<key>.yaml)."
    )
    display_name: str
    domain_summary: str = Field(description="Stored on app_user.domain_summary.")
    auth_token: str = Field(
        min_length=8,
        description="Bearer token the local app uses to identify as this user. Hackathon-only.",
    )
    voice: UserProfileVoice = Field(default_factory=UserProfileVoice)
    domain: UserProfileDomain


class UsersFile(StrictModel):
    users: list[UserEntry]


class ContextEntrySeed(StrictModel):
    """One row in seeds/context/<user_key>.yaml — every entry is kind='seed'."""

    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class UserContextFile(StrictModel):
    """seeds/context/<user_key>.yaml — non-overlapping per-user seed entries."""

    user_key: str
    entries: list[ContextEntrySeed]


class ProjectEntry(StrictModel):
    name: str
    description: str | None = None


class ProjectFile(StrictModel):
    project: ProjectEntry
    context_entries: list[ContextEntrySeed] = Field(default_factory=list)
