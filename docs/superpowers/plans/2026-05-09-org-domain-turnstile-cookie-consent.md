# Organization Domain Turnstile And Cookie Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow enterprise organization admins to configure custom-domain Turnstile and cookie consent behavior from `/settings/enterprise/domains`.

**Architecture:** Store the custom-domain cookie consent script in the existing `organization_domain.auth_config` JSON payload as `cookieConsentScript`. Main-domain auth pages continue reading the platform script, while verified custom domains inject only the per-domain script through a small helper. The existing domain auth settings action panel remains the edit surface and continues saving through `updateDomainAuthConfigAction`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle, Vitest, Testing Library, pnpm.

---

## File Structure

- Modify `apps/webapp/src/db/schema/types.ts`: extend `AuthConfig` with optional `cookieConsentScript`.
- Modify `apps/webapp/src/lib/domain/types.ts`: document that domain auth context can carry the cookie script through `authConfig`.
- Create `apps/webapp/src/app/[locale]/(auth)/cookie-consent-script.ts`: focused helper that chooses the script for main-domain vs custom-domain auth pages.
- Create `apps/webapp/src/app/[locale]/(auth)/cookie-consent-script.test.ts`: unit coverage for main-domain, custom-domain, empty, and whitespace script selection.
- Modify `apps/webapp/src/app/[locale]/(auth)/layout.tsx`: use the helper so custom domains do not fall back to the platform script.
- Modify `apps/webapp/src/components/settings/enterprise/domain-auth-config-dialog.tsx`: add a cookie consent script textarea and include it in the saved auth config.
- Modify `apps/webapp/src/components/settings/enterprise/domain-management.tsx`: show summary badges for Turnstile and cookie consent configuration.
- Create or modify `apps/webapp/src/components/settings/enterprise/domain-auth-config-dialog.test.tsx`: UI coverage for loading and editing `cookieConsentScript` if existing test infrastructure supports this component cleanly.

## Task 1: Add Runtime Script Selection Helper

**Files:**
- Create: `apps/webapp/src/app/[locale]/(auth)/cookie-consent-script.ts`
- Create: `apps/webapp/src/app/[locale]/(auth)/cookie-consent-script.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `apps/webapp/src/app/[locale]/(auth)/cookie-consent-script.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DomainAuthContext } from "@/lib/domain";
import { selectAuthCookieConsentScript } from "./cookie-consent-script";

const domainContext = (cookieConsentScript?: string): DomainAuthContext => ({
	organizationId: "org_123",
	domain: "login.acme.test",
	authConfig: {
		emailPasswordEnabled: true,
		socialProvidersEnabled: [],
		ssoEnabled: false,
		passkeyEnabled: true,
		cookieConsentScript,
	},
	branding: null,
	socialOAuthConfigured: {
		google: false,
		github: false,
		linkedin: false,
		apple: false,
	},
	turnstile: {
		enabled: false,
		siteKey: null,
		isEnterprise: true,
	},
});

describe("selectAuthCookieConsentScript", () => {
	it("uses the platform script on the main auth domain", () => {
		expect(selectAuthCookieConsentScript(null, "<script>platform()</script>")).toBe(
			"<script>platform()</script>",
		);
	});

	it("uses the custom-domain script for verified custom domains", () => {
		expect(
			selectAuthCookieConsentScript(
				domainContext("<script>domain()</script>"),
				"<script>platform()</script>",
			),
		).toBe("<script>domain()</script>");
	});

	it("does not fall back to the platform script for custom domains", () => {
		expect(selectAuthCookieConsentScript(domainContext(undefined), "<script>platform()</script>")).toBeNull();
	});

	it("treats whitespace custom-domain scripts as disabled", () => {
		expect(selectAuthCookieConsentScript(domainContext("   \n\t"), "<script>platform()</script>")).toBeNull();
	});
});
```

- [ ] **Step 2: Run the helper tests to verify they fail**

Run:

```bash
pnpm --dir apps/webapp vitest run 'src/app/[locale]/(auth)/cookie-consent-script.test.ts'
```

Expected: FAIL because `./cookie-consent-script` does not exist.

- [ ] **Step 3: Implement the helper**

Create `apps/webapp/src/app/[locale]/(auth)/cookie-consent-script.ts`:

```ts
import type { DomainAuthContext } from "@/lib/domain";

export function selectAuthCookieConsentScript(
	domainContext: DomainAuthContext | null,
	platformCookieConsentScript: string | null,
): string | null {
	if (!domainContext?.domain) {
		return normalizeScript(platformCookieConsentScript);
	}

	return normalizeScript(domainContext.authConfig.cookieConsentScript ?? null);
}

