"""Legacy request_context module.

The live V2 implementation is mounted from relevo.api.context for both
/request-context and /request_context. This empty router keeps old imports
working without reintroducing the retired stub route.
"""

from __future__ import annotations

from fastapi import APIRouter


router = APIRouter()
