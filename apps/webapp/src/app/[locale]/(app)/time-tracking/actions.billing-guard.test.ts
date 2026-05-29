import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./actions.ts", import.meta.url)), "utf8");

function functionBody(name: string) {
	const match = new RegExp(`(?:export\\s+)?async function ${name}\\s*\\(`).exec(source);
	const start = match?.index ?? -1;
	expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
	const nextExport = source.indexOf("export async function", start + 1);
	return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

function expectBillingGuardBeforeWrite(name: string, writeMarker: string) {
	const body = functionBody(name);
	const guardIndex = body.indexOf("requireBillingForMutation");
	const writeIndex = body.indexOf(writeMarker);

	expect(guardIndex, `${name} should require billing before mutating`).toBeGreaterThanOrEqual(0);
	expect(body).toContain("isBillingMutationAllowed");
	expect(body).toContain('error: "billing_required"');
	expect(body).toContain('code: billingAccess.reason ?? "subscription_required"');
	expect(writeIndex, `${name} should include expected write marker`).toBeGreaterThanOrEqual(0);
	expect(guardIndex, `${name} should guard before database writes`).toBeLessThan(writeIndex);
}

function expectNoManagerApprovalGuardBeforeWrite(name: string, writeMarker: string) {
	const body = functionBody(name);
	const guardIndex = body.indexOf(
		'return { success: false, error: "No manager assigned to approve time changes" }',
	);
	const writeIndex = body.indexOf(writeMarker);

	expect(guardIndex, `${name} should reject unapprovable approval-required changes`).toBeGreaterThanOrEqual(0);
	expect(writeIndex, `${name} should include expected write marker`).toBeGreaterThanOrEqual(0);
	expect(guardIndex, `${name} should reject missing managers before database writes`).toBeLessThan(writeIndex);
}

function expectPolicyCheckFailureBeforeWrite(name: string, writeMarker: string) {
	const body = functionBody(name);
	const guardIndex = body.indexOf(
		'error: "Could not verify time approval policy. Please try again."',
	);
	const writeIndex = body.indexOf(writeMarker);

	expect(guardIndex, `${name} should fail closed when policy checks fail`).toBeGreaterThanOrEqual(0);
	expect(writeIndex, `${name} should include expected write marker`).toBeGreaterThanOrEqual(0);
	expect(guardIndex, `${name} should fail closed before database writes`).toBeLessThan(writeIndex);
}

describe("legacy time-tracking action billing guards", () => {
	it("imports the shared billing mutation guard helpers", () => {
		expect(source).toContain(
			'import { isBillingMutationAllowed, requireBillingForMutation } from "@/lib/billing/guard"',
		);
	});

	it("imports the work balance dirty marker", () => {
		expect(source).toContain(
			'import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service"',
		);
	});

	it("wraps work balance dirty marking as best effort", () => {
		expect(source).toContain("async function markWorkBalanceDirtyBestEffort(");
		expect(source).toContain("await markWorkBalanceDirtyBestEffort(");
		expect(source).toContain('"Failed to mark work balance dirty"');
	});

	it("guards clock-in before creating time entries", () => {
		expectBillingGuardBeforeWrite("clockIn", "createTimeEntry({");
	});

	it("guards clock-out before creating time entries", () => {
		expectBillingGuardBeforeWrite("clockOut", "createTimeEntry({");
	});

	it("guards break insertion before delegating to the clocking mutation", () => {
		expectBillingGuardBeforeWrite("addBreakToActiveSession", "addBreakToActiveSessionAction(breakMinutes)");
	});

	it("guards manual time-entry creation before creating time entries", () => {
		expectBillingGuardBeforeWrite("createManualTimeEntry", "createTimeEntry({");
	});

	it.each([
		["editSameDayTimeEntry", "createTimeEntry({"],
		["requestTimeCorrection", "requestTimeCorrectionEffect(data)"],
		["updateWorkPeriodNotes", "await db.update"],
		["deleteWorkPeriod", ".update(timeEntry)"],
		["splitWorkPeriod", "createTimeEntry({"],
		["updateTimeEntryNotes", "await db.update"],
		["updateWorkPeriodProject", ".update(workPeriod)"],
	])("guards %s before writing time data", (name, writeMarker) => {
		expectBillingGuardBeforeWrite(name, writeMarker);
	});

	it.each(["clockOut", "createManualTimeEntry", "deleteWorkPeriod", "editSameDayTimeEntry"])(
		"marks work balances dirty after %s changes payable time",
		(name) => {
			const body = functionBody(name);
			expect(body).toContain("await markWorkBalanceDirtyBestEffort(");
			expect(body).toContain("dirtyFromDate:");
		},
	);

	it.each(["updateWorkPeriodProject", "updateWorkPeriodNotes"])(
		"does not mark work balances dirty after %s metadata changes",
		(name) => {
			expect(functionBody(name)).not.toContain("markEmployeeWorkBalanceDirty");
		},
	);

	it.each([["clockOut", "createTimeEntry({"]])(
		"rejects approval-required %s without a manager before writing",
		(name, writeMarker) => {
			expectNoManagerApprovalGuardBeforeWrite(name, writeMarker);
		},
	);

	it("auto-approves approval-required manual entries when no manager resolves", () => {
		const body = functionBody("createManualTimeEntry");

		expect(body).toContain("const requiresManagerApproval = requiresApproval && Boolean(managerId)");
		expect(body).toContain('const approvalStatus = requiresManagerApproval ? "pending" : "approved"');
		expect(body).toContain("const pendingChangesData = requiresManagerApproval");
		expect(body).toContain("if (requiresManagerApproval && managerId)");
	});

	it.each([
		["clockOut", "createClockOutApprovalRequest"],
		["createManualTimeEntry", "createManualEntryApprovalRequest"],
	])("creates approval requests from approval-required %s", (name, approvalMarker) => {
		const body = functionBody(name);
		const approvalIndex = body.indexOf(approvalMarker);

		expect(approvalIndex, `${name} should create approval requests`).toBeGreaterThanOrEqual(0);
	});

	it.each([
		["clockOut", "createTimeEntry({"],
		["createManualTimeEntry", "createTimeEntry({"],
	])("fails closed when %s policy checks fail before writing", (name, writeMarker) => {
		expectPolicyCheckFailureBeforeWrite(name, writeMarker);
	});
});
