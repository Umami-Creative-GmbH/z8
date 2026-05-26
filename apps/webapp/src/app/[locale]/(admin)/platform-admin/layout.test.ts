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
		const billingEnabledCheck = 'env.BILLING_ENABLED === "true"';
		const billingLink = 'href: "/platform-admin/billing"';

		expect(source).toContain(billingEnabledCheck);
		expect(source.indexOf(billingEnabledCheck)).toBeLessThan(source.indexOf(billingLink));
	});

	it("links to the platform analytics page", () => {
		const source = stripComments(readFileSync(join(PLATFORM_ADMIN_ROOT, "../layout.tsx"), "utf8"));

		expect(source).toContain('href: "/platform-admin/analytics"');
		expect(source).toContain("admin:admin.layout.nav.analytics");
	});

	it("checks the billing flag at request time on the billing page", () => {
		const source = stripComments(readFileSync(join(PLATFORM_ADMIN_ROOT, "billing/page.tsx"), "utf8"));
		const dynamicBoundary = "await connection()";
		const billingEnabledCheck = 'if (env.BILLING_ENABLED !== "true")';

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

	it("links to system email templates from platform-admin navigation and overview", () => {
		const layoutSource = stripComments(readFileSync(join(PLATFORM_ADMIN_ROOT, "../layout.tsx"), "utf8"));
		const overviewSource = stripComments(readFileSync(join(PLATFORM_ADMIN_ROOT, "page.tsx"), "utf8"));

		expect(layoutSource).toContain('href: "/platform-admin/system-email-templates"');
		expect(layoutSource).toContain('"System Email Templates"');
		expect(overviewSource).toContain('href="/platform-admin/system-email-templates"');
		expect(overviewSource).toContain('"System Email Templates"');
	});

	it("localizes deployment diagnostics page copy and hides decorative overview icon", () => {
		const diagnosticsSource = stripComments(
			readFileSync(join(PLATFORM_ADMIN_ROOT, "diagnostics/page.tsx"), "utf8"),
		);
		const overviewSource = stripComments(readFileSync(join(PLATFORM_ADMIN_ROOT, "page.tsx"), "utf8"));

		expect(diagnosticsSource).toContain("getTranslate");
		expect(diagnosticsSource).toContain("admin:admin.diagnostics.title");
		expect(diagnosticsSource).toContain('"Deployment Diagnostics"');
		expect(diagnosticsSource).toContain("admin:admin.diagnostics.description");
		expect(diagnosticsSource).toContain(
			'"Safe platform configuration and app-only deployment health checks."',
		);
		expect(overviewSource).toContain(
			'<IconActivityHeartbeat className="size-5" aria-hidden="true" />',
		);
	});

	it("renders platform admin nav and exit actions as icon-only accessible links", () => {
		const source = stripComments(readFileSync(join(PLATFORM_ADMIN_ROOT, "../layout.tsx"), "utf8"));

		expect(source).toContain("<PlatformAdminHeaderActions");
		expect(source).toContain("<LanguageSwitcher variant=\"compact\" />");
		expect(source).toContain('exitLabel={t("admin:admin.layout.exitAdmin", "Exit Admin")}');
		expect(source).not.toContain('<span className="hidden sm:inline">');
	});

	it("uses tooltips and active styles for platform admin header actions", () => {
		const source = stripComments(
			readFileSync(join(PLATFORM_ADMIN_ROOT, "../platform-admin-header-actions.tsx"), "utf8"),
		);

		expect(source).toContain('"use client"');
		expect(source).toContain("usePathname");
		expect(source).toContain("TooltipContent");
		expect(source).toContain("TooltipTrigger asChild");
		expect(source).toContain("aria-label={item.label}");
		expect(source).toContain("aria-label={exitLabel}");
		expect(source).toContain('item.href === "/platform-admin"');
		expect(source).toContain("pathname === item.href || pathname.startsWith(`${item.href}/`)");
		expect(source).toContain("bg-accent text-accent-foreground");
	});

	it("keeps the language switcher close to the exit admin action", () => {
		const source = stripComments(readFileSync(join(PLATFORM_ADMIN_ROOT, "../layout.tsx"), "utf8"));

		expect(source).toContain('className="flex items-center gap-2"');
		expect(source).toContain('<LanguageSwitcher variant="compact" />');
	});
});
