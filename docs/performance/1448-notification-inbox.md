# Notification list loading and scope

Ticket [#1468](https://github.com/Umami-Creative-GmbH/z8/issues/1468), part of
[spec #1448](https://github.com/Umami-Creative-GmbH/z8/issues/1448).

The closed notification bell now subscribes only to the unread count. The
popover and inbox retain their list reader. Opening either the mobile sheet or
desktop popover enables the list; reopening within its freshness window reuses
it. List and count retain the existing twenty-minute freshness/poll interval and
always refetch on window focus. Reconnect behavior retains TanStack Query's
existing default.

Both readers use user and organization cache keys. Display data is hidden while
the current session is pending or disagrees with the organization context.
Read and mutation requests carry expected user/organization headers, which the
handlers compare with their freshly authenticated session before database reads.
These headers grant no permission and do not replace the existing active-employee
and tenant checks. Requests from older callers without expectations retain the
existing authenticated API behavior.

Mark-read, mark-all-read, delete and delete-all invalidate only their captured
user/organization inbox family. Preferences and other users' inboxes survive.
The request and refresh scope are captured when a mutation starts, so completing
an old organization's mutation cannot refresh the newly selected organization.
Failed list reads show an error and retry action; pending reads expose an
accessible loading status instead of an empty success.

## Caller evidence

The regression budget was observed failing before implementation: mounting a
closed bell must issue zero list requests. The original combined hook issued
one list request and one count request. The replacement issues zero list
requests and one count request. Opening either real control tree issues one
list request and reuses the fresh count; closing with Escape and reopening adds
no fresh-list request. Each accepted mutation adds one intended list and count
read while leaving unrelated query families valid.

`notification-bell.test.tsx` exercises the real bell, Base UI mobile sheet and
desktop popover, notification hook and TanStack Query client with the network
boundary controlled. Explicit cases cover both controls, cached reopen, user
replacement within one organization, organization-context lag, sign-out,
pending session/list loading, read failure/retry, all four mutations and an
organization switch while a mutation is pending. jsdom exercises both trigger
trees and keyboard dismissal; it does not establish actual CSS viewport or
browser paint timing.

The real GET, count, PATCH and DELETE handler regressions independently reject
previous-user and previous-organization expectations, and reject signed-out
requests even when expectation headers match. Returned MFA/SSO-required states
are also rejected before reads, using the established AuthService guard pattern.
Only the request/authentication
boundary is faked; the real unit-project database refusal guard remains active
and would fail any attempted database access on these denied paths. These cases
do not claim full Better Auth, SSO/MFA or happy-path PostgreSQL coverage.

## Checks and limits

On October 24, 2026, the focused set passed **47 tests across seven files** with
normal test budgets: bell, popover, inbox, notification-hook, notification-route,
query-key and extracted-translation-default suites. A cold translation-source
scan initially exceeded its existing five-second budget during parallel host
work; the final normal-budget run passed without changing assertions/timeouts.
The complete webapp type check passed under `phase run --`.

React Doctor 0.9.18's changed-scope comparison against `81d12cb49` reported zero
new errors/warnings and a score of 100. Changed notification files pass Biome;
the modified notification-key block is formatted and the key file passes lint.
Unrelated legacy key-file formatting remains untouched. Vercel React,
composition and Web Interface Guidelines reviews of the changed behavior found
no additional new issue.

Reproduce the primary caller and HTTP checks with:

```sh
pnpm --filter webapp exec vitest run --project unit src/components/notifications/notification-bell.test.tsx src/components/notifications/notification-popover.test.tsx src/components/notifications/notifications-inbox.test.tsx src/hooks/use-notifications.test.ts src/app/api/notifications/route.test.ts src/lib/query/keys.test.ts src/tolgee/extracted-key-defaults.test.ts
phase run -- pnpm --filter webapp typecheck
```

The CI-mode integrated build and authenticated production-mode desktop/mobile
journey remain gates owned by the #1450/#1475 integration run. This slice does
not supply browser p50/p95, compressed JavaScript/RSC bytes, query durations or
production performance claims. The ticket remains open until those integrated
acceptance checks are fulfilled.
