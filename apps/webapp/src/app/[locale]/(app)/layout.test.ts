import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_ROUTE_ROOT = fileURLToPath(new URL(".", import.meta.url));

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("app layout locale preference", () => {
	it("does not mutate the locale cookie while rendering the layout", () => {
		const source = stripComments(
			readFileSync(join(APP_ROUTE_ROOT, "app-layout-content.tsx"), "utf8"),
		);

		expect(source).not.toContain("setLanguage(");
		expect(source).not.toContain("@/tolgee/language");
	});
});

describe("app layout user preferences", () => {
	it("passes the saved user timezone to the client preference provider", () => {
		const source = stripComments(
			readFileSync(join(APP_ROUTE_ROOT, "app-layout-content.tsx"), "utf8"),
		);

		expect(source).toContain("getUserTimezone(session.user.id)");
		expect(source).toContain("timezone={timezone}");
	});

	it("passes server-loaded organization settings to the client provider", () => {
		const source = stripComments(
			readFileSync(join(APP_ROUTE_ROOT, "app-layout-content.tsx"), "utf8"),
		);

		expect(source).toContain(
			"getOrganizationSettings(activeOrganizationId, session.user.id)",
		);
		expect(source).toContain("initialSettings={organizationSettings}");
	});
});

describe("app layout coordinator", () => {
	it("uses the neutral shell while authenticated request content resolves", () => {
		const source = stripComments(
			readFileSync(join(APP_ROUTE_ROOT, "layout.tsx"), "utf8"),
		);

		expect(source).toContain('import { Suspense } from "react"');
		expect(source).toContain(
			'import { AuthenticatedAppContent } from "./app-layout-content"',
		);
		expect(source).toContain(
			'import { AuthenticatedAppShell } from "./app-layout-shell"',
		);
		expect(source).toContain("<Suspense fallback={<AuthenticatedAppShell />}>");
		expect(source).toMatch(
			/<AuthenticatedAppContent params=\{params\}>\s*\{children\}\s*<\/AuthenticatedAppContent>/,
		);
	});

	it("does not access request, authentication, database, billing, or organization settings APIs", () => {
		const source = stripComments(
			readFileSync(join(APP_ROUTE_ROOT, "layout.tsx"), "utf8"),
		);

		expect(source).not.toMatch(
			/next\/headers|headers\(\)|@\/lib\/auth|@\/db|Billing|organization-settings/,
		);
	});
});

describe("authenticated app request gate", () => {
	it("preserves session and locale redirect safety", () => {
		const source = stripComments(
			readFileSync(join(APP_ROUTE_ROOT, "app-layout-content.tsx"), "utf8"),
		);

		expect(source).toContain("await Promise.all([params, headers()])");
		expect(source).toContain("auth.api.getSession({ headers: headersList })");
		expect(source).toMatch(
			/`\/api\/auth\/session-expired\?locale=\$\{locale\}&callbackUrl=\$\{encodeURIComponent\(pathname\)\}`/,
		);
		expect(source).toMatch(
			/pathname\.replace\(`\/\$\{locale\}`, `\/\$\{dbLocale\}`\)/,
		);
	});

	it("keeps billing fail-closed and tenant-scoped membership and subscription predicates", () => {
		const source = stripComments(
			readFileSync(join(APP_ROUTE_ROOT, "app-layout-content.tsx"), "utf8"),
		);

		expect(source).toContain("canAccess: false");
		expect(source).toContain('status: "billing_check_failed"');
		expect(source).toMatch(/pathname === `\/\$\{locale\}\/settings\/billing`/);
		expect(source).toMatch(
			/pathname\.startsWith\(`\/\$\{locale\}\/settings\/billing\/`\)/,
		);
		expect(source).toMatch(/pathname === `\/\$\{locale\}\/billing\/suspended`/);
		expect(source).toMatch(
			/pathname\.startsWith\(`\/\$\{locale\}\/billing\/suspended\/`\)/,
		);
		expect(source).toContain("eq(member.userId, session.user.id)");
		expect(source).toContain("eq(member.organizationId, activeOrganizationId)");
		expect(source).toContain(
			"eq(subscription.organizationId, activeOrganizationId)",
		);
		expect(source).toContain(
			"billingAccess.canAccess === false && !isBillingRecoveryPath",
		);
		expect(source).not.toMatch(/["']use cache(?:: private|: remote)?["']/);
	});
});
