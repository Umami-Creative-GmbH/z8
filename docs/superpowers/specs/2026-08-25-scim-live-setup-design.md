# SCIM Live Setup State

## Scope

Keep the SCIM setup controls synchronized with the wizard's saved setup state, make a pending connection creation recoverable without duplicate requests, and route SCIM UI copy through Tolgee fallback calls.

## Design

The wizard passes its current `setup` response and selected default role template to the SCIM step. The SCIM controller derives its connection identifier from this live setup data as well as refreshed control-plane metadata.

While a create request is pending or the control plane reports a creating reservation, creation remains disabled. The step exposes a refresh action that reconciles the current setup/control-plane state without retaining or returning credentials. A reconciled disconnected or creation-failed state permits an explicit retry.

Every user-facing SCIM string uses `useTranslate` with a namespaced key and English fallback. Timestamp formatting uses the active Tolgee locale while retaining UTC for `lastUsedAt`.

## Validation

Focused SCIM tests cover live wizard template updates and creating-to-refresh-to-retry recovery. The SCIM and wizard UI suite and webapp typecheck must pass.
