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
const impediments = await import("./impediment-actions");
const policy = await import("./policy-actions");
const intendedDrivers = await import("./intended-driver-actions");
const grants = await import("./verifier-actions");
let fixture: LifecycleDatabaseFixture;
let verifier: SeededEmployee;
function signIn(userId: string) {
	harness.userId = userId;
}
function original(
	classes = [
		{ code: "B", result: "successful", expiryDate: null, restrictions: "" },
	],
) {
	return {
		employeeId: fixture.employeeId,
		commandId: crypto.randomUUID(),
		originalInspected: true,
		identityConfirmed: true,
		employeeDeclaration: true,
		verifierConfirmed: true,
		documentIssuedOn: "2020-05-01",
		documentExpiresOn: "2035-05-01",
		classes,
	};
}
beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	verifier = await fixture.seedEmployee();
	harness.organizationId = fixture.organizationId;
	harness.now = "2026-01-31T11:00:00Z";
	signIn(fixture.ownerUserId);
	expect(
		(
			await policy.saveDrivingLicencePolicyAction({
				enabled: true,
				intervalMonths: 1,
				timezone: "Europe/Berlin",
				reminderLeadDays: [30, 7],
				retentionMonths: 36,
				retentionJustification:
					"Evidence retained for organization driving checks",
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
	signIn(verifier.userId);
});
afterEach(async () => {
	await fixture?.close();
});
async function self() {
	const employee = await fixture.db.query.employee.findFirst({
		where: (row, { eq }) => eq(row.id, fixture.employeeId),
	});
	if (!employee) throw new Error("Missing employee");
	signIn(employee.userId);
}
async function record() {
	const result = await checks.getDrivingLicenceEmployeeRecordAction({
		employeeId: fixture.employeeId,
	});
	if (!result.success) throw new Error(result.error);
	return result.data;
}
it("immediately suspends a recent clearance without collecting private reasons and survives elapsed time", async () => {
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	await self();
	harness.now = "2026-02-01T12:00:00Z";
	const command = { commandId: crypto.randomUUID() };
	const report = await impediments.reportDrivingImpedimentAction(command);
	expect(report.success).toBe(true);
	expect(await impediments.reportDrivingImpedimentAction(command)).toEqual(
		report,
	);
	expect(await record()).toMatchObject({
		status: "suspended",
		authorizedClasses: [],
	});
	expect((await record()).events).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				kind: "impediment_reported",
				reason: "person_impediment",
			}),
		]),
	);
	harness.now = "2026-06-01T12:00:00Z";
	expect((await record()).status).toBe("suspended");
	expect(
		(
			await impediments.reportDrivingImpedimentAction({
				...command,
				reason: "private",
			})
		).success,
	).toBe(false);
});
async function state() {
	const result = await impediments.getDrivingImpedimentStateAction({
		employeeId: fixture.employeeId,
	});
	if (!result.success) throw new Error(result.error);
	return result.data;
}
it("requires explicit resolution and a new original before reinstating only freshly successful classes", async () => {
	expect(
		(
			await checks.completeDrivingLicenceCheckAction(
				original([
					{
						code: "B",
						result: "successful",
						expiryDate: null,
						restrictions: "",
					},
					{
						code: "C",
						result: "successful",
						expiryDate: null,
						restrictions: "",
					},
				]),
			)
		).success,
	).toBe(true);
	await self();
	harness.now = "2026-02-01T12:00:00Z";
	expect(
		(
			await impediments.reportDrivingImpedimentAction({
				commandId: crypto.randomUUID(),
			})
		).success,
	).toBe(true);
	signIn(verifier.userId);
	harness.now = "2026-02-02T12:00:00Z";
	expect(
		(
			await checks.completeDrivingLicenceCheckAction({
				...original([
					{
						code: "B",
						result: "inconclusive",
						expiryDate: null,
						restrictions: "",
					},
				]),
				originalInspected: false,
				failureScope: "document",
			})
		).success,
	).toBe(true);
	harness.now = "2026-02-03T12:00:00Z";
	const fresh = await checks.completeDrivingLicenceCheckAction(original());
	if (!fresh.success) throw new Error(fresh.error);
	expect((await record()).authorizedClasses).toEqual([]);
	const snapshot = await state();
	expect(snapshot.reports).toHaveLength(1);
	const command = {
		employeeId: fixture.employeeId,
		checkId: fresh.data.checkId,
		classCodes: ["B"],
		expectedReportIds: snapshot.reports.map((r) => r.id),
		expectedSuspension: snapshot.suspension,
		impedimentResolved: true,
	};
	expect(
		(
			await impediments.reinstateDrivingAuthorizationAction({
				...command,
				impedimentResolved: false,
			})
		).success,
	).toBe(false);
	expect(
		(
			await impediments.reinstateDrivingAuthorizationAction({
				...command,
				expectedReportIds: [],
			})
		).success,
	).toBe(false);
	expect(
		(await impediments.reinstateDrivingAuthorizationAction(command)).success,
	).toBe(true);
	expect((await record()).authorizedClasses).toEqual(["B"]);
	expect((await record()).classes.find((c) => c.code === "C")?.status).toBe(
		"suspended",
	);
	expect((await state()).reports).toHaveLength(0);
	expect((await record()).events).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ kind: "impediment_resolved" }),
			expect.objectContaining({ kind: "reinstated", classCode: "B" }),
		]),
	);
});
it("refuses pre-report checks, foreign and ungranted actors, self reinstatement and stale replay", async () => {
	const initial = await checks.completeDrivingLicenceCheckAction(original());
	if (!initial.success) throw new Error(initial.error);
	await self();
	harness.now = "2026-02-01T12:00:00Z";
	expect(
		(
			await impediments.reportDrivingImpedimentAction({
				commandId: crypto.randomUUID(),
				employeeId: verifier.employeeId,
			})
		).success,
	).toBe(false);
	expect(
		(
			await impediments.reportDrivingImpedimentAction({
				commandId: crypto.randomUUID(),
			})
		).success,
	).toBe(true);
	const snapshot = await state();
	const command = {
		employeeId: fixture.employeeId,
		checkId: initial.data.checkId,
		classCodes: ["B"],
		expectedReportIds: snapshot.reports.map((r) => r.id),
		expectedSuspension: snapshot.suspension,
		impedimentResolved: true,
	};
	expect(
		(await impediments.reinstateDrivingAuthorizationAction(command)).success,
	).toBe(false);
	signIn(fixture.ownerUserId);
	expect(
		(await impediments.reinstateDrivingAuthorizationAction(command)).success,
	).toBe(false);
	expect(
		(
			await impediments.getDrivingImpedimentStateAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(false);
	signIn(verifier.userId);
	expect(
		(await impediments.reinstateDrivingAuthorizationAction(command)).success,
	).toBe(false);
	const foreignOrg = await fixture.createOrganization();
	const foreign = await fixture.seedEmployee({ organizationId: foreignOrg });
	expect(
		(
			await impediments.reinstateDrivingAuthorizationAction({
				...command,
				employeeId: foreign.employeeId,
			})
		).success,
	).toBe(false);
	harness.now = "2026-02-02T12:00:00Z";
	const fresh = await checks.completeDrivingLicenceCheckAction(original());
	if (!fresh.success) throw new Error(fresh.error);
	const ready = { ...command, checkId: fresh.data.checkId };
	expect(
		(await impediments.reinstateDrivingAuthorizationAction(ready)).success,
	).toBe(true);
	await self();
	harness.now = "2026-02-03T12:00:00Z";
	expect(
		(
			await impediments.reportDrivingImpedimentAction({
				commandId: crypto.randomUUID(),
			})
		).success,
	).toBe(true);
	signIn(verifier.userId);
	expect(
		(await impediments.reinstateDrivingAuthorizationAction(ready)).success,
	).toBe(false);
	expect((await record()).authorizedClasses).toEqual([]);
});
it("serializes a newer report against a previously prepared reinstatement", async () => {
	await checks.completeDrivingLicenceCheckAction(original());
	await self();
	harness.now = "2026-02-01T12:00:00Z";
	await impediments.reportDrivingImpedimentAction({
		commandId: crypto.randomUUID(),
	});
	signIn(verifier.userId);
	harness.now = "2026-02-02T12:00:00Z";
	const fresh = await checks.completeDrivingLicenceCheckAction(original());
	if (!fresh.success) throw new Error(fresh.error);
	const snapshot = await state();
	harness.now = "2026-02-03T12:00:00Z";
	const reinstate = impediments.reinstateDrivingAuthorizationAction({
		employeeId: fixture.employeeId,
		checkId: fresh.data.checkId,
		classCodes: ["B"],
		expectedReportIds: snapshot.reports.map((r) => r.id),
		expectedSuspension: snapshot.suspension,
		impedimentResolved: true,
	});
	await self();
	const report = impediments.reportDrivingImpedimentAction({
		commandId: crypto.randomUUID(),
	});
	const results = await Promise.all([reinstate, report]);
	expect(results[1].success).toBe(true);
	expect((await record()).authorizedClasses).toEqual([]);
	expect((await state()).reports.length).toBeGreaterThan(0);
});
it("shows a person suspension before the first class check and never authorizes a new class automatically", async () => {
	await self();
	harness.now = "2026-02-01T12:00:00Z";
	expect(
		(
			await impediments.reportDrivingImpedimentAction({
				commandId: crypto.randomUUID(),
			})
		).success,
	).toBe(true);
	expect((await record()).status).toBe("suspended");
	signIn(verifier.userId);
	harness.now = "2026-02-02T12:00:00Z";
	await checks.completeDrivingLicenceCheckAction(original());
	expect((await record()).authorizedClasses).toEqual([]);
});
it("rechecks current verifier scope and refuses expired or later-failed supporting evidence", async () => {
	await checks.completeDrivingLicenceCheckAction(original());
	await self();
	harness.now = "2026-02-01T12:00:00Z";
	await impediments.reportDrivingImpedimentAction({
		commandId: crypto.randomUUID(),
	});
	signIn(verifier.userId);
	harness.now = "2026-02-02T12:00:00Z";
	const fresh = await checks.completeDrivingLicenceCheckAction(original());
	if (!fresh.success) throw new Error(fresh.error);
	const snapshot = await state();
	const command = {
		employeeId: fixture.employeeId,
		checkId: fresh.data.checkId,
		classCodes: ["B"],
		expectedReportIds: snapshot.reports.map((r) => r.id),
		expectedSuspension: snapshot.suspension,
		impedimentResolved: true,
	};
	harness.now = "2026-03-03T12:00:00Z";
	expect(
		(await impediments.reinstateDrivingAuthorizationAction(command)).success,
	).toBe(false);
	harness.now = "2026-02-03T12:00:00Z";
	await checks.completeDrivingLicenceCheckAction(
		original([
			{ code: "B", result: "unsuccessful", expiryDate: null, restrictions: "" },
		]),
	);
	expect(
		(await impediments.reinstateDrivingAuthorizationAction(command)).success,
	).toBe(false);
	signIn(fixture.ownerUserId);
	await grants.saveDrivingLicenceVerifierGrantAction({
		verifierEmployeeId: verifier.employeeId,
		scope: "specific",
		teamIds: [],
		employeeIds: [fixture.ownerEmployeeId],
	});
	signIn(verifier.userId);
	expect(
		(await impediments.reinstateDrivingAuthorizationAction(command)).success,
	).toBe(false);
});
