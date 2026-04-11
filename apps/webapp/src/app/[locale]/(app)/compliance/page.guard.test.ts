import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("compliance page guard", () => {
	it("uses the shared org-admin settings helper and the normalized loader", () => {
		const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

		expect(source).toContain("requireOrgAdminSettingsAccess");
		expect(source).toContain("getComplianceCommandCenterData");
	});
});
