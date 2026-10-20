import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import {
	activateDrivingLicenceControl,
	saveConfirmedIntendedDriverAssignment,
} from "./testing/control.test.fixture";

const harness = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	now: "2026-01-31T11:00:00Z",
}));
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: async () =>
		harness.userId
			? {
					user: { id: harness.userId },
					session: { activeOrganizationId: harness.organizationId },
				}
			: null,
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual =
		await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: Object.freeze({
			nowInstant: () => actual.parseInstant(harness.now),
		}),
	};
});
const checks = await import("./check-actions");
const policy = await import("./policy-actions");
const grants = await import("./verifier-actions");
const history = await import("./history-actions");
const reinstatement = await import("./impediment-actions");
let fixture: LifecycleDatabaseFixture;
let verifier: SeededEmployee;
let checkId: string;
function supplement() {
	return {
		employeeId: fixture.employeeId,
		checkId,
		commandId: crypto.randomUUID(),
		reason: "recording_error",
		correction: { field: "documentIssuedOn", value: "2020-05-02" },
	};
}
async function read(period: { from?: string; to?: string } = {}) {
	const result = await history.getDrivingLicenceHistoryAction({
		employeeId: fixture.employeeId,
		...period,
	});
	if (!result.success) throw new Error(result.error);
	return result.data;
}
beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	verifier = await fixture.seedEmployee();
	harness.organizationId = fixture.organizationId;
	harness.now = "2026-01-31T11:00:00Z";
	harness.userId = fixture.ownerUserId;
	expect(
		(
			await activateDrivingLicenceControl({
				intervalMonths: 1,
				timezone: "Europe/Berlin",
				reminderLeadDays: [30, 7],
				retentionMonths: 1,
				retentionJustification:
					"Necessary evidence for organization driving checks",
			})
		).success,
	).toBe(true);
	expect(
		(
			await saveConfirmedIntendedDriverAssignment({
				target: { type: "employee", employeeId: fixture.employeeId },
				value: "required",
			})
		).success,
	).toBe(true);
	expect(
		(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: verifier.employeeId,
				scope: "all",
				teamIds: [],
				employeeIds: [],
			})
		).success,
	).toBe(true);
	harness.userId = verifier.userId;
	const check = await checks.completeDrivingLicenceCheckAction({
		employeeId: fixture.employeeId,
		commandId: crypto.randomUUID(),
		originalInspected: true,
		identityConfirmed: true,
		employeeDeclaration: true,
		verifierConfirmed: true,
		documentIssuedOn: "2020-05-01",
		documentExpiresOn: "2035-05-01",
		classes: [
			{ code: "B", result: "successful", expiryDate: null, restrictions: "" },
		],
	});
	if (!check.success) throw new Error(check.error);
	checkId = check.data.checkId;
});
afterEach(async () => {
	await fixture?.close();
});
const retention = await import("./retention-actions");
const jobs = await import("@/lib/jobs/driving-licence-retention");
it("starts retention at the actual last class expiry even when cleanup is delayed, then deletes evidence and supplements", async () => {
	expect(
		(await history.supplementDrivingLicenceCheckAction(supplement())).success,
	).toBe(true);
	harness.now = "2026-03-15T12:00:00Z";
	harness.userId = fixture.ownerUserId;
	const admin = await retention.getDrivingLicenceRetentionAction();
	expect(admin).toMatchObject({
		success: true,
		data: {
			records: [
				{
					checkId,
					retentionStartedAt: "2026-02-28T23:00:00.000Z",
					deleteAfter: "2026-03-31T22:00:00.000Z",
					protected: false,
				},
			],
		},
	});
	expect(JSON.stringify(admin)).not.toContain("declarationText");
	expect(
		(
			await checks.getDrivingLicenceEmployeeRecordAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(false);
	harness.now = "2026-03-31T22:00:00Z";
	const result = await jobs.runDrivingLicenceRetentionJob();
	expect(result.deletedCount).toBeGreaterThanOrEqual(1);
	harness.userId = verifier.userId;
	const evidence = await read();
	expect(evidence.checks).toEqual([]);
	expect(evidence.supplements).toEqual([]);
	expect(evidence.authorization.authorizedClasses).toEqual([]);
	expect(evidence.authorization.classes[0]).toMatchObject({
		status: "suspended",
		supportingCheckId: null,
	});
	expect((await jobs.runDrivingLicenceRetentionJob()).deletedCount).toBe(0);
});
async function adminRetention() {
	harness.userId = fixture.ownerUserId;
	const result = await retention.getDrivingLicenceRetentionAction();
	if (!result.success) throw new Error(result.error);
	return result.data;
}
async function ownHistory() {
	harness.userId = verifier.userId;
	return read();
}
it("requires a documented specific case and releases a hold without restarting an expired retention period", async () => {
	harness.userId = fixture.ownerUserId;
	expect(
		(
			await retention.placeDrivingLicenceHoldAction({
				checkId,
				caseReference: "",
				preservationReason: "",
			})
		).success,
	).toBe(false);
	const command = {
		checkId,
		caseReference: "CASE-2026-17",
		preservationReason:
			"Preserve this check for the pending vehicle liability proceeding.",
	};
	const held = await retention.placeDrivingLicenceHoldAction(command);
	if (!held.success) throw new Error(held.error);
	expect(await retention.placeDrivingLicenceHoldAction(command)).toEqual(held);
	harness.now = "2026-06-01T12:00:00Z";
	const before = await adminRetention();
	expect(before.records[0]).toMatchObject({
		retentionStartedAt: "2026-02-28T23:00:00.000Z",
		due: true,
		holds: [
			{
				caseReference: "CASE-2026-17",
				placedBy: fixture.ownerUserId,
				releasedAt: null,
			},
		],
	});
	expect((await jobs.runDrivingLicenceRetentionJob()).deletedCount).toBe(0);
	expect((await ownHistory()).checks).toHaveLength(1);
	harness.userId = fixture.ownerUserId;
	expect(
		(
			await retention.releaseDrivingLicenceHoldAction({
				holdId: held.data.holdId,
				releaseReason:
					"The legal proceeding is closed and preservation is no longer required.",
			})
		).success,
	).toBe(true);
	expect((await adminRetention()).records[0].retentionStartedAt).toBe(
		"2026-02-28T23:00:00.000Z",
	);
	expect(await retention.cleanupDrivingLicenceEvidenceAction()).toMatchObject({
		success: true,
		data: { deletedCount: 1 },
	});
	expect((await adminRetention()).runs).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				actorUserId: fixture.ownerUserId,
				deletedCount: 1,
			}),
		]),
	);
	expect((await ownHistory()).checks).toHaveLength(0);
});
it("keeps a shared original protected while either class is active and starts only at the last support transition", async () => {
	harness.now = "2026-02-01T11:00:00Z";
	const newCheck = await checks.completeDrivingLicenceCheckAction({
		employeeId: fixture.employeeId,
		commandId: crypto.randomUUID(),
		originalInspected: true,
		identityConfirmed: true,
		employeeDeclaration: true,
		verifierConfirmed: true,
		documentIssuedOn: "2020-01-01",
		documentExpiresOn: "2035-01-01",
		classes: [
			{ code: "B", result: "successful", expiryDate: null, restrictions: "" },
			{
				code: "C",
				result: "successful",
				expiryDate: "2026-02-05",
				restrictions: "",
			},
		],
	});
	if (!newCheck.success) throw new Error(newCheck.error);
	harness.now = "2026-02-10T12:00:00Z";
	expect(
		(await adminRetention()).records.find(
			(r) => r.checkId === newCheck.data.checkId,
		),
	).toMatchObject({ protected: true, retentionStartedAt: null });
	harness.now = "2026-02-20T12:00:00Z";
	harness.userId = verifier.userId;
	expect(
		(
			await checks.completeDrivingLicenceCheckAction({
				employeeId: fixture.employeeId,
				commandId: crypto.randomUUID(),
				originalInspected: true,
				identityConfirmed: true,
				employeeDeclaration: true,
				verifierConfirmed: true,
				documentIssuedOn: "2020-01-01",
				documentExpiresOn: "2035-01-01",
				classes: [
					{
						code: "B",
						result: "successful",
						expiryDate: null,
						restrictions: "",
					},
				],
			})
		).success,
	).toBe(true);
	const ended = (await adminRetention()).records.find(
		(r) => r.checkId === newCheck.data.checkId,
	);
	expect(ended).toMatchObject({
		protected: false,
		retentionStartedAt: "2026-02-20T12:00:00.000Z",
		deleteAfter: "2026-03-20T12:00:00.000Z",
	});
});
it("isolates hold, release and cleanup authority from verifier access and rejects foreign record references", async () => {
	expect((await retention.getDrivingLicenceRetentionAction()).success).toBe(
		false,
	);
	expect(
		(
			await retention.placeDrivingLicenceHoldAction({
				checkId,
				caseReference: "CASE-123",
				preservationReason: "Required by a specific legal proceeding.",
			})
		).success,
	).toBe(false);
	const foreign = await createLifecycleDatabaseFixture();
	try {
		harness.organizationId = foreign.organizationId;
		harness.userId = foreign.ownerUserId;
		expect(
			(
				await retention.placeDrivingLicenceHoldAction({
					checkId,
					caseReference: "CASE-123",
					preservationReason: "Required by a specific legal proceeding.",
				})
			).success,
		).toBe(false);
		expect(
			(
				await retention.releaseDrivingLicenceHoldAction({
					holdId: crypto.randomUUID(),
					releaseReason: "Preservation is no longer required for the case.",
				})
			).success,
		).toBe(false);
		expect(await retention.getDrivingLicenceRetentionAction()).toMatchObject({
			success: true,
			data: { records: [] },
		});
	} finally {
		await foreign.close();
		harness.organizationId = fixture.organizationId;
	}
});
it("preserves original evidence and its supplements across unrelated generic audit cleanup", async () => {
	expect(
		(await history.supplementDrivingLicenceCheckAction(supplement())).success,
	).toBe(true);
	const { deleteOldAuditLogs } = await import("@/lib/audit/cleanup");
	await deleteOldAuditLogs(1);
	const evidence = await read();
	expect(evidence.checks).toHaveLength(1);
	expect(evidence.supplements).toHaveLength(1);
});
it("retains an unresolved employee report after purging its old proof and never turns a new check into automatic reinstatement", async () => {
	const subject = await fixture.db.query.employee.findFirst({
		where: (e, { eq }) => eq(e.id, fixture.employeeId),
	});
	harness.now = "2026-02-04T12:00:00Z";
	harness.userId = subject?.userId ?? "";
	expect(
		(
			await reinstatement.reportDrivingImpedimentAction({
				commandId: crypto.randomUUID(),
			})
		).success,
	).toBe(true);
	expect((await adminRetention()).records[0]).toMatchObject({
		retentionStartedAt: "2026-02-04T12:00:00.000Z",
	});
	harness.now = "2026-03-05T12:00:00Z";
	expect((await jobs.runDrivingLicenceRetentionJob()).deletedCount).toBe(1);
	harness.userId = verifier.userId;
	const causes = await reinstatement.getDrivingImpedimentStateAction({
		employeeId: fixture.employeeId,
	});
	expect(causes).toMatchObject({
		success: true,
		data: { reports: [{ reportedAt: "2026-02-04T12:00:00.000Z" }] },
	});
	expect(
		(
			await checks.completeDrivingLicenceCheckAction({
				employeeId: fixture.employeeId,
				commandId: crypto.randomUUID(),
				originalInspected: true,
				identityConfirmed: true,
				employeeDeclaration: true,
				verifierConfirmed: true,
				documentIssuedOn: "2020-01-01",
				documentExpiresOn: "2035-01-01",
				classes: [
					{
						code: "B",
						result: "successful",
						expiryDate: null,
						restrictions: "",
					},
				],
			})
		).success,
	).toBe(true);
	expect((await read()).authorization.authorizedClasses).toEqual([]);
});
const intervals = await import("./interval-actions");
async function interval(months: number) {
	harness.userId = fixture.ownerUserId;
	const preview = await intervals.previewDrivingLicenceIntervalAction({
		intervalMonths: months,
	});
	if (!preview.success) throw new Error(preview.error);
	expect(
		(
			await intervals.applyDrivingLicenceIntervalAction({
				intervalMonths: months,
				previewToken: preview.data.previewToken,
			})
		).success,
	).toBe(true);
	harness.userId = verifier.userId;
}
async function checkAgain(code = "B", result = "successful") {
	const saved = await checks.completeDrivingLicenceCheckAction({
		employeeId: fixture.employeeId,
		commandId: crypto.randomUUID(),
		originalInspected: true,
		identityConfirmed: true,
		employeeDeclaration: true,
		verifierConfirmed: true,
		documentIssuedOn: "2020-01-01",
		documentExpiresOn: "2035-01-01",
		classes: [{ code, result, expiryDate: null, restrictions: "" }],
	});
	if (!saved.success) throw new Error(saved.error);
	return saved.data.checkId;
}
it("starts never-supporting unsuccessful evidence at its control instant and continues cleanup while the feature is disabled", async () => {
	harness.now = "2026-02-02T12:00:00Z";
	const unsuccessful = await checkAgain("A", "inconclusive");
	expect(
		(await adminRetention()).records.find((r) => r.checkId === unsuccessful),
	).toMatchObject({
		protected: false,
		retentionStartedAt: "2026-02-02T12:00:00.000Z",
	});
	expect(
		(await policy.switchDrivingLicenceControlAction({ enabled: false })).success,
	).toBe(true);
	harness.now = "2026-03-03T12:00:00Z";
	expect((await jobs.runDrivingLicenceRetentionJob()).deletedCount).toBe(1);
	expect((await adminRetention()).records.map((r) => r.checkId)).not.toContain(
		unsuccessful,
	);
});
it("starts retention at policy shortening application time instead of its newly backdated routine limit", async () => {
	await interval(6);
	harness.now = "2026-02-02T12:00:00Z";
	const renewed = await checkAgain();
	harness.now = "2026-05-05T12:00:00Z";
	await interval(1);
	const record = (await adminRetention()).records.find(
		(r) => r.checkId === renewed,
	);
	expect(record).toMatchObject({
		retentionStartedAt: "2026-05-05T12:00:00.000Z",
		deleteAfter: "2026-06-05T12:00:00.000Z",
	});
	expect((await jobs.runDrivingLicenceRetentionJob()).deletedCount).toBe(1);
	expect((await adminRetention()).records.map((r) => r.checkId)).toContain(
		renewed,
	);
});
it("starts retention for a negatively corrected clearance at the correction decision", async () => {
	harness.now = "2026-02-05T12:00:00Z";
	expect(
		(
			await history.supplementDrivingLicenceCheckAction({
				...supplement(),
				correction: {
					field: "classResult",
					classCode: "B",
					value: "unsuccessful",
				},
			})
		).success,
	).toBe(true);
	expect((await adminRetention()).records[0]).toMatchObject({
		retentionStartedAt: "2026-02-05T12:00:00.000Z",
	});
});
it("serializes competing cleanup and reinstatement so evidence is deleted only if no active class relies on it", async () => {
	await interval(6);
	const subject = await fixture.db.query.employee.findFirst({
		where: (e, { eq }) => eq(e.id, fixture.employeeId),
	});
	harness.now = "2026-02-02T12:00:00Z";
	harness.userId = subject?.userId ?? "";
	await reinstatement.reportDrivingImpedimentAction({
		commandId: crypto.randomUUID(),
	});
	harness.now = "2026-02-03T12:00:00Z";
	harness.userId = verifier.userId;
	const fresh = await checkAgain();
	const state = await reinstatement.getDrivingImpedimentStateAction({
		employeeId: fixture.employeeId,
	});
	if (!state.success) throw new Error(state.error);
	harness.now = "2026-03-05T12:00:00Z";
	harness.userId = fixture.ownerUserId;
	const cleanup = retention.cleanupDrivingLicenceEvidenceAction();
	harness.userId = verifier.userId;
	const reinstate = reinstatement.reinstateDrivingAuthorizationAction({
		employeeId: fixture.employeeId,
		checkId: fresh,
		classCodes: ["B"],
		impedimentResolved: true,
		expectedReportIds: state.data.reports.map((r) => r.id),
		expectedSuspension: state.data.suspension,
	});
	const [, decision] = await Promise.all([cleanup, reinstate]);
	const evidence = await read();
	if (evidence.authorization.authorizedClasses.length) {
		expect(decision.success).toBe(true);
		expect(evidence.checks.map((c) => c.id)).toContain(fresh);
		expect(
			(await adminRetention()).records.find((r) => r.checkId === fresh),
		).toMatchObject({ protected: true, retentionStartedAt: null });
	} else expect(decision.success).toBe(false);
});

