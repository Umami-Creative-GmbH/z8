import { describe, expect, it } from "vitest";
import { getVisibleSettings } from "@/components/settings/settings-config";

describe("settings import entry", () => {
	it("shows one shared import entry for admins", () => {
		const entries = getVisibleSettings("orgAdmin", false);
		const importEntries = entries.filter(
			(entry) => entry.group === "data" && entry.href.includes("import"),
		);

		expect(importEntries.some((entry) => entry.href === "/settings/import")).toBe(true);
		expect(entries.some((entry) => entry.href === "/settings/clockodo-import")).toBe(false);
	});

	it("hides organization settings for members and users without settings access", () => {
		const memberEntries = getVisibleSettings("member", false);
		const noAccessEntries = getVisibleSettings(null, false);

		expect(memberEntries.some((entry) => entry.href === "/settings/organization")).toBe(false);
		expect(noAccessEntries.some((entry) => entry.href === "/settings/organization")).toBe(false);
		expect(noAccessEntries.some((entry) => entry.href === "/settings/my-data")).toBe(false);
	});
});
