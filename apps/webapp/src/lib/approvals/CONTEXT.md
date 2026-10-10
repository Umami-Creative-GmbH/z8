# Approvals

Deciding approval requests and delivering their cards while each organization moves each approval kind from legacy requests to canonical workflows.

## Language

### Rollout

**Lifecycle mode**:
The rollout stage of one approval kind in one organization: `legacy`, `shadow`, `ready`, `canonical` or `complete`. It only moves forward; an organization with no recorded stage is in `legacy`.
_Avoid_: rollout mode, cutover state

**Approval authority**:
Which record decides an approval: **legacy** (legacy requests decide; lifecycle mode `legacy`, `shadow` or `ready`) or **canonical** (canonical workflows decide; `canonical` or `complete`).
_Avoid_: "legacy mode" when authority is meant

**Shadow mirroring**:
Copying each legacy write into a canonical workflow while legacy authority still decides, in lifecycle modes `shadow` and `ready`.
_Avoid_: mirroring (unqualified), shadow observation

**Observed workflow**:
The canonical workflow that shadow mirroring keeps for one legacy request. It follows the legacy request and never decides.
_Avoid_: shadow workflow, mirror

**Late mirroring**:
Mirroring a legacy request that was submitted before shadow mirroring began, as a fresh submission, when it is first acted on under shadow mirroring, so the action itself can be mirrored onto its new observed workflow.
_Avoid_: backfill, bootstrap

**Compatibility writing**:
Keeping legacy requests in step with canonical workflows once canonical authority decides, in lifecycle mode `canonical`.
_Avoid_: reverse mirroring

### Deputies

**Deputy decision**:
A decision made by an approver's deputy, during the approver's approved absence, on an approval still assigned to that approver. It records both people.
_Avoid_: delegated decision, proxy approval, on-behalf decision (that term means acting for the requester)

**Covering**:
A deputy covers for an approver on each day, in the approver's timezone, of the approver's approved absence that names them and does not count as working time, while the organization lets deputies decide approvals and the deputy is active and can use the approval inbox. Resolved only by `deputy/covering-store.ts`.
_Avoid_: standing in, substituting, "Vertretung" (German copy says "Abwesenheitsvertretung")

### Cards

**Review binding**:
An opaque handle on a card, permanently tied to its organization, recipient, submission cycle, assignment, submitted revision and the approval authority it was issued under. It decides only under that same authority.
_Avoid_: card token, action handle