it("restarts inactivity only after a genuinely reinstated fresh record stops supporting authorization", async () => {
	await interval(6);
	const subject = await fixture.db.query.employee.findFirst({
		where: (e, { eq }) => eq(e.id, fixture.employeeId),
	});
	harness.now = "2026-02-02T12:00:00Z";
	harness.userId = subject?.userId ?? "";
	await reinstatement.reportDrivingImpedimentAction({
		commandId: crypto.randomUUID(),
	});
	harness.now = "2026-02-03T12:00:00Z";
	harness.userId = verifier.userId;
	const fresh = await checkAgain();
	const state = await reinstatement.getDrivingImpedimentStateAction({
		employeeId: fixture.employeeId,
	});
	if (!state.success) throw new Error(state.error);
	harness.now = "2026-03-04T12:00:00Z";
	expect(
		(
			await reinstatement.reinstateDrivingAuthorizationAction({
				employeeId: fixture.employeeId,
				checkId: fresh,
				classCodes: ["B"],
				impedimentResolved: true,
				expectedReportIds: state.data.reports.map((r) => r.id),
				expectedSuspension: state.data.suspension,
			})
		).success,
	).toBe(true);
	expect(
		(await adminRetention()).records.find((r) => r.checkId === fresh),
	).toMatchObject({ protected: true, retentionStartedAt: null });
	await jobs.runDrivingLicenceRetentionJob();
	expect((await adminRetention()).records.map((r) => r.checkId)).toContain(
		fresh,
	);
	harness.now = "2026-03-06T12:00:00Z";
	harness.userId = subject?.userId ?? "";
	await reinstatement.reportDrivingImpedimentAction({
		commandId: crypto.randomUUID(),
	});
	expect(
		(await adminRetention()).records.find((r) => r.checkId === fresh),
	).toMatchObject({
		protected: false,
		retentionStartedAt: "2026-03-06T12:00:00.000Z",
	});
});
it("uses a due departure's actual cutoff before its worker runs and permits due inactive proof to be removed", async () => {
	await interval(6);
	const { createDepartureCommands } = await import(
		"@/lib/employee-lifecycle/commands"
	);
	const { parseInstant } = await import("@/lib/datetime/temporal-core");
	await fixture.pool.query(
		"update organization set timezone='Europe/Berlin' where id=$1",
		[fixture.organizationId],
	);
	const commands = createDepartureCommands({
		db: fixture.db,
		clock: { nowInstant: () => parseInstant(harness.now) },
		clockOut: { close: async () => ({ kind: "not_running" }) },
	});
	await commands.scheduleDeparture(
		{ organizationId: fixture.organizationId, userId: fixture.ownerUserId },
		{
			employeeId: fixture.employeeId,
			requestId: crypto.randomUUID(),
			expectedRevision: null,
			lastWorkingDay: "2026-02-05",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: false,
		},
	);
	harness.now = "2026-04-10T12:00:00Z";
	expect((await adminRetention()).records[0]).toMatchObject({
		protected: false,
		retentionStartedAt: "2026-02-05T23:00:00.000Z",
	});
	expect(await retention.cleanupDrivingLicenceEvidenceAction()).toMatchObject({
		success: true,
		data: { deletedCount: 1 },
	});
	expect((await adminRetention()).records).toHaveLength(0);
});

