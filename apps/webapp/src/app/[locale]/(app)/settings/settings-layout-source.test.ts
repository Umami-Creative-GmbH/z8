import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("settings layout sidebar", () => {
	it("keeps the settings nav scroll container flush for sticky headers", () => {
		const source = readFileSync("src/app/[locale]/(app)/settings/layout.tsx", "utf8");

		expect(source).toContain('className="w-64 border-r bg-card hidden md:block overflow-auto"');
		expect(source).not.toContain(
			'className="w-64 border-r bg-card p-4 hidden md:block overflow-auto"',
		);
	});

	it("renders route children once outside the navigation fallback", () => {
		const source = readFileSync("src/app/[locale]/(app)/settings/layout.tsx", "utf8");

		expect(
			source.match(
				/<div className="min-w-0 flex-1 overflow-auto overflow-x-hidden">\s*\{children\}\s*<\/div>/g,
			),
		).toHaveLength(1);
		expect(source).not.toContain("SettingsLayoutLoading({ children }");
	});

	it("keeps primary navigation and URL breadcrumb geometry visible while they resolve", () => {
		const source = readFileSync("src/app/[locale]/(app)/settings/layout.tsx", "utf8");

		expect(source).not.toContain('from "next/server"');
		expect(source).not.toContain("connection()");
		expect(source).toContain("getRenderSettingsAccess()");
		expect(source).toContain("getRenderSettingsCapabilities()");
		expect(source).toContain("<Suspense fallback={<SettingsNavigationLoading />}>");
		expect(source).toContain("function SettingsBreadcrumbsLoading()");
		expect(source).toContain("<Suspense fallback={<SettingsBreadcrumbsLoading />}>");
		expect(source).toMatch(
			/<Suspense fallback=\{<SettingsBreadcrumbsLoading \/>\}>\s*<SettingsBreadcrumbs \/>\s*<\/Suspense>/,
		);
		expect(source.match(/\{children\}/g)).toHaveLength(1);
	});

	it("reads the navigation props once per request for the sidebar and the mobile drawer", () => {
		const source = readFileSync("src/app/[locale]/(app)/settings/layout.tsx", "utf8");

		expect(source).toContain("const loadSettingsNavProps = cache(async () => {");
		expect(source.match(/getRenderSettingsAccess\(\)/g)).toHaveLength(1);
		expect(source.match(/getRenderSettingsCapabilities\(\)/g)).toHaveLength(1);
		expect(source.match(/await loadSettingsNavProps\(\)/g)).toHaveLength(2);
		expect(source).toMatch(
			/<SettingsMobileNav>\s*<SettingsNav \{\.\.\.navProps\} \/>\s*<\/SettingsMobileNav>/,
		);
		expect(source).toContain("<Suspense fallback={<SettingsMobileNavigationLoading />}>");
	});
});
