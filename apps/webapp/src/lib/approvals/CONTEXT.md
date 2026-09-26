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

**Compatibility writing**:
Keeping legacy requests in step with canonical workflows once canonical authority decides, in lifecycle mode `canonical`.
_Avoid_: reverse mirroring

### Cards

**Review binding**:
An opaque handle on a card, permanently tied to its organization, recipient, submission cycle, assignment, submitted revision and the approval authority it was issued under. It decides only under that same authority.
_Avoid_: card token, action handle
