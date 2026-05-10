import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PLATFORM_ADMIN_ROOT = fileURLToPath(new URL(".", import.meta.url));

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("platform admin layout", () => {
	it("only links to the billing page when billing is enabled", () => {
		const source = stripComments(readFileSync(join(PLATFORM_ADMIN_ROOT, "../layout.tsx"), "utf8"));
		const billingEnabledCheck = 'process.env.BILLING_ENABLED === "true"';
		const billingLink = 'href: "/platform-admin/billing"';

		expect(source).toContain(billingEnabledCheck);
		expect(source.indexOf(billingEnabledCheck)).toBeLessThan(source.indexOf(billingLink));
	});

	it("checks the billing flag at request time on the billing page", () => {
		const source = stripComments(readFileSync(join(PLATFORM_ADMIN_ROOT, "billing/page.tsx"), "utf8"));
		const dynamicBoundary = "await connection()";
		const billingEnabledCheck = 'if (process.env.BILLING_ENABLED !== "true")';

		expect(source).toContain(dynamicBoundary);
		expect(source.indexOf(dynamicBoundary)).toBeLessThan(source.indexOf(billingEnabledCheck));
	});

	it("links to deployment diagnostics from platform-admin navigation and overview", () => {
		const layoutSource = stripComments(readFileSync(join(PLATFORM_ADMIN_ROOT, "../layout.tsx"), "utf8"));
		const overviewSource = stripComments(readFileSync(join(PLATFORM_ADMIN_ROOT, "page.tsx"), "utf8"));

		expect(layoutSource).toContain('href: "/platform-admin/diagnostics"');
		expect(layoutSource).toContain('"Deployment Diagnostics"');
		expect(overviewSource).toContain('href="/platform-admin/diagnostics"');
		expect(overviewSource).toContain('"Deployment Diagnostics"');
	});
});
