import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drivingLicenceDeclaredClasses } from "@/db/schema/driving-licence-declared-classes";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import {
	activateDrivingLicenceControl,
	removeConfirmedIntendedDriverAssignment,
	saveConfirmedIntendedDriverAssignment,
} from "./testing/control.test.fixture";

const harness = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	now: "2026-01-31T11:00:00Z",
}));
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
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
	const actual = await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: Object.freeze({
			nowInstant: () => actual.parseInstant(harness.now),
		}),
	};
});
const declared = await import("./declared-classes-actions");
const checks = await import("./check-actions");
const grants = await import("./verifier-actions");
const { getUserNotifications } = await import("@/lib/notifications/notification-service");
const { drivingLicenceCollector } =
	await import("@/lib/personal-data-export/collectors/driving-licence");

let fixture: LifecycleDatabaseFixture;
let verifier: SeededEmployee;
let driverUserId: string;
let assignmentId: string;

function signIn(userId: string) {
	harness.userId = userId;
}
async function storedStatement() {
	const [row] = await fixture.db
		.select()
		.from(drivingLicenceDeclaredClasses)
		.where(
			and(
				eq(drivingLicenceDeclaredClasses.organizationId, fixture.organizationId),
				eq(drivingLicenceDeclaredClasses.employeeId, fixture.employeeId),
			),
		);
	return row ?? null;
}
async function ownRecord() {
	signIn(driverUserId);
	const record = await checks.getDrivingLicenceEmployeeRecordAction({
		employeeId: fixture.employeeId,
	});
	if (!record.success) throw new Error(record.error);
	return record.data;
}
function check(classes: { code: string; result: string; expiryDate: string | null }[]) {
	return {
		employeeId: fixture.employeeId,
		commandId: crypto.randomUUID(),
		originalInspected: true,
		identityConfirmed: true,
		employeeDeclaration: true,
		verifierConfirmed: true,
		documentIssuedOn: "2020-05-01",
		documentExpiresOn: "2035-05-01",
		classes: classes.map((entry) => ({ ...entry, restrictions: "" })),
	};
}

beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	verifier = await fixture.seedEmployee();
	harness.organizationId = fixture.organizationId;
	harness.now = "2026-01-31T11:00:00Z";
	const subject = await fixture.db.query.employee.findFirst({
		where: (employee, { eq }) => eq(employee.id, fixture.employeeId),
	});
	if (!subject) throw new Error("Missing subject");
	driverUserId = subject.userId;
	signIn(fixture.ownerUserId);
	expect(
		(
			await activateDrivingLicenceControl({
				intervalMonths: 12,
				timezone: "Europe/Berlin",
				retentionMonths: 36,
				retentionJustification: "Evidence retained for organization driving checks",
			})
		).success,
	).toBe(true);
	const assignment = await saveConfirmedIntendedDriverAssignment({
		target: { type: "employee", employeeId: fixture.employeeId },
		value: "required",
	});
	if (!assignment.success) throw new Error("Assignment refused");
	assignmentId = assignment.data.assignmentId;
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
});
afterEach(async () => {
	await fixture?.close();
});