function normalizeScript(script: string | null): string | null {
	if (!script || script.trim().length === 0) {
		return null;
	}

	return script;
}
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run:

```bash
pnpm --dir apps/webapp vitest run 'src/app/[locale]/(auth)/cookie-consent-script.test.ts'
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1 changes**

```bash
git add 'apps/webapp/src/app/[locale]/(auth)/cookie-consent-script.ts' 'apps/webapp/src/app/[locale]/(auth)/cookie-consent-script.test.ts'
git commit -m "test: cover auth cookie consent script selection"
```

## Task 2: Extend Auth Config Type And Auth Layout Wiring

**Files:**
- Modify: `apps/webapp/src/db/schema/types.ts`
- Modify: `apps/webapp/src/lib/domain/types.ts`
- Modify: `apps/webapp/src/app/[locale]/(auth)/layout.tsx`
- Test: `apps/webapp/src/app/[locale]/(auth)/cookie-consent-script.test.ts`

- [ ] **Step 1: Extend the `AuthConfig` type**

In `apps/webapp/src/db/schema/types.ts`, update the `AuthConfig` type to include the cookie consent script immediately after `turnstileSiteKey?: string;`:

```ts
export type AuthConfig = {
	emailPasswordEnabled: boolean;
	socialProvidersEnabled: string[]; // ["google", "github", "linkedin", "apple"]
	ssoEnabled: boolean;
	ssoProviderId?: string; // Reference to ssoProvider.providerId
	passkeyEnabled: boolean;
	// Cloudflare Turnstile (enterprise domains - required, no fallback to global)
	// Site key is public, stored here. Secret key stored in Vault at:
	// secret/organizations/{orgId}/turnstile/secret_key
	turnstileSiteKey?: string;
	// Cookie consent script injected on auth pages for this custom domain only.
	cookieConsentScript?: string;
};
```

- [ ] **Step 2: Document the default domain auth config behavior**

In `apps/webapp/src/lib/domain/types.ts`, keep `DEFAULT_AUTH_CONFIG` unchanged except for omitting `cookieConsentScript`, because missing means disabled:

```ts
export const DEFAULT_AUTH_CONFIG: AuthConfig = {
	emailPasswordEnabled: true,
	socialProvidersEnabled: ["google", "github", "linkedin", "apple"],
	ssoEnabled: false,
	passkeyEnabled: true,
};
```

No new default property is needed.

- [ ] **Step 3: Wire the helper into the auth layout**

In `apps/webapp/src/app/[locale]/(auth)/layout.tsx`, add the helper import:

```ts
import { selectAuthCookieConsentScript } from "./cookie-consent-script";
```

Replace the cookie-consent fetch and selection block with:

```ts
const platformCookieConsentScript = customDomain ? null : await getCookieConsentScript();
const cookieConsentScript = selectAuthCookieConsentScript(
	domainContext,
	platformCookieConsentScript,
);
```

Keep the existing `<Script id="cookie-consent" ... />` rendering block unchanged.

- [ ] **Step 4: Run focused helper tests**

Run:

```bash
pnpm --dir apps/webapp vitest run 'src/app/[locale]/(auth)/cookie-consent-script.test.ts'
```

Expected: PASS.

- [ ] **Step 5: Run TypeScript/build-adjacent validation**

Run:

```bash
pnpm --dir apps/webapp vitest run 'src/app/[locale]/(auth)/cookie-consent-script.test.ts'
pnpm --dir apps/webapp build
```

Expected: tests PASS and build completes. If the build requires unavailable Phase CLI environment variables, record the exact missing variables and skip the build per repository instructions.

- [ ] **Step 6: Commit Task 2 changes**

```bash
git add apps/webapp/src/db/schema/types.ts apps/webapp/src/lib/domain/types.ts 'apps/webapp/src/app/[locale]/(auth)/layout.tsx'
git commit -m "feat: select cookie consent per auth domain"
```

## Task 3: Add Cookie Consent Editing To Domain Auth Settings

**Files:**
- Modify: `apps/webapp/src/components/settings/enterprise/domain-auth-config-dialog.tsx`

- [ ] **Step 1: Update initial state to preserve cookie consent script**

In `apps/webapp/src/components/settings/enterprise/domain-auth-config-dialog.tsx`, update the `useState<AuthConfig>` initializer:

```ts
const [config, setConfig] = useState<AuthConfig>({
	emailPasswordEnabled: domain?.authConfig.emailPasswordEnabled ?? true,
	socialProvidersEnabled: domain?.authConfig.socialProvidersEnabled ?? [],
	ssoEnabled: domain?.authConfig.ssoEnabled ?? false,
	passkeyEnabled: domain?.authConfig.passkeyEnabled ?? true,
	turnstileSiteKey: domain?.authConfig.turnstileSiteKey,
	cookieConsentScript: domain?.authConfig.cookieConsentScript,
});
```

- [ ] **Step 2: Add the cookie consent textarea import**

Add this import near the existing UI imports:

```ts
import { Textarea } from "@/components/ui/textarea";
```

- [ ] **Step 3: Add the cookie consent section after Turnstile**

In the `ActionPanelBody`, after the Cloudflare Turnstile block and before `</ActionPanelBody>`, add:

```tsx
<Separator />

