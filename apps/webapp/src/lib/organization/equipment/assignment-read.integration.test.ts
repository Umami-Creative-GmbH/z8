import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const session = vi.hoisted(() => ({
	userId: "t1572r-owner",
	organizationId: "t1572r-org",
}));
const clock = vi.hoisted(() => ({ now: "2026-11-04T23:30:00Z" }));
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: session.userId, role: "user" },
				session: {
					id: `session-${session.userId}`,
					userId: session.userId,
					activeOrganizationId: session.organizationId,
				},
			}),
		},
	},
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual =
		await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: { nowInstant: () => actual.parseInstant(clock.now) },
	};
});

const actions = await import("./actions");
const pool = integrationAdminPool();
const ids = {
	holder: "15720000-0000-4000-8000-000000000001",
	other: "15720000-0000-4000-8000-000000000002",
	officer: "15720000-0000-4000-8000-000000000003",
	foreign: "15720000-0000-4000-8000-000000000004",
};
const refused = { success: false, code: "AuthorizationError" };

async function clean() {
	await pool.query("delete from organization where id like 't1572r-%'");
	await pool.query('delete from "user" where id like $1', ["t1572r-%"]);
}
beforeAll(async () => {
	await clean();
	for (const org of ["t1572r-org", "t1572r-other"])
		await pool.query(
			"insert into organization(id,name,slug,timezone,equipment_enabled,created_at) values($1,$1,$1,'Europe/Berlin',true,now())",
			[org],
		);
	for (const [name, org, role, employeeId] of [
		["owner", "t1572r-org", "owner", null],
		["holder", "t1572r-org", "member", ids.holder],
		["other", "t1572r-org", "member", ids.other],
		["officer", "t1572r-org", "member", ids.officer],
		["foreign", "t1572r-other", "owner", ids.foreign],
	] as const) {
		await pool.query(
			'insert into "user"(id,name,email,image,created_at,updated_at) values($1,$1,$2,$3,now(),now())',
			[
				`t1572r-${name}`,
				`${name}@t1572r.example.test`,
				name === "holder" ? "https://img.example.test/holder.png" : null,
			],
		);
		await pool.query(
			"insert into member(id,user_id,organization_id,role,status,created_at) values($1,$1,$2,$3,'approved',now())",
			[`t1572r-${name}`, org, role],
		);
		if (employeeId)
			await pool.query(
				"insert into employee(id,user_id,organization_id,role,is_active,updated_at) values($1,$2,$3,'employee',true,now())",
				[employeeId, `t1572r-${name}`, org],
			);
	}
});
afterAll(clean);
beforeEach(async () => {
	session.userId = "t1572r-owner";
	session.organizationId = "t1572r-org";
	clock.now = "2026-11-04T23:30:00Z";
	for (const table of [
		"equipment_officer_grant",
		"equipment_assignment",
		"equipment_command",
		"equipment_setup_command",
		"equipment_item",
		"equipment_type",
		"equipment_policy",
	])
		await pool.query(`delete from ${table} where organization_id='t1572r-org'`);
	await pool.query(
		"update organization set equipment_enabled=true where id='t1572r-org'",
	);
});

async function ok<T>(
	result: Promise<
		| { success: true; data: { ok: true; id: string } & T }
		| { success: true; data: { ok: false } }
		| { success: false }
	>,
) {
	const outcome = await result;
	if (!outcome.success || !outcome.data.ok)
		throw new Error(JSON.stringify(outcome));
	return outcome.data;
}
/** Two laptops, L-01 issued to the holder and L-02 to the other employee. */
async function issueLaptops() {
	const setup = (input: Record<string, unknown>) =>
		ok(
			actions.changeEquipmentSetup({
				requestId: crypto.randomUUID(),
				...input,
			}),
		);
	await setup({
		kind: "configure_policy",
		retentionMonths: 24,
		expectedRevision: 0,
	});
	const type = await setup({
		kind: "create_type",
		name: "Laptop",
		trackingMode: "individual",
		defaultReturnRequired: true,
	});
	const issued: string[] = [];
	for (const [identifier, employeeId] of [
		["L-01", ids.holder],
		["L-02", ids.other],
	]) {
		const item = await setup({
			kind: "register_item",
			typeId: type.id,
			identifier,
			serialNumber: `SN-${identifier}`,
		});
		const assignment = await ok(
			actions.changeEquipment({
				kind: "issue_individual",
				requestId: crypto.randomUUID(),
				itemId: item.id,
				employeeId,
				expectedRevision: 1,
				actualDate: "2026-11-02",
				condition: "good",
				returnRequired: true,
				explicitDeadline: "2026-11-04",
			}),
		);
		issued.push(assignment.id);
	}
	return { holderAssignment: issued[0], otherAssignment: issued[1] };
}

