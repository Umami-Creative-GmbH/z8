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

**Acting-for record**:
The stored fact that a deputy decision was made: the deputy, the approver acted for, the absence that made the cover, the authority, the subject and the outcome. One row per decision in `approval_deputy_decision`, written in the decision's transaction (`deputy/deputy-decision-store.ts`); canonical decision events carry the same acting-for in their metadata. Own rights win: an approver, eligible manager or manager of approvals never makes a deputy decision.
_Avoid_: delegation log, proxy record

### Cards

**Review binding**:
An opaque handle on a card, permanently tied to its organization, recipient, submission cycle, assignment, submitted revision and the approval authority it was issued under. It decides only under that same authority. A deputy card's binding also names the absent approver its recipient acts for, and decides only while the recipient is still **Covering** for them.
_Avoid_: card token, action handle