<div className="space-y-3">
	<div>
		<Label htmlFor="cookie-consent-script">Cookie Consent Script</Label>
		<p className="text-sm text-muted-foreground">
			Injected on authentication pages for this custom domain only. Leave empty to disable.
		</p>
	</div>
	<Textarea
		id="cookie-consent-script"
		value={config.cookieConsentScript ?? ""}
		onChange={(e) =>
			setConfig((prev) => ({
				...prev,
				cookieConsentScript: e.target.value || undefined,
			}))
		}
		rows={8}
		className="font-mono text-sm"
		placeholder={`<!-- Example: CookieBot -->
<script id="Cookiebot" src="https://consent.cookiebot.com/uc.js" data-cbid="YOUR-ID" type="text/javascript" async></script>`}
	/>
</div>
```

- [ ] **Step 4: Run focused type/test validation for the touched component**

Run:

```bash
pnpm --dir apps/webapp vitest run 'src/app/[locale]/(auth)/cookie-consent-script.test.ts'
```

Expected: PASS. If TypeScript errors appear in editor/build later, resolve them before committing.

- [ ] **Step 5: Commit Task 3 changes**

```bash
git add apps/webapp/src/components/settings/enterprise/domain-auth-config-dialog.tsx
git commit -m "feat: edit cookie consent for custom domains"
```

## Task 4: Show Domain Configuration Status Badges

**Files:**
- Modify: `apps/webapp/src/components/settings/enterprise/domain-management.tsx`

- [ ] **Step 1: Add summary badges for Turnstile and cookie consent**

In `apps/webapp/src/components/settings/enterprise/domain-management.tsx`, below the existing `Enabled Auth Methods` summary block, add:

```tsx
<div className="p-4 bg-muted/50 rounded-lg">
	<p className="text-sm font-medium mb-2">Domain Page Settings</p>
	<div className="flex flex-wrap gap-2">
		<Badge variant={domain.authConfig.turnstileSiteKey ? "outline" : "secondary"}>
			Turnstile {domain.authConfig.turnstileSiteKey ? "configured" : "not configured"}
		</Badge>
		<Badge variant={domain.authConfig.cookieConsentScript ? "outline" : "secondary"}>
			Cookie consent {domain.authConfig.cookieConsentScript ? "configured" : "not configured"}
		</Badge>
	</div>
</div>
```

- [ ] **Step 2: Ensure badge state updates after saving auth config**

Confirm `handleUpdateAuthConfig` still contains this state update:

```ts
setDomain((prev) => (prev ? { ...prev, authConfig: config } : null));
```

No additional state management is needed because `cookieConsentScript` is part of `config`.

- [ ] **Step 3: Run focused helper tests**

Run:

```bash
pnpm --dir apps/webapp vitest run 'src/app/[locale]/(auth)/cookie-consent-script.test.ts'
```

Expected: PASS.

- [ ] **Step 4: Commit Task 4 changes**

```bash
git add apps/webapp/src/components/settings/enterprise/domain-management.tsx
git commit -m "feat: show custom domain compliance status"
```

## Task 5: Add UI Coverage For Domain Auth Config Dialog

**Files:**
- Create: `apps/webapp/src/components/settings/enterprise/domain-auth-config-dialog.test.tsx`
- Modify if needed: `apps/webapp/src/components/settings/enterprise/domain-auth-config-dialog.tsx`

- [ ] **Step 1: Write the dialog test**

Create `apps/webapp/src/components/settings/enterprise/domain-auth-config-dialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DomainAuthConfigDialog } from "./domain-auth-config-dialog";

const domain = {
	id: "domain_123",
	domain: "login.acme.test",
	authConfig: {
		emailPasswordEnabled: true,
		socialProvidersEnabled: [],
		ssoEnabled: false,
		passkeyEnabled: true,
		turnstileSiteKey: "0x4AAA-site-key",
		cookieConsentScript: "<script>existing()</script>",
	},
};

