import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const LOCATIONS_ROOT = fileURLToPath(new URL(".", import.meta.url));

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("location settings scope actions", () => {
	it("derives access from settings tier helpers instead of employee admin checks", () => {
		const source = stripComments(readFileSync(join(LOCATIONS_ROOT, "actions.ts"), "utf8"));

		expect(source.includes("getLocationSettingsActorContext(")).toBe(true);
		expect(source.includes('emp?.role === "admin"')).toBe(false);
	});

	it("filters manager reads down to scoped subareas from own teams or own areas", () => {
		const source = stripComments(readFileSync(join(LOCATIONS_ROOT, "actions.ts"), "utf8"));

		expect(source.includes("teamPermissions")).toBe(true);
		expect(source.includes("subareaEmployee")).toBe(true);
		expect(source.includes("manageableSubareaIds")).toBe(true);
	});

	it("keeps location and subarea mutations on org-admin access only", () => {
		const source = stripComments(readFileSync(join(LOCATIONS_ROOT, "actions.ts"), "utf8"));

		expect(source.includes('accessTier !== "orgAdmin"')).toBe(true);
	});
});
