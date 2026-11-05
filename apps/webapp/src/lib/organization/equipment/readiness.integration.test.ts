import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
	integrationAdminPool,
	openIntegrationPool,
} from "@/test/integration-database";

const session = vi.hoisted(() => ({
	userId: "t1541-owner",
	organizationId: "t1541-org",
}));
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
		systemClock: {
			nowInstant: () => actual.parseInstant("2026-11-04T23:30:00Z"),
		},
	};
});
const actions = await import("./actions");
const pool = integrationAdminPool();
const holderId = "15410000-0000-4000-8000-000000000001";
async function clean() {
	await pool.query("delete from organization where id like 't1541-%'");
	await pool.query('delete from "user" where id like $1', ["t1541-%"]);
}
beforeAll(async () => {
	await clean();
	for (const org of ["t1541-org", "t1541-other"])
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
			[`t1541-${name}`, `${name}@t1541.example.test`],
		);
		await pool.query(
			"insert into member(id,user_id,organization_id,role,status,created_at) values($1,$1,$2,$3,'approved',now())",
			[`t1541-${name}`, `t1541-${org}`, role],
		);
	}
	await pool.query(
		"insert into employee(id,user_id,organization_id,role,is_active,updated_at) values($1,'t1541-holder','t1541-org','employee',true,now())",
		[holderId],
	);
	await pool.query(
		"insert into employee(id,user_id,organization_id,role,is_active,updated_at) values('15410000-0000-4000-8000-000000000002','t1541-manager','t1541-org','manager',true,now())",
	);
});
afterAll(clean);
beforeEach(async () => {
	session.userId = "t1541-owner";
	session.organizationId = "t1541-org";
	await pool.query("update member set role='admin' where id='t1541-admin'");
	await pool.query(
		"delete from equipment_assignment where organization_id='t1541-org'",
	);
	await pool.query(
		"delete from equipment_command where organization_id='t1541-org'",
	);
	await pool.query(
		"delete from equipment_setup_command where organization_id='t1541-org'",
	);
	await pool.query(
		"delete from equipment_item where organization_id='t1541-org'",
	);
	await pool.query(
		"delete from equipment_type where organization_id='t1541-org'",
	);
	await pool.query(
		"delete from equipment_policy where organization_id='t1541-org'",
	);
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
async function item() {
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
	return setup({ kind: "register_item", typeId: type.id, identifier: "L-01" });
}
async function overview() {
	const result = await actions.getEquipmentOverview();
	if (!result.success) throw new Error(JSON.stringify(result));
	return result.data;
}
function issue(
	itemId: string,
	expectedRevision = 1,
	extra: Record<string, unknown> = {},
) {
	return actions.changeEquipment({
		kind: "issue_individual",
		requestId: crypto.randomUUID(),
		itemId,
		employeeId: holderId,
		expectedRevision,
		actualDate: "2026-11-05",
		condition: "good",
		returnRequired: true,
		...extra,
	});
}
function readiness(
	itemId: string,
	kind = "clear_item",
	expectedRevision = 3,
	extra: Record<string, unknown> = {},
) {
	return actions.changeEquipment({
		kind,
		requestId: crypto.randomUUID(),
		itemId,
		expectedRevision,
		...extra,
	});
}
async function damagedReceipt(itemId: string) {
	const result = await issue(itemId);
	if (!result.success || !result.data.ok)
		throw new Error(JSON.stringify(result));
	expect(
		await actions.changeEquipment({
			kind: "receive_individual",
			requestId: crypto.randomUUID(),
			assignmentId: result.data.id,
			expectedRevision: 1,
			actualDate: "2026-11-05",
			condition: "damaged",
			notes: "Cracked screen",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	return result.data.id;
}
it("requires explicit clearance after damaged receipt, preserving receipt evidence and recording separate authority and time", async () => {
	const registered = await item();
	const assignmentId = await damagedReceipt(registered.id);
	const before = await overview();
	expect(before.assignments).toMatchObject([
		{
			id: assignmentId,
			outstanding: false,
			held: false,
			receipt: { condition: "damaged", notes: "Cracked screen" },
		},
	]);
	expect(before.availableItems).toEqual([]);
	expect(await issue(registered.id, 3)).toMatchObject({
		success: true,
		data: { ok: false, reason: "item_unavailable" },
	});
	session.userId = "t1541-admin";
	expect(await readiness(registered.id)).toMatchObject({
		success: true,
		data: { ok: true, id: registered.id, revision: 4 },
	});
	const after = await overview();
	expect(after.assignments[0].receipt).toEqual(before.assignments[0].receipt);
	expect(after.readinessItems).toMatchObject([
		{
			id: registered.id,
			status: "available",
			history: [
				{
					kind: "clearance",
					actorId: "t1541-admin",
					actorName: "t1541-admin",
					recordedAt: "2026-11-04T23:30:00Z",
				},
			],
		},
	]);
	expect(after.availableItems).toMatchObject([
		{ id: registered.id, revision: 4 },
	]);
	expect(await issue(registered.id, 4)).toMatchObject({
		success: true,
		data: { ok: true },
	});
});

it("cannot clear held or issued-to-keep equipment and preserves retirement through a later damaged receipt", async () => {
	const registered = await item();
	const issued = await issue(registered.id, 1, { returnRequired: false });
	if (!issued.success || !issued.data.ok)
		throw new Error(JSON.stringify(issued));
	expect(
		await readiness(registered.id, "mark_item_unavailable", 2),
	).toMatchObject({ success: true, data: { ok: true, revision: 3 } });
	expect(await readiness(registered.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "item_in_custody" },
	});
	expect((await overview()).assignments).toMatchObject([
		{ held: true, outstanding: false },
	]);
	expect(await readiness(registered.id, "retire_item", 3)).toMatchObject({
		success: true,
		data: { ok: true, revision: 4 },
	});
	expect(
		await actions.changeEquipment({
			kind: "receive_individual",
			requestId: crypto.randomUUID(),
			assignmentId: issued.data.id,
			expectedRevision: 1,
			actualDate: "2026-11-05",
			condition: "damaged",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	expect(await readiness(registered.id, "clear_item", 5)).toMatchObject({
		success: true,
		data: { ok: false, reason: "item_retired" },
	});
	const result = await overview();
	expect(result.availableItems).toEqual([]);
	expect(result.readinessItems).toMatchObject([
		{
			status: "retired",
			inCustody: false,
			canClear: false,
			canRetire: false,
			history: [{ kind: "unavailable" }, { kind: "retired" }],
		},
	]);
	expect(await issue(registered.id, 5)).toMatchObject({
		success: true,
		data: { ok: false, reason: "item_unavailable" },
	});
	const typeId = result.types[0].id;
	expect(
		await actions.changeEquipmentSetup({
			kind: "register_item",
			requestId: crypto.randomUUID(),
			typeId,
			identifier: " \t l-01 \n",
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "identifier_taken" },
	});
});

it.each(["mark_item_unavailable", "retire_item"])(
	"%s blocks stale issuance and is still refused by fresh issuance",
	async (kind) => {
		const registered = await item();
		expect((await overview()).availableItems).toMatchObject([
			{ id: registered.id, revision: 1 },
		]);
		expect(await readiness(registered.id, kind, 1)).toMatchObject({
			success: true,
			data: { ok: true, revision: 2 },
		});
		expect(await issue(registered.id, 1)).toMatchObject({
			success: true,
			data: { ok: false, reason: "stale_revision" },
		});
		expect(await issue(registered.id, 2)).toMatchObject({
			success: true,
			data: { ok: false, reason: "item_unavailable" },
		});
		expect((await overview()).availableItems).toEqual([]);
		expect((await overview()).assignments).toEqual([]);
	},
);

it("serializes competing readiness and issuance decisions without erasing custody or duplicating evidence", async () => {
	const registered = await item();
	const results = await Promise.all([
		issue(registered.id),
		readiness(registered.id, "mark_item_unavailable", 1),
	]);
	expect(
		results.filter((result) => result.success && result.data.ok),
	).toHaveLength(1);
	expect(
		results.filter(
			(result) =>
				result.success &&
				!result.data.ok &&
				result.data.reason === "stale_revision",
		),
	).toHaveLength(1);
	const after = await overview();
	expect(after.availableItems).toEqual([]);
	if (after.assignments.length) {
		expect(after.assignments).toMatchObject([{ held: true }]);
		expect(after.readinessItems).toMatchObject([
			{ inCustody: true, canClear: false, history: [] },
		]);
	} else
		expect(after.readinessItems).toMatchObject([
			{ status: "unavailable", history: [{ kind: "unavailable" }] },
		]);
});

it("replays concurrent clearance once, refuses changed payloads and actors, and keeps stale competing decisions from committing", async () => {
	const registered = await item();
	await damagedReceipt(registered.id);
	const requestId = crypto.randomUUID();
	const replay = await Promise.all([
		readiness(registered.id, "clear_item", 3, { requestId }),
		readiness(registered.id, "clear_item", 3, { requestId }),
	]);
	expect(replay[0]).toMatchObject({
		success: true,
		data: { ok: true, revision: 4 },
	});
	expect(replay[1]).toEqual(replay[0]);
	expect((await overview()).readinessItems[0].history).toHaveLength(1);
	expect(
		await readiness(registered.id, "retire_item", 3, { requestId }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
	session.userId = "t1541-admin";
	expect(
		await readiness(registered.id, "clear_item", 3, { requestId }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
	expect(await readiness(registered.id, "retire_item", 3)).toMatchObject({
		success: true,
		data: { ok: false, reason: "stale_revision" },
	});
	expect((await overview()).availableItems).toHaveLength(1);
});

it("refuses ordinary employees, managers, forged actors, and foreign item references at the shared action/read boundary", async () => {
	const registered = await item();
	for (const name of ["holder", "manager"]) {
		session.userId = `t1541-${name}`;
		for (const kind of ["clear_item", "mark_item_unavailable", "retire_item"])
			expect(await readiness(registered.id, kind, 1)).toMatchObject({
				success: true,
				data: { ok: false, reason: "forbidden" },
			});
		expect(await actions.getEquipmentOverview()).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await actions.getMyEquipment()).toMatchObject({
			success: true,
			data: { readinessItems: [] },
		});
	}
	session.userId = "t1541-owner";
	expect(
		await readiness(registered.id, "retire_item", 1, { userId: "t1541-admin" }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "invalid_input" },
	});
	session.userId = "t1541-foreign";
	session.organizationId = "t1541-other";
	expect((await overview()).readinessItems).toEqual([]);
	for (const kind of ["clear_item", "mark_item_unavailable", "retire_item"])
		expect(await readiness(registered.id, kind, 1)).toMatchObject({
			success: true,
			data: { ok: false, reason: "not_found" },
		});
});

it("rechecks current authority after waiting for the lifecycle organization lock", async () => {
	const registered = await item();
	const connections = openIntegrationPool({ max: 1 });
	const blocker = await connections.connect();
	let pending: ReturnType<typeof readiness> | undefined;
	try {
		await blocker.query("begin");
		await blocker.query(
			"select id from organization where id='t1541-org' for update",
		);
		session.userId = "t1541-admin";
		pending = readiness(registered.id, "retire_item", 1);
		await vi.waitFor(async () => {
			const waiting = await pool.query(
				"select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%organization%' and pid <> pg_backend_pid()",
			);
			expect(waiting.rows.length).toBeGreaterThan(0);
		});
		await blocker.query(
			"update member set role='member' where id='t1541-admin'",
		);
		await blocker.query("commit");
		expect(await pending).toMatchObject({
			success: true,
			data: { ok: false, reason: "forbidden" },
		});
	} finally {
		await blocker.query("rollback");
		blocker.release();
		await pending;
	}
	session.userId = "t1541-owner";
	expect((await overview()).availableItems).toMatchObject([
		{ id: registered.id, revision: 1 },
	]);
	expect((await overview()).readinessItems[0].history).toEqual([]);
});

it("rolls readiness and evidence back together, allowing the unchanged request to retry", async () => {
	const registered = await item();
	await damagedReceipt(registered.id);
	const requestId = crypto.randomUUID();
	await pool.query(`CREATE FUNCTION t1541_fail_readiness() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
		IF NEW.organization_id = 't1541-org' THEN RAISE EXCEPTION 'simulated evidence failure'; END IF;
		RETURN NEW; END $$;
		CREATE TRIGGER t1541_fail_readiness BEFORE INSERT ON equipment_item_readiness_event FOR EACH ROW EXECUTE FUNCTION t1541_fail_readiness()`);
	try {
		expect(
			await readiness(registered.id, "clear_item", 3, { requestId }),
		).toMatchObject({ success: false, code: "DatabaseError" });
		expect((await overview()).readinessItems).toMatchObject([
			{ status: "unavailable", revision: 3, history: [] },
		]);
		expect((await overview()).availableItems).toEqual([]);
	} finally {
		await pool.query(
			"drop trigger t1541_fail_readiness on equipment_item_readiness_event; drop function t1541_fail_readiness()",
		);
	}
	expect(
		await readiness(registered.id, "clear_item", 3, { requestId }),
	).toMatchObject({ success: true, data: { ok: true, revision: 4 } });
	expect((await overview()).readinessItems[0].history).toHaveLength(1);
});
