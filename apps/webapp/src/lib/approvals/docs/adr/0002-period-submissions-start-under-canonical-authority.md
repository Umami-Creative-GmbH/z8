---
status: accepted
---

# Period submissions start under canonical authority, with no legacy requests

Period submissions (#805) are a new approval kind. Every other kind either started as legacy requests and is moving through the lifecycle modes, or, like travel expense reports, runs entirely on legacy requests. We decided that period submissions are decided by canonical workflows from their first day in every organization: they never create legacy requests, never pass through `legacy`, `shadow` or `ready`, and have nothing to migrate later.

## Considered Options

- **Legacy requests, following travel expense reports (#623).** Rejected: proven and quicker, but it adds one more kind to the legacy-to-canonical migration that the time and absence kinds are still working through.
- **Legacy requests first, then the normal lifecycle-mode rollout.** Rejected: shadow mirroring and compatibility writing exist to protect data that legacy requests already hold; a new kind has none.

## Consequences

- An organization's lifecycle mode row for this kind cannot start at `legacy`: the kind needs a way to begin under canonical authority, which no kind has had before.
- The canonical adapter, card and inbox read are the only implementation; there is no legacy handler or legacy escalation entry to fall back to.
