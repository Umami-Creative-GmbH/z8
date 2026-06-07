import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const actionsSource = readFileSync(fileURLToPath(new URL("./actions.ts", import.meta.url)), "utf8");

describe("wellness action cache invalidation", () => {
	it("invalidates organization hydration streak leaders after water intake stats update", () => {
		const logWaterIntakeBody = actionsSource.slice(
			actionsSource.indexOf("export async function logWaterIntake"),
			actionsSource.indexOf("export async function snoozeWaterReminder"),
		);
		const statsUpdateIndex = logWaterIntakeBody.indexOf("updateHydrationStatsAfterIntake({");
		const revalidateIndex = logWaterIntakeBody.indexOf(
			"revalidateTag(CACHE_TAGS.HYDRATION_STREAKS(activeOrganizationId), \"max\")",
		);
		const responseIndex = logWaterIntakeBody.indexOf("const newTodayIntake");

		expect(actionsSource).toContain('import { revalidateTag } from "next/cache";');
		expect(actionsSource).toContain('import { CACHE_TAGS } from "@/lib/cache/tags";');
		expect(logWaterIntakeBody).toContain("if (activeOrganizationId) {");
		expect(statsUpdateIndex).toBeGreaterThanOrEqual(0);
		expect(revalidateIndex).toBeGreaterThan(statsUpdateIndex);
		expect(revalidateIndex).toBeLessThan(responseIndex);
	});
});
