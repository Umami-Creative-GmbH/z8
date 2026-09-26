# Better Auth, SCIM and SSO writers under configuration/access protection (#314 / T49)

## Delivery and activation status

Manual creation (#308) holds the shared organization configuration guard and the shared user
configuration/access guards of the actor and target. Under those guards it reads their
membership (role, status), employee active state, and the user's global role and ban. #313 made
z8's own settings writers of these facts take the exclusive guards. Better Auth, SCIM and SSO
also own writes of the same facts, and none of them took a guard. Better Auth ran its
membership cleanup in an after-commit hook, which cannot protect a write that has already
committed.

Each of those writers now takes the exclusive guard in the same transaction that commits its
write, before that write. Like #313, this participation is deployed unconditionally, because
the #264 activation gate for manual adoption requires it first. It changes no outcome; it only
orders a writer relative to in-flight submissions. Manual adoption itself stays gated by
`time_entry_append_control`.

A small number of deliberate behavior changes come with it (see
[Behavior changes](#behavior-changes)).

Implementation references: [#314](https://github.com/Umami-Creative-GmbH/z8/issues/314),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), the canonical resolutions
of [#258](https://github.com/Umami-Creative-GmbH/z8/issues/258#issuecomment-5654533697) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145), rows
C03, C07, C08, C18 and C19 of [the #265 audit](audits/265-configuration-paths.md), and the
[#313 protocol](organization-authorization-mutations-313.md).

## Protocol

### The transaction behind Better Auth's adapter

Better Auth writes through its adapter, and the adapter exposes no SQL, so the guards cannot be
taken on it. `lib/auth/auth-transaction.ts` instead wraps the drizzle client handed to
`drizzleAdapter` (`captureAuthTransactions(db)`). Every transaction Better Auth opens publishes
its drizzle transaction through an `AsyncLocalStorage` for exactly as long as the transaction
callback runs. Hooks and callbacks running inside it read the transaction with
`requireAuthTransaction`. They then take #313's `protectAuthorizationMutation` on the same
connection, in the same commit as the Better Auth write.

`requireAuthTransaction` **fails closed**: outside a captured transaction it throws
`UncoordinatedAuthMutationError`, so the write is refused rather than committed without its
guard.

### Coordinated calls

Several Better Auth endpoints write outside any transaction: member role updates, removal and
leaving, member addition, and the admin plugin's user updates. `runCoordinatedAuthMutation`
opens one Better Auth transaction (`runWithTransaction`) around the whole call, so the
before-hook's guard and the endpoint's write commit together.

- **Server callers** use `runAuthMutation` from `lib/auth.ts`. This covers
  `updateMemberRole` in organization settings and `removeEmployeeAccessAction`.
- **HTTP**: `/api/auth` routes these POST paths through `handleCoordinatedAuthRequest`:
  - `/organization/update-member-role`, `/organization/remove-member`, `/organization/leave`,
    `/organization/accept-invitation`, `/organization/delete`
  - `/admin/set-role`, `/admin/ban-user`, `/admin/unban-user`, `/admin/update-user`,
    `/admin/remove-user`

  A response with an error status rolls the transaction back. The paths are read from Better
  Auth's endpoint definitions, so a renamed endpoint cannot silently drop out.
  `addMember` has no HTTP path; its server callers must use `runAuthMutation`.

  **Correction (#359).** Better Auth's `auth.handler` runs each request under
  `runWithAdapter(baseAdapter)`. That resets its adapter context, so over `/api/auth` Better
  Auth's own writes went through the base adapter and committed on their own, outside the
  coordinated transaction the hooks wrote in. Endpoints that open their own
  `runWithTransaction` opened a second transaction. Work queued with
  `queueAfterTransactionHook` ran at once, before the commit. The raced tests above did not
  notice, because every Better Auth write happened after the guard wait. Since #359 the captured
  drizzle client runs every query on the published transaction while one is active, and a
  transaction opened on it joins it. The coordination hooks queue after-commit work with
  `queueAfterAuthTransactionCommit`. `/organization/create` joined the coordinated paths in
  #359.

The email-lookup wrapper now also applies to the transaction adapter. Inside a coordinated
transaction, user email lookups therefore stay case-insensitive.

### Guards per writer

| Writer | Hook | Guard (exclusive) |
| --- | --- | --- |
| Member role update | `beforeUpdateMemberRole` | Member's user |
| Member removal | `beforeRemoveMember` | Member's user |
| Leaving an organization (no Better Auth hook) | `z8-auth-mutation-coordination` before-hook | Leaving user |
| Member addition | `beforeAddMember` | Member's user |
| Invitation acceptance | `beforeAcceptInvitation` | Accepting user |
| Organization deletion (cascades every membership) | `beforeDeleteOrganization` | Organization |
| Admin role, ban, unban, update, removal | `z8-auth-mutation-coordination` before-hook | Body's `userId` (global, all organizations) |
| SCIM provisioning, group changes, replay, recovery, decommission | The plugin's lock of the user's `scimSubject`, in sorted user order, inside the SCIM plugin's transaction; re-taken at the start of `reconcileSCIMProjectedUser` ([#429](#sorted-scim-projection-guards-429)) | Projected user |
| Provider-bound SSO login | `provisionSsoProviderOrganization` (own transaction) | Logging-in user |
| Social login with a verified SSO domain | `assignSsoOrganizationByVerifiedDomain` (own transaction) | Logging-in user |

Every guard is taken before the writer's first write of a fact that manual creation reads, and
before any identity lock or row lock the writer takes on such facts. This matches #264 ranks
3–4 and #313.

There is one exception to "before anything". In a SCIM request, the plugin first writes some of
its own identity and group rows (`scimUser`, `scimGroup`, the `scimSubject` lock itself and, for
a new user, the Better Auth user). Since #429 the guard follows the `scimSubject` lock directly;
before that it was taken in `reconcileSCIMProjectedUser`, after all of them. Manual creation does
not lock those rows and does not read them under protection, so taking the guard after them
creates no wait cycle with a submission.

Plugin before-hooks see the request's original headers, because Better Auth merges the bearer
plugin's session cookie only after every before-hook has run. The leave hook therefore resolves
the session from the cookie, falling back to the bearer token. The admin hooks guard the target
named in the body once a caller is resolved. An anonymous request, which the endpoint refuses
anyway, locks nothing. Both plugin hooks require the coordinated transaction before anything
else.

As a backstop, after-hooks refuse a successful removal, leave or admin change unless that user's
guard was taken earlier in the same transaction. Such a write is rolled back, so a session
mechanism these hooks do not recognize fails closed rather than unguarded.

A coordinated HTTP request opens its transaction before Better Auth authenticates the caller.
Each such request therefore holds one pool connection for its duration, including requests that
are then refused.

### Removal cleanup is part of the removal

Before this slice, `afterRemoveMember` ran `completeRemovedMemberCleanup` after the removal had
committed. Now the removal transaction itself runs `revokeRemovedMemberAccessInTransaction`
through `afterRemoveMember` and the leave after-hook. That call deactivates the employee and
deletes the organization's session rows in the same commit as the membership delete. Only
secondary-storage session deletion and billing reconciliation wait for the commit
(`queueAfterAuthTransactionCommit` since #359; Better Auth's `queueAfterTransactionHook`
before).

`revokeRemovedMemberAccessInTransaction` takes the user's guard first. This also covers the
action's retry path (`completeRemovedMemberCleanup`).

Work queued after commit can still fail after the write has committed: billing
reconciliation, secondary-storage session deletion, or provisioning. Better Auth then rethrows
the error. As before this slice, the HTTP response is an error for a change that did commit.
`removeEmployeeAccessAction` detects the committed removal and retries the cleanup.

Provisioning after a membership is added or accepted keeps its existing after-commit timing,
now deferred with `queueAfterAuthTransactionCommit` (#359). That provisioning covers the employee, the
invitation's organization-creation flag, and billing seats.

## Behavior changes

- **SSO membership is owned by z8.** The SSO plugin inserts members through its
  non-transactional base adapter, which no guard can join. Its `organizationProvisioning` is
  disabled, and `lib/auth/sso-organization-provisioning.ts` implements both of its paths with
  the plugin's rules:
  - An existing membership, or a pending unexpired invitation for the email, means no new
    membership.
  - The role comes from the provider's `role` attribute.
  - The verified-domain path requires a verified email that maps to exactly one
    organization's verified provider.

  For provider-bound logins, the employee (inactive while the organization requires SSO
  approval) and the membership now commit together. Previously they were two separate commits.
  - The role is now read from `provisionUser`'s user info. For OIDC that is the same object the
    plugin used.
  - For SAML the plugin passed the raw attribute map. A raw attribute literally named
    `attributes` can therefore no longer promote a SAML user to admin.
  - Provider domain parsing uses the URL parser instead of `tldts`.
- **Leaving an organization now runs removal cleanup.** Before this slice, `/organization/leave`
  left the employee active and its sessions alive. The UI does not call it.
- **Uncoordinated Better Auth membership, role and access calls are refused.** A new server
  caller must use `runAuthMutation`.
- **Removal is atomic with employee deactivation.** If cleanup fails, the membership stays.
  Previously the membership was gone and the cleanup had to be retried.

## Reviewed exclusions and handoffs

- `auth.api.createOrganization` (onboarding): the creator's membership of a brand-new
  organization. No manual submission can be in flight in an organization that does not exist
  yet. Onboarding belongs to #318.
- Employee provisioning after membership addition or acceptance
  (`ensureEmployeeForOrganizationMember`) runs after commit in its own transaction. It still
  takes no user guard. This is `organization-member-provisioning`, owned by #318.
- Platform-administration direct writes of `user.role`, `banned` and `banExpires`
  (`platform-admin.service.ts`) and user settings belong to #312.
- Invitation creation, rejection and cancellation, and `updateOrganization` (other than
  timezone, which #311 rejects): none of these changes a fact that manual creation reads.
  `ssoRequiresApproval` only affects SSO employee creation. SSO provisioning reads it inside
  its own guarded transaction.
- `accountBanPlugin` enforces bans on reads and writes nothing.
- `storePendingInvitation` (`app/[locale]/(auth)/invitation-actions.ts`) writes only `user.invitedVia`,
  which manual creation does not read.

## Verification

### PostgreSQL (2026-09-25)

`src/app/[locale]/(app)/time-tracking/actions/clocking.manual-auth-scim.integration.test.ts` is
registered in the runner script and in `tests.yml`.

- It drives the real `createManualTimeEntry` on a disposable PostgreSQL 16 database.
- The other side of each race is a real Better Auth instance: organization, admin, bearer, SSO
  and SCIM plugins, with the production coordination hooks and plugin, over the captured
  drizzle client. That instance is called through `auth.api` and through the HTTP handler via
  `handleCoordinatedAuthRequest`.
- SSO races use the production provisioning functions.
- Only the manual action's session, billing, notification delivery, secondary storage and Next
  cache boundaries are replaced.

As in #313, each race pauses one side on a lock it takes after its protection. It then proves
that the other side waits on the exact guard key, identified by the `pg_locks` classid/objid of
that key's `hashtextextended` value.

| Race or case | Result |
| --- | --- |
| Admin demotion while an on-behalf submission is in flight | Demotion waits on the admin's guard; the submission commits under the authority it validated |
| Submission while a demotion is in flight | Submission waits, then is refused (`target_not_authorized`) with nothing written |
| HTTP `/organization/update-member-role` | Same ordering; a refused request (member caller, 403) writes nothing |
| `updateMemberRole` / `removeMember` / `leaveOrganization` outside a coordinated transaction | Refused with `UncoordinatedAuthMutationError`; nothing written |
| Member removal | Waits on the target's guard; membership delete, employee deactivation and session-row deletion commit together; billing reconciled after commit |
| Removal whose in-transaction cleanup fails (trigger fault) | Whole removal rolls back; membership and active employee remain; no billing call |
| HTTP `/organization/remove-member` (#359) | A failing in-transaction cleanup rolls the membership delete back (500) |
| HTTP `/organization/leave` (bearer session) | Waits on the leaver's guard; same cleanup |
| HTTP `/organization/accept-invitation` | Waits on the invitee's guard; provisioning runs after commit |
| Provider-bound SSO provisioning | Waits on the user's guard; member (mapped `admin` role) and active employee commit together |
| Verified-domain SSO membership | Waits on the user's guard; member created |
| `auth.api.banUser` | Waits on the target's guard while their submission is in flight |
| HTTP `/admin/set-role` | Waits on the target's guard |
| SCIM deprovisioning replay (`reconcileSCIMProjection`) | Waits on the target's guard, then suspends the membership and deactivates the employee |
| Submission while SCIM deprovisioning is in flight | Submission waits, then is refused with nothing written |
| HTTP `/organization/delete` | Waits on the organization guard. The pre-existing owner-retention trigger then refuses the cascade (500), and the request rolls back |

All 16 pass (plus a fail-closed check for an uncoordinated `leaveOrganization`). To show the guards are what the races observe, the suite was also run with
`protectAuthorizationMutation` and the admin hook stubbed out. All 13 races failed, because no
transaction waited on the guard. The 3 cases that do not depend on a guard passed: the
baseline submission, fail-closed refusal and cleanup rollback. The existing SCIM suites
(`protocol`, `scim-callback-atomicity`) now build their Better Auth instances over the captured
client, as production does, and still pass.

The full runner list then passed on the same kind of database: 61 files and 1122 tests. One
file was skipped: the browser suite, which needs `Z8_TEST_CHROME_PATH`.

### Database-free

- `lib/auth/auth-transaction.test.ts`: capture, scope, closing after settlement, fail-closed.
- `lib/auth/auth-mutation-coordination.test.ts`: each hook's scope, fail-closed per hook,
  cleanup in the transaction with post-commit work after commit, rollback on cleanup failure,
  refusal of an unguarded removal, HTTP path selection and rollback.
- `lib/auth/sso-organization-provisioning.test.ts`: role mapping and domain matching.
- Updated fakes: organization and employee settings actions (role update and removal run
  inside `runAuthMutation`), SCIM configuration (guard before the first SCIM write; fail
  closed), the removal cleanup's guard order, the auth route, and the production composition
  test (plugin order; real `provisionUser` takes a guard).

### Not verified at a real boundary

The suite does not cover:

- SCIM `/Users` requests, absent-member and stale-projection cases. The replay path is raced,
  and since #429 a `/Groups` creation and a managed-connection decommission run against
  PostgreSQL too. All of these reach the same guarded callback.
- The SSO callback endpoints. The provisioning functions are called directly, and the
  production composition test covers the wiring (`organizationProvisioning.disabled`,
  `provisionUser`, plugin order) without PostgreSQL.
- HTTP `/organization/add-member`, and the admin endpoints
  `/admin/unban-user`, `/admin/update-user` and `/admin/remove-user`. They share the hooks
  exercised by the raced paths.
- A ban racing submissions in several organizations. The user guard is global by
  construction, but no test shows it.

## Sorted SCIM projection guards (#429)

[#429](https://github.com/Umami-Creative-GmbH/z8/issues/429) closes activation blocker 4.

### Problem

`@better-auth/scim` 1.7.3 calls the projection callback once per user, in its own order. A
group change follows the request's member order (`reconcileUsers` →
`reconcileSCIMUserBatch`, in chunks of 50; duplicates are dropped, nothing is sorted). A guard
taken only in the callback was therefore taken out of order. A group change listing B before A
took B's guard, then A's. A submission holding A's guard (shared) and waiting for B's
deadlocked with it.

### Design

Every multi-user projection path of the plugin (group create, replace, patch and delete,
domain replay, connection decommission) first runs `acquireUserLocks`. That step resolves the
batch's users, **sorts them**, and advances each user's `scimSubject.revision` in that order,
before any callback runs. The plugin needs this order for its own deadlock freedom. Single-user
paths lock their one user's subject the same way, or create it.

`guardSCIMSubjectAcquisitions` (`lib/scim/projection-guards.ts`) wraps Better Auth's adapter
factory, including the adapters of Better Auth transactions. When `incrementOne` or `create`
on `scimSubject` returns a row, it takes that user's exclusive configuration/access guard
right away, on the captured transaction (`requireAuthTransaction`), and records it for that
transaction. The guards therefore follow the plugin's sorted subject order and are all held
before the first callback, so before the first projected write. The wrapper is composed in
`lib/auth.ts` and in the three SCIM PostgreSQL suites.

Nothing is locked out of order, and every violation fails closed:

- A subject locked outside a captured transaction is refused (`UncoordinatedAuthMutationError`).
- A subject below a user this transaction already guards is refused before its guard is taken
  (`SCIMProjectionGuardOrderError`).
- The callback keeps its guard as a check (`protectSCIMProjectedUser`). It re-takes the guard of
  a user locked with its subject. In a transaction that already guarded other users, a user
  whose guard was not taken with its subject is late. The callback then throws
  `SCIMProjectionGuardOrderError` before any guard or write. The plugin owns the transaction,
  so z8 cannot restart it. The whole SCIM transaction rolls back and the SCIM client or
  recovery retries (#313's restart semantics). A transaction that guarded nobody yet takes the
  guard in the callback, as before.

In 1.7.3 no late user can occur: the callbacks project a subset of the users whose subjects
`acquireUserLocks` locked, and a `scimUser`'s user does not change. The check stays anyway.
If the wrapper were missing, a multi-user projection would fail closed at its second user
instead of deadlocking.

### Why not a patch or upstream support

- The plugin has no public pre-reconcile option, so upstream support means waiting for a
  release.
- A `pnpm patch` would sort the callbacks or add a hook inside vendored `dist` code, and would
  have to be ported on every Better Auth upgrade.
- Observing the subject lock uses only the public adapter contract and the plugin's schema.
  It relies on one invariant: the plugin locks every projected user's subject, in sorted order,
  before projecting. The plugin keeps that invariant for its own correctness. If a future
  version breaks it, the order checks fail closed and the PostgreSQL tests below fail. Guards
  never silently go out of order.

Side effect: on single-user paths the guard is now taken at the subject lock, which is earlier
than the callback. That is still after the plugin's identity rows, and it is now before its
update of the managed user's name and email.

### PostgreSQL evidence (2026-09-26)

Added to `clocking.manual-auth-scim.integration.test.ts`. It uses a real managed SCIM
connection whose active sources are the organization admin and the employee. The admin's user
ID sorts first.

| Case | Result |
| --- | --- |
| HTTP `POST /Groups` listing the employee, then the admin (descending ID order), paused on the employee's row; the admin then submits on behalf of the employee | Both members' guards are held during the first projection. The submission waits and then commits after the group change (201). No deadlock |
| Domain replay (`reconcileSCIMProjection`), paused on the first user's employee row | Both users' guards are already held |
| Managed-connection decommission, paused on the first user's membership suspension | Both users' guards are already held; both memberships are suspended |

With the fix disabled (the wrapper passes the factory through and the callback takes each guard
itself, as before #429), all three cases fail. In the race, PostgreSQL logs
`deadlock detected`: the submission's `ShareLock` on one guard waits for the group change,
whose `ExclusiveLock` on the other waits for the submission. The submission is aborted
(`success: false`). The replay and decommission cases hold only the first user's guard.

The three SCIM PostgreSQL suites (manual/auth/SCIM, `protocol`, `scim-callback-atomicity`)
pass 28/28 on a fresh database.

Database-free: `lib/scim/projection-guards.test.ts` covers guard after the subject lock (advance
and create), once per user and transaction, ignored models and conflicts, out-of-order refusal,
fail closed outside a transaction, the callback's re-take, and late-user refusal.
`lib/scim/auth-configuration.test.ts` shows that a late user aborts the callback with no guard
and no write. `lib/auth.test.ts` pins the production composition.

## Remaining activation blockers

1. Employee provisioning after membership addition or acceptance, invite-code joins,
   onboarding, demo and cleanup writers (#318) do not yet participate.
2. ~~Platform-administration direct writes of global role and ban, and user settings (#312).~~
   They participate since #312; see [its evidence](user-configuration-access-312.md).
3. Old deployed binaries write these facts without protection (#327). New guards cannot fence
   old code. They must be drained or disabled before manual adoption activates.
4. ~~A SCIM request that projects several users can take their guards out of sorted order, for
   example a group change listing members in request order.~~ Every projected user's guard is
   now taken in sorted order before the first projected write; see
   [Sorted SCIM projection guards (#429)](#sorted-scim-projection-guards-429). Production
   observation of lock waits and aborts belongs to #447 (which replaced #327).
5. Organization deletion briefly pauses manual submissions across the organization, like the
   other organization-wide writers in #313. Better Auth's hard deletion of an organization that
   has an owner cannot succeed today because of the owner-retention trigger.
6. The leave and admin hooks resolve bearer sessions themselves, because before-hooks run
   before the bearer plugin's header rewrite. A session mechanism they do not recognize makes
   the change fail closed, not unguarded.
7. Changes to `ssoRequiresApproval` (organization update and settings) take no guard. Audit row
   C19 asks for approval-setting changes to participate. Manual creation does not read the
   setting. SSO provisioning reads it inside its own user-guarded transaction, but no
   organization guard orders a concurrent setting change against that read. This is left to
   #318 with the rest of provisioning.