describe("declared licence classes (#2003)", () => {
	it("lets an intended driver declare classes that grant nothing and asks their verifier to check them", async () => {
		signIn(driverUserId);
		const saved = await declared.saveDeclaredLicenceClassesAction({
			classes: [
				{ code: "C", expiryDate: "2029-03-31" },
				{ code: "B", expiryDate: null },
			],
			documentExpiresOn: "2033-06-30",
		});
		expect(saved).toEqual({ success: true, data: { declared: 2 } });

		const record = await ownRecord();
		expect(record.status).toBe("not_yet_checked");
		expect(record.authorizedClasses).toEqual([]);
		expect(record.declaredUnchecked).toEqual(["B", "C"]);
		expect(record.declared).toMatchObject({
			classes: [
				{ code: "B", expiryDate: null },
				{ code: "C", expiryDate: "2029-03-31" },
			],
			documentExpiresOn: "2033-06-30",
		});

		const inbox = (await getUserNotifications(verifier.userId, fixture.organizationId))
			.notifications;
		const notice = inbox.find((entry) => entry.entityType === "driving_licence_declared_classes");
		expect(notice).toMatchObject({
			actionUrl: `/team/driving-licence/${fixture.employeeId}`,
		});
		expect(notice?.message).toContain("B, C");

		signIn(verifier.userId);
		const worklist = await checks.getDrivingLicenceCheckWorklistAction();
		if (!worklist.success) throw new Error(worklist.error);
		expect(worklist.data.find((row) => row.employeeId === fixture.employeeId)).toMatchObject({
			declaredUnchecked: ["B", "C"],
		});

		// The employee's personal data export includes their statement.
		const exported = await drivingLicenceCollector.collect(fixture.db, {
			organizationId: fixture.organizationId,
			employeeId: fixture.employeeId,
			userId: driverUserId,
			kind: "employee",
		});
		const part = exported.parts.find((candidate) => candidate.key === "declared_classes");
		expect(part?.kind === "table" ? part.rows : null).toEqual([
			{
				declared_class_code: "B",
				declared_class_expiry_date: null,
				declared_document_expires_on: "2033-06-30",
				declared_at: "2026-01-31T11:00:00Z",
			},
			{
				declared_class_code: "C",
				declared_class_expiry_date: "2029-03-31",
				declared_document_expires_on: "2033-06-30",
				declared_at: "2026-01-31T11:00:00Z",
			},
		]);
	});

	it("replaces the declared classes a check inspects and keeps the others", async () => {
		signIn(driverUserId);
		await declared.saveDeclaredLicenceClassesAction({
			classes: [
				{ code: "B", expiryDate: null },
				{ code: "CE", expiryDate: "2029-03-31" },
			],
			documentExpiresOn: null,
		});
		signIn(verifier.userId);
		expect(
			(
				await checks.completeDrivingLicenceCheckAction(
					check([{ code: "B", result: "successful", expiryDate: null }]),
				)
			).success,
		).toBe(true);

		let record = await ownRecord();
		expect(record.authorizedClasses).toEqual(["B"]);
		expect(record.declared?.classes).toEqual([{ code: "CE", expiryDate: "2029-03-31" }]);
		expect(record.declaredUnchecked).toEqual(["CE"]);

		signIn(verifier.userId);
		expect(
			(
				await checks.completeDrivingLicenceCheckAction(
					check([{ code: "CE", result: "unsuccessful", expiryDate: "2029-03-31" }]),
				)
			).success,
		).toBe(true);
		record = await ownRecord();
		expect(record.declared).toBeNull();
		expect(await storedStatement()).toBeNull();
	});

	it("leaves out classes that are already authorized and notifies only for newly declared ones", async () => {
		signIn(verifier.userId);
		await checks.completeDrivingLicenceCheckAction(
			check([{ code: "B", result: "successful", expiryDate: null }]),
		);
		signIn(driverUserId);
		expect(
			await declared.saveDeclaredLicenceClassesAction({
				classes: [{ code: "B", expiryDate: null }],
				documentExpiresOn: null,
			}),
		).toEqual({ success: true, data: { declared: 0 } });
		expect(await storedStatement()).toBeNull();

		await declared.saveDeclaredLicenceClassesAction({
			classes: [{ code: "C", expiryDate: null }],
			documentExpiresOn: null,
		});
		await declared.saveDeclaredLicenceClassesAction({
			classes: [{ code: "C", expiryDate: "2030-01-31" }],
			documentExpiresOn: null,
		});
		const notices = (
			await getUserNotifications(verifier.userId, fixture.organizationId)
		).notifications.filter((entry) => entry.entityType === "driving_licence_declared_classes");
		expect(notices).toHaveLength(1);
		expect((await storedStatement())?.version).toBe(2);
	});

	it("refuses employees who are not intended drivers and invalid statements", async () => {
		signIn(verifier.userId);
		expect(
			await declared.saveDeclaredLicenceClassesAction({
				classes: [{ code: "B", expiryDate: null }],
				documentExpiresOn: null,
			}),
		).toEqual({ success: false, error: "not_intended_driver" });

		signIn(driverUserId);
		for (const invalid of [
			{ classes: [], documentExpiresOn: null },
			{ classes: [{ code: "B", expiryDate: "2030-01-01" }], documentExpiresOn: null },
			{
				classes: [
					{ code: "B", expiryDate: null },
					{ code: "B", expiryDate: null },
				],
				documentExpiresOn: null,
			},
			{ classes: [{ code: "X", expiryDate: null }], documentExpiresOn: null },
			{ classes: [{ code: "B", expiryDate: null }], documentExpiresOn: "2030-02-30" },
		])
			expect(await declared.saveDeclaredLicenceClassesAction(invalid)).toEqual({
				success: false,
				error: "invalid",
			});
		expect(await storedStatement()).toBeNull();
	});

	it("removes the statement once the employee is no longer an intended driver, and on withdrawal", async () => {
		signIn(driverUserId);
		await declared.saveDeclaredLicenceClassesAction({
			classes: [{ code: "B", expiryDate: null }],
			documentExpiresOn: null,
		});
		expect(await declared.withdrawDeclaredLicenceClassesAction()).toEqual({
			success: true,
			data: { declared: 0 },
		});
		expect(await storedStatement()).toBeNull();

		await declared.saveDeclaredLicenceClassesAction({
			classes: [{ code: "B", expiryDate: null }],
			documentExpiresOn: null,
		});
		expect(await storedStatement()).not.toBeNull();
		signIn(fixture.ownerUserId);
		expect((await removeConfirmedIntendedDriverAssignment({ assignmentId })).success).toBe(true);
		expect(await storedStatement()).toBeNull();
	});
});
