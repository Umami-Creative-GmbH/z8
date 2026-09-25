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
    `/organization/add-member`, `/organization/accept-invitation`, `/organization/delete`
  - `/admin/set-role`, `/admin/ban-user`, `/admin/unban-user`, `/admin/update-user`,
    `/admin/remove-user`

  A response with an error status rolls the transaction back.

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
| SCIM provisioning, group changes, replay, recovery, decommission | Start of `reconcileSCIMProjectedUser`, inside the SCIM plugin's transaction | Projected user |
| Provider-bound SSO login | `provisionSsoProviderOrganization` (own transaction) | Logging-in user |
| Social login with a verified SSO domain | `assignSsoOrganizationByVerifiedDomain` (own transaction) | Logging-in user |

Every guard is taken before the writer's first dependent write and before any identity lock or
row lock it takes afterwards. This matches #264 ranks 3–4 and #313.

Plugin before-hooks see the request's original headers, because Better Auth merges the bearer
plugin's session cookie only after every before-hook has run. The leave hook therefore resolves
the session from the cookie, falling back to the bearer token. The admin hooks guard the target
named in the body, without looking up a session. As a backstop, removal cleanup refuses unless
the removed user's guard was taken earlier in the same transaction. A removal or leave whose
member was not guarded before the delete is rolled back.

### Removal cleanup is part of the removal

Before this slice, `afterRemoveMember` ran `completeRemovedMemberCleanup` after the removal had
committed. Now the removal transaction itself runs `revokeRemovedMemberAccessInTransaction`
through `afterRemoveMember` and the leave after-hook. That call deactivates the employee and
deletes the organization's session rows in the same commit as the membership delete. Only
secondary-storage session deletion and billing reconciliation wait for the commit (Better
Auth's `queueAfterTransactionHook`).

`revokeRemovedMemberAccessInTransaction` takes the user's guard first. This also covers the
action's retry path (`completeRemovedMemberCleanup`).

Provisioning after a membership is added or accepted keeps its existing after-commit timing,
now deferred with `queueAfterTransactionHook`. That provisioning covers the employee, the
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
| `updateMemberRole` / `removeMember` outside a coordinated transaction | Refused with `UncoordinatedAuthMutationError`; nothing written |
| Member removal | Waits on the target's guard; membership delete, employee deactivation and session-row deletion commit together; billing reconciled after commit |
| Removal whose in-transaction cleanup fails (trigger fault) | Whole removal rolls back; membership and active employee remain; no billing call |
| HTTP `/organization/leave` (bearer session) | Waits on the leaver's guard; same cleanup |
| HTTP `/organization/accept-invitation` | Waits on the invitee's guard; provisioning runs after commit |
| Provider-bound SSO provisioning | Waits on the user's guard; member (mapped `admin` role) and active employee commit together |
| Verified-domain SSO membership | Waits on the user's guard; member created |
| `auth.api.banUser` | Waits on the target's guard while their submission is in flight |
| HTTP `/admin/set-role` | Waits on the target's guard |
| SCIM deprovisioning replay (`reconcileSCIMProjection`) | Waits on the target's guard, then suspends the membership and deactivates the employee |
| Submission while SCIM deprovisioning is in flight | Submission waits, then is refused with nothing written |
| HTTP `/organization/delete` | Waits on the organization guard. The pre-existing owner-retention trigger then refuses the cascade (500), and the request rolls back |

All 16 pass. To show the guards are what the races observe, the suite was also run with
`protectAuthorizationMutation` and the admin hook stubbed out. All 13 races failed, because no
transaction waited on the guard. The 3 cases that do not depend on a guard passed: the
baseline submission, fail-closed refusal and cleanup rollback. The existing SCIM suites
(`protocol`, `scim-callback-atomicity`) now build their Better Auth instances over the captured
client, as production does, and still pass.

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

## Remaining activation blockers

1. Employee provisioning after membership addition or acceptance, invite-code joins,
   onboarding, demo and cleanup writers (#318) do not yet participate.
2. Platform-administration direct writes of global role and ban, and user settings (#312), do
   not yet participate.
3. Old deployed binaries write these facts without protection (#327). New guards cannot fence
   old code. They must be drained or disabled before manual adoption activates.
4. A SCIM request that projects several users can take their guards out of sorted order, for
   example a group change listing members in request order. Domain replays are ordered by user
   ID. Against a submission holding one of those users' guards, PostgreSQL detects the
   resulting deadlock and aborts one side. Both sides keep their guarantees, but the aborted
   side needs a retry: the SCIM client or recovery, or the user resubmitting. Production
   observation of lock waits and aborts belongs to #327.
5. Organization deletion briefly pauses manual submissions across the organization, like the
   other organization-wide writers in #313. Better Auth's hard deletion of an organization that
   has an owner cannot succeed today because of the owner-retention trigger.
6. The leave hook resolves bearer sessions itself, because before-hooks precede the bearer
   plugin's header rewrite. A session mechanism it does not recognize makes leaving fail
   closed, not unguarded.
