# #1470: consent-aware lazy product analytics

## Behavior

`PostHogProvider` always renders the same fragment around its application children. It no longer imports either browser SDK entry point eagerly or inserts an SDK context wrapper after consent. No production browser consumer of `posthog-js/react` or `usePostHog` remains.

The effect requests `posthog-js` only for a configured token, deployment enabled, current product-improvement consent, and a known authenticated identity. One pending module promise is shared across effect replay and identity/consent changes. The current authenticated layout supplies a user/active-organization identity key solely to own cleanup; that key is not sent to the SDK. There is no added session, organization, preference or clock request.

A load that finishes after consent withdrawal, deployment disablement, configuration removal, actor change or unmount cannot initialize the departed effect. A loaded instance opts out and resets on those transitions. A failed import stays inert for that module lifetime; unrelated renders do not repeatedly retry or initialize it. Partial initialization and cleanup failures are contained without logging application/error context. The existing `/ingest`, UI host, defaults, history-change pageview and pageleave options are preserved for allowed browser initialization.

There is no new wrapper, loading placeholder, Suspense fallback or application key. Draft inputs, focus, current clock state and navigation stay mounted through analytics changes. The integration does not add a consumer SDK context because no application consumer uses it.

## Server error privacy change

Automatic third-party **server** exception forwarding is removed. `instrumentation.ts:onRequestError` intentionally performs no vendor capture, cookie parsing, auth/database lookup or raw-context logging. This hook has no authoritative current product-analytics consent; a vendor distinct-ID cookie cannot supply it. Unknown and denied states therefore cannot forward errors. This also withholds server errors for opted-in users, rather than inventing a separate server consent protocol inside an error handler. Consented browser analytics remains available.

The unused server SDK wrapper and its cookie-parser tests were removed with their sole production caller. This removes the parser's raw malformed-cookie error logging as well. Dependency manifests are unchanged.

`register`, `instrumentation.node.ts`, first-party OpenTelemetry, operational error tracing and fixture performance observers retain their existing ownership and behavior. No observer configuration or metrics were changed.

## Evidence

The public rendered-provider seam first reproduced draft/clock remounting when consent changed. The actual `onRequestError` seam first reproduced third-party client creation for a protected synthetic SQL/token exception and an unsigned vendor identity cookie. Both were red before implementation and pass after the changes.

`posthog-provider.transport.test.tsx` holds/rejects the external SDK module's promise while rendering the real public provider. Its 19 cases cover configured/allowed initialization, opted-out/disabled/unconfigured/unknown identity without loading, current app usability and focused draft retention, withdrawal before/after loading, user/organization replacement during/after loading, unmount, Strict Mode, partial initialization failures, cleanup failures and no repeated unrelated initialization. Only the external SDK and deployment configuration are mocked.

`posthog-provider.test.tsx` uses a working clock toggle and uncontrolled draft to prove the application DOM and mount count survive consent changes. Layout tests prove exact saved consent and current user/organization identity reach the provider, including no active organization.

`instrumentation.privacy.test.ts` exercises the actual public error hook with a configured synthetic token. Protected exception and request canaries include SQL parameters, cookies, bearer tokens, employee paths and access-token queries. It proves no third-party SDK creation/capture, network calls, fallback logging or request/error getter evaluation. Node and Edge, absent/malformed/vendor/authenticated headers are covered. These literals are synthetic test data.

Focused final validation: 10 unit files / 153 cases; Phase all-project typechecks; Biome on seven changed source/test files; React Doctor 100/100 with no diagnostics. The unit set also includes real header-clock transport/provider refresh, preference, registration, setup privacy and telemetry regression suites. No database behavior changed, so no new PostgreSQL suite was added for this ticket.

## Production measurement gate remains open

The parent owns production builds, services, fixture configuration and browser/load measurement. No app build, live service, collector, container, data reset or fixture mutation was performed in this ticket.

The parity original/head builds currently have an empty public analytics token. They can measure whether the provider avoids SDK code and capture traffic for that unconfigured case. They cannot prove configured-consented behavior.

For unconfigured, disabled or opted-out initial loads, inspect build chunks and the browser network waterfall: no `posthog-js` SDK chunk should be requested solely by this provider and no `/ingest` capture request should appear. Preserve the parity configuration and compare actual compressed transfer bytes, requests, main-thread tasks, enabled clock readiness and route readiness against the original.

For configured and consented behavior, use a separate parent-owned head-only build with a synthetic public token and an explicitly local fake SDK/sink; do not route to a real vendor or use vendor secrets. Hold/reject the SDK resource, exercise the real clock/navigation and an unsaved draft, withdraw consent or replace identity while held, and confirm no stale initialization/capture. Then release an allowed case and observe exactly one initialization plus normal local capture, opt-out/reset on withdrawal, and no child remount/focus/draft loss. This is distinct evidence and must not be reported as original/head parity evidence.

No numerical byte, task, latency or readiness improvement is claimed by source analysis or package size. Record the parent-owned measured artifacts before closing this acceptance gate.
