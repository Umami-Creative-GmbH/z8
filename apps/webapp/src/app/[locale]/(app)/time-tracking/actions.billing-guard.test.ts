import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	fileURLToPath(new URL("./actions.ts", import.meta.url)),
	"utf8",
);
const clockingSource = readFileSync(
	fileURLToPath(new URL("./actions/clocking.ts", import.meta.url)),
	"utf8",
);
const correctionSubmissionSource = readFileSync(
	fileURLToPath(
		new URL(
			"../../../../lib/approvals/server/time-correction-submission.ts",
			import.meta.url,
		),
	),
	"utf8",
);

function functionBody(name: string, targetSource = source) {
	const match = new RegExp(
		`(?:export\\s+)?(?:async\\s+)?function ${name}\\s*\\(`,
	).exec(targetSource);
	const start = match?.index ?? -1;
	expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
	const nextExport = targetSource.indexOf("export async function", start + 1);
	return targetSource.slice(start, nextExport === -1 ? undefined : nextExport);
}

function expectBillingGuardBeforeWrite(
	name: string,
	writeMarker: string,
	targetSource = source,
) {
	const body = functionBody(name, targetSource);
	const guardIndex = body.indexOf("requireBillingForMutation");
	const writeIndex = body.indexOf(writeMarker);

	expect(
		guardIndex,
		`${name} should require billing before mutating`,
	).toBeGreaterThanOrEqual(0);
	expect(body).toContain("isBillingMutationAllowed");
	expect(body).toContain('error: "billing_required"');
	expect(body).toContain(
		'code: billingAccess.reason ?? "subscription_required"',
	);
	expect(
		writeIndex,
		`${name} should include expected write marker`,
	).toBeGreaterThanOrEqual(0);
	expect(
		guardIndex,
		`${name} should guard before database writes`,
	).toBeLessThan(writeIndex);
}

function expectNoManagerApprovalGuardBeforeWrite(
	name: string,
	writeMarker: string,
) {
	const body = functionBody(name, clockingSource);
	const guardIndex = body.indexOf(
		'error: "No manager assigned to approve time changes"',
	);
	const writeIndex = body.indexOf(writeMarker);

	expect(
		guardIndex,
		`${name} should reject unapprovable approval-required changes`,
	).toBeGreaterThanOrEqual(0);
	expect(
		writeIndex,
		`${name} should include expected write marker`,
	).toBeGreaterThanOrEqual(0);
	expect(
		guardIndex,
		`${name} should reject missing managers before database writes`,
	).toBeLessThan(writeIndex);
}

function expectPolicyCheckFailureBeforeWrite(
	name: string,
	writeMarker: string,
	targetSource = source,
) {
	const body = functionBody(name, targetSource);
	const guardIndex = Math.max(
		body.indexOf(
			'error: "Could not verify time approval policy. Please try again."',
		),
		body.indexOf("error: APPROVAL_POLICY_CHECK_ERROR"),
	);
	const writeIndex = body.indexOf(writeMarker);

	expect(
		guardIndex,
		`${name} should fail closed when policy checks fail`,
	).toBeGreaterThanOrEqual(0);
	expect(
		writeIndex,
		`${name} should include expected write marker`,
	).toBeGreaterThanOrEqual(0);
	expect(
		guardIndex,
		`${name} should fail closed before database writes`,
	).toBeLessThan(writeIndex);
}

