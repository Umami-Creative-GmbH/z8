# Configuration and access mutation inventory — #265

Part of the [activation dossier](265-activation-dossier.md). Same baseline and
evidence limitations apply. Paths are relative to `apps/webapp/src/`.
`SET` means `app/[locale]/(app)/settings`; `SVC` means `lib/effect/services`.
O/E/U mean organization/employee/user. Each row includes inserts when a row did
not previously exist, updates, removals and relevant cascading effects.

**Current state:** apart from C11–C13 (#316, see
[its evidence](../holiday-change-policy-coordination-316.md), without the import, demo
and cleanup writers left to #318) and the application writers of C02 and C07 (#312, see
[its evidence](../user-configuration-access-312.md), with user cleanup left to #318), no row
below is certified to participate in the new manual configuration protocol. The Better Auth,
SCIM and SSO writers of C03, C07 (including the admin plugin's endpoints), C08, C18 and C19
participate since #314 (see [its evidence](../auth-scim-coordination-314.md)); the
provisioning, import, demo and cleanup writers of those rows remain with #318. Existing local
transactions and SCIM transactional
callbacks must be preserved, then extended at their actual mutation owner.
Creation-time fallback changes and access changes require the same protection as
an explicit timezone or permission edit.

## Mutation register

| ID / dependency | Source-observed callers → actual owners; scope | Current transaction/evidence boundary | Follow-up and concrete acceptance |
| --- | --- | --- | --- |
| C01 — organization timezone | `SET/organizations/actions.ts::updateOrganizationTimezone` → organization UPDATE + work-balance reset; O/all affected E | Transaction at lines 1288 onward; inline rebuild/reset uses extra balance locks. Org settings writes also include direct auth-schema updates and `auth.api.updateOrganization` | #311: shared/exclusive configuration guard at original transaction, timezone + durable rebuild intent atomic; separately coordinated recovery, freshness checks and failure-after-commit behavior |
| C02 — user timezone and first settings row | `SET/profile/actions.ts`; `SVC/onboarding.service.ts`; `components/dashboard/actions.ts`; `lib/bot-platform/i18n.ts::setUserLocale` via `tolgee/language.ts`; wellness/calendar settings and wellness mutations; U across O | `db/schema/user-settings.ts` default UTC means locale/onboarding/display-only INSERT can change fallback. Existing timezone balance resets may discover cross-org employees; many paths use global DB operations | #312/#318: user-global guard before every first-row/upsert/delete and actual timezone update; cover absent-row races, same effective zone versus changed fallback source, sorted cross-org rebuild scope; no late earlier-ranked locks |
| C03 — membership and organization role | `SET/organizations/actions.ts` invitation/role operations → `auth.api.*`; `app/[locale]/(auth)/invitation-actions.ts`; `SVC/pending-member.service.ts`, `invite-code.service.ts`; `lib/auth/organization-member-provisioning.ts`, `employee-invitation-draft.ts`, `member-removal-cleanup.ts`; O/U/E | Mixed plugin-managed commits and direct DB provisioning/approval transactions; removal cleanup is after commit; role changes can affect authority without touching existing work | #313/#314/#318: original membership/status/role/create/delete transaction participates, exact organization predicates, revoked authority versus receipt access; race invite acceptance and pending approval with manual creation |
| C04 — employee active state, role, team, employment | `SET/employees/employee-mutations.actions.ts`, `employee-lifecycle.actions.ts`, `employment-history-actions.ts`; `SET/teams/actions.ts`; `SVC/onboarding.service.ts`; O/E/U | Direct employee updates and lifecycle/history/approval effects; employment changes can alter target eligibility and balances. Team membership is not an automatic expansion of on-behalf authority | #313/#318: protect activation/deactivation/reactivation/role/team and dependent cascades; test authorized direct reports versus unrelated team members, owner/admin whose employee role is ordinary, source-scope restart |
| C05 — direct manager relations | Employee settings → `SVC/manager.service.ts` writes `employeeManagers` primary/replacement/delete; demo and org cleanup also write/delete these relations; O/target and manager E | Multi-statement updates/inserts of manager relationships; not protected by target work lock alone. Manager ordering/tenure also feeds escalation selection | #313/#297/#318: exclusive configuration protection and complete employee scope before relation changes; race management loss/reassignment against submission and escalation, preserve primary/tenure/ID ordering |
| C06 — custom permissions and role projection | `SVC/custom-role.service.ts`, `permissions.service.ts`, `role-template.service.ts`; settings role/permission callers; O/E/U, global templates may span O | Writes custom role/permission/assignment, employee role, team permissions and default team membership; deletion/activation changes effective grants even without changing target rows | #313/#314/#318: protect every consumed permission/template/assignment mutation, including absent grants and global scope discovery; CASL creation/management authority checked inside protected work transaction |
| C07 — global user privilege, ban and access | Platform administration → `SVC/platform-admin.service.ts`; Better Auth admin/user APIs through `lib/auth.ts`; `lib/auth-helpers.ts` reads user role/access. Session revocation owners: `lib/auth/organization-session-revocation.ts`, `guarded-secondary-storage.ts`; U/all affected O | Plugin and direct user updates differ from organization membership. Revoking sessions or an after-hook is not protection of the permission mutation that already committed | #312/#314: user-global access guards at privilege/ban/delete mutation, revalidate active authorized context; test multiple organizations, revoked session and global admin status. Do not treat session-only bookkeeping as a new global work policy |
| C08 — SCIM lifecycle, roles and recovery | `lib/auth.ts` → `lib/scim/auth-configuration.ts` → `lifecycle-reconciler.ts`, `projection-reconciler.ts`, `transaction-store.ts`; projection replay/recovery and `lib/jobs/scim-maintenance.ts`; O/U/E/provider connection | Real provider transaction context updates members/employees/roles/team permissions, lifecycle/projection state, audit and seat outbox; recovery can reapply projections later. `drizzleAdapter(..., { transaction: true })` is useful but supplies no manual guards by itself | #314: acquire protection in original provider transaction before dependent mutation, not callback-after-commit/global DB helper; verify real SCIM API and replay worker races, decommission, absent member and stale projection cases |
| C09 — project eligibility | `SET/projects/actions.ts` create/update/status/active/delete/assign/unassign; retained Clockodo import and demo setup; `db/schema/project.ts` project/assignment/manager relationships; O/project/target E | Direct project/assignment writes; shared work readers in `TT/actions/entry-helpers.ts` check assignment/bookability. Project assignments have no effective dates | #315/#318: protect active/bookable lifecycle and target assignment changes/deletions; same eligibility for form choices and authoritative command; no invented assignment dates. Validate project/canonical allocation organization |
| C10 — work category/set eligibility | `SET/work-categories/actions.ts`; reviewed `committers.ts::commitWorkCategory`; demo/import setup; O/set/category/E/team | Category and set create/activate/update/delete, membership and effective assignment writes; current assignment readers feed manual choices. Reviewed setup commit is a staging-row transaction, not new configuration protection | #315/#318: protect set contents and organization/team/employee effective assignments as well as category rows; assignment expiry uses one fresh evaluation instant; absent/deleted rows and target-switch selector races |
| C11 — holiday blocking via settings | `SET/holidays/actions.ts`, `preset-actions.ts`; `lib/calendar/holiday-service.ts` reads active organization blocking categories/dates; O/date/category | Category/holiday/preset/assignment operations are separate mutation owners. `assigned-holidays.ts` display semantics differ from manual organization-level blocking | #316: protect actual holiday/category activation, blocking flag, dates and deletion; half-open effective-zone occupied dates, midnight end excludes next date; no employee/team-assignment substitution |
| C12 — holiday administrative HTTP | `app/api/org-admin/holidays/route.ts`, `[id]/route.ts`, `import/route.ts`; `holiday-categories/route.ts`, `[id]/route.ts`; `holiday-presets/route.ts`, `[id]/route.ts`; O | HTTP create/update/soft-delete; import uses a transaction that can create categories and holidays. Settings-only guards would miss these writers | #316: original HTTP transaction protection, organization admin authorization and same absent-row/date/category races as C11; use actual route tests |
| C13 — change policy and assignments | `SET/change-policies/actions.ts` and `SVC/change-policy.service.ts`; manual `TT/actions/policy-helpers.ts` calls the service; O/policy/E/team | Both action and service mutation surfaces; global DB-backed reads/effective-policy selection currently separate from manual work transaction; active/expiry/priority semantics affect approval intent | #316: transaction-bound effective/nonexpired scoped selection and ambiguity failure; preserve precedence/inclusive age thresholds. Only age-based forbidden becomes approval intent; race policy/assignment insert/update/delete with fresh submission |
| C14 — work/break policy and approval routing | `SET/work-policies/actions.ts`, `SVC/work-policy.service.ts`; `SET/approval-policies/actions.ts` → `lib/approvals/policies/chain-service.ts`; O/E/policy/stage | Work schedules/regulations/break options/assignments and approval policy chain/stage writers; snapshot readers in `lib/time-tracking/policy-clock-out-break-snapshot.ts` take row locks | #302/#303/#316/#327: protect actual dependencies of completion/manual routing, preserve legitimate auto-completion and rollback unroutable required approval; reconcile snapshot row order with policy mutation and employee locks |
| C15 — surcharges and projection dependencies | `SET/surcharges/actions.ts`, `SVC/surcharge.service.ts`, reviewed setup imports, demo; `lib/time-tracking/policy-clock-out-surcharge-snapshot.ts`; O/model/rule/assignment/E | Snapshot locks organization/employee/assignment/model/rule; settings modify those rows. Surcharge semantics use event end, not manual submission evaluation time | #274/#303/#318/#327: document concrete auxiliary locks and mutation participation, consistent snapshot and recalculation intents. No blanket claim these are all new manual-policy inputs |
| C16 — billing entitlement and trial provisioning | `app/api/billing/checkout/route.ts`, `subscription/route.ts`, `webhook/route.ts`, `app/api/platform-admin/billing/route.ts`; `SVC/billing/subscription.service.ts`, `billing-events.service.ts`, `billing-enforcement.service.ts`; seat reconciliation and SCIM seat outbox; O/subscription/U membership | Enforcement may INSERT default trial via global DB; webhook/subscription mutations and seat reconciliation have their own owners; permission preflight does not freeze current entitlement | #317/#314/#318: trial provisioning before protected operation, transaction-bound non-provisioning recheck inside; coordinate subscription/override/reconciliation writes, expiry and callback races; preserve replay access/billing checks |
| C17 — setup, provisioning, imports and demo | `SVC/setup.service.ts`, `onboarding.service.ts`, invite/member provisioning; `lib/import-review/committers.ts`; retained Clockodo/Clockin setup writers; `lib/demo/employee-generator.ts`, `demo-data.service.ts`; `db/seed/work-policy-presets.ts`, seed entry point | Creates initial org/user/employee/team/project/category/holiday/policy facts and assignments, sometimes while processing imported work. Reviewed unsupported employee/work-policy types are currently held for mapping rather than committed | #318/#284/#285: enumerate actual enabled entity dispatch (do not infer it from type names), protect initial defaults and multi-org/global dependencies, prevent late shared→exclusive upgrade during work creation; drain old setup/demo/operator binaries |
| C18 — destructive lifecycle and cascade | `lib/jobs/organization-cleanup.ts`, `lib/demo/delete-non-admin.ts`, demo cleanup; auth member/user/organization removal; role/project/category/policy deletes in rows above | Transactional delete may cascade through auth, employee, permissions and configuration without visiting each settings action. Whole-org cleanup also removes work/approval evidence | #306/#314/#318/#327: route complete O/U/E scope before destructive transaction, guards before first delete, cleanup participation before new evidence capture; prove no foreign scope deletion or late recreation |

### C19 — SSO organization and employee provisioning (source-reachable)

`lib/auth.ts:726–774` configures SSO `organizationProvisioning.getRole` and
`provisionUserOnEveryLogin` → `provisionUser`. The plugin derives organization
membership role from provider attributes; the callback independently reads
organization `ssoRequiresApproval` and employee existence using global `db`,
inserts a missing employee with `isActive: !ssoRequiresApproval`, and records SSO
login provenance. Scope is provider organization/U/new or existing E. This is
distinct from the ordinary membership helper and the SCIM transaction store.

The membership mutation belongs to the SSO plugin; a global-DB employee INSERT
inside its callback does not establish same-transaction participation. The
organization's additional-field mutation surface for `ssoRequiresApproval` also
belongs in C03/C17 protection. Deployed participation remains unknown.

**#314/#318 acceptance:** trace the actual SSO login/provisioning transaction,
acquire O/U/E protection before membership/eligibility mutation, include
first-employee and approval-setting changes, and race missing-employee provisioning
with manual creation. Preserve verified-login provenance and prove both role and
employee writes participate, or effectively retire the affected path before
activation. An after-hook alone is insufficient.

## Actual dependency boundary and adjacent writers

`lib/timezone/effective-timezone.ts`, `lib/time-tracking/timezone-capture.ts`,
`lib/time-tracking/validation.ts`, `lib/calendar/holiday-service.ts`,
`TT/actions/entry-helpers.ts`, `lib/authorization/ability.ts` and the change-policy
service are the current read seams to reconcile with protected manual preparation.
The creation-authorized target context is advisory; only transaction-time
revalidation is authoritative.

The source mutation sweep also found neighboring writers. They are classified
here rather than silently added to a broad configuration mutex:

| Neighboring source family | Disposition |
| --- | --- |
| `SET/employees/rate-mutations.actions.ts`, `SET/vacation/actions.ts`, `assignment-actions.ts`; `lib/query/vacation.queries.ts`, `lib/absences/vacation.service.ts`; `app/[locale]/(app)/team/team-time-balance.ts` | Rate/vacation/balance projections are not automatically manual-creation policy inputs. Include actual shared employee/authorization changes in C04 and concrete balance lock interactions in #327; preserve absence/payroll semantics |
| `SVC/skill.service.ts`, `coverage.service.ts`; customer, location and shift settings | No current manual interpretation dependency on location timezone, skills or coverage established. Project deletion/assignment and explicit work location metadata remain C09/W14; source changes introducing a dependency require a new inventory entry |
| `SET/wellness/actions.ts`, `app/[locale]/(app)/wellness/actions/mutations.ts`, dashboard, calendar and onboarding preferences | Hydration/display-only UPDATE is not a work policy change; INSERT of `userSettings` still participates under C02 because of timezone defaults |
| `lib/notifications/project-notification-triggers.ts`; email/branding/domain/notification/enterprise OAuth configuration | Delivery-only settings do not grant work creation authority. Preference/entitlement/provider changes affecting approval delivery are R06–R09; any auth/access effect belongs to C03/C07/C08, not an assumed display-only exemption |
| Regional holiday generation library | Does not establish a global mutable holiday calendar or justify a new global holiday mutex. Persisted organization blocking rows remain C11/C12 |

Global user/template changes and organization cleanup can require more than one
organization or employee. First discover the complete scope, then take sorted
guards in the dossier order and revalidate. A changed scope restarts the
transaction. Protect absence of rows and insert/delete paths; locking only rows
found by a preparation query is insufficient.
