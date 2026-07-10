import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("WellnessSettingsForm accessibility", () => {
	it("names the daily-goal decrement and increment controls", () => {
		const source = readFileSync(resolve(__dirname, "wellness-settings-form.tsx"), "utf8");

		expect(source).toContain("settings.wellness.decreaseDailyGoal");
		expect(source).toContain("settings.wellness.increaseDailyGoal");
	});
});