describe("legacy time-tracking action billing guards", () => {
	it("imports the shared billing mutation guard helpers", () => {
		expect(source).toContain("isBillingMutationAllowed");
		expect(source).toContain("requireBillingForMutation");
		expect(source).toContain('from "@/lib/billing/guard"');
	});

	it("imports the work balance dirty marker", () => {
		expect(source).toContain("markEmployeeWorkBalanceDirty");
		expect(source).toContain('from "@/lib/work-balance/service"');
	});

	it("wraps work balance dirty marking as best effort", () => {
		expect(source).toContain("async function markWorkBalanceDirtyBestEffort(");
		expect(source).toContain("await markWorkBalanceDirtyBestEffort(");
		expect(source).toContain('"Failed to mark work balance dirty"');
	});

	it("guards clock-in before creating time entries", () => {
		expectBillingGuardBeforeWrite(
			"clockIn",
			"clockingService.clockIn({",
			clockingSource,
		);
	});

	it("captures browser timezone context in live clock-in entries", () => {
		const body = functionBody("clockIn", clockingSource);

		expect(body).toContain("actionContext: ClockActionContext = {}");
		expect(body).toContain("resolveTimeEntryTimezoneCapture({");
		expect(body).toContain("browserTimezone: actionContext.browserTimezone");
		expect(body).toContain('browserSource: "browser"');
		expect(body).toContain('fallbackSource: "user_setting"');
	});

	it("guards clock-out before creating time entries", () => {
		expectBillingGuardBeforeWrite(
			"clockOut",
			"clockingService.clockOut({",
			clockingSource,
		);
	});

	it("captures browser timezone context in live clock-out entries", () => {
		const body = functionBody("clockOut", clockingSource);

		expect(body).toContain("actionContext: ClockActionContext = {}");
		expect(body).toContain("resolveTimeEntryTimezoneCapture({");
		expect(body).toContain("browserTimezone: actionContext.browserTimezone");
		expect(body).toContain('browserSource: "browser"');
		expect(body).toContain('fallbackSource: "user_setting"');
	});

	it("guards break insertion before delegating to the clocking mutation", () => {
		expectBillingGuardBeforeWrite(
			"addBreakToActiveSession",
			"addBreakToActiveSessionAction(breakMinutes)",
		);
	});

	it("guards manual time-entry creation before creating time entries", () => {
		expectBillingGuardBeforeWrite("createManualTimeEntry", "createTimeEntry(");
	});

	it.each([
		["requestTimeCorrection", "requestTimeCorrectionEffect(data)"],
		["updateWorkPeriodNotes", ".update(timeEntry)"],
		["splitWorkPeriod", "createTimeEntry({"],
		["updateTimeEntryNotes", ".update(timeEntry)"],
		["updateWorkPeriodProject", ".update(workPeriod)"],
	])("guards %s before writing time data", (name, writeMarker) => {
		expectBillingGuardBeforeWrite(name, writeMarker);
	});

	it("guards the canonical same-day edit before writing time data", () => {
		expectBillingGuardBeforeWrite(
			"editSameDayTimeEntry",
			"canonicalTimeEntryClient.createCorrectionEntry",
			correctionSubmissionSource,
		);
	});

	it("marks work balances dirty after createManualTimeEntry changes payable time", () => {
		const name = "createManualTimeEntry";
		const body = functionBody(name);
		expect(body).toContain("await markWorkBalanceDirtyBestEffort(");
		expect(body).toContain("dirtyFromDate:");
	});

	it("marks work balances dirty after the canonical same-day edit", () => {
		const body = functionBody(
			"editSameDayTimeEntry",
			correctionSubmissionSource,
		);
		expect(body).toContain(
			"await markWorkBalanceDirtyAfterSameDayEditBestEffort(",
		);
		expect(body).toContain("dirtyFromDate:");
	});

	it("marks work balances dirty after clockOut changes payable time", () => {
		const body = functionBody("clockOut", clockingSource);
		expect(body).toContain(
			"await markWorkBalanceDirtyAfterClockOutBestEffort(",
		);
		expect(body).toContain("dirtyFromDate:");
	});

	it.each([
		"updateWorkPeriodProject",
		"updateWorkPeriodNotes",
	])("does not mark work balances dirty after %s metadata changes", (name) => {
		expect(functionBody(name)).not.toContain("markEmployeeWorkBalanceDirty");
	});

	it("blocks the legacy delete work period action instead of hard deleting", () => {
		const body = functionBody("deleteWorkPeriod");

		expect(body).toContain(
			'return { success: false, error: "Deletion requires manager approval" }',
		);
		expect(body).not.toContain("requireBillingForMutation");
		expect(body).not.toContain("markWorkBalanceDirtyBestEffort");
		expect(body).not.toContain("delete(workPeriod)");
	});

	it("guards deletion approval requests before creating correction entries", () => {
		const body = functionBody("submissionEffect", correctionSubmissionSource);
		const guardIndex = body.indexOf("requireBillingForMutation");
		const writeIndex = body.indexOf("submitCorrection({");

		expect(guardIndex).toBeGreaterThanOrEqual(0);
		expect(body).toContain("isBillingMutationAllowed");
		expect(body).toContain('message: "billing_required"');
		expect(body).toContain(
			'value: billingAccess.reason ?? "subscription_required"',
		);
		expect(body).toContain('message: "billing_required"');
		expect(writeIndex).toBeGreaterThanOrEqual(0);
		expect(guardIndex).toBeLessThan(writeIndex);
	});

	it.each([
		["clockOut", "clockingService.clockOut({"],
	])("rejects approval-required %s without a manager before writing", (name, writeMarker) => {
		expectNoManagerApprovalGuardBeforeWrite(name, writeMarker);
	});

	it("keeps manual source rows pending until approval routing resolves", () => {
		const body = functionBody("createManualTimeEntry");

		expect(body).toContain(
			'const approvalStatus = requiresApproval ? "pending" : "approved"',
		);
		expect(body).toContain("const pendingChangesData = requiresApproval");
		expect(body).toMatch(
			/const approvalResult = requiresApproval\s+\? await createManualEntryApprovalRequest/,
		);
		expect(body).toContain('error.field === "managerId"');
		expect(body).not.toContain("requiresManagerApproval");
	});

	it.each([
		["clockOut", "createClockOutApprovalRequest"],
		["createManualTimeEntry", "createManualEntryApprovalRequest"],
	])("creates approval requests from approval-required %s", (name, approvalMarker) => {
		const body = functionBody(
			name,
			name === "clockOut" ? clockingSource : source,
		);
		const approvalIndex = body.indexOf(approvalMarker);

		expect(
			approvalIndex,
			`${name} should create approval requests`,
		).toBeGreaterThanOrEqual(0);
	});

	it.each([
		["clockOut", "clockingService.clockOut({"],
		["createManualTimeEntry", "createTimeEntry("],
	])("fails closed when %s policy checks fail before writing", (name, writeMarker) => {
		expectPolicyCheckFailureBeforeWrite(
			name,
			writeMarker,
			name === "clockOut" ? clockingSource : source,
		);
	});
});
