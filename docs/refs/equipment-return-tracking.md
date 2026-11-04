# Equipment issue and return tracking

Status: design confirmed on 2026-11-04. Equipment setup (#1536), individual issuance/receipt (#1537), quantity issuance/partial receipts (#1538), scoped officers (#1539), item readiness/clearance (#1541), and staff-confirmed transfers (#1542) are implemented. Reasoned loss/waiver and recovery (#1540) are implemented; later lifecycle, reminder, export and retention slices remain pending.


Specification: [#1535 — Equipment issue and return tracking](https://github.com/Umami-Creative-GmbH/z8/issues/1535).

Implementation is split into 14 native sub-issues of the specification (#1536–#1549). Start with [equipment setup #1536](https://github.com/Umami-Creative-GmbH/z8/issues/1536); the issue tracker holds the verified blocking relationships.

## Setup implementation (#1536)

- `/settings/equipment` gives accessible organization owners and admins retention, reusable type, identity registration and archive forms. Managers have no implied access. Archived records remain readable.
- The server entry points are `getEquipmentSetup`, `getEquipmentSetupDetail` and `changeEquipmentSetup` in `apps/webapp/src/lib/organization/equipment/actions.ts`. They resolve the active organization and actor on every call. Contracts and refusal codes live alongside them in `contracts.ts`.
- Mutations carry a UUID `requestId`; accepted requests replay their result and reject changed payloads. Policy/type/archive edits carry `expectedRevision`; a new policy uses revision zero. Reload before retrying a stale edit.
- `setup.ts` exposes `prepareEquipmentTypeForIssuance(tx, { organizationId, typeId })` as a shared transaction primitive. Call it inside the authorized assignment transaction. It requires a policy and active type, permanently records type use, and returns the tracking mode and return default. Issuance stores the explicitly agreed return requirement, including any override. Registration also records use, so an existing individual identity cannot become quantity equipment. Rolling the transaction back rolls the marker back.
- All equipment state changes serialize with `lockEquipmentOrganization`. Later lifecycle/issuance writers must use a consistent order for lifecycle locks and this equipment lock, and retain the lock through the assignment write. Never save an assignment after committing the type-use transaction separately.
- `src/db/schema/equipment.ts` and migration `0295_equipment_setup.sql` define policy, types, identities and command replay. Item/type references include the organization. The generated normalized identity key is unique without an archive/retirement filter; later cleanup must preserve that row and key.
- Public-action PostgreSQL coverage lives in `src/lib/organization/equipment/setup.integration.test.ts`. Focused form and guarded-route runtime tests live beside the equipment settings components and route.
- All UI copy uses Tolgee keys with static English defaults. Remote `tolgee sync --remove-unused` and `pnpm i18n:pull` still require system Tolgee credentials. Until the new title is synced, the shell uses the existing translated Settings ancestor; remove the equipment exclusion in `src/lib/navigation/route-metadata.ts` after catalog synchronization.

## Individual custody implementation (#1537)

- `changeEquipment` is the public handover command in `apps/webapp/src/lib/organization/equipment/actions.ts`; its strict contracts are `issue_individual` and `receive_individual` in `contracts.ts`. `getEquipmentOverview`, `getEmployeeEquipment` and `getMyEquipment` return the authorized read models. The server resolves organization, actor and session on every call. Inside the transaction it rechecks SSO/MFA, approved membership, live employment access and equipment authority. Owners/admins manage equipment; managers and employees can read only their own retained history. Officer delegation belongs to the later officer ticket.
- `/equipment` provides issuance, receipt, attributable history and URL filters for holder, type, outstanding, overdue and former employees. `/my-equipment` is read-only. The employee settings profile receives equipment only through its independent authorized read, including former holders. The sidebar supplies separate staff and personal capabilities; the setup page links to the overview. The new routes temporarily use the translated Settings shell title pending Tolgee synchronization.
- Issuance needs a configured policy, an active individual type, an available identity and a current employee. The agreement snapshots return requirement and optional explicit deadline. New handovers require an actual date and good/worn/damaged/unknown condition; notes are optional. Actual dates and deadlines are organization-local calendar dates, while entry timestamps are canonical UTC instants. Future handovers and chronology conflicting with the identity's prior receipt are refused.
- `equipment_item.in_custody` and readiness `status` are nonpersonal state, independent of `equipment_assignment` and its `equipment_handover` evidence. The item also preserves its latest handover date. Never derive availability from the existence or removal of personal assignment history. A partial unique index prevents two unsettled individual assignments for one identity. Composite references enforce organization ownership. Migration `0296_equipment_custody.sql` installs this schema.
- A physical receipt settles the required return and releases custody atomically. Damaged receipts set readiness to unavailable unless already retired. Issued-to-keep equipment has no deadline or outstanding return but stays in custody until receipt. Self-issuance is allowed; self-receipt is refused even for owners/admins. Receipts and staff history reads remain possible after the holder leaves or the type is archived. Readiness controls are described below; exceptions and historical-entry commands are later slices. This boundary offers no raw edit route around those rules.
- Every handover carries a UUID `requestId` and `expectedRevision`. Issuance uses the item's revision; receipt uses the assignment's revision. Committed commands replay their nonpersonal result only for the same actor and payload, before checking stale revisions. A changed payload or actor conflicts. A failed transaction leaves no evidence, custody change or replay receipt. Reload stale forms before retrying.
- **Lock order:** sorted shared user-configuration/access guards for the actor and issuance target, target employee coordination, lifecycle organization row, then `lockEquipmentOrganization`. Fresh issuance rechecks the target after these locks. Equipment setup now takes its actor guard and organization row before equipment too, avoiding reverse-order organization FK waits. Later lifecycle integrations must acquire their existing lifecycle guards before equipment and keep the assignment writes inside the same transaction.
- PostgreSQL tests in `custody.integration.test.ts` drive public actions and reads against the disposable database, including concurrent issue/retry/receipt, actor restrictions, foreign IDs, pending cutoff and a race with real departure commands, date boundaries, archive/default behavior and receipt rollback. Focused runtime tests cover the overview, employee profile, personal route, accessible handover forms, filters and sidebar capabilities. Migration/schema parity uses the existing integration suite.
- Verification gaps: authenticated live Next/browser behavior requires the unavailable Phase database/auth environment. Remote `tolgee sync --remove-unused` and `pnpm i18n:pull` require unavailable Tolgee credentials. No system secrets were requested, and no translated catalog entries were invented. English defaults and local extraction checks are in place.

## Scoped equipment officers (#1539)

- Owners/admins manage responsibilities in `/settings/equipment` through `getEquipmentOfficerGrants` and `changeEquipmentOfficerGrant`. A responsibility covers the whole organization, selected teams, selected employees, or the union of selected teams and employees. Every selection is validated in the active organization. Former or otherwise inaccessible employees cannot receive a new grant.
- `access.ts` is the shared live authority boundary for operational reads and writes. It rechecks organization authentication, approved membership, current employment and the current grant after the documented access/lifecycle/equipment locks. Responsibility changes use the same locks, actor-bound request replay and expected revisions. Revocation fences subsequent reads, commands and old command retries. Setup administration remains owner/admin-only, including transaction-time revalidation. Managers and unrelated officer roles gain no implied equipment access.
- Operational reads restrict employee choices, assignment evidence and receipt actions to current scope. Employees retain their own read-only history. Navigation reads a live grant using the server's already-authorized render identity, without loading equipment history. `/equipment/employees/[employeeId]` provides an independent authorized employee-equipment profile for officers without opening employee administration.
- Readiness controls share the same live grant. A selected-scope officer can manage an item through a covered assignment, including after physical receipt, but a current holder outside the grant fences earlier assignment scope. Items with no retained covered assignment remain with whole-organization officers and owner/admin fallback. Out-of-scope items and their readiness evidence are omitted from scoped reads.
- The strict `register_and_issue_individual` command registers an identity and issues it to a covered current employee in one transaction. It uses revision zero for a new identity and the normal handover rules, replay, custody, identifier reservation and self-receipt restrictions. Officers receive active registration types and available nonpersonal identities, never another holder's custody/history or unrestricted setup access. The overview's issuance form exposes this combined operation.
- Migration `0298_equipment_officers.sql` adds revisioned grants and `equipment_former_team_scope`. Team grants use current primary/secondary membership for current subjects, and **only** captured team IDs for former subjects. Lifecycle integration must upsert the subject's departure-captured teams before roster cleanup, and revoke the departing officer's grant (incrementing its revision) before rehire can occur. This ticket supplies that lookup/storage seam; it does not infer all former subjects or install lifecycle writers. Whole-organization and explicit employee grants can already follow up former subjects.
- Public-action PostgreSQL coverage in `officers.integration.test.ts` includes selected/all scope, team changes, former captured scope, foreign IDs, live departure cutoff, owner fallback, replay after scope removal, self-receipt, concurrent grant revisions/retries, concurrent identity registration and rollback. Sidebar integration and focused form/direct-route tests cover usable officer access. The existing Phase-backed authenticated smoke and Tolgee remote synchronization gaps remain; static English defaults and local extraction checks cover the new copy.

## Quantity handovers implementation (#1538)

- The existing `changeEquipment` public action accepts `issue_quantity` (type, current employee, positive whole quantity, actual date, condition, optional notes, agreed return terms, request identity and expected type revision) and `receive_quantity` (assignment, positive whole quantity, actual date, condition, optional notes, request identity and expected assignment revision). They use the same transactional authorization, lifecycle locks and actor-bound replay boundary as individual handovers. Direct individual receipt cannot settle a quantity assignment.
- Migration `0297_equipment_quantities.sql` (journal index 297, timestamp 1810396800000) backfills existing individual agreements with their type, quantity one and physical receipt count. Quantity assignments reference an organization type and have no artificial item identity. Database constraints bound physical receipt totals, keep individual quantities at one and preserve one issuance per assignment. The `received` flag means the full quantity was physically received; it is not a general obligation-closure flag.
- `getEquipmentOverview`, `getEmployeeEquipment` and `getMyEquipment` expose `quantity`, `physicallyReceivedQuantity`, `outstandingQuantity` and all `receipts`, each with quantity, date, condition, notes, actor and UTC entry timestamp. `receipt` remains the latest physical receipt for existing individual consumers. Required quantities remain outstanding/overdue until fully received; issued-to-keep quantities have no return balance or deadline but can be voluntarily received in parts. Later loss/waiver outcomes must reduce the obligation separately and must never increase the physical receipt count.
- The existing overview and employee-profile issuance forms offer active quantity types alongside individual items; personal and staff history share explicit totals and independent receipt evidence. Receipt forms cap quantity at the remaining physical balance. A partial receipt never labels the whole assignment physically received or implies clearance for a damaged individual identity.
- Public PostgreSQL coverage is in `quantities.integration.test.ts`, alongside existing setup and individual custody regressions. Focused quantity-entry, partial-receipt and read-display coverage extends `equipment-workspace.test.tsx`. Live authenticated smoke checks and remote translation synchronization still require unavailable Phase DB/auth and Tolgee system credentials; English static defaults and local extraction checks remain in place.

## Item readiness and clearance implementation (#1541)

- `changeEquipment` accepts strict `clear_item`, `mark_item_unavailable` and `retire_item` commands with `itemId`, `requestId` and `expectedRevision`. These pass through the existing current equipment authority decision, transaction locks and actor-bound replay boundary in `custody.ts`. `readiness.ts` contains transaction primitives, not a second public action or independent role policy.
- Clearance changes readiness only when the item is unavailable, unarchived, not retired and physically out of custody. Custody stays authoritative after personal-history removal, including equipment issued to keep and future lost/waived outcomes. A readiness decision never releases custody or creates physical receipt. Retirement is terminal; a subsequent damaged receipt cannot downgrade retired status to unavailable.
- Migration `0299_equipment_readiness.sql` (journal index 299, timestamp 1810569600000) adds separate `equipment_item_readiness_event` evidence with the actor, UTC entry instant, decision and item revision. It never overwrites `equipment_handover` or its recorded receipt condition. Retired identities retain the existing unconditional organization/normalized-identifier uniqueness constraint.
- The authorized staff read returns `EquipmentView.readinessItems` with current status, custody, allowed controls and attributable availability history. Personal reads return no management items. `/equipment` provides explicit clearance/unavailable/retirement confirmations and displays event times in the organization timezone. Issue selection excludes unavailable, retired, archived and held items; fresh issuance rechecks state and revision under the same equipment lock.
- `readiness.integration.test.ts` exercises the public actions and reads with disposable PostgreSQL: receipt versus readiness, evidence preservation, terminal retirement and identity reservation, stale/racing issuance, concurrent replay, actor/tenant restrictions, authority changes while waiting, and transactional rollback/retry. `equipment-readiness.test.tsx` covers confirmations, uncertain retries, stale feedback, organization-zone evidence, item selection and personal read-only behavior.
- Authenticated live Next/browser smoke remains unavailable without Phase database/auth credentials. Remote Tolgee synchronization/pull remains unavailable without Tolgee system credentials; new text retains static English defaults and is covered by local extraction checks. Local React Doctor runs use `--no-score --no-supply-chain`, without diagnostic upload; its TanStack `preventDefault` warning reflects the required client form pattern.

The migration journal includes quantity `0297`, officer scope `0298` (timestamp 1810483200000), and readiness `0299` in ascending order.

## Loss, waiver and physical recovery (#1540)

- `changeEquipment` accepts `close_return` with assignment, expected revision, request identity, positive whole quantity, `outcome: "lost" | "waived"` and a mandatory trimmed reason. It uses `access.ts`'s current `canAdminister` decision; an officer grant never grants exception-closure authority. Another owner/admin must close the actor's own return. Only outstanding required quantities can be closed.
- `receive_exception` records actual physical receipt against an `exceptionId` on the same assignment and organization, with quantity, actual date, condition and optional notes. It uses the shared current receiver scope, forbids self-receipt, and rechecks authority after taking the existing lifecycle/equipment locks. The actual receipt cannot precede issuance or the exception decision's organization-local calendar date. A loss receipt is recovery; a waiver receipt is a voluntary return of waived equipment. Ordinary receipts cannot consume quantities already closed as lost or waived; use their linked receipt action.
- Migration `0300_equipment_exceptions.sql` uses journal index 300 and timestamp 1810656000000, following officers 0298 and readiness 0299. `equipment_exception` retains the decision's original kind, quantity, reason, actor and UTC entry instant. Physical handovers reference it through an organization-and-assignment composite foreign key. Its `receivedQuantity` is bounded by the decision quantity. Assignment `lostQuantity` and `waivedQuantity` retain the original closure totals; `receivedQuantity` counts all actual receipts. `exceptionReceivedQuantity` counts the physical receipts overlapping an already closed exception. For required assignments, outstanding is `quantity - receivedQuantity - lostQuantity - waivedQuantity + exceptionReceivedQuantity`; equipment issued to keep has zero outstanding. The overlap prevents recovery from settling a quantity twice. Database constraints bound these balances without integer-overflow arithmetic.
- The read models expose independent `lostQuantity`, `waivedQuantity`, `recoveredQuantity` (physical receipts linked to loss), `exceptions`, linked `receipts`, and action capabilities. Recovery is included in physically received totals; loss/waiver decision totals remain visible. A closed obligation with retained custody is labelled **Return obligation closed**, never physically received or issued to keep. Each decision and recovery has attributable history on the staff overview, scoped employee equipment view, employee profile and personal read-only view. The existing outstanding/overdue filters exclude resolved quantities while holder/type/former views retain their history.
- Closing an individual return never releases `equipment_item.inCustody` or changes readiness. Recovery and waived receipt release custody atomically with physical receipt. Damaged recovery sets unavailable unless the item is retired, and subsequent issuance still requires separate readiness clearance. Archived types/items and former holders remain recoverable. No raw edit or reversal command is added; exception reversals belong to #1544.
- `exceptions.integration.test.ts` drives the public actions/reads through disposable PostgreSQL: the three-shirt example, partial loss/waiver, receipt overlap, input/tenant/self restrictions, scoped officer recovery, current/revoked authority (including while waiting), replay/payload/actor conflicts, competing closures/receipts/recoveries, damaged readiness, former/archive history and transactional failure/retry. `equipment-exceptions.test.tsx` exercises closure/recovery/waived-receipt forms, mandatory reasons, quantity bounds, unchanged retry identity, edited requests, stale feedback, employee-profile availability and distinct personal-history labels. A combined transfer test proves only unsettled quantities can transfer and that subsequent recovery retains the original loss without double settlement. Existing equipment suites remain the regression boundary.
- Verification gaps: authenticated live Next/browser smoke requires unavailable Phase database/auth credentials. Remote `tolgee sync --remove-unused` and `pnpm i18n:pull` require unavailable Tolgee credentials. New strings keep static English defaults and local extraction coverage. Full production build is deliberately deferred to the parent integration run because concurrent builds exhausted memory. React Doctor runs locally with `--no-score --no-supply-chain`; no diagnostic upload is used. The final local React Doctor scan reports no issues after integrating the shared transfer editor and validation module.

## Staff-confirmed transfers (#1542)

- `changeEquipment` accepts the strict `transfer_equipment` command: source `assignmentId` and `expectedRevision`, target `employeeId`, positive whole `quantity`, `expectedIssuanceRevision`, independent `receipt` and `issue` evidence, and one UUID `requestId`. Each evidence object supplies its actual organization-local date, condition and optional notes. The new issuance additionally supplies its own return requirement and optional deadline. The successful result identifies the new target assignment; the source holder and agreement are preserved.
- The command uses the shared current authority in `access.ts` for both source and target before execution and before replay. Target lifecycle guards precede organization/equipment locks. `custody.ts` uses the same transaction handover primitive for ordinary receipts, issuance and both transfer legs. Refusing either leg, or a database failure after receipt, rolls back all evidence, balances, custody and replay identity. An unchanged successful command replays only for its original actor and payload.
- Quantity transfers may receive and issue part of the source's remaining unsettled balance. Lost or waived quantities require their linked exception receipt first and are excluded from transfer controls and submission bounds. Individual transfers require quantity one, receipt before new issuance, and current available readiness. A damaged receipt cannot clear the item: the combined transfer refuses and rolls back, leaving staff to record receipt separately and then record separate clearance before issuance. Unavailable, retired, archived or still-held identities cannot bypass ordinary issuance rules. Loss/waiver/recovery remain separate commands owned by #1540; this slice adds no exception path.
- Staff can open the transfer form from eligible assignments in `/equipment`, the scoped employee equipment route and authorized employee-profile sections. The form identifies the source and separates receipt evidence from new issuance evidence and terms. Target selection contains authorized current employees other than the source. Personal history is read-only. Both employees' authorized histories and worklist balances reflect the committed handovers through the existing reads and route revalidation.
- `transfers.integration.test.ts` exercises public actions and reads with real PostgreSQL for partial quantities, individual custody, independent evidence/terms, chronology, invalid targets, self-receipt refusal, readiness, rollback/retry, actor-bound replay, stale revisions, racing return/transfer, and current scope loss on either employee. `equipment-transfer.test.tsx` covers accessible fields and errors, quantities, target selection, terms, stale/uncertain retries and read-only controls. New text has static English defaults and passes local extraction checks.
- No schema change was needed. Migration slot `0301` (index 301, timestamp 1810742400000) remains unused. Authenticated live `/equipment` and employee-history smoke tests remain unrun because Phase database/auth credentials are unavailable; remote `tolgee sync --remove-unused` and `pnpm i18n:pull` remain unrun because Tolgee credentials are unavailable. Local React Doctor uses `--no-score --no-supply-chain` without diagnostic uploads. The parent integration run owns the final production build.


## Agreed scope

- Track equipment held by employees, its condition, and required returns. Purchasing, depreciation, repairs, and warehouse stock control are outside the first version.
- Support individually identified items and quantity assignments, including partial returns of quantities.
- Owners and admins manage all assignments and can delegate equipment management to equipment officers. Employees can view their own equipment. A manager role alone grants no equipment management authority.
- Each assignment explicitly states whether return is required. Equipment the employee may keep does not create a departure return obligation.

Terminology lives in the [Organization context](../../apps/webapp/src/lib/organization/CONTEXT.md#equipment-confirmed-design).

## Existing lifecycle constraints

These are existing behavior, not newly settled equipment decisions:

- A departure takes effect at its cutoff even when follow-up remains pending or fails. Outstanding equipment must not silently change that contract.
- Deactivation has the same consequences as an effective departure (Organization ADR 0006); equipment integration must account for both paths.
- Kiosk credential revocation and physical possession are separate. Recording a returned fob is not the same as ending its authorization.

See the [offboarding reference](employee-offboarding.md) and [Organization ADR 0006](../../apps/webapp/src/lib/organization/docs/adr/0006-deactivation-makes-a-former-employee-like-a-departure.md).

## Departures, deactivation, and rehire (Q5)

Required returns remain actionable after a scheduled departure takes effect or the employee is deactivated. They never postpone the end of employment or access revocation. Rehire does not clear old obligations. Physical key or fob receipt remains separate from credential revocation.

## Return deadlines (Q6, Q12)

A return deadline is optional during employment. A scheduled departure makes required equipment due by the last working day unless already due earlier. Immediate deactivation makes required returns due that day unless already due earlier. Deadlines are calendar dates in the organization's timezone.

Editing or cancelling a scheduled departure recalculates only the deadline derived from that departure. An explicit return deadline is preserved. Cancellation does not undo recorded returns.

## Individually identified equipment (Q7)

An individually tracked item has an organization-unique equipment identifier and at most one current holder. A manufacturer serial number is optional and supplements that identifier. Return and subsequent issuance preserve the item's assignment history.

## Condition and handover evidence (Q8–Q9)

Every issuance and physical return records good, worn, damaged, or unknown condition, with optional notes. Each partial return has its own condition record so differently conditioned quantities can be received separately.

Authorized staff record issuance and confirm physical receipt. Each action records who performed it and when. Employees cannot mark their own equipment returned. Employee acknowledgment and signatures are not required in the first version.

## Equipment officer scope (Q10)

Owners and admins alone manage equipment officer grants. A grant covers the whole organization or selected teams and employees; officers can manage assignments only within that scope. Owners and admins can manage all assignments. A manager role alone supplies no equipment management authority.

## Lost equipment and waived returns (Q11)

Owners and admins may close all or part of an outstanding return as lost or return waived, with a mandatory reason. Those quantities remain separately visible in history and are never counted as physically returned. Financial recovery and payroll deductions are outside this feature.

## Equipment types (Q13)

Organizations maintain reusable equipment types, such as Laptop or Shirt size M. Each type defines individual versus quantity tracking and a default return requirement. The return requirement can be overridden at issuance. Used types are archived instead of deleting their history.

## Corrections (Q14)

Corrections preserve the original record, identify the correcting person, and require a reason. Officers can correct within their scope; only owners and admins may reverse lost or waived outcomes. A correction that would give one individually identified item two holders is refused.

## Product surfaces (Q15)

Provide an Equipment overview for authorized staff, an equipment section on employee profiles, a view of the employee's own equipment, and outstanding returns in departure and deactivation previews. The overview filters by holder, equipment type, outstanding returns, overdue returns, and former employees. Managers require an explicit equipment grant to view other employees' equipment.

## Initial entry and evidence scope (Q16–Q17)

Authorized staff may record equipment already held by current or former employees. The actual issue date is separate from when the record was entered; condition may be unknown for historical entries. Initial entry is manual. Bulk imports, photo uploads, and signed handover documents are outside the first version.

## Recovery of lost equipment (Q18)

Receiving equipment previously closed as lost creates a linked recovery record with receipt and condition, preserving the original loss decision. An individually identified lost item remains unavailable for assignment until recovered.

## Officer grant lifecycle (Q19)

An equipment officer's grant ends when they leave; rehire does not restore it. Other currently authorized officers continue to manage former employees' returns. For team-scoped access to a former employee, use the employee's team membership when they left together with the officer's current grant. Owners and admins are the fallback.

## Return reminders (Q20)

Employees receive reminders three calendar days before and on the return deadline. Responsible officers receive a notice on the first overdue day and weekly afterward. Delivery defaults to in-app and email, respecting notification preferences. Former employees receive no reminders; currently authorized officers receive follow-up, with owners and admins as fallback. Resolved quantities no longer generate return reminders.

## Employee visibility and personal data exports (Q21)

Employees can see their own assignment history, conditions, notes, corrections, and lost or waived outcomes. These records are included in their organization-scoped personal data export. Former employees use the existing admin-assisted export route. Equipment has no additional hidden employee-record category in the first version.

## Equipment record retention (Q22)

Before using the feature, an organization configures a finite retention period for closed assignment records. The period starts at the latest activity on a fully closed assignment. Outstanding obligations and documented case holds protect records from cleanup. On expiry, remove employee links and personal details, retaining only nonpersonal item history.

Keeping a correction or loss decision in history means retaining it until this policy permits cleanup, not promising permanent personal history. Cleanup must not make an item available for reassignment or make its identifier reusable: custody availability and the employee's retained personal history are separate concerns.

## Transfers between employees (Q23)

A transfer requires recorded receipt followed by a new issuance. Authorized staff may perform these together while preserving both handovers and their conditions. Employee-to-employee transfers without staff confirmation are outside the first version. An identified item never acquires two holders through a transfer.

## Equipment issued to keep (Q24)

Assignments without a return requirement are shown as issued to keep. They have no return deadline, outstanding return, or return reminder. An individually identified item issued to keep cannot be issued again unless physically received back. Converting an existing required return into permission to keep requires an owner's or admin's recorded waiver.

## Damaged equipment and availability (Q25)

A damaged item needs an officer's explicit clearance before it can be issued again. Its received condition remains on the return record, and clearance is recorded separately. Authorized staff may mark an item unavailable or retired. This is limited availability control, not a repair or warehouse stock workflow.

## Stable equipment identities and type defaults (Q26)

Equipment identifiers remain unique within the organization even after retirement. Identifier equality ignores surrounding spaces and letter case. Type default changes affect only future assignments. Once a type has been used, changing between individual and quantity tracking requires a new type.

## Staff's own equipment (Q27)

An employee cannot confirm their own physical return, including when acting as an owner or admin. Another authorized person must receive it. Another owner or admin must close that person's own obligation as lost or return waived. Corrections cannot bypass these restrictions. Staff may record equipment issued to themselves.

## Historical handover dates (Q28)

A historical assignment may have an explicitly unknown issue date. Every new handover requires its actual date; the entry timestamp is always retained separately. Refuse future handover dates and conflicting item histories. Former employees may receive historical records but cannot receive newly issued equipment.

## Consistency scenarios

- Three required shirts: receive two in good condition and close one as lost with an admin reason. History shows two physically returned, one lost, and no outstanding return; it never claims three were returned.
- A laptop remains with an employee when departure takes effect. Employment and access end, the return remains actionable, and a later rehire neither clears it nor issues the same laptop again.
- A scheduled departure is cancelled. Its derived return deadline is removed, an explicit return deadline remains, and recorded handovers remain recorded.
- A damaged laptop is received. The return obligation is fulfilled, but the item cannot be issued again until an officer records clearance.
- A lost item is recovered. Record receipt and condition alongside the earlier loss outcome; do not erase the loss decision or create an extra returned quantity.
- Retention removes a closed issued-to-keep assignment's personal details. Its equipment identifier remains reserved and the item remains unavailable for reassignment until physically received back.
- An admin's own laptop is returned. Another authorized receiver records receipt; a self-correction cannot substitute for that receiver.

## Design tree and confirmation

- Scope and item model: Q1–Q2, Q4, Q7, Q13, Q16, Q24–Q26 agreed.
- Actors and authority: Q3, Q9–Q10, Q15, Q19, Q27 agreed.
- Return lifecycle: Q5–Q6, Q11–Q12, Q14, Q18, Q23, Q28 agreed.
- Condition and evidence: Q8–Q9, Q16–Q18, Q25 agreed.
- Product surfaces, reminders, and personal exports: Q15, Q20–Q21 agreed.
- Retention: Q22 agreed.

All interview decisions Q1–Q28 are agreed. The user confirmed shared understanding in Q29 on 2026-11-04; the design interview is complete. No product code, schema, or migration has been implemented by this interview.
