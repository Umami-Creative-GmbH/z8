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
	it("passes server-loaded organization settings to the client provider", () => {
		const source = stripComments(
			readFileSync(join(APP_ROUTE_ROOT, "app-layout-content.tsx"), "utf8"),
		);

		expect(source).toContain("getRenderOrganizationDisplayContext()");
		expect(source).toContain("initialContext={organizationContext}");
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

		expect(source).toMatch(
			/await Promise\.all\(\[\s*params,\s*headers\(\),\s*getRenderSession\(\),?\s*\]\)/,
		);
		expect(source).toMatch(/const \[\{ locale \}, headersList, rawSession\]/);
		expect(source).toContain(
			"requireAppSession(rawSession, headersList, locale)",
		);
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
		expect(source).toMatch(
			/loadAppBillingStatus\(\s*activeOrganizationId\s*\)/,
		);
		expect(source).toContain("getRenderApprovedMembership()");
		const identitySource = stripComments(
			readFileSync(
				join(APP_ROUTE_ROOT, "../../../lib/auth/render-context.ts"),
				"utf8",
			),
		);
		expect(identitySource).toContain("eq(member.userId, session.user.id)");
		expect(identitySource).toContain(
			"entry.organization.id === activeOrganizationId",
		);
		expect(identitySource).toContain('entry.membership.status === "approved"');
		expect(source).toContain(
			"eq(subscription.organizationId, activeOrganizationId)",
		);
		expect(source).toContain(
			"billingAccess.canAccess === false && !isBillingRecoveryPath",
		);
		expect(source).not.toMatch(/["']use cache(?:: private|: remote)?["']/);
	});
});
