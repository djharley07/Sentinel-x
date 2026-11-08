"""Request identity, shared without importing API modules."""
from contextvars import ContextVar
from dataclasses import dataclass
from uuid import UUID

@dataclass(frozen=True)
class Identity:
    account_id: UUID
    organization_id: UUID
    username: str
    display_name: str
    role: str
    technician_id: UUID | None

current_identity: ContextVar[Identity | None] = ContextVar('sentinel_identity', default=None)

def principal() -> Identity:
    from fastapi import HTTPException
    user = current_identity.get()
    if user is None:
        raise HTTPException(401, 'Sign in to continue.')
    return user
