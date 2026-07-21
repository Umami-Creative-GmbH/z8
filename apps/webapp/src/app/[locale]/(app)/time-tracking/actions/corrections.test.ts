import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createUtcDateTime } from "./time-utils";

const actionSource = readFileSync(
	fileURLToPath(new URL("./corrections.ts", import.meta.url)),
	"utf8",
);
const modularSource = readFileSync(
	fileURLToPath(
		new URL(
			"../../../../../lib/approvals/server/time-correction-submission.ts",
			import.meta.url,
		),
	),
	"utf8",
);
const modularMutationsSource = readFileSync(
	fileURLToPath(new URL("./mutations.ts", import.meta.url)),
	"utf8",
);
const legacySource = readFileSync(
	fileURLToPath(new URL("../actions.ts", import.meta.url)),
	"utf8",
);

const { resolveCorrectionApprovalManager } = await import(
	"@/lib/approvals/server/time-correction-submission"
);

function createManagerLinkDb(managerLinks: unknown[]) {
	return {
		query: {
			employee: {
				findMany: vi.fn(async () => [
					{
						id: "employee-1",
						organizationId: "org-1",
						isActive: true,
						role: "employee",
					},
					{
						id: "manager-1",
						organizationId: "org-1",
						isActive: true,
						role: "manager",
					},
				]),
			},
			employeeManagers: {
				findMany: vi.fn(async () => managerLinks),
			},
			teamMembership: {
				findMany: vi.fn(async () => []),
			},
			team: {
				findMany: vi.fn(async () => []),
			},
		},
	};
}