describe("DomainAuthConfigDialog", () => {
	it("loads and saves the custom-domain cookie consent script", async () => {
		const user = userEvent.setup();
		const onSave = vi.fn().mockResolvedValue(undefined);

		render(
			<DomainAuthConfigDialog
				open={true}
				onOpenChange={vi.fn()}
				domain={domain}
				organizationId="org_123"
				onSave={onSave}
			/>,
		);

		const textarea = screen.getByLabelText("Cookie Consent Script");
		expect(textarea).toHaveValue("<script>existing()</script>");

		await user.clear(textarea);
		await user.type(textarea, "<script>updated()</script>");
		await user.click(screen.getByRole("button", { name: "Save Configuration" }));

		expect(onSave).toHaveBeenCalledWith(
			"domain_123",
			expect.objectContaining({
				cookieConsentScript: "<script>updated()</script>",
				turnstileSiteKey: "0x4AAA-site-key",
			}),
			undefined,
		);
	});
});
```

- [ ] **Step 2: Run the dialog test to verify it fails if the UI is missing**

Run:

```bash
pnpm --dir apps/webapp vitest run src/components/settings/enterprise/domain-auth-config-dialog.test.tsx
```

Expected: PASS if Task 3 already added the textarea. If it fails because `ActionPanel` requires browser APIs, mock only the failing browser API or skip this test and document the reason in the task notes.

- [ ] **Step 3: Fix accessible labeling if needed**

If the test cannot find the textarea by label, ensure the production markup uses this exact label/id relationship:

```tsx
<Label htmlFor="cookie-consent-script">Cookie Consent Script</Label>
<Textarea id="cookie-consent-script" />
```

- [ ] **Step 4: Run the dialog test again**

Run:

```bash
pnpm --dir apps/webapp vitest run src/components/settings/enterprise/domain-auth-config-dialog.test.tsx
```

Expected: PASS, unless the test was explicitly skipped because of component infrastructure limitations.

- [ ] **Step 5: Commit Task 5 changes**

```bash
git add apps/webapp/src/components/settings/enterprise/domain-auth-config-dialog.tsx apps/webapp/src/components/settings/enterprise/domain-auth-config-dialog.test.tsx
git commit -m "test: cover custom domain cookie consent editor"
```

## Task 6: Final Verification

**Files:**
- Verify all modified files from Tasks 1-5.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --dir apps/webapp vitest run 'src/app/[locale]/(auth)/cookie-consent-script.test.ts' src/components/settings/enterprise/domain-auth-config-dialog.test.tsx
```

Expected: PASS. If the dialog test is skipped for documented infrastructure reasons, the helper test must still PASS.

- [ ] **Step 2: Run the webapp test suite when feasible**

Run:

```bash
pnpm --dir apps/webapp test
```

Expected: PASS. If the suite is too slow or blocked by unavailable services, record the failure command and exact blocker.

- [ ] **Step 3: Run the webapp build when feasible**

Run:

```bash
pnpm --dir apps/webapp build
```

Expected: PASS. If the build requires unavailable Phase CLI environment variables, skip it and list the missing variables in the final response.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff --stat
git diff -- apps/webapp/src/db/schema/types.ts apps/webapp/src/lib/domain/types.ts 'apps/webapp/src/app/[locale]/(auth)/layout.tsx' 'apps/webapp/src/app/[locale]/(auth)/cookie-consent-script.ts' 'apps/webapp/src/app/[locale]/(auth)/cookie-consent-script.test.ts' apps/webapp/src/components/settings/enterprise/domain-auth-config-dialog.tsx apps/webapp/src/components/settings/enterprise/domain-auth-config-dialog.test.tsx apps/webapp/src/components/settings/enterprise/domain-management.tsx
```

Expected: Diff only includes the planned type, helper, auth-layout, UI, and test changes.

- [ ] **Step 5: Commit final verification cleanup if needed**

If verification required small fixes, commit them:

```bash
git add apps/webapp/src/db/schema/types.ts apps/webapp/src/lib/domain/types.ts 'apps/webapp/src/app/[locale]/(auth)' apps/webapp/src/components/settings/enterprise/domain-auth-config-dialog.tsx apps/webapp/src/components/settings/enterprise/domain-auth-config-dialog.test.tsx apps/webapp/src/components/settings/enterprise/domain-management.tsx
git commit -m "fix: finalize custom domain consent settings"
```

If there are no remaining changes after prior task commits, do not create an empty commit.

## Self-Review

- Spec coverage: The plan covers storing `cookieConsentScript` in `AuthConfig`, no custom-domain fallback to platform script, preserving main-domain global settings, using existing org-admin server actions, maintaining Turnstile secret handling, UI editing, status badges, cache behavior through existing `updateDomainAuthConfig`, and focused tests.
- Placeholder scan: No placeholder markers, unspecified validation, or vague test instructions remain.
- Type consistency: The property name is consistently `cookieConsentScript`; the runtime helper is consistently `selectAuthCookieConsentScript`; existing `turnstileSiteKey` behavior remains unchanged.
