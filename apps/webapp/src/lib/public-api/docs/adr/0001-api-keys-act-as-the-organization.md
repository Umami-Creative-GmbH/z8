# API keys act as the organization, not their creator

An API key belongs to the organization and acts as the organization, limited only by its key scopes; the admin who created it is recorded for attribution and never lends the key their own permissions. Integrations such as payroll sync and BI exports need org-wide, stable access, and a key that silently narrows or dies when one admin is demoted or offboarded breaks them without anyone noticing. This deviates from Better Auth's default of user-owned keys, so existing keys are migrated to organization ownership, and offboarding or demoting the creator leaves their keys working.

## Consequences

- Key scopes are the only limit on what a key reads; there is no member role behind a key to fall back on.
- A request made with a key is never attributed to the key creator. Requests go to a dedicated key request log rather than the user-attributed audit log.
- Revoking a key after its creator leaves is a deliberate admin action, not an offboarding side effect.
