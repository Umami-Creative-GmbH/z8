# Equipment issue and return tracking

Status: design confirmed on 2026-11-04. Equipment setup (#1536) is implemented; the assignment and return slices remain pending.

Specification: [#1535 — Equipment issue and return tracking](https://github.com/Umami-Creative-GmbH/z8/issues/1535).

Implementation is split into 14 native sub-issues of the specification (#1536–#1549). Start with [equipment setup #1536](https://github.com/Umami-Creative-GmbH/z8/issues/1536); the issue tracker holds the verified blocking relationships.

## Setup implementation (#1536)

- `/settings/equipment` gives accessible organization owners and admins retention, reusable type, identity registration and archive forms. Managers have no implied access. Archived records remain readable.
- The server entry points are `getEquipmentSetup`, `getEquipmentSetupDetail` and `changeEquipmentSetup` in `apps/webapp/src/lib/organization/equipment/actions.ts`. They resolve the active organization and actor on every call. Contracts and refusal codes live alongside them in `contracts.ts`.
- Mutations carry a UUID `requestId`; accepted requests replay their result and reject changed payloads. Policy/type/archive edits carry `expectedRevision`; a new policy uses revision zero. Reload before retrying a stale edit.
- `setup.ts` exposes `prepareEquipmentTypeForIssuance(tx, { organizationId, typeId })` for the next slice. Call it inside the authorized assignment transaction. It requires a policy and active type, permanently records type use, and returns the tracking mode and return default to copy onto the assignment. Registration also records use, so an existing individual identity cannot become quantity equipment. Rolling the transaction back rolls the marker back.
- All equipment state changes serialize with `lockEquipmentOrganization`. Later lifecycle/issuance writers must use a consistent order for lifecycle locks and this equipment lock, and retain the lock through the assignment write. Never save an assignment after committing the type-use transaction separately.
- `src/db/schema/equipment.ts` and migration `0295_equipment_setup.sql` define policy, types, identities and command replay. Item/type references include the organization. The generated normalized identity key is unique without an archive/retirement filter; later cleanup must preserve that row and key.
- Public-action PostgreSQL coverage lives in `src/lib/organization/equipment/setup.integration.test.ts`. Focused form and guarded-route runtime tests live beside the equipment settings components and route.
- All UI copy uses Tolgee keys with static English defaults. Remote `tolgee sync --remove-unused` and `pnpm i18n:pull` still require system Tolgee credentials. Until the new title is synced, the shell uses the existing translated Settings ancestor; remove the equipment exclusion in `src/lib/navigation/route-metadata.ts` after catalog synchronization.

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
