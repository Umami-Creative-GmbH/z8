import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const session = vi.hoisted(() => ({
	userId: "t1543-owner",
	organizationId: "t1543-org",
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
const holderId = "15430000-0000-4000-8000-000000000001";
const ownerId = "15430000-0000-4000-8000-000000000002";
async function clean() {
	await pool.query("delete from organization where id like 't1543-%'");
	await pool.query('delete from "user" where id like $1', ["t1543-%"]);
}
beforeAll(async () => {
	await clean();
	for (const org of ["t1543-org", "t1543-other"])
		await pool.query(
			"insert into organization(id,name,slug,timezone,created_at) values($1,$1,$1,'Europe/Berlin',now())",
			[org],
		);
	for (const [name, org, role] of [
		["owner", "org", "owner"],
		["admin", "org", "admin"],
		["holder", "org", "member"],
		["manager", "org", "member"],
		["foreign", "other", "owner"],
	]) {
		await pool.query(
			'insert into "user"(id,name,email,created_at,updated_at) values($1,$1,$2,now(),now())',
			[`t1543-${name}`, `${name}@t1543.example.test`],
		);
		await pool.query(
			"insert into member(id,user_id,organization_id,role,status,created_at) values($1,$1,$2,$3,'approved',now())",
			[`t1543-${name}`, `t1543-${org}`, role],
		);
	}
	for (const [id, name, role] of [
		[holderId, "holder", "employee"],
		[ownerId, "owner", "employee"],
		["15430000-0000-4000-8000-000000000003", "manager", "manager"],
	])
		await pool.query(
			"insert into employee(id,user_id,organization_id,role,is_active,updated_at) values($1,$2,'t1543-org',$3,true,now())",
			[id, `t1543-${name}`, role],
		);
});
afterAll(clean);
beforeEach(async () => {
	session.userId = "t1543-owner";
	session.organizationId = "t1543-org";
	clock.now = "2026-11-04T23:30:00Z";
	await pool.query(
		"delete from equipment_assignment where organization_id='t1543-org'",
	);
	await pool.query(
		"delete from equipment_command where organization_id='t1543-org'",
	);
	await pool.query(
		"delete from equipment_setup_command where organization_id='t1543-org'",
	);
	await pool.query(
		"delete from equipment_item where organization_id='t1543-org'",
	);
	await pool.query(
		"delete from equipment_type where organization_id='t1543-org'",
	);
	await pool.query(
		"delete from equipment_policy where organization_id='t1543-org'",
	);
	await pool.query(
		"update employee set is_active=true where organization_id='t1543-org'",
	);
	await pool.query("update member set role='admin' where id='t1543-admin'");
});
async function setup(input: Record<string, unknown>) {
	const result = await actions.changeEquipmentSetup({
		requestId: crypto.randomUUID(),
		...input,
	});
	if (!result.success || !result.data.ok)
		throw new Error(JSON.stringify(result));
	return result.data;
}
async function quantityType() {
	await setup({
		kind: "configure_policy",
		retentionMonths: 24,
		expectedRevision: 0,
	});
	return setup({
		kind: "create_type",
		name: "Shirt · size M",
		trackingMode: "quantity",
		defaultReturnRequired: true,
	});
}
async function issue(typeId: string, extra: Record<string, unknown> = {}) {
	return actions.changeEquipment({
		kind: "record_historical_quantity",
		requestId: crypto.randomUUID(),
		typeId,
		employeeId: holderId,
		expectedRevision: 1,
		quantity: 3,
		actualDate: null,
		condition: "good",
		notes: "Three size-M shirts",
		returnRequired: true,
		explicitDeadline: "2026-11-04",
		...extra,
	});
}
async function overview(filters: Record<string, unknown> = {}) {
	const result = await actions.getEquipmentOverview(filters);
	if (!result.success) throw new Error(JSON.stringify(result));
	return result.data;
}
function receive(assignmentId: string, extra: Record<string, unknown> = {}) {
	return actions.changeEquipment({
		kind: "receive_quantity",
		requestId: crypto.randomUUID(),
		assignmentId,
		expectedRevision: 1,
		quantity: 2,
		actualDate: "2026-11-04",
		condition: "good",
		notes: "Two good shirts",
		...extra,
	});
}
it("records unknown historical quantity holdings without inventing an issue date and keeps UTC entry evidence", async () => {
	const type = await quantityType();
	const result = await issue(type.id);
	expect(result).toMatchObject({
		success: true,
		data: { ok: true, revision: 1 },
	});
	expect((await overview()).assignments).toMatchObject([
		{
			trackingMode: "quantity",
			quantity: 3,
			outstandingQuantity: 3,
			outstanding: true,
			issue: {
				actualDate: null,
				historical: true,
				condition: "good",
				actorId: "t1543-owner",
				recordedAt: "2026-11-04T23:30:00Z",
			},
		},
	]);
});
