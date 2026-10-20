import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { saveConfirmedIntendedDriverAssignment } from "./testing/control.test.fixture";

const session = vi.hoisted(() => ({
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
	getAuthContext: async () => ({
		user: { id: session.userId },
		session: { activeOrganizationId: session.organizationId },
	}),
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual =
		await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: { nowInstant: () => actual.parseInstant(session.now) },
	};
});
const operational = await import("./operational-actions");
const checks = await import("./check-actions");
const policies = await import("./policy-actions");
const grants = await import("./verifier-actions");
let fixture: LifecycleDatabaseFixture;
let planner: SeededEmployee;
let roleId: string;
beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	planner = await fixture.seedEmployee();
	session.organizationId = fixture.organizationId;
	session.userId = fixture.ownerUserId;
	session.now = "2026-01-31T11:00:00Z";
	roleId = crypto.randomUUID();
	await fixture.pool.query(
		`insert into custom_role (id, organization_id, name, created_by, updated_at) values ($1,$2,'Driving planner',$3,now())`,
		[roleId, fixture.organizationId, fixture.ownerUserId],
	);
	await fixture.pool.query(
		`insert into custom_role_permission (custom_role_id,action,subject) values ($1,'read','DrivingAuthorization')`,
		[roleId],
	);
	await fixture.pool.query(
		`insert into employee_custom_role (employee_id,custom_role_id,assigned_by) values ($1,$2,$3)`,
		[planner.employeeId, roleId, fixture.ownerUserId],
	);
	expect(
		(
			await policies.switchDrivingLicenceControlAction({
				enabled: true,
				setup: {
					intervalMonths: 1,
					timezone: "Europe/Berlin",
					retentionMonths: 36,
					retentionJustification: "Organization driving evidence retention",
				},
			})
		).success,
	).toBe(true);
});
afterEach(async () => fixture?.close());

async function switchControl(enabled: boolean) {
	const previous = session.userId;
	session.userId = fixture.ownerUserId;
	expect((await policies.switchDrivingLicenceControlAction({ enabled })).success).toBe(true);
	session.userId = previous;
}

it("refuses targeted status reads and the employee search while driving licence control is off", async () => {
	await switchControl(false);
	session.userId = planner.userId;
	expect(
		await operational.getDrivingAuthorizationStatusAction({ employeeId: fixture.employeeId }),
	).toMatchObject({ success: false });
	expect(await operational.getOperationalDrivingEmployeesAction()).toMatchObject({
		success: false,
	});
	const { GET: status } = await import("@/app/api/driving-licence/status/route");
	const response = await status(
		new Request(
			`http://localhost/api/driving-licence/status?organizationId=${fixture.organizationId}&employeeId=${fixture.employeeId}`,
		),
	);
	expect(response.status).toBe(404);
	await switchControl(true);
	expect(
		await operational.getDrivingAuthorizationStatusAction({ employeeId: fixture.employeeId }),
	).toMatchObject({ success: true });
});

it("shows a member their own status only as an intended driver or with own retained records", async () => {
	const { userId } = await fixture.pool
		.query<{ userId: string }>(`select user_id "userId" from employee where id=$1`, [
			fixture.employeeId,
		])
		.then((result) => result.rows[0]);
	const own = () =>
		operational.getDrivingAuthorizationStatusAction({ employeeId: fixture.employeeId });
	session.userId = userId;
	// Not an intended driver, no records: nothing, also when asking by their own id.
	expect(await own()).toEqual({ success: true, data: null });
	expect(await operational.getDrivingAuthorizationStatusAction()).toEqual({
		success: true,
		data: null,
	});

	await completeOriginal();
	session.userId = userId;
	expect(await own()).toMatchObject({ success: true, data: { status: "active" } });

	// A former intended driver keeps reading their own retained status, but gets no advisory.
	session.userId = fixture.ownerUserId;
	expect(
		(
			await saveConfirmedIntendedDriverAssignment({
				target: { type: "employee", employeeId: fixture.employeeId },
				value: "not_required",
			})
		).success,
	).toBe(true);
	session.userId = userId;
	expect(await own()).toMatchObject({ success: true, data: { status: "not_enrolled" } });
	expect(await operational.getDrivingAuthorizationStatusAction()).toEqual({
		success: true,
		data: null,
	});

	await switchControl(false);
	session.userId = userId;
	expect(await own()).toEqual({ success: true, data: null });
});

