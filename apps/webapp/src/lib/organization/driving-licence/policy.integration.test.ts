import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import {
	activateDrivingLicenceControl,
	saveConfirmedIntendedDriverAssignment,
} from "./testing/control.test.fixture";

const session = vi.hoisted(() => ({
	userId: "t1311-admin",
	organizationId: "t1311-org",
}));
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: async () =>
		session.userId
			? {
					user: { id: session.userId },
					session: { activeOrganizationId: session.organizationId },
				}
			: null,
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual =
		await original<typeof import("@/lib/datetime/temporal-core")>();
	const { Temporal } = await import("temporal-polyfill");
	return {
		...actual,
		systemClock: {
			nowInstant: () => Temporal.Instant.from("2026-10-16T12:00:00Z"),
		},
	};
});
const actions = await import("./policy-actions");
function assignIntendedDriver(id: string) {
	return saveConfirmedIntendedDriverAssignment({
		target: { type: "employee", employeeId: id },
		value: "required",
	});
}
const pool = integrationAdminPool();
const employeeId = "e1311000-0000-4000-8000-000000000001";
const foreignId = "e1311000-0000-4000-8000-000000000002";
const validPolicy = {
	intervalMonths: 6,
	timezone: "Europe/Berlin",
	reminderLeadDays: [30, 7],
	retentionMonths: 24,
	retentionJustification:
		"Required for documenting our internal original inspection process.",
};
async function clean() {
	await pool.query("delete from organization where id like 't1311-%'");
	await pool.query('delete from "user" where id like $1', ["t1311-%"]);
}
beforeAll(async () => {
	await clean();
	for (const org of ["t1311-org", "t1311-foreign"])
		await pool.query(
			"insert into organization (id,name,slug,created_at) values ($1,$1,$1,now())",
			[org],
		);
	for (const [id, org, role] of [
		["admin", "t1311-org", "admin"],
		["employee", "t1311-org", "member"],
		["foreign", "t1311-foreign", "admin"],
	]) {
		await pool.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$1,$2,now(),now())',
			[`t1311-${id}`, `${id}@t1311.example.test`],
		);
		await pool.query(
			"insert into member (id,user_id,organization_id,role,status,created_at) values ($1,$1,$2,$3,'approved',now())",
			[`t1311-${id}`, org, role],
		);
	}
	await pool.query(
		"insert into employee (id,user_id,organization_id,is_active,updated_at) values ($1,'t1311-employee','t1311-org',true,now()),($2,'t1311-foreign','t1311-foreign',true,now())",
		[employeeId, foreignId],
	);
});
afterAll(clean);
beforeEach(async () => {
	session.userId = "t1311-admin";
	session.organizationId = "t1311-org";
	await pool.query(
		"delete from driving_licence_intended_driver_assignment where organization_id='t1311-org'",
	);
	await pool.query(
		"delete from driving_licence_policy_revision where organization_id='t1311-org'",
	);
	await pool.query(
		"delete from driving_licence_policy where organization_id='t1311-org'",
	);
});
describe("driving licence policy and intended drivers through public actions", () => {
	it("persists an explicitly configured policy and assigns an intended driver with no authorization", async () => {
		expect(await activateDrivingLicenceControl(validPolicy)).toMatchObject({ success: true });
		expect(await assignIntendedDriver(employeeId)).toMatchObject({
			success: true,
		});
		const settings = await actions.getDrivingLicenceAdminDataAction();
		expect(settings).toMatchObject({
			success: true,
			data: {
				policy: { ...validPolicy, enabled: true },
				intendedDrivers: {
					assignments: [{ assignmentType: "employee", employeeId, value: "required" }],
				},
			},
		});
		session.userId = "t1311-employee";
		expect(await actions.getOwnDrivingLicenceStatusAction()).toMatchObject({
			success: true,
			data: {
				enrolled: true,
				status: "not_yet_checked",
				authorizedClasses: [],
				timezone: "Europe/Berlin",
			},
		});
	});
});

