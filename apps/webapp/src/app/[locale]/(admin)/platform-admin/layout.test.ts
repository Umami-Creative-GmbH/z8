import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PLATFORM_ADMIN_ROOT = fileURLToPath(new URL(".", import.meta.url));

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function readAdminContentSource(): string {
	return stripComments(
		readFileSync(
			join(PLATFORM_ADMIN_ROOT, "../admin-layout-content.tsx"),
			"utf8",
		),
	);
}

function readAdminLayoutSource(): string {
	const coordinatorSource = readFileSync(
		join(PLATFORM_ADMIN_ROOT, "../layout.tsx"),
		"utf8",
	);
	const contentSource = readAdminContentSource();

	return stripComments(`${coordinatorSource}\n${contentSource}`);
}

describe("platform admin layout", () => {
	it("only links to the billing page when billing is enabled", () => {
		const source = readAdminLayoutSource();
		const billingEnabledCheck = 'env.BILLING_ENABLED === "true"';
		const billingLink = 'href: "/platform-admin/billing"';

		expect(source).toContain(billingEnabledCheck);
		expect(source.indexOf(billingEnabledCheck)).toBeLessThan(
			source.indexOf(billingLink),
		);
	});

	it("links to the platform analytics page", () => {
		const source = readAdminLayoutSource();

		expect(source).toContain('href: "/platform-admin/analytics"');
		expect(source).toContain("admin:admin.layout.nav.analytics");
	});

	it("checks the billing flag at request time on the billing page", () => {
		const source = stripComments(
			readFileSync(join(PLATFORM_ADMIN_ROOT, "billing/page.tsx"), "utf8"),
		);
		const dynamicBoundary = "await connection()";
		const billingEnabledCheck = 'if (env.BILLING_ENABLED !== "true")';

		expect(source).toContain(dynamicBoundary);
		expect(source.indexOf(dynamicBoundary)).toBeLessThan(
			source.indexOf(billingEnabledCheck),
		);
	});

	it("links to deployment diagnostics from platform-admin navigation and overview", () => {
		const layoutSource = readAdminLayoutSource();
		const overviewSource = stripComments(
			readFileSync(join(PLATFORM_ADMIN_ROOT, "page.tsx"), "utf8"),
		);

		expect(layoutSource).toContain('href: "/platform-admin/diagnostics"');
		expect(layoutSource).toContain('"Deployment Diagnostics"');
		expect(overviewSource).toContain('href="/platform-admin/diagnostics"');
		expect(overviewSource).toContain('"Deployment Diagnostics"');
	});

	it("links to system email templates from platform-admin navigation and overview", () => {
		const layoutSource = readAdminLayoutSource();
		const overviewSource = stripComments(
			readFileSync(join(PLATFORM_ADMIN_ROOT, "page.tsx"), "utf8"),
		);

		expect(layoutSource).toContain(
			'href: "/platform-admin/system-email-templates"',
		);
		expect(layoutSource).toContain('"System Email Templates"');
		expect(overviewSource).toContain(
			'href="/platform-admin/system-email-templates"',
		);
		expect(overviewSource).toContain('"System Email Templates"');
	});

	it("localizes deployment diagnostics page copy and hides decorative overview icon", () => {
		const diagnosticsSource = stripComments(
			readFileSync(join(PLATFORM_ADMIN_ROOT, "diagnostics/page.tsx"), "utf8"),
		);
		const overviewSource = stripComments(
			readFileSync(join(PLATFORM_ADMIN_ROOT, "page.tsx"), "utf8"),
		);

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
		const source = readAdminLayoutSource();

		expect(source).toContain("<PlatformAdminHeaderActions");
		expect(source).toContain('<LanguageSwitcher variant="compact" />');
		expect(source).toContain(
			'exitLabel={t("admin:admin.layout.exitAdmin", "Exit Admin")}',
		);
		expect(source).not.toContain('<span className="hidden sm:inline">');
	});

	it("uses tooltips and active styles for platform admin header actions", () => {
		const source = stripComments(
			readFileSync(
				join(PLATFORM_ADMIN_ROOT, "../platform-admin-header-actions.tsx"),
				"utf8",
			),
		);

		expect(source).toContain('"use client"');
		expect(source).toContain("usePathname");
		expect(source).toContain("TooltipContent");
		expect(source).toContain("TooltipTrigger asChild");
		expect(source).toContain("aria-label={item.label}");
		expect(source).toContain("aria-label={exitLabel}");
		expect(source).toContain("bg-accent text-accent-foreground");
	});

	it("keeps the language switcher close to the exit admin action", () => {
		const source = readAdminLayoutSource();

		expect(source).toContain('className="flex items-center gap-2"');
		expect(source).toContain('<LanguageSwitcher variant="compact" />');
	});

	it("renders a left-side mobile admin menu before the admin identity", () => {
		const source = readAdminLayoutSource();
		const mobileMenuIndex = source.indexOf("<PlatformAdminMobileMenu");
		const adminHomeLinkIndex = source.indexOf('href="/platform-admin"');

		expect(source).toContain("PlatformAdminMobileMenu");
		expect(source).toContain("openMenuLabel={t(");
		expect(source).toContain('"Open admin menu"');
		expect(mobileMenuIndex).toBeGreaterThanOrEqual(0);
		expect(adminHomeLinkIndex).toBeGreaterThanOrEqual(0);
		expect(mobileMenuIndex).toBeLessThan(adminHomeLinkIndex);
	});

	it("coordinates request-bound admin content behind a neutral shell", () => {
		const source = stripComments(
			readFileSync(join(PLATFORM_ADMIN_ROOT, "../layout.tsx"), "utf8"),
		);

		expect(source).toContain('import { Suspense } from "react"');
		expect(source).toContain(
			'import { AdminLayoutContent } from "./admin-layout-content"',
		);
		expect(source).toContain(
			'import { AdminLayoutShell } from "./admin-layout-shell"',
		);
		expect(source).toContain("<Suspense fallback={<AdminLayoutShell />}>");
		expect(source).toMatch(
			/<AdminLayoutContent>\s*\{children\}\s*<\/AdminLayoutContent>/,
		);
		expect(source).not.toMatch(
			/async function AdminLayout|next\/headers|@\/lib\/auth|@\/db/,
		);
	});

	it("preserves session, role, translated navigation, identity, and child rendering in content", () => {
		const source = readAdminLayoutSource();

		expect(source).toContain("auth.api.getSession({ headers: headersList })");
		expect(source).toContain('redirect("/sign-in")');
		expect(source).toContain('session.user.role !== "admin"');
		expect(source).toContain('redirect("/")');
		expect(source).toContain("getTranslate()");
		expect(source).toContain("session.user.name");
		expect(source).toContain("session.user.email");
		expect(readAdminContentSource().match(/\{children\}/g)).toHaveLength(1);
		expect(source).not.toMatch(/["']use cache(?:: private|: remote)?["']/);
	});

	it("isolates each pathname-aware admin control with a neutral local fallback", () => {
		const source = readAdminLayoutSource();

		expect(source).toMatch(
			/<Suspense fallback=\{<AdminHeaderControlLoading \/>\}>\s*<PlatformAdminMobileMenu[\s\S]*?<\/Suspense>/,
		);
		expect(
			source.match(/<Suspense fallback=\{<AdminHeaderControlLoading \/>\}>/g),
		).toHaveLength(4);
		expect(source).toMatch(
			/<Suspense fallback=\{<AdminHeaderControlLoading \/>\}>\s*<LanguageSwitcher variant="compact" \/>\s*<\/Suspense>/,
		);
	});

	it("defines the platform admin mobile menu as a left sheet using shared nav state", () => {
		const source = stripComments(
			readFileSync(
				join(PLATFORM_ADMIN_ROOT, "../platform-admin-mobile-menu.tsx"),
				"utf8",
			),
		);

		expect(source).toContain('"use client"');
		expect(source).toContain("SheetTrigger asChild");
		expect(source).toContain('side="left"');
		expect(source).toContain("SheetClose asChild");
		expect(source).toContain("IconMenu2");
		expect(source).toContain("platformAdminIcons[item.icon]");
		expect(source).toContain("isActivePlatformAdminItem(pathname, item)");
		expect(source).toContain("bg-accent text-accent-foreground");
	});

	it("keeps shared platform admin nav helpers outside component files", () => {
		const source = stripComments(
			readFileSync(
				join(PLATFORM_ADMIN_ROOT, "../platform-admin-nav.ts"),
				"utf8",
			),
		);

		expect(source).toContain("export const platformAdminIcons");
		expect(source).toContain("export function isActivePlatformAdminItem");
		expect(source).toContain('item.href === "/platform-admin"');
		expect(source).toContain(
			"pathname === item.href || pathname.startsWith(`$" + "{item.href}/`)",
		);
	});

	it("stacks platform settings environment rows on mobile", () => {
		const source = stripComments(
			readFileSync(join(PLATFORM_ADMIN_ROOT, "settings/page.tsx"), "utf8"),
		);
		const rowClass =
			"flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between";
		const codeClass =
			"break-all text-left text-xs text-muted-foreground sm:text-right";

		expect(source.match(new RegExp(rowClass, "g")) ?? []).toHaveLength(2);
		expect(source.match(new RegExp(codeClass, "g")) ?? []).toHaveLength(2);
	});
});