it("keeps finite justified retention when switching control off, keeps evidence due and honors its hold", async () => {
	harness.userId = fixture.ownerUserId;
	const hold = await retention.placeDrivingLicenceHoldAction({
		checkId,
		caseReference: "CASE-disable",
		preservationReason: "Preserve the evidence during the pending case.",
	});
	if (!hold.success) throw new Error(hold.error);
	// An established retention period can't be cleared, before or after the switch-off.
	expect(
		await policy.saveDrivingLicencePolicyAction({
			intervalMonths: 1,
			timezone: "Europe/Berlin",
			reminderLeadDays: [30, 7],
			retentionMonths: null,
			retentionJustification: null,
		}),
	).toMatchObject({ success: false, error: "retention_required" });
	expect((await policy.switchDrivingLicenceControlAction({ enabled: false })).success).toBe(
		true,
	);
	expect(
		await policy.saveDrivingLicencePolicyAction({
			intervalMonths: 1,
			timezone: "Europe/Berlin",
			reminderLeadDays: [30, 7],
			retentionMonths: null,
			retentionJustification: null,
		}),
	).toMatchObject({ success: false, error: "not_enabled" });
	harness.now = "2026-04-01T12:00:00Z";
	expect((await adminRetention()).records[0]).toMatchObject({
		deleteAfter: "2026-03-31T22:00:00.000Z",
		due: true,
	});
	expect((await retention.cleanupDrivingLicenceEvidenceAction()).success).toBe(
		true,
	);
	expect((await adminRetention()).runs[0].heldCount).toBeGreaterThanOrEqual(1);
	expect((await adminRetention()).records.map((r) => r.checkId)).toContain(checkId);
	harness.userId = fixture.ownerUserId;
	expect(
		(
			await retention.releaseDrivingLicenceHoldAction({
				holdId: hold.data.holdId,
				releaseReason: "The case ended and preservation is no longer needed.",
			})
		).success,
	).toBe(true);
	expect(
		(await jobs.runDrivingLicenceRetentionJob()).deletedCount,
	).toBeGreaterThanOrEqual(1);
	expect((await adminRetention()).records.map((r) => r.checkId)).not.toContain(checkId);
});