it("keeps the explicit calendar zone fixed after activation and saves the policy only while control is on", async () => {
	expect(await actions.saveDrivingLicencePolicyAction(validPolicy)).toEqual({
		success: false,
		error: "not_enabled",
	});
	expect(await activateDrivingLicenceControl(validPolicy)).toMatchObject({ success: true });
	expect(
		await actions.saveDrivingLicencePolicyAction({ ...validPolicy, reminderLeadDays: [14] }),
	).toMatchObject({ success: true });
	expect(
		await actions.saveDrivingLicencePolicyAction({
			...validPolicy,
			timezone: "America/New_York",
		}),
	).toEqual({ success: false, error: "timezone_fixed" });
	// The policy form never switches: the Features switch is the only activation.
	expect(await actions.saveDrivingLicencePolicyAction({ ...validPolicy, enabled: false })).toEqual(
		{ success: false, error: "invalid_policy" },
	);
	expect(await actions.switchDrivingLicenceControlAction({ enabled: false })).toMatchObject({
		success: true,
	});
	expect(await actions.saveDrivingLicencePolicyAction(validPolicy)).toEqual({
		success: false,
		error: "not_enabled",
	});
});
it("keeps a justified finite retention period and validates all policy limits", async () => {
	expect(await activateDrivingLicenceControl(validPolicy)).toMatchObject({ success: true });
	for (const invalid of [
		{ retentionMonths: 0 },
		{ retentionMonths: 121 },
		{ intervalMonths: 0 },
		{ intervalMonths: 1.5 },
		{ timezone: "viewer" },
		{ reminderLeadDays: [7, 7] },
		{ reminderLeadDays: [-1] },
		{ reminderLeadDays: [1.5] },
	]) {
		expect(
			await actions.saveDrivingLicencePolicyAction({
				...validPolicy,
				...invalid,
			}),
		).toMatchObject({ success: false, error: "invalid_policy" });
	}
	for (const cleared of [{ retentionMonths: null }, { retentionJustification: "" }])
		expect(
			await actions.saveDrivingLicencePolicyAction({ ...validPolicy, ...cleared }),
		).toEqual({ success: false, error: "retention_required" });
	expect(await actions.getDrivingLicenceAdminDataAction()).toMatchObject({
		success: true,
		data: { policy: { ...validPolicy, enabled: true }, intendedDrivers: { assignments: [] } },
	});
});
it("enforces approved membership and organization administration on every public settings operation", async () => {
	await activateDrivingLicenceControl(validPolicy);
	for (const identity of [
		{ userId: "t1311-employee", organizationId: "t1311-org" },
		{ userId: "t1311-admin", organizationId: "t1311-foreign" },
		{ userId: "", organizationId: "t1311-org" },
	]) {
		Object.assign(session, identity);
		expect(await actions.saveDrivingLicencePolicyAction(validPolicy)).toEqual({
			success: false,
			error: "forbidden",
		});
		expect(await assignIntendedDriver(employeeId)).toEqual({
			success: false,
			error: "forbidden",
		});
		expect(await actions.getDrivingLicenceAdminDataAction()).toEqual({
			success: false,
			error: "forbidden",
		});
	}
});
it("rejects foreign employees, inactive employees, and assignment while disabled, with a repeated assignment remaining one", async () => {
	expect(await assignIntendedDriver(employeeId)).toEqual({
		success: false,
		error: "not_enabled",
	});
	await activateDrivingLicenceControl(validPolicy);

	expect(await assignIntendedDriver(foreignId)).toEqual({
		success: false,
		error: "employee_not_found",
	});
	await pool.query("update employee set is_active=false where id=$1", [
		employeeId,
	]);
	expect(await assignIntendedDriver(employeeId)).toEqual({
		success: false,
		error: "employee_not_found",
	});
	await pool.query("update employee set is_active=true where id=$1", [
		employeeId,
	]);
	await assignIntendedDriver(employeeId);
	await assignIntendedDriver(employeeId);
	const result = await actions.getDrivingLicenceAdminDataAction();
	expect(
		result.success && result.data.intendedDrivers.assignments,
	).toHaveLength(1);
	session.userId = "t1311-foreign";
	session.organizationId = "t1311-foreign";
	expect(await actions.getOwnDrivingLicenceStatusAction()).toMatchObject({
		success: true,
		data: { enrolled: false, status: "not_enrolled", authorizedClasses: [] },
	});
});
