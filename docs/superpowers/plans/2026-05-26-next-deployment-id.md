# Next.js Deployment ID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure the webapp Next.js deployment ID to reduce version-skew failures during rolling deployments.

**Architecture:** Reuse the existing `buildHash` computed in `apps/webapp/next.config.ts` as the deterministic `deploymentId`. This keeps Next.js skew detection aligned with the build hash already exposed to diagnostics and PostHog sourcemaps.

**Tech Stack:** Next.js, TypeScript, pnpm.

---

## File Structure

- Modify: `apps/webapp/next.config.ts` adds the `deploymentId` property to the existing `NextConfig` object.

## Task 1: Configure Deployment ID

**Files:**
- Modify: `apps/webapp/next.config.ts:42-60`

- [x] **Step 1: Add the deployment ID to Next config**

Update the config object so it includes `deploymentId: buildHash` near the other top-level build/runtime flags:

```ts
const nextConfig: NextConfig = {
	reactStrictMode: true,
	async rewrites() {
		return [
			{
				source: "/ingest/static/:path*",
				destination: `${POSTHOG_HOST}/static/:path*`,
			},
			{
				source: "/ingest/:path*",
				destination: `${POSTHOG_HOST}/:path*`,
			},
		];
	},
	skipTrailingSlashRedirect: true,
	deploymentId: buildHash,
	reactCompiler: true,
	env: {
		NEXT_PUBLIC_BUILD_HASH: buildHash,
	},
```

- [x] **Step 2: Run a targeted type/config check**

Run:

```bash
pnpm --filter webapp exec tsc --noEmit
```

Expected: TypeScript exits successfully with no `deploymentId` type error in `apps/webapp/next.config.ts`.

- [ ] **Step 3: If targeted TypeScript is not available, run the webapp build**

Skipped because Step 2 completed successfully.

Run:

```bash
CI=true pnpm --filter @z8/webapp build
```

Expected: Next.js accepts the config and the build exits successfully.
