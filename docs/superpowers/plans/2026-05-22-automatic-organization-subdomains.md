# Automatic Organization Subdomains Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic organization URLs at `https://<slug>.ui.z8-time.app` with `https://<orgid>.ui.z8-time.app` aliases while preserving verified custom-domain behavior.

**Architecture:** Add a focused platform-domain resolver under `src/lib/domain` that classifies hosts and resolves platform subdomains against Better Auth organizations. Wire it into auth layout, Turnstile verification, URL generation, proxy classification, and Better Auth host/origin validation. Keep automatic platform subdomains derived from `organization.slug` and `organization.id`; do not store them in `organization_domain`.

**Tech Stack:** Next.js 16 App Router, Better Auth 1.6.11, Drizzle ORM, Vitest, React 19, pnpm.

---

## File Structure

- Create `apps/webapp/src/lib/domain/platform-domain.ts`: pure host normalization/classification plus database-backed platform organization lookup and platform domain-context construction.
- Create `apps/webapp/src/lib/domain/platform-domain.test.ts`: unit tests for host classification, slug/id lookup order, not-found behavior, and context shape.
- Modify `apps/webapp/src/lib/domain/request-domain.ts`: make customer custom-domain extraction ignore platform organization subdomains.
- Modify `apps/webapp/src/lib/domain/request-domain.test.ts`: add tests proving `*.ui.z8-time.app` is not treated as a customer custom domain.
- Modify `apps/webapp/src/lib/domain/index.ts`: export the new resolver helpers.
- Modify `apps/webapp/src/lib/app-url.ts`: use verified custom domain first, then canonical slug platform URL.
- Create `apps/webapp/src/lib/app-url.test.ts`: cover URL precedence.
- Modify `apps/webapp/src/app/[locale]/(auth)/layout.tsx`: resolve auth context for platform organization subdomains.
- Modify `apps/webapp/src/app/[locale]/(auth)/layout.test.tsx`: cover platform subdomain auth context and custom-domain preservation.
- Modify `apps/webapp/src/app/api/auth/verify-turnstile/route.ts`: resolve platform subdomain organization context for Turnstile verification.
- Modify `apps/webapp/src/app/api/auth/verify-turnstile/route.test.ts`: cover platform subdomain behavior.
- Modify `apps/webapp/src/app/api/auth/social-org/[provider]/route.ts`: resolve organization id from platform subdomain for org-specific social OAuth.
- Modify `apps/webapp/src/lib/auth.ts`: add explicit Better Auth allowed host and trusted origin wildcard support for `*.ui.z8-time.app`.
- Modify `apps/webapp/src/proxy.ts`: avoid tagging platform organization subdomains as customer custom domains.
- Do not add proxy-level alias redirects in this implementation. The organization-id alias remains accepted without redirect to avoid database work in middleware and to avoid unsafe method-changing redirects.

## Task 1: Platform Domain Classification

**Files:**
- Create: `apps/webapp/src/lib/domain/platform-domain.ts`
- Create: `apps/webapp/src/lib/domain/platform-domain.test.ts`
- Modify: `apps/webapp/src/lib/domain/index.ts`

- [ ] **Step 1: Write failing classification tests**

Create `apps/webapp/src/lib/domain/platform-domain.test.ts` with these tests first:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	env: {
		MAIN_DOMAIN: "ui.z8-time.app",
		PLATFORM_DOMAIN: "ui.z8-time.app",
	},
}));

vi.mock("@/env", () => ({ env: mockState.env }));

const { classifyDomainHost, getPlatformOrganizationLabel, normalizeDomainHost } = await import(
	"./platform-domain"
);

