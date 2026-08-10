import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shared pathname consumer boundaries", () => {
	it("isolates each sidebar navigation group with neutral menu skeletons", () => {
		const source = readFileSync("src/components/app-sidebar.tsx", "utf8");

		expect(source).toMatch(/import \{[^}]*Suspense[^}]*\} from "react"/);
		expect(source).toContain("SidebarMenuSkeleton");
		expect(source).toContain("function SidebarNavigationLoading");
		expect(source).toMatch(
			/<Suspense fallback=\{<SidebarNavigationLoading rows=\{8\} \/>\}>\s*<NavMain[\s\S]*?<\/Suspense>/,
		);
		expect(source).toMatch(
			/<Suspense fallback=\{<SidebarNavigationLoading rows=\{4\} \/>\}>\s*\{isManagerOrAbove\(employeeRole\) && <NavTeam[\s\S]*?<\/Suspense>/,
		);
		expect(source).toMatch(
			/<Suspense fallback=\{<SidebarNavigationLoading rows=\{3\} \/>\}>\s*<NavSecondary[\s\S]*?<\/Suspense>/,
		);

		const fallbackSource = source.slice(
			source.indexOf("function SidebarNavigationLoading"),
			source.indexOf("export function AppSidebar"),
		);
		expect(fallbackSource).not.toMatch(
			/href|url|capabilit|platform|payroll|settings/i,
		);
	});

	it("keeps the resolved app frame visible while the site header resolves", () => {
		const source = readFileSync(
			"src/app/[locale]/(app)/app-layout-content.tsx",
			"utf8",
		);

		expect(source).toMatch(/import \{[^}]*Suspense[^}]*\} from "react"/);
		expect(source).toContain("function SiteHeaderLoading");
		expect(source).toMatch(
			/<Suspense fallback=\{<SiteHeaderLoading \/>\}>\s*<SiteHeader \/>\s*<\/Suspense>/,
		);

		const fallbackSource = source.slice(
			source.indexOf("function SiteHeaderLoading"),
			source.indexOf("export async function AuthenticatedAppContent"),
		);
		expect(fallbackSource).toContain("<Skeleton");
		expect(fallbackSource).not.toMatch(
			/user|tenant|organization|pathname|button|link/i,
		);
	});
});
