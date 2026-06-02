import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const hookSource = readFileSync(
	fileURLToPath(new URL("./use-calendar-employees.ts", import.meta.url)),
	"utf8",
);
const teamActionsSource = readFileSync(
	fileURLToPath(new URL("../app/[locale]/(app)/team/actions.ts", import.meta.url)),
	"utf8",
);

describe("useCalendarEmployees data source", () => {
	it("uses a lightweight cached calendar action instead of the team-page balance action", () => {
		expect(hookSource).toContain("getCalendarManagedEmployees");
		expect(hookSource).not.toContain("getManagedEmployees");
		expect(teamActionsSource).toContain("getCalendarManagedEmployees");
		expect(teamActionsSource).toContain("unstable_cache");
		expect(teamActionsSource).toContain("CACHE_TAGS.EMPLOYEES(organizationId)");

		const calendarActionBody = teamActionsSource.slice(
			teamActionsSource.indexOf("export async function getCalendarManagedEmployees"),
			teamActionsSource.indexOf("export async function getManagedEmployees"),
		);

		expect(calendarActionBody).not.toContain("refreshEmployeeTimeBalances");
	});
});