async function reportOwnImpediment() {
	harness.userId = (
		await fixture.pool.query("select user_id from employee where id=$1", [
			fixture.employeeId,
		])
	).rows[0].user_id;
	const result = await reinstatement.reportDrivingImpedimentAction({
		commandId: crypto.randomUUID(),
	});
	if (!result.success) throw new Error(result.error);
	harness.userId = verifier.userId;
	return result.data.reportId;
}
async function causes() {
	const result = await reinstatement.getDrivingImpedimentStateAction({
		employeeId: fixture.employeeId,
	});
	if (!result.success) throw new Error(result.error);
	return result.data;
}
it("deletes resolved impediment evidence and its report event after finite retention, preserving evidence under an existing check case hold", async () => {
	harness.now = "2026-02-01T12:00:00Z";
	const reportId = await reportOwnImpediment();
	harness.now = "2026-02-02T12:00:00Z";
	const resolutionCheckId = await checkAgain();
	const snapshot = await causes();
	expect(
		(
			await reinstatement.reinstateDrivingAuthorizationAction({
				employeeId: fixture.employeeId,
				checkId: resolutionCheckId,
				classCodes: ["B"],
				expectedReportIds: [reportId],
				expectedSuspension: snapshot.suspension,
				impedimentResolved: true,
			})
		).success,
	).toBe(true);
	harness.userId = fixture.ownerUserId;
	const hold = await retention.placeDrivingLicenceHoldAction({
		checkId,
		caseReference: "CASE-report",
		preservationReason:
			"Preserve related original evidence during the specific case.",
	});
	if (!hold.success) throw new Error(hold.error);
	harness.now = "2026-04-03T12:00:00Z";
	await jobs.runDrivingLicenceRetentionJob();
	expect((await adminRetention()).reports).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				reportId,
				retentionStartedAt: "2026-03-02T23:00:00.000Z",
				deleteAfter: "2026-04-02T22:00:00.000Z",
				due: true,
			}),
		]),
	);
	expect((await ownHistory()).events.some((e) => e.id === reportId)).toBe(true);
	const heldProof = await ownHistory();
	expect(heldProof.checks.some((check) => check.id === resolutionCheckId)).toBe(
		true,
	);
	expect(
		heldProof.events.some(
			(event) => event.reason === `reported_impediment:${reportId}`,
		),
	).toBe(true);

	harness.userId = fixture.ownerUserId;
	expect(
		(
			await retention.releaseDrivingLicenceHoldAction({
				holdId: hold.data.holdId,
				releaseReason:
					"The legal case has ended; preservation is no longer needed.",
			})
		).success,
	).toBe(true);
	await jobs.runDrivingLicenceRetentionJob();
	expect((await adminRetention()).reports).toEqual([]);
	expect(
		(await ownHistory()).events.filter(
			(e) =>
				e.id === reportId || e.reason === `reported_impediment:${reportId}`,
		),
	).toEqual([]);
	expect((await causes()).reports).toEqual([]);
	expect((await jobs.runDrivingLicenceRetentionJob()).deletedCount).toBe(0);
});