it("reads exactly one in-scope assignment with the holder's image, its serial number and nothing to issue (#1572)", async () => {
	const { holderAssignment } = await issueLaptops();
	const read = await actions.getEquipmentAssignment(holderAssignment);
	expect(read).toMatchObject({
		success: true,
		data: {
			canManage: true,
			canAdminister: true,
			today: "2026-11-05",
			timezone: "Europe/Berlin",
			readinessItems: [],
			availableItems: [],
			availableQuantityTypes: [],
			registrationTypes: [],
			assignments: [
				{
					id: holderAssignment,
					identifier: "L-01",
					serialNumber: "SN-L-01",
					employeeId: ids.holder,
					holderName: "t1572r-holder",
					holderImage: "https://img.example.test/holder.png",
					overdue: true,
					canReceive: true,
					transfers: [],
					issue: { actualDate: "2026-11-02", actorName: "t1572r-owner" },
				},
			],
		},
	});
	if (!read.success) throw new Error("Read failed");
	expect(read.data.assignments).toHaveLength(1);
	// Transfers still need the reader's scope of current employees, with their images.
	expect(read.data.employees).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: ids.holder,
				image: "https://img.example.test/holder.png",
			}),
			expect.objectContaining({ id: ids.other, image: null }),
		]),
	);
});

it("names both sides of a transfer on the assignments it links", async () => {
	const { holderAssignment } = await issueLaptops();
	const before = await actions.getEquipmentAssignment(holderAssignment);
	if (!before.success) throw new Error("Read failed");
	const source = before.data.assignments[0];
	const destination = await ok(
		actions.changeEquipment({
			kind: "transfer_equipment",
			requestId: crypto.randomUUID(),
			assignmentId: source.id,
			expectedRevision: source.revision,
			expectedIssuanceRevision: source.transfer?.expectedIssuanceRevision,
			employeeId: ids.officer,
			quantity: 1,
			receipt: { actualDate: "2026-11-04", condition: "good" },
			issue: {
				actualDate: "2026-11-04",
				condition: "good",
				returnRequired: true,
			},
		}),
	);
	expect(await actions.getEquipmentAssignment(holderAssignment)).toMatchObject({
		success: true,
		data: {
			assignments: [
				{
					transfers: [{ direction: "out", counterpartName: "t1572r-officer" }],
				},
			],
		},
	});
	expect(await actions.getEquipmentAssignment(destination.id)).toMatchObject({
		success: true,
		data: {
			assignments: [
				{
					employeeId: ids.officer,
					transfers: [{ direction: "in", counterpartName: "t1572r-holder" }],
				},
			],
		},
	});
});

it("refuses an assignment outside an officer's grant while reading one inside it", async () => {
	const { holderAssignment, otherAssignment } = await issueLaptops();
	await ok(
		actions.changeEquipmentOfficerGrant({
			kind: "set_officer_grant",
			requestId: crypto.randomUUID(),
			employeeId: ids.officer,
			expectedRevision: 0,
			scope: "selected",
			teamIds: [],
			employeeIds: [ids.other],
		}),
	);
	session.userId = "t1572r-officer";
	expect(await actions.getEquipmentAssignment(holderAssignment)).toMatchObject(
		refused,
	);
	expect(await actions.getEquipmentAssignment(otherAssignment)).toMatchObject({
		success: true,
		data: {
			canManage: true,
			canAdminister: false,
			assignments: [{ id: otherAssignment, canCloseException: false }],
		},
	});
});

it("lets the holder read their own assignment read-only and nobody else's", async () => {
	const { holderAssignment, otherAssignment } = await issueLaptops();
	session.userId = "t1572r-holder";
	expect(await actions.getEquipmentAssignment(holderAssignment)).toMatchObject({
		success: true,
		data: {
			canManage: false,
			employees: [],
			assignments: [{ id: holderAssignment, canReceive: false }],
		},
	});
	const own = await actions.getEquipmentAssignment(holderAssignment);
	if (!own.success) throw new Error("Read failed");
	expect(own.data.assignments[0]).not.toHaveProperty("transfers");
	expect(await actions.getEquipmentAssignment(otherAssignment)).toMatchObject(
		refused,
	);
});

it("refuses another organization's assignment, a missing one and an invalid reference", async () => {
	const { holderAssignment } = await issueLaptops();
	session.userId = "t1572r-foreign";
	session.organizationId = "t1572r-other";
	expect(await actions.getEquipmentAssignment(holderAssignment)).toMatchObject(
		refused,
	);
	session.userId = "t1572r-owner";
	session.organizationId = "t1572r-org";
	expect(
		await actions.getEquipmentAssignment(
			"15720000-0000-4000-8000-0000000000ff",
		),
	).toMatchObject(refused);
	expect(await actions.getEquipmentAssignment("not-a-uuid")).toMatchObject({
		success: false,
		code: "ValidationError",
	});
});

it("refuses every assignment while equipment is switched off", async () => {
	const { holderAssignment } = await issueLaptops();
	await pool.query(
		"update organization set equipment_enabled=false where id='t1572r-org'",
	);
	expect(await actions.getEquipmentAssignment(holderAssignment)).toMatchObject(
		refused,
	);
	session.userId = "t1572r-holder";
	expect(await actions.getEquipmentAssignment(holderAssignment)).toMatchObject(
		refused,
	);
});
