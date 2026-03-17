import { describe, expect, it } from "vitest";
import { getVisibleSettings } from "@/components/settings/settings-config";

describe("settings import entry", () => {
	it("shows one shared import entry for admins", () => {
		const entries = getVisibleSettings(true, false);
		const importEntries = entries.filter(
			(entry) => entry.group === "data" && entry.href.includes("import"),
		);

		expect(importEntries.some((entry) => entry.href === "/settings/import")).toBe(true);
		expect(entries.some((entry) => entry.href === "/settings/clockodo-import")).toBe(false);
	});

	it("hides organization settings for non-admins", () => {
		const entries = getVisibleSettings(false, false);

		expect(entries.some((entry) => entry.href === "/settings/organizations")).toBe(false);
	});
});