it("keeps resolved report proof throughout a long active resolution check, then ages it from the final support end", async () => {
	await interval(6);
	harness.now = "2026-02-01T12:00:00Z";
	const reportId = await reportOwnImpediment();
	harness.now = "2026-02-02T12:00:00Z";
	const resolutionCheckId = await checkAgain();
	const snapshot = await causes();
	expect(
		(
			await reinstatement.reinstateDrivingAuthorizationAction({
				employeeId: fixture.employeeId,
				checkId: resolutionCheckId,
				classCodes: ["B"],
				expectedReportIds: [reportId],
				expectedSuspension: snapshot.suspension,
				impedimentResolved: true,
			})
		).success,
	).toBe(true);
	harness.now = "2026-04-03T12:00:00Z";
	await jobs.runDrivingLicenceRetentionJob();
	expect((await adminRetention()).reports).toMatchObject([
		{ reportId, protected: true, retentionStartedAt: null, deleteAfter: null },
	]);
	expect((await ownHistory()).events.some((e) => e.id === reportId)).toBe(true);
	harness.now = "2026-08-03T12:00:00Z";
	await jobs.runDrivingLicenceRetentionJob();
	expect((await adminRetention()).reports).toMatchObject([
		{
			reportId,
			protected: false,
			retentionStartedAt: "2026-08-02T22:00:00.000Z",
			deleteAfter: "2026-09-02T22:00:00.000Z",
		},
	]);
	harness.now = "2026-09-02T22:00:00Z";
	await jobs.runDrivingLicenceRetentionJob();
	expect((await adminRetention()).reports).toEqual([]);
	expect(
		(await ownHistory()).events.filter(
			(e) =>
				e.id === reportId || e.reason === `reported_impediment:${reportId}`,
		),
	).toEqual([]);
});
it("ages unresolved former-period report evidence from the effective departure cutoff without resolving or deleting a rehired employee's current cause", async () => {
	harness.now = "2026-02-01T12:00:00Z";
	const oldReportId = await reportOwnImpediment();
	const { createDepartureCommands } = await import(
		"@/lib/employee-lifecycle/commands"
	);
	const { parseInstant } = await import("@/lib/datetime/temporal-core");
	const commands = createDepartureCommands({
		db: fixture.db,
		clock: { nowInstant: () => parseInstant(harness.now) },
		clockOut: { close: async () => ({ kind: "not_running" }) },
	});
	const owner = {
		organizationId: fixture.organizationId,
		userId: fixture.ownerUserId,
	};
	await fixture.pool.query(
		"update organization set timezone='Europe/Berlin' where id=$1",
		[fixture.organizationId],
	);
	const departure = await commands.scheduleDeparture(owner, {
		employeeId: fixture.employeeId,
		requestId: crypto.randomUUID(),
		expectedRevision: null,
		lastWorkingDay: "2026-02-05",
		replacementEmployeeId: null,
		acknowledgeUnassignedDuties: true,
	});
	harness.now = "2026-02-05T23:00:00Z";
	expect((await adminRetention()).reports).toMatchObject([
		{
			reportId: oldReportId,
			retentionStartedAt: "2026-02-05T23:00:00.000Z",
			deleteAfter: "2026-03-05T23:00:00.000Z",
		},
	]);
	await commands.executeDeparture({
		organizationId: fixture.organizationId,
		employeeId: fixture.employeeId,
		employmentPeriodId: fixture.employmentPeriodId,
		departureId: departure.departureId,
		revision: departure.revision,
	});
	const workPolicy = await fixture.pool.query(
		"insert into work_policy (organization_id,name,created_by,updated_at) values ($1,'Returning',$2,now()) returning id",
		[fixture.organizationId, fixture.ownerUserId],
	);
	harness.now = "2026-02-07T12:00:00Z";
	await commands.rehireEmployee(owner, {
		employeeId: fixture.employeeId,
		requestId: crypto.randomUUID(),
		previousEmploymentPeriodId: fixture.employmentPeriodId,
		role: "employee",
		teamId: null,
		primaryManagerId: fixture.ownerEmployeeId,
		workPolicyId: workPolicy.rows[0].id,
		weeklyContractMinutes: 2400,
		contractType: "fixed",
		workModel: "onsite",
		hourlyRate: null,
		currency: "EUR",
		probationStartsOn: null,
		probationEndsOn: null,
		changeReason: "Returning",
	});
	harness.userId = verifier.userId;
	const freshCheckId = await checkAgain();
	harness.userId = fixture.ownerUserId;
	expect(
		(
			await retention.placeDrivingLicenceHoldAction({
				checkId: freshCheckId,
				caseReference: "CASE-new-period",
				preservationReason:
					"Preserve this new employment period check for its own case.",
			})
		).success,
	).toBe(true);
	harness.now = "2026-02-08T12:00:00Z";
	const currentReportId = await reportOwnImpediment();
	harness.now = "2026-03-06T12:00:00Z";
	const { CRON_JOBS } = await import("@/lib/cron/registry");
	await CRON_JOBS["cron:driving-licence-retention"].processor();
	const rows = (await adminRetention()).reports;
	expect(rows.map((r) => r.reportId)).toEqual([currentReportId]);
	harness.userId = verifier.userId;
	expect((await causes()).reports).toMatchObject([{ id: currentReportId }]);
	expect((await ownHistory()).authorization.authorizedClasses).toEqual([]);
	expect((await ownHistory()).events.some((e) => e.id === oldReportId)).toBe(
		false,
	);
	const foreign = await createLifecycleDatabaseFixture();
	try {
		harness.organizationId = foreign.organizationId;
		harness.userId = foreign.ownerUserId;
		expect(await retention.getDrivingLicenceRetentionAction()).toMatchObject({
			success: true,
			data: { reports: [] },
		});
		expect(
			(
				await history.getDrivingLicenceHistoryAction({
					employeeId: fixture.employeeId,
				})
			).success,
		).toBe(false);
		expect(
			(await retention.cleanupDrivingLicenceEvidenceAction()).success,
		).toBe(true);
	} finally {
		await foreign.close();
		harness.organizationId = fixture.organizationId;
		harness.userId = verifier.userId;
	}
	await CRON_JOBS["cron:driving-licence-retention"].processor();
	expect((await causes()).reports).toMatchObject([{ id: currentReportId }]);
});