describe("platform domain host helpers", () => {
	beforeEach(() => {
		mockState.env.MAIN_DOMAIN = "ui.z8-time.app";
		mockState.env.PLATFORM_DOMAIN = "ui.z8-time.app";
	});

	it("normalizes hosts by lowercasing and removing ports", () => {
		expect(normalizeDomainHost("Acme.UI.Z8-Time.App:443")).toBe("acme.ui.z8-time.app");
		expect(normalizeDomainHost("https://Acme.UI.Z8-Time.App/login")).toBe("acme.ui.z8-time.app");
		expect(normalizeDomainHost("  ")).toBeNull();
	});

	it("classifies the main domain and localhost as main", () => {
		expect(classifyDomainHost("ui.z8-time.app")).toEqual({ type: "main", hostname: "ui.z8-time.app" });
		expect(classifyDomainHost("localhost:3000")).toEqual({ type: "main", hostname: "localhost" });
		expect(classifyDomainHost("tenant.localhost:3000")).toEqual({ type: "main", hostname: "tenant.localhost" });
	});

	it("classifies one-label platform organization subdomains", () => {
		expect(classifyDomainHost("acme.ui.z8-time.app")).toEqual({
			type: "platformOrganization",
			hostname: "acme.ui.z8-time.app",
			label: "acme",
			rootDomain: "ui.z8-time.app",
		});
		expect(getPlatformOrganizationLabel("org_123.ui.z8-time.app")).toBe("org_123");
	});

	it("does not classify multi-level platform hosts as organization subdomains", () => {
		expect(classifyDomainHost("deep.acme.ui.z8-time.app")).toEqual({
			type: "unknownPlatform",
			hostname: "deep.acme.ui.z8-time.app",
			rootDomain: "ui.z8-time.app",
		});
	});

	it("classifies unrelated hosts as custom domain candidates", () => {
		expect(classifyDomainHost("login.acme.test")).toEqual({
			type: "customDomain",
			hostname: "login.acme.test",
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir apps/webapp test src/lib/domain/platform-domain.test.ts
```

Expected: FAIL because `./platform-domain` does not exist.

- [ ] **Step 3: Implement pure classification helpers**

Create `apps/webapp/src/lib/domain/platform-domain.ts` with this initial implementation:

```ts
import { env } from "@/env";

export type DomainHostClassification =
	| { type: "main"; hostname: string }
	| { type: "platformOrganization"; hostname: string; label: string; rootDomain: string }
	| { type: "unknownPlatform"; hostname: string; rootDomain: string }
	| { type: "customDomain"; hostname: string };

export function normalizeDomainHost(host: string | null): string | null {
	if (!host) {
		return null;
	}

	const trimmed = host.trim().toLowerCase();
	if (!trimmed) {
		return null;
	}

	try {
		return new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`).hostname;
	} catch {
		return trimmed.split(":")[0] || null;
	}
}

export function getPlatformRootDomain(): string {
	return normalizeDomainHost(env.PLATFORM_DOMAIN ?? env.MAIN_DOMAIN ?? "ui.z8-time.app") ?? "ui.z8-time.app";
}

export function classifyDomainHost(host: string | null): DomainHostClassification | null {
	const hostname = normalizeDomainHost(host);
	if (!hostname) {
		return null;
	}

	const mainDomain = normalizeDomainHost(env.MAIN_DOMAIN ?? "localhost:3000");
	const platformRootDomain = getPlatformRootDomain();

	if (
		hostname === mainDomain ||
		hostname === platformRootDomain ||
		hostname === "localhost" ||
		hostname.endsWith(".localhost")
	) {
		return { type: "main", hostname };
	}

	const platformSuffix = `.${platformRootDomain}`;
	if (hostname.endsWith(platformSuffix)) {
		const label = hostname.slice(0, -platformSuffix.length);
		if (label && !label.includes(".")) {
			return { type: "platformOrganization", hostname, label, rootDomain: platformRootDomain };
		}

		return { type: "unknownPlatform", hostname, rootDomain: platformRootDomain };
	}

	return { type: "customDomain", hostname };
}

export function getPlatformOrganizationLabel(host: string | null): string | null {
	const classification = classifyDomainHost(host);
	return classification?.type === "platformOrganization" ? classification.label : null;
}
```

Add the new exports to `apps/webapp/src/lib/domain/index.ts`:

```ts
// Domain service exports

export { domainCache } from "./domain-cache";
export * from "./domain-service";
export * from "./platform-domain";
export * from "./types";
```

- [ ] **Step 4: Add environment schema support for platform root domain**

Modify `apps/webapp/src/env.ts` to add `PLATFORM_DOMAIN` next to `MAIN_DOMAIN` in both the server schema and runtime env object. The relevant sections should include:

```ts
PLATFORM_DOMAIN: z.string().optional(),
MAIN_DOMAIN: z.string().optional(),
```

and:

```ts
PLATFORM_DOMAIN: process.env.PLATFORM_DOMAIN,
MAIN_DOMAIN: process.env.MAIN_DOMAIN,
```

Place `PLATFORM_DOMAIN` directly beside `MAIN_DOMAIN` to keep deployment-domain settings discoverable.

- [ ] **Step 5: Run classification tests to verify they pass**

Run:

```bash
pnpm --dir apps/webapp test src/lib/domain/platform-domain.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add apps/webapp/src/env.ts apps/webapp/src/lib/domain/index.ts apps/webapp/src/lib/domain/platform-domain.ts apps/webapp/src/lib/domain/platform-domain.test.ts
git commit -m "feat: classify platform organization subdomains"
```

## Task 2: Platform Organization Resolution

**Files:**
- Modify: `apps/webapp/src/lib/domain/platform-domain.ts`
- Modify: `apps/webapp/src/lib/domain/platform-domain.test.ts`

- [ ] **Step 1: Extend tests for organization lookup and context construction**

Append these tests to `apps/webapp/src/lib/domain/platform-domain.test.ts`. Replace the current mock block at the top with this expanded mock state and imports:

```ts
const mockState = vi.hoisted(() => ({
	env: {
		MAIN_DOMAIN: "ui.z8-time.app",
		PLATFORM_DOMAIN: "ui.z8-time.app",
	},
	db: {
		query: {
			organization: {
				findFirst: vi.fn(),
			},
			organizationBranding: {
				findFirst: vi.fn(),
			},
		},
	},
	getConfiguredProviders: vi.fn(),
}));

vi.mock("@/env", () => ({ env: mockState.env }));
vi.mock("@/db", () => ({ db: mockState.db }));
vi.mock("@/lib/social-oauth", () => ({ getConfiguredProviders: mockState.getConfiguredProviders }));
```

Update the dynamic import to include the new functions:

```ts
const {
	classifyDomainHost,
	getPlatformDomainConfig,
	getPlatformOrganizationLabel,
	normalizeDomainHost,
	resolvePlatformOrganization,
} = await import("./platform-domain");
```

Add this `beforeEach` reset inside the existing `describe` or in a new `describe` block:

```ts
beforeEach(() => {
	vi.clearAllMocks();
	mockState.env.MAIN_DOMAIN = "ui.z8-time.app";
	mockState.env.PLATFORM_DOMAIN = "ui.z8-time.app";
	mockState.getConfiguredProviders.mockResolvedValue({
		google: false,
		github: false,
		linkedin: false,
		apple: false,
	});
});
```

Add these tests:

```ts
describe("platform organization resolution", () => {
	it("resolves platform labels by slug before id", async () => {
		mockState.db.query.organization.findFirst
			.mockResolvedValueOnce({ id: "org_slug", slug: "acme", name: "Acme" })
			.mockResolvedValueOnce({ id: "org_id", slug: "other", name: "Other" });

		const result = await resolvePlatformOrganization("acme");

		expect(result).toEqual({ id: "org_slug", slug: "acme", name: "Acme" });
		expect(mockState.db.query.organization.findFirst).toHaveBeenCalledTimes(1);
	});

	it("falls back to organization id when no slug matches", async () => {
		mockState.db.query.organization.findFirst
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ id: "org_123", slug: "acme", name: "Acme" });

		const result = await resolvePlatformOrganization("org_123");

		expect(result).toEqual({ id: "org_123", slug: "acme", name: "Acme" });
		expect(mockState.db.query.organization.findFirst).toHaveBeenCalledTimes(2);
	});

	it("returns null when neither slug nor id matches", async () => {
		mockState.db.query.organization.findFirst.mockResolvedValue(null);

		await expect(resolvePlatformOrganization("missing")).resolves.toBeNull();
	});

	it("builds a domain auth context for platform organization subdomains", async () => {
		mockState.db.query.organization.findFirst.mockResolvedValueOnce({
			id: "org_123",
			slug: "acme",
			name: "Acme",
		});
		mockState.db.query.organizationBranding.findFirst.mockResolvedValueOnce({
			logoUrl: "https://cdn.example/logo.png",
			backgroundImageUrl: null,
			appName: "Acme Time",
			primaryColor: "#2563eb",
			accentColor: "#0ea5e9",
		});
		mockState.getConfiguredProviders.mockResolvedValueOnce({
			google: true,
			github: false,
			linkedin: false,
			apple: false,
		});

		const result = await getPlatformDomainConfig("acme.ui.z8-time.app");

		expect(result).toEqual({
			organizationId: "org_123",
			organizationSlug: "acme",
			domain: "acme.ui.z8-time.app",
			canonicalDomain: "acme.ui.z8-time.app",
			isCanonical: true,
			authConfig: {
				emailPasswordEnabled: true,
				socialProvidersEnabled: ["google", "github", "linkedin", "apple"],
				ssoEnabled: false,
				passkeyEnabled: true,
			},
			branding: {
				logoUrl: "https://cdn.example/logo.png",
				backgroundImageUrl: null,
				appName: "Acme Time",
				primaryColor: "#2563eb",
				accentColor: "#0ea5e9",
			},
			socialOAuthConfigured: {
				google: true,
				github: false,
				linkedin: false,
				apple: false,
			},
			turnstile: {
				enabled: false,
				siteKey: null,
				isEnterprise: false,
			},
		});
	});

	it("marks organization id hosts as aliases with slug canonical domain", async () => {
		mockState.db.query.organization.findFirst
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ id: "org_123", slug: "acme", name: "Acme" });
		mockState.db.query.organizationBranding.findFirst.mockResolvedValueOnce(null);

		const result = await getPlatformDomainConfig("org_123.ui.z8-time.app");

		expect(result?.organizationId).toBe("org_123");
		expect(result?.organizationSlug).toBe("acme");
		expect(result?.domain).toBe("org_123.ui.z8-time.app");
		expect(result?.canonicalDomain).toBe("acme.ui.z8-time.app");
		expect(result?.isCanonical).toBe(false);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir apps/webapp test src/lib/domain/platform-domain.test.ts
```

Expected: FAIL because `resolvePlatformOrganization` and `getPlatformDomainConfig` are not implemented.

- [ ] **Step 3: Implement resolver and platform auth context**

Add these imports to `apps/webapp/src/lib/domain/platform-domain.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { organizationBranding } from "@/db/schema";
import { getConfiguredProviders } from "@/lib/social-oauth";
import {
	DEFAULT_AUTH_CONFIG,
	type DomainAuthContext,
	type OrganizationBranding,
	type SocialOAuthConfigured,
} from "./types";
```

Add this default social OAuth object below the imports:

```ts
const DEFAULT_SOCIAL_OAUTH_CONFIGURED: SocialOAuthConfigured = {
	google: false,
	github: false,
	linkedin: false,
	apple: false,
};
```

Add these exported types and functions after `getPlatformOrganizationLabel`:

```ts
export interface PlatformOrganizationRecord {
	id: string;
	slug: string;
	name: string;
}

export interface PlatformDomainAuthContext extends DomainAuthContext {
	organizationSlug: string;
	canonicalDomain: string;
	isCanonical: boolean;
}

export async function resolvePlatformOrganization(
	label: string,
): Promise<PlatformOrganizationRecord | null> {
	const bySlug = await db.query.organization.findFirst({
		where: eq(organization.slug, label),
		columns: {
			id: true,
			slug: true,
			name: true,
		},
	});

	if (bySlug) {
		return bySlug;
	}

	const byId = await db.query.organization.findFirst({
		where: eq(organization.id, label),
		columns: {
			id: true,
			slug: true,
			name: true,
		},
	});

	return byId ?? null;
}

export function getCanonicalPlatformDomain(organizationSlug: string): string {
	return `${organizationSlug}.${getPlatformRootDomain()}`;
}

export async function getPlatformDomainConfig(
	host: string | null,
): Promise<PlatformDomainAuthContext | null> {
	const classification = classifyDomainHost(host);
	if (classification?.type !== "platformOrganization") {
		return null;
	}

	const org = await resolvePlatformOrganization(classification.label);
	if (!org) {
		return null;
	}

	const brandingRecord = await db.query.organizationBranding.findFirst({
		where: eq(organizationBranding.organizationId, org.id),
	});

	let branding: OrganizationBranding | null = null;
	if (brandingRecord) {
		branding = {
			logoUrl: brandingRecord.logoUrl,
			backgroundImageUrl: brandingRecord.backgroundImageUrl,
			appName: brandingRecord.appName,
			primaryColor: brandingRecord.primaryColor,
			accentColor: brandingRecord.accentColor,
		};
	}

	let socialOAuthConfigured = DEFAULT_SOCIAL_OAUTH_CONFIGURED;
	try {
		socialOAuthConfigured = await getConfiguredProviders(org.id);
	} catch (error) {
		console.warn(`Failed to get social OAuth config for ${org.id}:`, error);
	}

	const canonicalDomain = getCanonicalPlatformDomain(org.slug);

	return {
		organizationId: org.id,
		organizationSlug: org.slug,
		domain: classification.hostname,
		canonicalDomain,
		isCanonical: classification.hostname === canonicalDomain,
		authConfig: DEFAULT_AUTH_CONFIG,
		branding,
		socialOAuthConfigured,
		turnstile: {
			enabled: false,
			siteKey: null,
			isEnterprise: false,
		},
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir apps/webapp test src/lib/domain/platform-domain.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add apps/webapp/src/lib/domain/platform-domain.ts apps/webapp/src/lib/domain/platform-domain.test.ts
git commit -m "feat: resolve platform organization subdomains"
```

## Task 3: Custom Domain Detection And Proxy Classification

**Files:**
- Modify: `apps/webapp/src/lib/domain/request-domain.ts`
- Modify: `apps/webapp/src/lib/domain/request-domain.test.ts`
- Modify: `apps/webapp/src/proxy.ts`

- [ ] **Step 1: Add failing request-domain tests for platform subdomains**

Modify the hoisted env in `apps/webapp/src/lib/domain/request-domain.test.ts` to include `PLATFORM_DOMAIN`:

```ts
const mockEnv = vi.hoisted(() => ({
	env: {
		MAIN_DOMAIN: "app.z8.test",
		PLATFORM_DOMAIN: "ui.z8-time.app",
	},
}));
```

Update `beforeEach`:

```ts
beforeEach(() => {
	mockEnv.env.MAIN_DOMAIN = "app.z8.test";
	mockEnv.env.PLATFORM_DOMAIN = "ui.z8-time.app";
});
```

Add this test:

```ts
it("returns null for platform organization subdomains", () => {
	expect(getCustomDomainFromHeaders(new Headers({ host: "acme.ui.z8-time.app" }))).toBeNull();
	expect(getCustomDomainFromHeaders(new Headers({ host: "org_123.ui.z8-time.app" }))).toBeNull();
});
```

- [ ] **Step 2: Run request-domain tests to verify they fail**

Run:

```bash
pnpm --dir apps/webapp test src/lib/domain/request-domain.test.ts
```

Expected: FAIL because platform subdomains are currently returned as custom domains.

- [ ] **Step 3: Update customer custom-domain extraction**

Replace `apps/webapp/src/lib/domain/request-domain.ts` with classification-backed logic:

```ts
import { classifyDomainHost } from "./platform-domain";

export function getCustomDomainFromHeaders(headers: Headers): string | null {
	const classification = classifyDomainHost(headers.get("host"));
	return classification?.type === "customDomain" ? classification.hostname : null;
}
```

- [ ] **Step 4: Update proxy classification**

In `apps/webapp/src/proxy.ts`, add this import:

```ts
import { classifyDomainHost } from "@/lib/domain/platform-domain";
```

Remove the `env` import and local `MAIN_DOMAIN` constant because classification now lives in `platform-domain.ts`:

```ts
import { env } from "@/env";
```

Remove:

```ts
// Main domain from environment variable
const MAIN_DOMAIN = env.MAIN_DOMAIN || "localhost:3000";
```

Replace the custom-domain detection block at the end with:

```ts
// Custom domain detection. Platform organization subdomains are resolved separately
// and must not be tagged as customer-owned custom domains.
const domainClassification = classifyDomainHost(request.headers.get("host"));
if (domainClassification?.type === "customDomain") {
	response.headers.set(DOMAIN_HEADERS.DOMAIN, domainClassification.hostname);
}
```

No other code in `proxy.ts` should reference `env` after this change.

- [ ] **Step 5: Run tests to verify custom-domain extraction passes**

Run:

```bash
pnpm --dir apps/webapp test src/lib/domain/request-domain.test.ts src/lib/domain/platform-domain.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add apps/webapp/src/lib/domain/request-domain.ts apps/webapp/src/lib/domain/request-domain.test.ts apps/webapp/src/proxy.ts
git commit -m "fix: exclude platform subdomains from custom domains"
```

## Task 4: URL Generation Fallback

**Files:**
- Modify: `apps/webapp/src/lib/app-url.ts`
- Create: `apps/webapp/src/lib/app-url.test.ts`

- [ ] **Step 1: Write failing app-url tests**

Create `apps/webapp/src/lib/app-url.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	domainConfig: vi.fn(),
	db: {
		query: {
			organization: {
				findFirst: vi.fn(),
			},
		},
	},
	env: {
		PLATFORM_DOMAIN: "ui.z8-time.app",
	},
}));

vi.mock("@/env", () => ({ env: mockState.env }));
vi.mock("@/db", () => ({ db: mockState.db }));
vi.mock("@/lib/domain/domain-service", () => ({
	getDomainConfigByOrganization: mockState.domainConfig,
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ warn: vi.fn() }),
}));

const { getOrganizationBaseUrl } = await import("./app-url");

describe("getOrganizationBaseUrl", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.env.PLATFORM_DOMAIN = "ui.z8-time.app";
		delete process.env.BETTER_AUTH_URL;
		delete process.env.NEXT_PUBLIC_APP_URL;
	});

	it("returns verified custom domain before platform subdomain", async () => {
		mockState.domainConfig.mockResolvedValueOnce({
			domain: "login.acme.test",
			domainVerified: true,
		});

		await expect(getOrganizationBaseUrl("org_123")).resolves.toBe("https://login.acme.test");
		expect(mockState.db.query.organization.findFirst).not.toHaveBeenCalled();
	});

	it("returns canonical slug platform subdomain when no verified custom domain exists", async () => {
		mockState.domainConfig.mockResolvedValueOnce(null);
		mockState.db.query.organization.findFirst.mockResolvedValueOnce({ slug: "acme" });

		await expect(getOrganizationBaseUrl("org_123")).resolves.toBe("https://acme.ui.z8-time.app");
	});

	it("returns the default app URL when organization lookup fails", async () => {
		process.env.NEXT_PUBLIC_APP_URL = "https://ui.z8-time.app";
		mockState.domainConfig.mockResolvedValueOnce(null);
		mockState.db.query.organization.findFirst.mockResolvedValueOnce(null);

		await expect(getOrganizationBaseUrl("org_123")).resolves.toBe("https://ui.z8-time.app");
	});
});
```

- [ ] **Step 2: Run app-url tests to verify they fail**

Run:

```bash
pnpm --dir apps/webapp test src/lib/app-url.test.ts
```

Expected: FAIL because `getOrganizationBaseUrl()` currently returns the default URL after no custom domain.

- [ ] **Step 3: Implement slug platform fallback**

Modify `apps/webapp/src/lib/app-url.ts` imports:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { getDomainConfigByOrganization } from "@/lib/domain/domain-service";
import { getCanonicalPlatformDomain } from "@/lib/domain/platform-domain";
import { createLogger } from "@/lib/logger";
```

Replace `getOrganizationBaseUrl` with:

```ts
export async function getOrganizationBaseUrl(organizationId?: string): Promise<string> {
	const defaultUrl = getDefaultAppBaseUrl();

	if (!organizationId) {
		return defaultUrl;
	}

	try {
		const domainConfig = await getDomainConfigByOrganization(organizationId);
		if (domainConfig?.domainVerified) {
			return `https://${domainConfig.domain}`;
		}
	} catch (error) {
		logger.warn({ error, organizationId }, "Failed to get custom domain for organization");
	}

	try {
		const org = await db.query.organization.findFirst({
			where: eq(organization.id, organizationId),
			columns: { slug: true },
		});

		if (org?.slug) {
			return `https://${getCanonicalPlatformDomain(org.slug)}`;
		}
	} catch (error) {
		logger.warn({ error, organizationId }, "Failed to get organization slug for platform URL");
	}

	return defaultUrl;
}
```

- [ ] **Step 4: Run app-url tests to verify they pass**

Run:

```bash
pnpm --dir apps/webapp test src/lib/app-url.test.ts src/lib/domain/platform-domain.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add apps/webapp/src/lib/app-url.ts apps/webapp/src/lib/app-url.test.ts
git commit -m "feat: use platform subdomain as organization url fallback"
```

## Task 5: Auth Runtime Integration

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(auth)/layout.tsx`
- Modify: `apps/webapp/src/app/[locale]/(auth)/layout.test.tsx`
- Modify: `apps/webapp/src/app/api/auth/verify-turnstile/route.ts`
- Modify: `apps/webapp/src/app/api/auth/verify-turnstile/route.test.ts`
- Modify: `apps/webapp/src/app/api/auth/social-org/[provider]/route.ts`

- [ ] **Step 1: Add failing auth layout test for platform subdomains**

Modify `apps/webapp/src/app/[locale]/(auth)/layout.test.tsx` mock state to include `getPlatformDomainConfig`:

```ts
const mockState = vi.hoisted(() => ({
	headers: vi.fn(async () => new Headers()),
	getCookieConsentScript: vi.fn(async () => null),
	getDomainConfig: vi.fn(),
	getPlatformDomainConfig: vi.fn(),
	env: {},
}));
```

Update the domain mock:

```ts
vi.mock("@/lib/domain", () => ({
	getDomainConfig: mockState.getDomainConfig,
	getPlatformDomainConfig: mockState.getPlatformDomainConfig,
}));
```

Reset it in `beforeEach`:

```ts
mockState.getPlatformDomainConfig.mockResolvedValue(null);
```

Add this test:

```ts
it("uses platform organization context on platform subdomains", async () => {
	mockState.headers.mockResolvedValue(new Headers({ host: "acme.ui.z8-time.app" }));
	mockState.getCookieConsentScript.mockResolvedValue("platform()");
	mockState.getPlatformDomainConfig.mockResolvedValue({
		organizationId: "org_123",
		organizationSlug: "acme",
		domain: "acme.ui.z8-time.app",
		canonicalDomain: "acme.ui.z8-time.app",
		isCanonical: true,
		authConfig: {
			emailPasswordEnabled: true,
			socialProvidersEnabled: ["google"],
			ssoEnabled: false,
			passkeyEnabled: true,
		},
		branding: null,
		socialOAuthConfigured: {
			google: true,
			github: false,
			linkedin: false,
			apple: false,
		},
		turnstile: {
			enabled: false,
			siteKey: null,
			isEnterprise: false,
		},
	});

	render(await AuthLayout({ children: <div>Auth content</div> }));

	expect(mockState.getPlatformDomainConfig).toHaveBeenCalledWith("acme.ui.z8-time.app");
	expect(mockState.getDomainConfig).not.toHaveBeenCalled();
	expect(mockState.getCookieConsentScript).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run auth layout tests to verify they fail**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/(auth)/layout.test.tsx'
```

Expected: FAIL because layout does not call `getPlatformDomainConfig`.

- [ ] **Step 3: Update auth layout context resolution**

Modify imports in `apps/webapp/src/app/[locale]/(auth)/layout.tsx`:

```ts
import { type DomainAuthContext, getDomainConfig, getPlatformDomainConfig } from "@/lib/domain";
```

After reading headers, capture host:

```ts
const host = headersList.get("host");
const customDomain = getCustomDomainFromHeaders(headersList);
```

Replace domain context selection with:

```ts
let domainContext: DomainAuthContext | null = null;
const platformDomainContext = await getPlatformDomainConfig(host);
if (platformDomainContext) {
	domainContext = platformDomainContext;
} else if (customDomain) {
	domainContext = await getDomainConfig(customDomain);
} else {
	const globalTurnstileSiteKey = env.TURNSTILE_SITE_KEY ?? null;
	domainContext = {
		organizationId: "",
		domain: "",
		authConfig: {
			emailPasswordEnabled: true,
			socialProvidersEnabled: ["google", "github", "linkedin", "apple"],
			ssoEnabled: false,
			passkeyEnabled: true,
		},
		branding: null,
		socialOAuthConfigured: {
			google: false,
			github: false,
			linkedin: false,
			apple: false,
		},
		turnstile: {
			enabled: !!globalTurnstileSiteKey,
			siteKey: globalTurnstileSiteKey,
			isEnterprise: false,
		},
	};
}
```

Keep the existing cookie-consent logic so platform subdomains still use the platform cookie consent script unless a future organization-level setting exists:

```ts
const platformCookieConsentScript = customDomain ? null : await getCookieConsentScript();
```

- [ ] **Step 4: Add failing Turnstile API test for platform subdomains**

Modify `apps/webapp/src/app/api/auth/verify-turnstile/route.test.ts` mock state to include `getPlatformDomainConfig`:

```ts
const mockState = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	getDomainConfig: vi.fn(),
	getPlatformDomainConfig: vi.fn(),
	verifyTurnstileToken: vi.fn(),
	env: {
		MAIN_DOMAIN: "app.z8.test",
	},
}));
```

Update the domain mock:

```ts
vi.mock("@/lib/domain", () => ({
	getDomainConfig: mockState.getDomainConfig,
	getPlatformDomainConfig: mockState.getPlatformDomainConfig,
}));
```

Reset it in `beforeEach`:

```ts
mockState.getPlatformDomainConfig.mockResolvedValue(null);
```

Add this test:

```ts
it("derives platform organization Turnstile context from platform subdomains", async () => {
	mockState.getPlatformDomainConfig.mockResolvedValue({ organizationId: "org_123" });

	const response = await POST(
		new Request("https://acme.ui.z8-time.app/api/auth/verify-turnstile", {
			method: "POST",
			headers: { host: "acme.ui.z8-time.app" },
			body: JSON.stringify({ token: "token_123" }),
		}),
	);

	expect(response.status).toBe(200);
	expect(mockState.getPlatformDomainConfig).toHaveBeenCalledWith("acme.ui.z8-time.app");
	expect(mockState.getDomainConfig).not.toHaveBeenCalled();
	expect(mockState.verifyTurnstileToken).toHaveBeenCalledWith("token_123", "org_123", false);
});
```

- [ ] **Step 5: Update Turnstile route**

In `apps/webapp/src/app/api/auth/verify-turnstile/route.ts`, import `getPlatformDomainConfig` from `@/lib/domain` alongside existing domain imports.

Replace the organization context resolution with this order:

```ts
const host = request.headers.get("host");
const platformDomainConfig = await getPlatformDomainConfig(host);
const customDomain = platformDomainConfig ? null : getCustomDomainFromHeaders(request.headers);
const domainConfig = platformDomainConfig ?? (customDomain ? await getDomainConfig(customDomain) : null);
const organizationId = domainConfig?.organizationId;
const isEnterprise = !!customDomain;
```

Keep the existing rate limiting, payload parsing, and `verifyTurnstileToken(token, organizationId, isEnterprise)` call. Platform subdomains should pass `isEnterprise = false` because they use platform Turnstile behavior.

- [ ] **Step 6: Update social OAuth initiation route**

In `apps/webapp/src/app/api/auth/social-org/[provider]/route.ts`, update imports:

```ts
import { getDomainConfig, getPlatformDomainConfig } from "@/lib/domain";
```

Replace the host organization resolution block with:

```ts
if (host) {
	const normalizedHost = host.toLowerCase().replace(/:\d+$/, "");
	try {
		const platformDomainConfig = await getPlatformDomainConfig(normalizedHost);
		const domainConfig = platformDomainConfig ?? (await getDomainConfig(normalizedHost));
		if (domainConfig) {
			organizationId = domainConfig.organizationId;
		}
	} catch (error) {
		logger.warn({ error, host }, "Failed to get domain config");
	}
}
```

- [ ] **Step 7: Run auth integration tests**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/(auth)/layout.test.tsx' src/app/api/auth/verify-turnstile/route.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(auth)/layout.tsx' 'apps/webapp/src/app/[locale]/(auth)/layout.test.tsx' apps/webapp/src/app/api/auth/verify-turnstile/route.ts apps/webapp/src/app/api/auth/verify-turnstile/route.test.ts apps/webapp/src/app/api/auth/social-org/[provider]/route.ts
git commit -m "feat: resolve auth context for platform subdomains"
```

## Task 6: Better Auth Host And Origin Validation

**Files:**
- Modify: `apps/webapp/src/lib/auth.ts`
- Create: `apps/webapp/src/lib/auth-domain-config.ts`
- Create: `apps/webapp/src/lib/auth-domain-config.test.ts`

- [ ] **Step 1: Write failing tests for Better Auth domain config helpers**

Create `apps/webapp/src/lib/auth-domain-config.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	env: {
		APP_URL: "https://ui.z8-time.app",
		PLATFORM_DOMAIN: "ui.z8-time.app",
	},
}));

vi.mock("@/env", () => ({ env: mockState.env }));

const { getAuthAllowedHosts, getStaticTrustedOrigins } = await import("./auth-domain-config");

describe("auth domain config", () => {
	beforeEach(() => {
		mockState.env.APP_URL = "https://ui.z8-time.app";
		mockState.env.PLATFORM_DOMAIN = "ui.z8-time.app";
	});

	it("allows the platform wildcard host for Better Auth baseURL resolution", () => {
		expect(getAuthAllowedHosts()).toContain("*.ui.z8-time.app");
		expect(getAuthAllowedHosts()).toContain("ui.z8-time.app");
		expect(getAuthAllowedHosts()).toContain("localhost:3000");
	});

	it("trusts the platform wildcard origin for CSRF and redirects", () => {
		expect(getStaticTrustedOrigins()).toContain("https://*.ui.z8-time.app");
		expect(getStaticTrustedOrigins()).toContain("https://ui.z8-time.app");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir apps/webapp test src/lib/auth-domain-config.test.ts
```

Expected: FAIL because `auth-domain-config.ts` does not exist.

- [ ] **Step 3: Implement Better Auth domain config helper**

Create `apps/webapp/src/lib/auth-domain-config.ts`:

```ts
import { env } from "@/env";
import { getDefaultAppBaseUrl } from "@/lib/app-url";
import { getPlatformRootDomain } from "@/lib/domain/platform-domain";

function hostFromUrlOrHost(value: string): string {
	try {
		return new URL(value).host;
	} catch {
		return value.replace(/^https?:\/\//, "").replace(/\/+$/, "");
	}
}

export function getAuthAllowedHosts(): string[] {
	const appHost = hostFromUrlOrHost(env.APP_URL || "ui.z8-time.app");
	const platformRoot = getPlatformRootDomain();

	return Array.from(new Set([appHost, platformRoot, `*.${platformRoot}`, "ui.z8-time.app", "localhost:3000"]));
}

export function getStaticTrustedOrigins(): string[] {
	const defaultOrigin = getDefaultAppBaseUrl();
	const platformRoot = getPlatformRootDomain();

	return Array.from(new Set([defaultOrigin, `https://${platformRoot}`, `https://*.${platformRoot}`]));
}
```

- [ ] **Step 4: Wire helper into Better Auth config**

In `apps/webapp/src/lib/auth.ts`, add this import:

```ts
import { getAuthAllowedHosts, getStaticTrustedOrigins } from "@/lib/auth-domain-config";
```

Replace `baseURL.allowedHosts` with:

```ts
allowedHosts: getAuthAllowedHosts(),
```

Replace the first line of `trustedOrigins` with:

```ts
const origins = getStaticTrustedOrigins();
```

Keep the existing dynamic current-host and verified-custom-domain logic after that line.

- [ ] **Step 5: Run auth config tests**

Run:

```bash
pnpm --dir apps/webapp test src/lib/auth-domain-config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

Run:

```bash
git add apps/webapp/src/lib/auth.ts apps/webapp/src/lib/auth-domain-config.ts apps/webapp/src/lib/auth-domain-config.test.ts
git commit -m "feat: allow platform subdomains in better auth"
```

## Task 7: Alias Policy And Final Verification

**Files:**
- Verify: all changed tests and production build when available

- [ ] **Step 1: Confirm alias policy in code comments or handoff**

Do not implement alias-to-slug redirects in middleware for this iteration. `orgid.ui.z8-time.app` should resolve and work, while generated links use `slug.ui.z8-time.app` through `getOrganizationBaseUrl()`. This avoids database reads in `proxy.ts` and avoids unsafe redirects for API/auth requests.

- [ ] **Step 2: Verify alias behavior is already covered**

Confirm `apps/webapp/src/lib/domain/platform-domain.test.ts` contains this assertion from Task 2:

```ts
expect(result?.organizationId).toBe("org_123");
expect(result?.organizationSlug).toBe("acme");
expect(result?.domain).toBe("org_123.ui.z8-time.app");
expect(result?.canonicalDomain).toBe("acme.ui.z8-time.app");
expect(result?.isCanonical).toBe(false);
```

- [ ] **Step 3: Run focused test suite**

Run:

```bash
pnpm --dir apps/webapp test src/lib/domain/platform-domain.test.ts src/lib/domain/request-domain.test.ts src/lib/app-url.test.ts src/lib/auth-domain-config.test.ts 'src/app/[locale]/(auth)/layout.test.tsx' src/app/api/auth/verify-turnstile/route.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full webapp tests**

Run:

```bash
pnpm --dir apps/webapp test
```

Expected: PASS. When a failure occurs, fix failures caused by this implementation before continuing. For pre-existing unrelated failures, capture the failing test names and exact error output in the implementation handoff.

- [ ] **Step 5: Run production build when environment permits**

Run:

```bash
CI=true pnpm --dir apps/webapp build
```

Expected: PASS. When the build requires unavailable Phase CLI/system secrets, do not invent environment variables; record the missing variables and explain in the implementation handoff that the build was not run.

- [ ] **Step 6: Do not create a verification-only commit**

Task 7 should not add code. Do not create an empty commit. When verification reveals a bug from earlier tasks, return to the relevant task, add the missing focused test, fix the implementation, rerun the focused tests, and commit the actual changed files from that task.

## Final Review Checklist

- [ ] `slug.ui.z8-time.app` resolves organization context by slug.
- [ ] `orgid.ui.z8-time.app` resolves organization context by id when no slug matches.
- [ ] Generated organization URLs prefer verified custom domains before platform slug URLs.
- [ ] Platform subdomains are not treated as customer custom domains.
- [ ] Better Auth `baseURL.allowedHosts` includes `*.ui.z8-time.app`.
- [ ] Better Auth trusted origins include `https://*.ui.z8-time.app`.
- [ ] Host-derived org context does not bypass existing membership or RBAC checks.
- [ ] Focused tests pass.
- [ ] Full tests pass, or unrelated failures are documented with exact output.
- [ ] Production build passes, or unavailable environment variables are documented.
