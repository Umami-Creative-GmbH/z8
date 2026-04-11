import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("app sidebar compliance navigation", () => {
	it("adds the compliance entry behind an org-admin-only server flag", () => {
		const sidebarSource = readFileSync(new URL("./app-sidebar.tsx", import.meta.url), "utf8");
		const serverSidebarSource = readFileSync(
			new URL("./server-app-sidebar.tsx", import.meta.url),
			"utf8",
		);

		expect(sidebarSource).toContain("showComplianceNav");
		expect(sidebarSource).toContain('url: "/compliance"');
		expect(serverSidebarSource).toContain("getCurrentSettingsAccessTier");
		expect(serverSidebarSource).toContain('showComplianceNav={settingsAccessTier === "orgAdmin"}');
	});
});