it("lets explicitly authorized planners read absent authorization without gaining inspection access", async () => {
	session.userId = planner.userId;
	const result = await operational.getDrivingAuthorizationStatusAction({
		employeeId: fixture.employeeId,
	});
	expect(result).toEqual({
		success: true,
		data: {
			employeeId: fixture.employeeId,
			status: "not_enrolled",
			authorizedClasses: [],
			classes: [],
		},
	});
	expect(
		(
			await checks.getDrivingLicenceEmployeeRecordAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(false);
	const worklist = await operational.getOperationalDrivingEmployeesAction({
		search: "Lifecycle",
	});
	expect(worklist.success).toBe(true);
	if (worklist.success)
		expect(
			worklist.data.some((entry) => entry.employeeId === fixture.employeeId),
		).toBe(true);
});

it("offers a distinct grant in the existing role editor and does not infer it from administrator or employee access", async () => {
	const { isValidPermission } = await import(
		"@/lib/authorization/permission-registry"
	);
	expect(isValidPermission("read", "DrivingAuthorization")).toBe(true);
	expect(
		(
			await operational.getDrivingAuthorizationStatusAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(false);
	const ordinary = await fixture.seedEmployee();
	session.userId = ordinary.userId;
	await fixture.pool.query(
		`insert into employee_custom_role (employee_id,custom_role_id,assigned_by) values ($1,$2,$3)`,
		[ordinary.employeeId, roleId, fixture.ownerUserId],
	);
	await fixture.pool.query(
		`update custom_role_permission set subject='Employee' where custom_role_id=$1`,
		[roleId],
	);
	expect(
		(
			await operational.getDrivingAuthorizationStatusAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(false);
	expect(
		(await operational.getOperationalDrivingEmployeesAction()).success,
	).toBe(false);
});

async function completeOriginal() {
	session.userId = fixture.ownerUserId;
	expect(
		(
			await saveConfirmedIntendedDriverAssignment({
				target: { type: "employee", employeeId: fixture.employeeId },
				value: "required",
			})
		).success,
	).toBe(true);
	const verifier = await fixture.seedEmployee();
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
	session.userId = verifier.userId;
	expect(
		(
			await checks.completeDrivingLicenceCheckAction({
				employeeId: fixture.employeeId,
				commandId: crypto.randomUUID(),
				originalInspected: true,
				identityConfirmed: true,
				employeeDeclaration: true,
				verifierConfirmed: true,
				documentIssuedOn: "2020-05-01",
				documentExpiresOn: "2035-05-01",
				classes: [
					{
						code: "B",
						result: "successful",
						expiryDate: null,
						restrictions: "Code 01: corrective lenses",
					},
				],
			})
		).success,
	).toBe(true);
}

it("returns only effective classes and driving restrictions and reflects expiry even before a worker runs", async () => {
	await completeOriginal();
	session.userId = planner.userId;
	expect(
		await operational.getDrivingAuthorizationStatusAction({
			employeeId: fixture.employeeId,
		}),
	).toEqual({
		success: true,
		data: {
			employeeId: fixture.employeeId,
			status: "active",
			authorizedClasses: ["B"],
			classes: [
				{
					code: "B",
					status: "active",
					restrictions: "Code 01: corrective lenses",
				},
			],
		},
	});
	session.now = "2026-02-28T23:00:00Z";
	expect(
		await operational.getDrivingAuthorizationStatusAction({
			employeeId: fixture.employeeId,
		}),
	).toEqual({
		success: true,
		data: {
			employeeId: fixture.employeeId,
			status: "suspended",
			authorizedClasses: [],
			classes: [
				{
					code: "B",
					status: "suspended",
					restrictions: "Code 01: corrective lenses",
				},
			],
		},
	});
	expect(
		(
			await checks.getDrivingLicenceEmployeeRecordAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(false);
	const { getDrivingLicenceHistoryAction } = await import("./history-actions");
	expect(
		(await getDrivingLicenceHistoryAction({ employeeId: fixture.employeeId }))
			.success,
	).toBe(false);
});

it("rechecks explicit grants, active membership and both tenant boundaries on every status and search read", async () => {
	session.userId = planner.userId;
	expect(
		(
			await operational.getDrivingAuthorizationStatusAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(true);
	const otherOrg = await fixture.createOrganization();
	const foreign = await fixture.seedEmployee({ organizationId: otherOrg });
	expect(
		(
			await operational.getDrivingAuthorizationStatusAction({
				employeeId: foreign.employeeId,
			})
		).success,
	).toBe(false);
	await fixture.pool.query(
		`update custom_role set is_active=false where id=$1`,
		[roleId],
	);
	expect(
		(
			await operational.getDrivingAuthorizationStatusAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(false);
	expect(
		(await operational.getOperationalDrivingEmployeesAction()).success,
	).toBe(false);
	await fixture.pool.query(
		`update custom_role set is_active=true, organization_id=$2 where id=$1`,
		[roleId, otherOrg],
	);
	expect(
		(
			await operational.getDrivingAuthorizationStatusAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(false);
	await fixture.pool.query(
		`update custom_role set organization_id=$2 where id=$1`,
		[roleId, fixture.organizationId],
	);
	await fixture.pool.query(
		`delete from employee_custom_role where custom_role_id=$1`,
		[roleId],
	);
	expect(
		(
			await operational.getDrivingAuthorizationStatusAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(false);
	// Own minimal view needs no operational permission, but still needs current membership.
	expect(
		(await operational.getDrivingAuthorizationStatusAction()).success,
	).toBe(true);
	await fixture.pool.query(`update member set status='pending' where id=$1`, [
		planner.memberId,
	]);
	expect(
		(await operational.getDrivingAuthorizationStatusAction()).success,
	).toBe(false);
});

it("serves operational GET reads privately with the same current permission and tenant boundary", async () => {
	const { GET: status } = await import(
		"@/app/api/driving-licence/status/route"
	);
	const { GET: employees } = await import(
		"@/app/api/driving-licence/operational-employees/route"
	);
	session.userId = planner.userId;
	const response = await status(
		new Request(
			`http://localhost/api/driving-licence/status?organizationId=${fixture.organizationId}&employeeId=${fixture.employeeId}`,
		),
	);
	expect(response.status).toBe(200);
	expect(response.headers.get("cache-control")).toBe(
		"private, no-store, max-age=0",
	);
	expect(await response.json()).toEqual({
		success: true,
		data: {
			employeeId: fixture.employeeId,
			status: "not_enrolled",
			authorizedClasses: [],
			classes: [],
		},
	});
	const roster = await employees(
		new Request(
			`http://localhost/api/driving-licence/operational-employees?organizationId=${fixture.organizationId}`,
		),
	);
	expect(roster.status).toBe(200);
	expect(roster.headers.get("cache-control")).toContain("no-store");
	const foreignOrg = await fixture.createOrganization();
	expect(
		(
			await status(
				new Request(
					`http://localhost/api/driving-licence/status?organizationId=${foreignOrg}&employeeId=${fixture.employeeId}`,
				),
			)
		).status,
	).toBe(404);
	await fixture.pool.query(
		`delete from employee_custom_role where custom_role_id=$1`,
		[roleId],
	);
	expect(
		(
			await status(
				new Request(
					`http://localhost/api/driving-licence/status?organizationId=${fixture.organizationId}&employeeId=${fixture.employeeId}`,
				),
			)
		).status,
	).toBe(404);
	expect(
		(
			await employees(
				new Request(
					`http://localhost/api/driving-licence/operational-employees?organizationId=${fixture.organizationId}`,
				),
			)
		).status,
	).toBe(404);
});
