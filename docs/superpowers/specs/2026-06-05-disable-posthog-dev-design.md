# Disable PostHog In Development

## Goal

Prevent local development from sending PostHog analytics or server-side exception telemetry, even when PostHog tokens are configured in the environment.

## Scope

- Disable client-side PostHog initialization in `NODE_ENV=development`.
- Disable server-side PostHog client creation in `NODE_ENV=development`.
- Preserve existing consent-based behavior outside development.
- Preserve existing token-required behavior outside development.

## Design

Add development-mode guards at the two PostHog entry points:

- `apps/webapp/src/components/posthog-provider.tsx`: compute whether PostHog is enabled from `env.NODE_ENV !== "development"`, the configured project token, and `helpImproveProduct`. When disabled by development mode, render children directly and skip `posthog.init`, `opt_in_capturing`, `opt_out_capturing`, and `reset`.
- `apps/webapp/src/lib/posthog-server.ts`: return `null` from `getPostHogServer()` when `env.NODE_ENV === "development"`, before constructing the `posthog-node` client.

## Testing

- Add a client provider test proving development mode does not initialize or wrap PostHog even with consent and a token.
- Add a server test proving development mode returns `null` and does not construct the PostHog client even with a token.
- Keep existing tests for no token and configured-token behavior outside development.

## Non-Goals

- Add a new runtime feature flag.
- Change PostHog sourcemap upload configuration.
- Change production or test telemetry behavior except where tests explicitly set `NODE_ENV=development`.
