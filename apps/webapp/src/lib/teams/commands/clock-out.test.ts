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
	it("rejects approval-required clock-out before mutating", () => {
		const source = readClockOutSource();
		const approvalIndex = source.indexOf("if (needsClockOutApproval)");
		const unsupportedIndex = source.indexOf("Time changes requiring approval are not supported for this action yet");
		const insertIndex = source.indexOf(".insert(timeEntry)");
		const updateIndex = source.indexOf(".update(workPeriod)");

		expect(approvalIndex).toBeGreaterThanOrEqual(0);
		expect(unsupportedIndex).toBeGreaterThan(approvalIndex);
		expect(insertIndex).toBeGreaterThan(unsupportedIndex);
		expect(updateIndex).toBeGreaterThan(unsupportedIndex);
	});

	it("fails closed when approval policy lookup fails before mutating", () => {
		const source = readClockOutSource();
		const failureIndex = source.indexOf("Could not verify time approval policy. Please try again.");
		const insertIndex = source.indexOf(".insert(timeEntry)");
		const updateIndex = source.indexOf(".update(workPeriod)");

		expect(failureIndex).toBeGreaterThanOrEqual(0);
		expect(insertIndex).toBeGreaterThan(failureIndex);
		expect(updateIndex).toBeGreaterThan(failureIndex);
	});

	it("does not create approval requests for clock-out", () => {
		const source = readClockOutSource();

		expect(source).not.toContain("createClockOutApprovalRequest");
		expect(source).not.toContain("sendClockOutApprovalNotifications");
		expect(source).not.toContain("pendingApproval");
	});
});
