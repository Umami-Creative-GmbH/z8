import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
			await activateDrivingLicenceControl({
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
	signIn(verifier.userId);
});
afterEach(async () => {
	await fixture?.close();
});
describe("original driving licence checks through public actions", () => {
	it("records an attributable original check and grants only its explicitly successful classes", async () => {
		const result = await checks.completeDrivingLicenceCheckAction(original());
		expect(result.success).toBe(true);
		signIn(
			(
				await fixture.db.query.employee.findFirst({
					where: (employee, { eq }) => eq(employee.id, fixture.employeeId),
				})
			)?.userId ?? "missing-subject",
		);
		const record = await checks.getDrivingLicenceEmployeeRecordAction({
			employeeId: fixture.employeeId,
		});
		expect(record.success).toBe(true);
		if (!record.success) return;
		expect(record.data.authorizedClasses).toEqual(["B"]);
		expect(record.data.classes[0]).toMatchObject({
			code: "B",
			status: "active",
			validThrough: "2026-02-28",
			deadlineTimezone: "Europe/Berlin",
		});
		expect(record.data.checks[0]).toMatchObject({
			employeeDeclaration: true,
			originalInspected: true,
			identityConfirmed: true,
			verifierConfirmed: true,
			verifierEmployeeId: verifier.employeeId,
			controlledAt: "2026-01-31T11:00:00.000Z",
		});
		expect(record.data.checks[0].declarationText).toContain(
			"no known driving ban",
		);
	});
});
async function record() {
	const result = await checks.getDrivingLicenceEmployeeRecordAction({
		employeeId: fixture.employeeId,
	});
	expect(result.success).toBe(true);
	if (!result.success) throw new Error(result.error);
	return result.data;
}
it("renews only inspected classes and keeps B authorized when independently checked C expires", async () => {
	expect(
		(
			await checks.completeDrivingLicenceCheckAction(
				original([
					{
						code: "B",
						result: "successful",
						expiryDate: null,
						restrictions: "Corrective lenses",
					},
					{
						code: "C",
						result: "successful",
						expiryDate: "2026-02-05",
						restrictions: "",
					},
				]),
			)
		).success,
	).toBe(true);
	harness.now = "2026-02-06T00:00:00Z";
	expect((await record()).authorizedClasses).toEqual(["B"]);
	expect((await record()).classes.find((c) => c.code === "C")).toMatchObject({
		status: "suspended",
		reason: "class_expired",
	});
	harness.now = "2026-02-07T12:00:00Z";
	expect(
		(
			await checks.completeDrivingLicenceCheckAction(
				original([
					{
						code: "C",
						result: "successful",
						expiryDate: "2030-01-01",
						restrictions: "",
					},
				]),
			)
		).success,
	).toBe(true);
	const after = await record();
	expect(after.authorizedClasses).toEqual(["B"]);
	expect(after.classes.find((c) => c.code === "B")).toMatchObject({
		lastSuccessfulAt: "2026-01-31T11:00:00.000Z",
		validThrough: "2026-02-28",
		restrictions: "Corrective lenses",
	});
	expect(after.classes.find((c) => c.code === "C")?.status).toBe("suspended");
});
it("renews a current partial class without changing the uninspected class anchor", async () => {
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
	harness.now = "2026-02-15T12:00:00Z";
	expect(
		(
			await checks.completeDrivingLicenceCheckAction(
				original([
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
	expect((await record()).classes).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ code: "B", validThrough: "2026-02-28" }),
			expect.objectContaining({ code: "C", validThrough: "2026-03-15" }),
		]),
	);
	harness.now = "2026-02-28T23:00:00Z";
	expect((await record()).authorizedClasses).toEqual(["C"]);
});
it.each([
	[
		"2028-01-31T11:00:00Z",
		"2035-01-01",
		null,
		"2028-02-29",
		"2028-02-29T23:00:00Z",
	],
	[
		"2026-03-01T11:00:00Z",
		"2035-01-01",
		"2026-03-29",
		"2026-03-29",
		"2026-03-29T22:00:00Z",
	],
	[
		"2026-10-01T11:00:00Z",
		"2035-01-01",
		"2026-10-25",
		"2026-10-25",
		"2026-10-25T23:00:00Z",
	],
])(
	"includes the entire local limit day across leap/month-end/DST at %s",
	async (at, documentExpiry, classExpiry, validThrough, cutoff) => {
		harness.now = at;
		expect(
			(
				await checks.completeDrivingLicenceCheckAction({
					...original([
						{
							code: "B",
							result: "successful",
							expiryDate: classExpiry,
							restrictions: "",
						},
					]),
					documentExpiresOn: documentExpiry,
				})
			).success,
		).toBe(true);
		const { parseInstant } = await import("@/lib/datetime/temporal-core");
		harness.now = parseInstant(cutoff).subtract({ milliseconds: 1 }).toString();
		expect((await record()).classes[0]).toMatchObject({
			status: "active",
			validThrough,
			deadlineTimezone: "Europe/Berlin",
		});
		harness.now = cutoff;
		expect((await record()).classes[0]).toMatchObject({ status: "suspended" });
	},
);
it("applies document expiry to every class independently of worker timing", async () => {
	expect(
		(
			await checks.completeDrivingLicenceCheckAction({
				...original([
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
				documentExpiresOn: "2026-02-03",
			})
		).success,
	).toBe(true);
	harness.now = "2026-02-03T23:00:00Z";
	expect((await record()).authorizedClasses).toEqual([]);
	expect((await record()).classes.map((c) => c.reason)).toEqual([
		"document_expired",
		"document_expired",
	]);
});
it.each(["unsuccessful", "inconclusive"])(
	"suspends an %s class immediately and never silently reinstates it",
	async (result) => {
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
		harness.now = "2026-02-01T12:00:00Z";
		expect(
			(
				await checks.completeDrivingLicenceCheckAction(
					original([{ code: "C", result, expiryDate: null, restrictions: "" }]),
				)
			).success,
		).toBe(true);
		expect((await record()).authorizedClasses).toEqual(["B"]);
		expect(
			(
				await checks.completeDrivingLicenceCheckAction(
					original([
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
		expect((await record()).authorizedClasses).toEqual(["B"]);
		const evidence = await record();
		expect(evidence.checks).toHaveLength(3);
		expect(
			evidence.checks
				.find((check) => check.controlledAt === "2026-01-31T11:00:00.000Z")
				?.classes.map((c) => c.result),
		).toEqual(["successful", "successful"]);
	},
);
it("keeps a person-wide failed declaration in effect when a new class is successfully checked", async () => {
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
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
				employeeDeclaration: false,
			})
		).success,
	).toBe(true);
	expect(
		(
			await checks.completeDrivingLicenceCheckAction(
				original([
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
	expect((await record()).authorizedClasses).toEqual([]);
	expect(
		(await record()).events.some((event) => event.kind === "global_suspension"),
	).toBe(true);
});
it("keeps an elapsed deadline suspended after policy extension and a successful recheck", async () => {
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	harness.now = "2026-03-01T00:00:00Z";
	signIn(fixture.ownerUserId);
	const intervals = await import("./interval-actions");
	const preview = await intervals.previewDrivingLicenceIntervalAction({
		intervalMonths: 12,
	});
	if (!preview.success) throw new Error(preview.error);
	expect(
		(
			await intervals.applyDrivingLicenceIntervalAction({
				intervalMonths: 12,
				previewToken: preview.data.previewToken,
			})
		).success,
	).toBe(true);
	signIn(verifier.userId);
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	const evidence = await record();
	expect(evidence.authorizedClasses).toEqual([]);
	expect(evidence.classes[0]).toMatchObject({
		status: "suspended",
		reason: "check_overdue",
	});
	expect(
		evidence.checks.find(
			(check) => check.controlledAt === "2026-01-31T11:00:00.000Z",
		)?.intervalMonths,
	).toBe(1);
});
it("deduplicates a repeated command without creating a newer successful-check anchor", async () => {
	const command = original();
	const first = await checks.completeDrivingLicenceCheckAction(command);
	harness.now = "2026-02-10T12:00:00Z";
	expect(await checks.completeDrivingLicenceCheckAction(command)).toEqual(
		first,
	);
	const evidence = await record();
	expect(evidence.checks).toHaveLength(1);
	expect(evidence.classes[0].lastSuccessfulAt).toBe("2026-01-31T11:00:00.000Z");
});
it("rejects self checks, ungranted administrators, foreign references and revoked responsibility", async () => {
	const self = await fixture.db.query.employee.findFirst({
		where: (row, { eq }) => eq(row.id, fixture.employeeId),
	});
	if (!self) throw new Error("Missing subject");
	signIn(self.userId);
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(false);
	signIn(fixture.ownerUserId);
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(false);
	expect(
		(
			await checks.getDrivingLicenceEmployeeRecordAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(false);
	const adminData = await grants.getDrivingLicenceVerifierAdminDataAction();
	if (!adminData.success) throw new Error(adminData.error);
	const grant = adminData.data.grants[0];
	const foreignOrg = await fixture.createOrganization();
	const foreign = await fixture.seedEmployee({ organizationId: foreignOrg });
	signIn(verifier.userId);
	expect(
		(
			await checks.completeDrivingLicenceCheckAction({
				...original(),
				employeeId: foreign.employeeId,
			})
		).success,
	).toBe(false);
	expect(
		(
			await checks.getDrivingLicenceEmployeeRecordAction({
				employeeId: foreign.employeeId,
			})
		).success,
	).toBe(false);
	expect(await checks.getDrivingLicenceCheckWorklistAction()).toMatchObject({
		success: true,
		data: [expect.objectContaining({ employeeId: fixture.employeeId })],
	});
	signIn(fixture.ownerUserId);
	expect(
		(
			await grants.revokeDrivingLicenceVerifierGrantAction({
				grantId: grant.id,
			})
		).success,
	).toBe(true);
	signIn(verifier.userId);
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(false);
	expect(
		(
			await checks.getDrivingLicenceEmployeeRecordAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(false);
});
it("refuses prohibited extra personal fields and inconsistent successful confirmation", async () => {
	expect(
		(
			await checks.completeDrivingLicenceCheckAction({
				...original(),
				licenceNumber: "excluded",
			})
		).success,
	).toBe(false);
	expect(
		(
			await checks.completeDrivingLicenceCheckAction({
				...original(),
				identityConfirmed: false,
			})
		).success,
	).toBe(false);
	expect(
		(
			await checks.completeDrivingLicenceCheckAction({
				...original(),
				employeeDeclaration: false,
			})
		).success,
	).toBe(false);
	expect((await record()).status).toBe("not_yet_checked");
});
it("refuses a granted verifier's self-check and a target removed from their current scope", async () => {
	signIn(fixture.ownerUserId);
	expect(
		(
			await saveConfirmedIntendedDriverAssignment({
				target: { type: "employee", employeeId: verifier.employeeId },
				value: "required",
			})
		).success,
	).toBe(true);
	signIn(verifier.userId);
	expect(
		(
			await checks.completeDrivingLicenceCheckAction({
				...original(),
				employeeId: verifier.employeeId,
			})
		).success,
	).toBe(false);
	signIn(fixture.ownerUserId);
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
	signIn(verifier.userId);
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(false);
	expect(
		(
			await checks.getDrivingLicenceEmployeeRecordAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(false);
	expect(await checks.getDrivingLicenceCheckWorklistAction()).toEqual({
		success: true,
		data: [],
	});
});
