# Historical work diagnostics with scoped completeness (#319 / T54)

## Delivery and activation status

Operators can now read record-level diagnostics of historical work. For a requested
employee scope and date range, the report says whether the evidence is complete,
lists each missing, conflicting or suspect representation with its reason and
provenance, and shows each employee's append assurance as a separate claim. This
delivers the graph-aware diagnostics that
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145)
allows before activation. It also covers the operator surfacing moved here from #324.

Everything here is a **read**. Nothing writes, repairs, derives a missing value,
reinterprets a manual submission or changes an approval. Repair belongs to #320 and
#323. Scoped payroll collection, where an export is all-or-blocked, belongs to #322.
Payroll workspace and export behaviour is unchanged.

References: [#319](https://github.com/Umami-Creative-GmbH/z8/issues/319),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the canonical
resolutions of [#260](https://github.com/Umami-Creative-GmbH/z8/issues/260#issuecomment-5654136671)
(§2, §4, §7, §8), [#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538)
(§9) and [#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).

## Modules

| Module | Role |
| --- | --- |
| `lib/time-tracking/historical-work-diagnostics.ts` | Pure assessment: shape matrix, provenance, relevance and completeness, manual diagnoses, and the authorized projection. |
| `lib/time-tracking/historical-work-diagnostics-reader.ts` | Loads the evidence in the same read-only repeatable-read snapshot as `readAppendAssurance`. That existing module is reused; this slice adds no second lineage reader. |
| `lib/time-tracking/diagnostic-access.ts` | Decides who is an operator. It is shared with `POST /api/time-entries/verify`. |
| `POST /api/time-entries/diagnostics` | Returns diagnostics for one employee and a calendar-date range (at most 366 days). |
| `/settings/work-diagnostics` | Org-admin page. It covers every employee (including inactive ones) or one employee, month by month. |

## Evidence read, before any filter

The reader loads the whole history of the scoped employees. It applies no approval
filter, no end-present filter and no date filter:

- legacy periods, including deleted, pending, rejected and open ones;
- canonical work records with their detail and project allocations;
- endpoint entries;
- completed-work receipts;
- the append control and each employee's admission instant.

It also follows **one hop of linked evidence that another employee owns**: a record
that a scoped period links to or shares an ID with, and a period that links to a
loaded record. This keeps an ownership conflict from hiding behind an employee
filter.

Finally, it lists the organization's work whose `employee_id` is not one of the
organization's employees. Only the work IDs are kept, never the foreign owner.

Relevance is decided afterwards, per finding.

## Shape matrix (#260 §2)

Each finding has a `shape`:

- **missing**: a value that other evidence establishes is absent.
- **conflicting**: two representations disagree.
- **suspected_defect**: a historical manual-entry behavior.
- **disclosure**: a limitation that does not make the work uncertain.

A canonical record is one of three things:

- the representation of the period that links to it;
- the representation of an unlinked period with the same ID. This is the backfill identity convention, and it is reported as `canonical_link_missing`.
- canonical-native work, which is validated on its own evidence and never asked for a legacy period.

| Area | Findings |
| --- | --- |
| Ownership | `ownership_conflict`: period, record and endpoint entries name different employees; all of them are kept. `work_outside_organization_employees`: widens to the organization. |
| Canonical links | `canonical_missing`, `canonical_link_missing`, `canonical_link_unresolved` (widens to the employee), `canonical_link_shared` (several periods link one record), `canonical_detail_missing`, `relinked_canonical_residue` (a record carrying a period's ID while that period links elsewhere; ambiguous duplicate lineage, never native work). |
| Endpoints and captures | `endpoint_missing` (closed period without an end, or canonical work opened but never completed), `endpoint_conflict` (period against canonical record or against endpoint entry), `open_state_conflict`, `multiple_active_work`, `endpoint_entry_unresolved`, `endpoint_entry_superseded`, `endpoint_entry_missing` (not blocking), `capture_inferred` (disclosure: `historical_inference`/`backfill` captures do not prove the original context). |
| Duration | `duration_missing` (never derived), `duration_conflict` (never picks a side), `negative_duration`, `reversed_interval`, `empty_interval` (nondeleted equal endpoints). Zero minutes over a positive sub-minute interval is accepted. `stored_elapsed_discrepancy` is a disclosure, because established stored minutes govern (#321). |
| Deleted work | Deletion evidence is preserved, and a deleted period needs no canonical record. The only finding is `deleted_work_payable`: its record still spans a nonempty interval. A deletion sentinel (equal endpoints) is accepted. |
| Metadata | `metadata_missing`: the period has a value and the record has none. `metadata_conflict`: both have values and they differ. `metadata_canonical_only`: the record is richer (disclosure). A period's project counts as present when any project allocation of the record holds it. |
| Approvals | `approval_state_conflict`. `approval_relationship_missing`: pending work with no pending changes, no workflow and no legacy `approval_request` naming the period. Current status is never used to infer history. |
| Duplicate lineage | `overlapping_work`: every nondeleted period and native record occupies its half-open interval, active work from its start onward, and adjacency is allowed. It covers overlapping concurrent submissions (§8) and records left behind as duplicates. Matching intervals are reported, never merged. Append lineage issues remain in append assurance. |

## Provenance and treatment (#260 §7)

Provenance comes from durable write evidence, never from the work date. The
**adoption point** is the employee's `time_entry_append_position.admitted_at`. When
the employee has none and the control is `active`, the control's `updated_at` is
used instead: there is no application setter, so its last update is the activation.

| Evidence | Provenance |
| --- | --- |
| No adoption point | `pre_adoption` / `organization_not_adopted` |
| Row written before the adoption point, no receipt | `pre_adoption` / `written_before_admission` |
| Creating receipt under `legacy` admission before the point | `pre_adoption` / `legacy_admission_receipt` |
| Creating receipt under `append` admission, work starting before the point | `fresh_backdated` |
| Creating receipt under `append` admission otherwise | `post_adoption` |
| Row written after the point without a receipt; legacy receipt after the point; pre-adoption work amended under `append` | `ambiguous` (investigation) |

A finding that spans several works takes the worst provenance: post-adoption, then
backdated, then ambiguous, then pre-adoption.

The treatment follows from shape and provenance:

- fresh post-adoption and backdated writes are an `integrity_incident`;
- ambiguous provenance is `investigation_required`;
- a pre-adoption missing value is a `historical_gap`, which is the only treatment #320 may consider;
- a pre-adoption conflict or suspected defect is `review_required`;
- a disclosure is `disclosed`.

Limitation: row `created_at` is write-time evidence. It is not a signed operation
record, and legacy in-flight inventory (#327) is not modelled.

## Historical manual entries (#260 §8)

Legacy manual submissions keep their request and result in
`time_record_work.computation_metadata`. The diagnosis interprets the submitted wall
times in the evidenced zone. That zone is the request's zone or, if the request has
none, the clock-in capture recorded at submission. A capture that was inferred later
is never used.

- `manual_zone_unrecorded`: neither the request nor a contemporaneous capture names the zone. It is `review_required`: a reviewer asks for human evidence instead of choosing a zone.
- `manual_interpretation_ambiguous`: the wall time falls into a daylight-saving gap or fold.
- `manual_interpretation_mismatch`: the untrimmed persisted result differs from the reconstruction.
- `manual_trimmed`: the legacy writer trimmed the submission. The diagnosis reports the submitted and persisted intervals, and nothing is restored.
- `manual_holiday_check_dates_differ`: the legacy validator checked the submitted interval's **UTC** dates, end date included. This finding reports when those dates differ from the dates the interval occupies in its zone. It uses no current holiday configuration and reevaluates no eligibility.
- `manual_evidence_unreadable`: the stored evidence carries the manual marker but cannot be parsed.

Suspected defects never block completeness: the established interval stands until an
authorized review changes it.

## Scoped completeness (#260 §4)

A finding's relevance has one of three levels:

- **interval**: the hull of all its representations. An unknown end stays open toward later scopes.
- **employee**: its dates cannot be established.
- **organization**: its ownership cannot be established.

`missing` and `conflicting` findings are blocking. The exception is
`endpoint_entry_missing`, because the period and the record already establish that
interval.

The scope is `complete` when no blocking finding is relevant, and `incomplete`
otherwise. An incomplete scope carries `widenedTo` (`requested`, `employees` or
`organization`) and the affected employees. Diagnostic reads may show unaffected data
under that marker. An export stays all-or-blocked (#322).

Calendar dates become the instants of every zone's local day (−14h/+14h, the same
envelope payroll queries use). A diagnostic scope therefore never depends on the
viewer's zone.

Append assurance comes from the same snapshot. It is returned separately and never
makes a scope incomplete. Its `payroll_readiness_not_assessed` limitation keeps the
two claims apart.

## Authorization (#260 §4)

`historicalWorkViewerAccess` defines two kinds of operator:

- **Organization administrators** (`manage OrgSettings`) see everything.
- **Other operators** see employees whose time entries they manage through the CASL subject check. For a manager, that means direct reports only. Managing your own entries does not make you an operator.

For a non-administrator operator:

- A finding that names any employee they may not diagnose keeps only its kind, shape, treatment and blocking flag.
- Organization-level work is redacted the same way.
- Affected-employee lists drop those employees and report `redactedEmployeeCount`.

A reader without diagnostic access gets `summarizeHistoricalWork`: status, widening,
range and counts, with no identities. The route answers:

- 403 for an employee the caller may not diagnose;
- 404 for an employee outside the organization;
- 400 for an invalid date range.

The page requires org-admin settings access.

## Verification

### PostgreSQL (2026-09-25)

The suite is `apps/webapp/src/lib/time-tracking/historical-work-diagnostics.integration.test.ts`.
It is registered in `scripts/run-approval-workflow-repository-integration.sh` and in
the CI `integration-tests` job. It ran against a fresh label-owned PostgreSQL 16
container with the full migration chain: **6 tests passed**.

It uses the real diagnostics route, including the membership lookup, the principal
loader, the CASL ability and the snapshot reader. The work it reads was written by
the real `createManualTimeEntry`: legacy submissions before adoption, and a strict
version-2 command after it.

Verified:

- Consistent legacy manual work is `complete` with no findings, and the read writes nothing (full row snapshot equality).
- Legacy trimming: a real overlapping submission is reported as `manual_trimmed` with the submitted and persisted intervals, together with the UTC holiday-date finding. Stored rows are unchanged.
- Pending work without a duration or relationship, a missing time record, and June work with an unknown end are all reported for July before any payroll filter. Pending work linked only through a legacy approval request is not reported as missing a relationship. Another employee's scope stays complete.
- Adoption provenance: after real admission, the same injected duration conflict is `review_required` on pre-adoption legacy work and an `integrity_incident` (`fresh_backdated`, `manual_entry`) on the version-2 work.
- A deleted period with a payable record yields only `deleted_work_payable`, and the deletion is kept.
- Authorization:
  - A direct manager gets record-level output, with the peer's ownership conflict redacted and no peer identity anywhere in the response.
  - The owner sees the peer.
  - The employee gets a summary without IDs.
  - A peer and a manager asking about a non-report get 403.
  - A foreign-organization employee gets 404.
  - A reversed range and a non-UUID `employeeId` get 400.

Mutation check: filtering periods to `approved` in the reader, and granting record
level to every non-self employee, each made the corresponding test fail.

### Database-free

- `historical-work-diagnostics.test.ts` (56 tests) covers:
  - every matrix row, including missing versus conflicting;
  - each provenance state;
  - manual diagnoses, including the DST fold, the zone fallback to the capture and the refusal to use inferred captures;
  - relevance widening, disclosures and the calendar envelope;
  - redaction and the summary.
- `work-diagnostics-dashboard.test.tsx` covers the complete and incomplete states, finding rows with treatment, provenance and evidence, and append issues, candidates and interruptions.

Not verified: the settings page was not rendered in a browser against a database.
Its data path is the reader verified above, and its presentation is covered by the
jsdom test.

## Known limits from review

- The holiday diagnosis compares the dates the legacy validator checked with the dates the work occupies. It does not decide whether a holiday was accepted, because that would reevaluate historical holiday eligibility (#260 §8).
- Approval checks read the period, its workflow link and legacy approval requests. They do not reconstruct decision history.
- Canonical-native records have no receipts, so their provenance is only `pre_adoption` or `ambiguous`.
- Record-level UI is org-admin only. Managers use `POST /api/time-entries/diagnostics` for their direct reports.
- The route and page are read-only and ungated. They ship under #259's early allowance for graph-aware diagnostics, which also covered #324's verify route.

## Remaining activation blockers

This slice closes on implementation (see the #264 decision of 2026-09-25). Activation
items move to #327/#329/#331:

- **Scale (#329 pilot):** the diagnostic read is O(history) per scoped employee, like append assurance. The org-wide page reads every employee. Measure it, and add paging if needed.
- **Provenance (#327):** provenance relies on the per-employee admission instant and on the control's `updated_at`. A durable organization activation record and an enumerated legacy in-flight inventory would make `pre_adoption` stronger than row write time. Until every writer participates, legacy writers in adopted scopes appear as `ambiguous`.
- **Payroll gate (#322):** consuming these findings as the all-or-blocked gate, and keeping readiness and collection in one snapshot, belongs to #322. `assertCanonicalCutoverReady` still guards payroll reads until then.
- **Repair (#320, #323):** repairs are not authorized here. `historical_gap` only marks candidates. #320 revalidates them under coordination (see `docs/historical-gap-repair-320.md`); explicit proposals for everything else belong to #323.
- **Rollback (#331):** the route and page are read-only additions with no stored state. Rolling back removes them, and nothing needs cleanup.
