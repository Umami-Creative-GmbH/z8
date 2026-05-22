import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readClockOutSource() {
	return readFileSync(fileURLToPath(new URL("./clock-out.ts", import.meta.url)), "utf8");
}

describe("Teams clock-out command work balance invalidation", () => {
	it("marks the employee work balance dirty after closing the active period", () => {
		const source = readClockOutSource();
		const updateIndex = source.indexOf(".update(workPeriod)");
		const dirtyIndex = source.indexOf("await markEmployeeWorkBalanceDirty");

		expect(source).toContain(
			'import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service"',
		);
		expect(source).toContain("dirtyFromDate:");
		expect(source).toContain("DateTime.fromJSDate(activePeriod.startTime, { zone: \"utc\" }).toISODate()");
		expect(updateIndex).toBeGreaterThanOrEqual(0);
		expect(dirtyIndex).toBeGreaterThan(updateIndex);
	});

	it("logs dirty marker failures without failing the command", () => {
		const source = readClockOutSource();

		expect(source).toContain("try {");
		expect(source).toContain("catch (error) {");
		expect(source).toContain("Failed to mark work balance dirty after Teams clock-out");
	});
});

describe("Teams clock-out command approvals", () => {
	it("requires a primary manager before mutating an approval-required clock-out", () => {
		const source = readClockOutSource();
		const approvalIndex = source.indexOf("if (needsClockOutApproval)");
		const managerIndex = source.indexOf("db.query.employeeManagers.findFirst");
		const noManagerIndex = source.indexOf("bot.cmd.clockout.noApprover");
		const insertIndex = source.indexOf(".insert(timeEntry)");
		const updateIndex = source.indexOf(".update(workPeriod)");

		expect(approvalIndex).toBeGreaterThanOrEqual(0);
		expect(managerIndex).toBeGreaterThan(approvalIndex);
		expect(noManagerIndex).toBeGreaterThan(managerIndex);
		expect(insertIndex).toBeGreaterThan(noManagerIndex);
		expect(updateIndex).toBeGreaterThan(noManagerIndex);
	});

	it("awaits approval creation and compensates primary mutations before returning failure", () => {
		const source = readClockOutSource();
		const createIndex = source.indexOf("await createClockOutApprovalRequest");
		const rollbackEntryIndex = source.indexOf(".delete(timeEntry)");
		const rollbackPeriodIndex = source.indexOf("clockOutId: activePeriod.clockOutId");
		const dirtyIndex = source.indexOf("await markEmployeeWorkBalanceDirty");
		const approvalBlock = source.slice(createIndex, rollbackEntryIndex);

		expect(createIndex).toBeGreaterThanOrEqual(0);
		expect(approvalBlock).not.toContain(".catch((err) =>");
		expect(rollbackEntryIndex).toBeGreaterThan(createIndex);
		expect(rollbackPeriodIndex).toBeGreaterThan(createIndex);
		expect(dirtyIndex).toBeGreaterThan(createIndex);
	});
});