it("starts unversioned legacy report retention at its first subsequent explicit departure cutoff", async () => {
	const legacy = await fixture.seedEmployee({ withPeriod: false });
	harness.userId = fixture.ownerUserId;
	expect(
		(
			await saveConfirmedIntendedDriverAssignment({
				target: { type: "employee", employeeId: legacy.employeeId },
				value: "required",
			})
		).success,
	).toBe(true);
	harness.userId = legacy.userId;
	harness.now = "2026-02-01T12:00:00Z";
	const report = await reinstatement.reportDrivingImpedimentAction({
		commandId: crypto.randomUUID(),
	});
	if (!report.success) throw new Error(report.error);
	const { createDepartureCommands } = await import(
		"@/lib/employee-lifecycle/commands"
	);
	const { parseInstant } = await import("@/lib/datetime/temporal-core");
	const commands = createDepartureCommands({
		db: fixture.db,
		clock: { nowInstant: () => parseInstant(harness.now) },
		clockOut: { close: async () => ({ kind: "not_running" }) },
	});
	await fixture.pool.query(
		"update organization set timezone='Europe/Berlin' where id=$1",
		[fixture.organizationId],
	);
	await commands.scheduleDeparture(
		{ organizationId: fixture.organizationId, userId: fixture.ownerUserId },
		{
			employeeId: legacy.employeeId,
			requestId: crypto.randomUUID(),
			expectedRevision: null,
			lastWorkingDay: "2026-02-05",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		},
	);
	harness.now = "2026-02-05T23:00:00Z";
	expect((await adminRetention()).reports).toMatchObject([
		{
			reportId: report.data.reportId,
			protected: false,
			retentionStartedAt: "2026-02-05T23:00:00.000Z",
		},
	]);
	harness.now = "2026-03-05T23:00:00Z";
	await jobs.runDrivingLicenceRetentionJob();
	expect((await adminRetention()).reports).toEqual([]);
	harness.userId = verifier.userId;
	const evidence = await history.getDrivingLicenceHistoryAction({
		employeeId: legacy.employeeId,
	});
	expect(
		evidence.success &&
			evidence.data.events.some((e) => e.id === report.data.reportId),
	).toBe(false);
});
