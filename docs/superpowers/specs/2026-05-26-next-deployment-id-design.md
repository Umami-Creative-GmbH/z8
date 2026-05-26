# Next.js Deployment ID Design

## Goal

Prevent client/server version skew during rolling webapp deployments by configuring Next.js `deploymentId`.

## Design

Reuse the existing `buildHash` computed in `apps/webapp/next.config.ts` as the deployment ID. The hash is already derived from `NEXT_PUBLIC_BUILD_HASH`, CI commit SHA variables, or the local git commit, and the publish workflow already passes `NEXT_PUBLIC_BUILD_HASH=${{ github.sha }}` into Docker builds.

## Scope

- Add `deploymentId: buildHash` to the webapp Next.js config.
- Do not add a new runtime environment variable.
- Do not generate a random ID, because the value should be deterministic for a built image and easy to correlate with diagnostics and sourcemaps.

## Testing

Run the relevant webapp configuration/type checks or build command available locally after the change.
