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
const splitSource = readFileSync(
	fileURLToPath(new URL("./actions/work-period-split.ts", import.meta.url)),
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

	it("leaves clock-in billing, holiday, capture and occupancy to the Clocking module", () => {
		// Proven through `run` in lib/time-tracking/clocking/clock-in.integration.test.ts.
		const body = functionBody("clockInAs", clockingSource);

		expect(body).toContain("await clocking.run({");
		expect(body).toContain("device: actionContext.browserTimezone ?? null");
		expect(body).not.toContain("requireBillingForMutation");
		expect(body).not.toContain("clockingService");
	});

	it("leaves clock-out billing, capture and follow-ups to the Clocking module", () => {
		// Proven through `run` in lib/time-tracking/clocking/clock-out.integration.test.ts.
		const body = functionBody("clockOutAs", clockingSource);

		expect(body).toContain("await clocking.run({");
		expect(body).toContain("device: actionContext.browserTimezone ?? null");
		expect(body).not.toContain("requireBillingForMutation");
	});

	it("leaves break billing, holiday, capture and occupancy to the Clocking module", () => {
		// Proven through `run` in lib/time-tracking/clocking/break.integration.test.ts.
		const body = functionBody("addBreakToActiveSession", clockingSource);

		expect(body).toContain("await clocking.run({");
		expect(body).toContain('body: { kind: "break", breakMinutes }');
		expect(body).not.toContain("requireBillingForMutation");
		expect(functionBody("addBreakToActiveSession")).toContain(
			"return addBreakToActiveSessionAction(breakMinutes, actionContext);",
		);
	});

	it("guards manual time-entry creation before creating time entries", () => {
		expectBillingGuardBeforeWrite(
			"createManualTimeEntry",
			"createManualTimeEntryModular(data)",
		);
	});

	it.each([
		["requestTimeCorrection", "requestTimeCorrectionEffect(data)"],
		["updateWorkPeriodNotes", ".update(timeEntry)"],
		["updateTimeEntryNotes", ".update(timeEntry)"],
		["updateWorkPeriodProject", "changeWorkPeriodProject({"],
		["updateWorkPeriodBillability", "changeWorkPeriodBillability({"],
	])("guards %s before writing time data", (name, writeMarker) => {
		expectBillingGuardBeforeWrite(name, writeMarker);
	});

	it("guards the shared calendar split before its coordinated transaction", () => {
		expectBillingGuardBeforeWrite(
			"splitOwnWorkPeriod",
			"withCompletedWorkTransaction(",
			splitSource,
		);
		expect(functionBody("splitWorkPeriod")).toContain("return splitOwnWorkPeriod({");
	});

	it("guards the canonical same-day edit before writing time data", () => {
		expectBillingGuardBeforeWrite(
			"editSameDayTimeEntry",
			"withCompletedWorkTransaction(",
			correctionSubmissionSource,
		);
	});

	it("leaves the manual entry's balance refresh to the work record's transaction (#1223)", () => {
		const body = functionBody("createManualTimeEntry", clockingSource);
		expect(body).toContain("applyWorkRecordChange(context, {");
		expect(body).toContain('kind: "create_new"');
		expect(clockingSource).not.toContain("markEmployeeWorkBalanceDirty");
	});

	it("leaves the same-day edit's balance refresh to the amendment's transaction (#1226)", () => {
		const body = functionBody(
			"editSameDayTimeEntry",
			correctionSubmissionSource,
		);
		expect(body).toContain("amendLegacyCompletedWork(scope, amendment)");
		expect(body).not.toContain("markEmployeeWorkBalanceDirty");
	});

	it.each(["updateWorkPeriodProject", "updateWorkPeriodBillability", "updateWorkPeriodNotes"])(
		"does not mark work balances dirty after %s metadata changes",
		(name) => {
			expect(functionBody(name)).not.toContain("markEmployeeWorkBalanceDirty");
		},
	);

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

	it("keeps manual source rows pending until approval routing resolves", () => {
		const body = functionBody("createManualTimeEntry", clockingSource);

		const approval = body.slice(body.indexOf("approval: requiresApproval"));
		expect(approval).toMatch(
			/^approval: requiresApproval\s*\?\s*\{\s*state: "pending",\s*pendingChanges: \{/,
		);
		expect(approval).toContain(': { state: "approved" }');
		expect(body).toContain(
			"executeOrdinaryWorkPeriodSubmissionInTransaction({",
		);
		expect(body).toContain('error.field === "managerId"');
		expect(body).not.toContain("requiresManagerApproval");
	});

	it.each([
		"createManualTimeEntry",
	])("creates approval requests from approval-required %s through the shared boundary", (name) => {
		const body = functionBody(name, clockingSource);
		const approvalIndex = body.indexOf(
			"executeOrdinaryWorkPeriodSubmissionInTransaction({",
		);

		expect(
			approvalIndex,
			`${name} should create approval requests`,
		).toBeGreaterThanOrEqual(0);
	});

	it.each([
		["createManualTimeEntry", "applyWorkRecordChange("],
	])("fails closed when %s policy checks fail before writing", (name, writeMarker) => {
		expectPolicyCheckFailureBeforeWrite(name, writeMarker, clockingSource);
	});
});
