---
status: accepted
---

# Personio delivers through v2 and keeps a record of what it delivered

Personio retires `POST /v1/company/attendances` at 2027-01-31T23:59:59Z ([deprecation notice](https://developer.personio.de/changelog/deprecation-of-attendances-and-projects-v1-endpoints)).

We move both attendance and absences to v2: [`/v2/attendance-periods`](https://developer.personio.de/reference/post_v2-attendance-periods) and [`/v2/absence-periods`](https://developer.personio.de/reference/post_v2-absence-periods). Moving attendance alone was the alternative. We moved absences too because no Personio absence mapping could be created before, so it had to be built anyway, and building it on v2 absence type UUIDs avoids a second migration.

We keep the v1 employees list, which is not deprecated, for matching by personnel number, because v2 persons can only filter by email.

Z8 also keeps a delivered record for everything Personio accepts. v2 creates one period per request and has no idempotency key or external reference, so only Z8's own record prevents duplicates on retries and re-exports, and lets corrections reach Personio.

These choices were made in the 2026-10-30 grilling of #1054.

## Consequences

**What Z8 sends**

- **Approval:** creates and patches send `skip_approval=true`. Z8 delivers only approved work and absences, so Personio does not ask for a second approval.
- **Times:** Personio takes local date-times without an offset and documents no zone.
  - Each endpoint is sent as the wall-clock time in its own captured offset.
  - The attribution date is the local clock-in date.
  - A period whose endpoints lie in different zones (travel) is delivered and flagged on its result.
- **Breaks:** each Z8 work period becomes one `WORK` period, and Z8 sends no `BREAK` periods. When Personio's response shows it added a break of its own, the result says so, because Personio's hours then differ from Z8's.
- **Projects:** Z8 sends no `project.id`. The work category and Z8 project name stay in the comment.
- **Absence types:**
  - On the Personio settings, the admin maps each Z8 absence category to one of the organization's live Personio absence types, stored by UUID.
  - Only `DAY` types are offered.
  - Half days are sent as `FIRST_HALF`/`SECOND_HALF`.
  - Old legacy-only wage type codes are not carried over.
  - Unmapped categories are skipped with a reason.

**Matching and connection test**

- **Matching:** all existing strategies stay: personnel number and custom-field identifier through v1 employees, and email through v2 persons. The resolved id is used as the v2 person id. Personio implies but does not state that the two are equal, so the tenant verification must prove it.
- **Connection test:**
  - It requests a v2 token with no scope, which grants all of the client's scopes and lists them.
  - It then checks every read the export depends on and reports each check on its own.
  - It states that write permission can't be checked without writing. Personio documents neither write scope names nor an introspection endpoint.

**Re-exports**

- **Delivered records:** a later export of the same period and scope works through what was delivered before:
  - Unchanged records are not sent again.
  - Changed records are patched.
  - A change of person or absence type is a delete and a create.
  - Records that no longer exist in Z8 are deleted, but only inside the export's own period and employee scope.
  - Records delivered through v1 count as delivered, and later changes to them are reported for manual follow-up.
- **Concurrency:** only one Personio delivery runs per organization at a time, and others wait.

**Results**

- **Per-record outcomes:** every delivery shows each record as delivered, delivered with a difference, skipped with a reason, or failed with Personio's message.
- **Where they show:** results appear in the payroll workspace, which offers Personio as a target, and in the payroll export history. Payroll comparisons stay file-only, per ADR 0001.
- **Scheduled exports:** a scheduled export with failed records is marked failed, and its owner is notified.

**Rollout**

- **The switch:** attendance moves per organization through a v2 switch that only platform admins operate.
- **Pilot:** the switch goes on first for a pilot: a Personio developer account or a customer organization, whichever is available first.
- **Dates:**
  - Every organization is on v2 by 2026-12-01.
  - The v1 attendance path stays as a per-organization fallback until 2027-01-31, then is removed.
- **Absences** go through v2 from the start.
- **Queued and retried jobs** follow the switch at the moment they run.
- **Admins are told:** Personio admins get a notice and a notification asking them to check that their API credential can write attendance and absence periods and to map their absence types.

**Done**

Personio counts as tenant-verified when a run in a real account, checked in Personio, covers:

- the connection test, passing and then failing with a permission removed
- a normal day, a day with a break gap, an overnight shift, and a night shift across the 2026-10-25 DST change
- a full-day, a multi-day and a half-day absence
- matching by personnel number and by email
- periods arriving confirmed
- an unchanged, an amended and a deleted re-export
- Personio's hours equalling Z8's
