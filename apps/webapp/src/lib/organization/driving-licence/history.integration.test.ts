import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

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
const intendedDrivers = await import("./intended-driver-actions");
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
			await policy.saveDrivingLicencePolicyAction({
				enabled: true,
				intervalMonths: 1,
				timezone: "Europe/Berlin",
				reminderLeadDays: [30, 7],
				retentionMonths: 36,
				retentionJustification:
					"Necessary evidence for organization driving checks",
			})
		).success,
	).toBe(true);
	expect(
		(
			await intendedDrivers.setDrivingLicenceIntendedDriverAssignmentAction({
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
it("appends a dated attributed correction while preserving original confirmation and authorization anchors", async () => {
	const original = await read();
	harness.now = "2026-02-02T10:00:00Z";
	const command = supplement();
	const saved = await history.supplementDrivingLicenceCheckAction(command);
	expect(saved.success).toBe(true);
	expect(await history.supplementDrivingLicenceCheckAction(command)).toEqual(
		saved,
	);
	const after = await read();
	expect(after.checks).toEqual(original.checks);
	expect(after.checks[0].verifierConfirmed).toBe(true);
	expect(after.supplements).toHaveLength(1);
	expect(after.supplements[0]).toMatchObject({
		checkId,
		recordedAt: "2026-02-02T10:00:00.000Z",
		authorUserId: verifier.userId,
		authorEmployeeId: verifier.employeeId,
		correction: { field: "documentIssuedOn", value: "2020-05-02" },
	});
	expect(after.authorization).toEqual(original.authorization);
	expect(after.events).toEqual(original.events);
});
it("shows an overdue decision at its effective instant even before a worker runs and retains the original context outside the period", async () => {
	harness.now = "2026-03-02T12:00:00Z";
	const result = await read({
		from: "2026-02-28T23:00:00Z",
		to: "2026-03-01T23:00:00Z",
	});
	expect(result.authorization.authorizedClasses).toEqual([]);
	expect(result.events).toContainEqual(
		expect.objectContaining({
			kind: "suspended",
			reason: "check_overdue",
			effectiveAt: "2026-02-28T23:00:00.000Z",
			inPeriod: true,
		}),
	);
	expect(result.checks).toContainEqual(
		expect.objectContaining({
			id: checkId,
			inPeriod: false,
			intervalMonths: 1,
			deadlineTimezone: "Europe/Berlin",
			verifierConfirmed: true,
		}),
	);
	expect(result.events).toContainEqual(
		expect.objectContaining({ kind: "authorized", inPeriod: false, checkId }),
	);
	expect(
		(await read({ from: "2026-03-02T00:00:00Z" })).events.filter(
			(e) => e.inPeriod,
		),
	).toHaveLength(0);
});

it("suspends supported authorization on corrected negative evidence and never treats a positive supplement as reinstatement", async () => {
	harness.now = "2026-02-02T10:00:00Z";
	expect(
		(
			await history.supplementDrivingLicenceCheckAction({
				...supplement(),
				correction: { field: "documentExpiresOn", value: "2026-02-01" },
			})
		).success,
	).toBe(true);
	let result = await read();
	expect(result.authorization.authorizedClasses).toEqual([]);
	expect(
		(
			await reinstatement.reinstateDrivingAuthorizationAction({
				employeeId: fixture.employeeId,
				checkId,
				classCodes: ["B"],
				expectedReportIds: [],
				expectedSuspension: null,
				impedimentResolved: true,
			})
		).success,
	).toBe(false);
	expect(result.authorization.classes[0]).toMatchObject({
		reason: "evidence_corrected",
		supportingCheckId: checkId,
		lastSuccessfulAt: "2026-01-31T11:00:00.000Z",
	});
	expect(result.events).toContainEqual(
		expect.objectContaining({
			kind: "suspended",
			reason: "evidence_corrected",
			actorUserId: verifier.userId,
			checkId,
		}),
	);
	expect(
		(
			await history.supplementDrivingLicenceCheckAction({
				...supplement(),
				correction: { field: "documentExpiresOn", value: "2040-01-01" },
			})
		).success,
	).toBe(true);
	result = await read();
	expect(result.authorization.authorizedClasses).toEqual([]);
	expect(result.checks).toHaveLength(1);
	expect(result.checks[0]).toMatchObject({
		documentExpiresOn: "2035-05-01",
		verifierConfirmed: true,
	});
	expect(
		(
			await history.supplementDrivingLicenceCheckAction({
				...supplement(),
				reinstate: true,
			})
		).success,
	).toBe(false);
	expect(
		(
			await history.supplementDrivingLicenceCheckAction({
				...supplement(),
				correction: {
					field: "classResult",
					classCode: "C",
					value: "successful",
				},
			})
		).success,
	).toBe(false);
});
it("checks current scope for every history read and correction, while employees can read only their own history", async () => {
	const subject = await fixture.db.query.employee.findFirst({
		where: (e, { eq }) => eq(e.id, fixture.employeeId),
	});
	if (!subject) throw new Error("Missing subject");
	harness.userId = subject.userId;
	expect((await read()).canSupplement).toBe(false);
	expect(
		(await history.supplementDrivingLicenceCheckAction(supplement())).success,
	).toBe(false);
	harness.userId = fixture.ownerUserId;
	expect(
		(
			await history.getDrivingLicenceHistoryAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(false);
	expect(
		(await history.supplementDrivingLicenceCheckAction(supplement())).success,
	).toBe(false);
	const foreignOrg = await fixture.createOrganization();
	const foreign = await fixture.seedEmployee({ organizationId: foreignOrg });
	harness.userId = verifier.userId;
	expect(
		(
			await history.getDrivingLicenceHistoryAction({
				employeeId: foreign.employeeId,
			})
		).success,
	).toBe(false);
	expect(
		(
			await history.supplementDrivingLicenceCheckAction({
				...supplement(),
				employeeId: foreign.employeeId,
			})
		).success,
	).toBe(false);
	harness.userId = fixture.ownerUserId;
	expect(
		(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: verifier.employeeId,
				scope: "specific",
				teamIds: [],
				employeeIds: [fixture.ownerEmployeeId],
			})
		).success,
	).toBe(true);
	harness.userId = verifier.userId;
	expect(
		(
			await history.getDrivingLicenceHistoryAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(false);
	expect(
		(await history.supplementDrivingLicenceCheckAction(supplement())).success,
	).toBe(false);
});
it("retains original and prior supplements when a later correction is selected by period", async () => {
	harness.now = "2026-02-01T12:00:00Z";
	expect(
		(await history.supplementDrivingLicenceCheckAction(supplement())).success,
	).toBe(true);
	harness.now = "2026-02-10T12:00:00Z";
	expect(
		(
			await history.supplementDrivingLicenceCheckAction({
				...supplement(),
				correction: { field: "documentIssuedOn", value: "2020-05-03" },
			})
		).success,
	).toBe(true);
	const selected = await read({
		from: "2026-02-10T00:00:00Z",
		to: "2026-02-11T00:00:00Z",
	});
	expect(selected.checks[0]).toMatchObject({
		id: checkId,
		inPeriod: false,
		documentIssuedOn: "2020-05-01",
		intervalMonths: 1,
	});
	expect(selected.supplements.map((s) => s.inPeriod)).toEqual([false, true]);
	expect(
		(
			await history.getDrivingLicenceHistoryAction({
				employeeId: fixture.employeeId,
				from: "2026-02-12T00:00:00Z",
				to: "2026-02-11T00:00:00Z",
			})
		).success,
	).toBe(false);
	expect(
		(
			await history.supplementDrivingLicenceCheckAction({
				...supplement(),
				licenceNumber: "excluded",
			})
		).success,
	).toBe(false);
	expect(
		(
			await history.supplementDrivingLicenceCheckAction({
				...supplement(),
				correction: {
					field: "classRestrictions",
					classCode: "B",
					value: "x".repeat(301),
				},
			})
		).success,
	).toBe(false);
});
it.each([
	{ field: "classRestrictions", classCode: "B", value: "Corrective lenses" },
	{ field: "classResult", classCode: "B", value: "unsuccessful" },
	{ field: "classExpiry", classCode: "B", value: "2026-02-05" },
])(
	"suspends only current supported clearance for negative class correction $field",
	async (correction) => {
		expect(
			(
				await history.supplementDrivingLicenceCheckAction({
					...supplement(),
					correction,
				})
			).success,
		).toBe(true);
		expect((await read()).authorization.authorizedClasses).toEqual([]);
		expect((await read()).checks[0].classes[0]).toMatchObject({
			result: "successful",
			restrictions: "",
			expiryDate: null,
		});
	},
);
it("does not invalidate a new check by correcting an older superseded original, and rejects revoked responsibility", async () => {
	harness.now = "2026-02-01T12:00:00Z";
	const next = await checks.completeDrivingLicenceCheckAction({
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
	expect(next.success).toBe(true);
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
	expect((await read()).authorization.authorizedClasses).toEqual(["B"]);
	harness.userId = fixture.ownerUserId;
	const admin = await grants.getDrivingLicenceVerifierAdminDataAction();
	if (!admin.success) throw new Error(admin.error);
	expect(
		(
			await grants.revokeDrivingLicenceVerifierGrantAction({
				grantId: admin.data.grants[0].id,
			})
		).success,
	).toBe(true);
	harness.userId = verifier.userId;
	expect(
		(await history.supplementDrivingLicenceCheckAction(supplement())).success,
	).toBe(false);
	expect(
		(
			await history.getDrivingLicenceHistoryAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(false);
});
it("retains the original policy context after the organization changes settings", async () => {
	harness.userId = fixture.ownerUserId;
	expect(
		(
			await policy.saveDrivingLicencePolicyAction({
				enabled: true,
				intervalMonths: 1,
				timezone: "Europe/Berlin",
				reminderLeadDays: [14, 3],
				retentionMonths: 24,
				retentionJustification:
					"Updated documented retention for driving evidence",
			})
		).success,
	).toBe(true);
	harness.userId = verifier.userId;
	const result = await read();
	expect(result.checks[0]).toMatchObject({
		policyVersion: 1,
		intervalMonths: 1,
	});
	expect(result.policies).toContainEqual(
		expect.objectContaining({
			version: 1,
			intervalMonths: 1,
			timezone: "Europe/Berlin",
		}),
	);
	expect(result.policies[0]).not.toHaveProperty("retentionJustification");
});