function functionBody(source: string, name: string) {
	const match = new RegExp(
		`(?:export\\s+)?(?:async\\s+)?function ${name}\\s*\\(`,
	).exec(source);
	const start = match?.index ?? -1;
	expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
	const nextExport = source.indexOf("export async function", start + 1);
	return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

describe("time correction request safety", () => {
	it("exposes only authenticated UI operations from the file-level server action module", () => {
		const exportedFunctions = [
			...actionSource.matchAll(/export async function\s+(\w+)/g),
		].map((match) => match[1]);

		expect(exportedFunctions).toEqual([
			"editSameDayTimeEntry",
			"requestTimeCorrectionEffect",
			"requestTimeEntryDeletion",
		]);
		expect(actionSource).not.toContain(
			"export async function submitCorrection",
		);
		expect(actionSource).not.toContain(
			"export async function dispatchCommittedTimeCorrectionSubmission",
		);
	});

	it("routes modular approval-producing edits through one repository transaction and the shared submission boundary", () => {
		const body = functionBody(modularSource, "submitCorrection");

		expect(body).toContain("repository.withTransaction");
		expect(body).toContain("deriveTimeCorrectionSubmissionKey");
		expect(body).toContain("deriveTimeCorrectionRowId");
		expect(body).toContain("executeTimeCorrectionSubmissionInTransaction");
		expect(body).not.toContain("dbService.db.transaction");
		expect(body).not.toContain("createTimeCorrectionApprovalWorkflow");
	});

	it("validates a durable cycle token and derives routing only from locked trusted state", () => {
		const submissionBody = functionBody(modularSource, "submissionEffect");
		const transactionBody = functionBody(modularSource, "submitCorrection");

		expect(submissionBody).toContain("validateSubmissionId(data.submissionId)");
		expect(submissionBody.indexOf("validateSubmissionId")).toBeLessThan(
			submissionBody.indexOf("submitCorrection({"),
		);
		expect(transactionBody).toContain("teamMembership");
		expect(transactionBody).toContain("lockedEmployee.teamId");
		expect(transactionBody).not.toContain("input.teamId");
		expect(transactionBody).toContain("defaultApproverId:");
		expect(transactionBody).not.toContain("if (!managerDecision.ok)");
		expect(transactionBody).toContain("overtimeRisk: null");
		expect(transactionBody).not.toContain('overtimeRisk: "warning"');
	});

	it("binds the exported shared submission to the authenticated session", () => {
		const body = functionBody(modularSource, "submitCorrection");

		expect(body).toContain("getCurrentSession()");
		expect(body).toContain("session.user.id !== input.userId");
		expect(body).toContain(
			"session.session.activeOrganizationId !== input.organizationId",
		);
		expect(body.indexOf("getCurrentSession()")).toBeLessThan(
			body.indexOf("repository.withTransaction"),
		);
	});

	it("routes deletion through the same repository-owned submission boundary", () => {
		const body = functionBody(modularSource, "submitCorrection");
		const deletionBody = functionBody(
			modularSource,
			"requestTimeEntryDeletion",
		);

		expect(body).toContain("repository.withTransaction");
		expect(body).toContain("deriveTimeCorrectionSubmissionKey");
		expect(body).toContain("deriveTimeCorrectionRowId");
		expect(body).toContain("executeTimeCorrectionSubmissionInTransaction");
		expect(body).not.toContain("dbService.db.transaction");
		expect(body).not.toContain("createTimeCorrectionApprovalWorkflow");
		expect(deletionBody).toContain(
			'submissionEffect({ ...data, reason: data.reason.trim() }, "delete")',
		);
	});

	it("keeps the monolithic correction effect as the only modular delegate implementation", () => {
		const body = functionBody(legacySource, "requestTimeCorrectionEffect");

		expect(body).toContain("requestModularTimeCorrectionEffect(data)");
		expect(body).not.toContain("createCorrectionEntry");
		expect(body).not.toContain("dbService.db.transaction");
		expect(body).not.toContain("createTimeCorrectionApprovalWorkflow");
		expect(legacySource).not.toContain("requestTimeCorrectionEffectLegacy");
		expect(legacySource).not.toContain("createTimeCorrectionApprovalWorkflow");
		expect(legacySource).not.toContain(
			'dbService.query("createTimeCorrectionRequest"',
		);
		expect(legacySource).not.toContain(
			"timeEntryService.createCorrectionEntry",
		);
		expect(legacySource).not.toContain("TimeEntryServiceLive");
		expect(legacySource).not.toContain("renderTimeCorrectionPendingApproval");
	});

	it("keeps the monolithic same-day edit as a thin modular delegate", () => {
		const body = functionBody(legacySource, "editSameDayTimeEntry");

		expect(body).toContain("editModularSameDayTimeEntry(data)");
		expect(body).not.toContain("createTimeEntry({");
		expect(body).not.toContain(".update(workPeriod)");
		expect(body).not.toContain("db.transaction");
	});

	it("returns before dependency setup when committed submission effects are a replay no-op", () => {
		const body = functionBody(
			modularSource,
			"dispatchCommittedTimeCorrectionSubmission",
		);
		const noEffectCheck = body.indexOf("input.result.postCommit");
		const dependencySetup = body.indexOf("Effect.gen");

		expect(noEffectCheck).toBeGreaterThanOrEqual(0);
		expect(dependencySetup).toBeGreaterThan(noEffectCheck);
	});

	it("uses explicit correction endpoint dates instead of stored work period endpoint dates", () => {
		expect(modularSource).toContain("newClockInDate: data.newClockInDate");
		expect(modularSource).toContain("newClockOutDate: data.newClockOutDate");
		expect(modularSource).not.toContain("periodStart:");
		expect(modularSource).not.toContain("periodEnd:");
		expect(modularSource).not.toContain("setTimeOnStoredDate");
	});

	it("rejects partial explicit clock-out endpoint inputs", () => {
		expect(modularSource).toContain(
			"if (params.newClockOutDate || params.newClockOutTime)",
		);
		expect(modularSource).toContain(
			'return { error: "Invalid clock out date or time" } as const;',
		);
	});

	it("scopes and locks the modular work period to the authenticated employee and organization", () => {
		const body = functionBody(modularSource, "submitCorrection");

		expect(body).toContain("eq(workPeriod.id, input.workPeriodId)");
		expect(body).toContain("eq(workPeriod.employeeId, input.employeeId)");
		expect(body).toContain(
			"eq(workPeriod.organizationId, input.organizationId)",
		);
		expect(body).toContain('.for("update")');
	});

	it("requires exactly one locked active target employee before locking the work period", () => {
		const body = functionBody(modularSource, "submitCorrection");
		const employeeLock = body.indexOf("const lockedEmployees = await tx");
		const exactEmployeeCheck = body.indexOf("lockedEmployees.length !== 1");
		const periodLock = body.indexOf("const [lockedPeriod] = await tx");

		expect(employeeLock).toBeGreaterThanOrEqual(0);
		expect(body).toContain("eq(employee.isActive, true)");
		expect(body).toContain("orderBy(asc(employee.id))");
		expect(body).toContain("Global employee lock order");
		expect(exactEmployeeCheck).toBeGreaterThan(employeeLock);
		expect(periodLock).toBeGreaterThan(exactEmployeeCheck);
	});

	it("excludes deleted work periods from direct same-day edits", () => {
		const body = functionBody(modularSource, "editSameDayTimeEntry");

		expect(body).toContain("isNull(workPeriod.deletedAt)");
	});

	it("rejects direct same-day edits that change endpoint local dates", () => {
		const body = functionBody(modularSource, "editSameDayTimeEntry");

		expect(body).toContain("originalClockInDate");
		expect(body).toContain("originalClockOutDate");
		expect(body).toContain("data.newClockInDate !== originalClockInDate");
		expect(body).toContain("data.newClockOutDate !== originalClockOutDate");
		expect(body).toContain("Date changes require manager approval");
	});

	it("leaves the final same-day work period mutation to the scoped locked service", () => {
		const body = functionBody(modularSource, "editSameDayTimeEntry");

		expect(body).not.toContain(".update(workPeriod)");
		expect(body).toContain("canonicalTimeEntryClient.createCorrectionEntry");
	});

	it("applies direct same-day corrections through the shared locked service in one transaction", () => {
		const body = functionBody(modularSource, "editSameDayTimeEntry");

		expect(body).toContain("db.transaction");
		expect(body).toContain("canonicalTimeEntryClient.createCorrectionEntry");
		expect(body).toContain("workPeriodId: selectedWorkPeriod.id");
		expect(body).toContain("tx,");
		expect(body).not.toContain("createTimeEntry({");
		expect(body).not.toContain("markTimeEntrySuperseded");
	});

	it("excludes deleted work periods from correction approval requests", () => {
		const body = functionBody(modularSource, "submitCorrection");

		expect(body).toContain("isNull(workPeriod.deletedAt)");
	});

	it.each([
		["legacy notes", legacySource, "updateWorkPeriodNotes"],
		["legacy split", legacySource, "splitWorkPeriod"],
		["legacy project", legacySource, "updateWorkPeriodProject"],
		["modular notes", modularMutationsSource, "updateWorkPeriodNotes"],
		["modular split", modularMutationsSource, "splitWorkPeriod"],
		["modular project", modularMutationsSource, "updateWorkPeriodProject"],
	])("excludes deleted work periods from %s calendar mutations", (_name, source, functionName) => {
		const body = functionBody(source, functionName);

		expect(body).toContain("isNull(workPeriod.deletedAt)");
	});

	it("creates deterministic inactive rows before invoking the shared boundary in the repository transaction", () => {
		const transactionBody = functionBody(modularSource, "submitCorrection");
		const insertBody = functionBody(modularSource, "insertOrVerifyCorrection");
		const insertIndex = transactionBody.indexOf("insertOrVerifyCorrection");
		const approvalIndex = transactionBody.indexOf(
			"executeTimeCorrectionSubmissionInTransaction",
		);

		expect(transactionBody).toContain("deriveTimeCorrectionRowId");
		expect(insertBody).toContain("insertTimeCorrectionSourceEntry");
		expect(insertBody).not.toContain(".insert(timeEntry)");
		expect(insertIndex).toBeGreaterThanOrEqual(0);
		expect(approvalIndex).toBeGreaterThan(insertIndex);
	});

	it("blocks direct same-day edits when a correction approval is pending", () => {
		const body = functionBody(modularSource, "editSameDayTimeEntry");

		expect(body).toContain("approvalRequest");
		expect(body).toContain("pending_time_correction_approval");
		expect(body).toContain(
			"A time correction approval is already pending for this work period",
		);
	});

	it("derives same-day dirty dates from original and corrected endpoint-local evidence", () => {
		const body = functionBody(modularSource, "editSameDayTimeEntry");

		expect(body).toContain("dirtyFromDateForTimeCorrection");
		expect(body).toContain("originalEndpointEvidence");
		expect(body).toContain("clockInTimezoneCapture");
		expect(body).not.toContain("earliestAffectedDate");
	});

	it("fails closed for same-day edits when policy verification fails", () => {
		const body = functionBody(modularSource, "editSameDayTimeEntry");

		expect(body).toContain("Failed to verify edit policy. Please try again.");
		expect(body).not.toContain(
			'editCapability = { type: "direct", reason: "within_self_service" };',
		);
	});

	it("rejects direct clock-in-only edits after the existing clock-out", () => {
		const body = functionBody(modularSource, "editSameDayTimeEntry");

		expect(body).toMatch(
			/const effectiveClockOut\s*=\s*correctedClockOutDate \?\?\s*selectedWorkPeriod\.endTime/,
		);
		expect(body).toContain(
			"if (effectiveClockOut && effectiveClockOut <= correctedClockInDate)",
		);
		expect(body).toContain("Clock out time must be after clock in time");
	});

	it("rejects approval requests when the effective clock-out is not after clock-in", () => {
		const body = functionBody(modularSource, "submissionEffect");

		expect(body).toContain("compareInstants(");
		expect(body).toContain("Clock out time must be after clock in time");
	});

	it("requests deletion through zero-duration correction entries and approval metadata", () => {
		const body = functionBody(modularSource, "requestTimeEntryDeletion");
		const submissionBody = functionBody(modularSource, "submissionEffect");

		expect(modularSource).toContain(
			"export async function requestTimeEntryDeletion",
		);
		expect(submissionBody).toContain("loadSubmissionActor");
		expect(submissionBody).toContain(
			"requireBillingForMutation(organizationId)",
		);
		expect(submissionBody).toContain("isBillingMutationAllowed(billingAccess)");
		expect(body).toContain('error: "billing_required"');
		expect(body).toContain('"delete"');
		expect(submissionBody).toContain(
			"const deletionTimestamp = period.startTime",
		);
		expect(body).toContain("data.reason.trim()");
		expect(body).toContain(
			'return { success: false, error: "Reason is required" }',
		);
		expect(modularSource).not.toContain("delete(workPeriod)");
	});

	it("derives deletion timezone evidence independently for both original endpoints", () => {
		const body = functionBody(modularSource, "submissionEffect");

		expect(body).toContain('endpointType: "clock_in"');
		expect(body).toContain('endpointType: "clock_out"');
		expect(body).toContain("const original = originals.find");
		expect(body).toContain(
			"const endpointTimezone = original?.timezone ?? timezone",
		);
		expect(body).toContain("resolveTimeEntryTimezoneCapture");
		expect(body).toContain("resolveFallbackTimezoneCapture");
	});

	it("blocks the legacy exported delete work period action", () => {
		const body = functionBody(legacySource, "deleteWorkPeriod");

		expect(body).toContain(
			'return { success: false, error: "Deletion requires manager approval" }',
		);
		expect(body).not.toContain("delete(workPeriod)");
	});
});

describe("createUtcDateTime", () => {
	it("builds a UTC instant from an employee local date and time", () => {
		const result = createUtcDateTime("2026-06-03", "18:15", "Europe/Berlin");

		expect(result?.toISOString()).toBe("2026-06-03T16:15:00.000Z");
	});

	it("allows a corrected clock-out date to be the same local date as clock-in", () => {
		const start = createUtcDateTime("2026-06-03", "09:00", "Europe/Berlin");
		const end = createUtcDateTime("2026-06-03", "17:00", "Europe/Berlin");

		expect(start?.toISOString()).toBe("2026-06-03T07:00:00.000Z");
		expect(end?.toISOString()).toBe("2026-06-03T15:00:00.000Z");
		if (!start || !end) throw new Error("Expected valid correction instants");
		expect(end.getTime()).toBeGreaterThan(start.getTime());
	});
});

describe("resolveCorrectionApprovalManager", () => {
	it("resolves the approver from primary manager links when the employee fixture omits managerId", async () => {
		const db = createManagerLinkDb([
			{ employeeId: "employee-1", managerId: "manager-1", isPrimary: true },
		]);

		await expect(
			resolveCorrectionApprovalManager({
				db,
				requesterEmployeeId: "employee-1",
				organizationId: "org-1",
			}),
		).resolves.toEqual({ ok: true, managerId: "manager-1" });
	});

	it("returns the existing no-manager correction validation decision", async () => {
		const db = createManagerLinkDb([]);

		await expect(
			resolveCorrectionApprovalManager({
				db,
				requesterEmployeeId: "employee-1",
				organizationId: "org-1",
			}),
		).resolves.toEqual({
			ok: false,
			message: "No manager assigned to approve corrections",
			field: "managerId",
		});
	});
});
