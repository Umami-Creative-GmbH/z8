import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const session = vi.hoisted(() => ({
	userId: "t1536-owner",
	organizationId: "t1536-org",
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

const actions = await import("./actions");
const pool = integrationAdminPool();
async function clean() {
	await pool.query("delete from organization where id like 't1536-%'");
	await pool.query('delete from "user" where id like $1', ["t1536-%"]);
}
beforeAll(async () => {
	await clean();
	for (const org of ["t1536-org", "t1536-other"])
		await pool.query(
			"insert into organization(id,name,slug,created_at) values($1,$1,$1,now())",
			[org],
		);
	for (const [name, org, role] of [
		["owner", "org", "owner"],
		["admin", "org", "admin"],
		["member", "org", "member"],
		["manager", "org", "member"],
		["foreign", "other", "owner"],
	]) {
		await pool.query(
			'insert into "user"(id,name,email,created_at,updated_at) values($1,$1,$2,now(),now())',
			[`t1536-${name}`, `${name}@t1536.example.test`],
		);
		await pool.query(
			"insert into member(id,user_id,organization_id,role,status,created_at) values($1,$1,$2,$3,'approved',now())",
			[`t1536-${name}`, `t1536-${org}`, role],
		);
	}
	await pool.query(
		"insert into employee(id,user_id,organization_id,role,is_active,updated_at) values('15360000-0000-4000-8000-000000000001','t1536-manager','t1536-org','manager',true,now())",
	);
});
afterAll(clean);
beforeEach(async () => {
	session.userId = "t1536-owner";
	session.organizationId = "t1536-org";
	await pool.query(
		"delete from equipment_setup_command where organization_id='t1536-org'",
	);
	await pool.query(
		"delete from equipment_item where organization_id='t1536-org'",
	);
	await pool.query(
		"delete from equipment_type where organization_id='t1536-org'",
	);
	await pool.query(
		"delete from equipment_policy where organization_id='t1536-org'",
	);
});

it("requires an explicit positive finite retention policy before registering equipment", async () => {
	expect(await actions.getEquipmentSetup()).toMatchObject({
		success: true,
		data: { policy: null, types: [], items: [] },
	});
	for (const retentionMonths of [
		0,
		-1,
		1.5,
		Number.POSITIVE_INFINITY,
		Number.NaN,
	]) {
		expect(
			await actions.changeEquipmentSetup({
				kind: "configure_policy",
				requestId: crypto.randomUUID(),
				expectedRevision: 0,
				retentionMonths,
			}),
		).toMatchObject({
			success: true,
			data: { ok: false, reason: "invalid_input" },
		});
	}
	expect(
		await actions.changeEquipmentSetup({
			kind: "configure_policy",
			requestId: crypto.randomUUID(),
			expectedRevision: 0,
			retentionMonths: 24,
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	expect(await actions.getEquipmentSetup()).toMatchObject({
		success: true,
		data: { policy: { retentionMonths: 24, revision: 1 } },
	});
});

async function accepted(input: Record<string, unknown>) {
	const result = await actions.changeEquipmentSetup({
		requestId: crypto.randomUUID(),
		...input,
	});
	expect(result).toMatchObject({ success: true, data: { ok: true } });
	if (!result.success || !result.data.ok)
		throw new Error("Expected equipment command to succeed");
	return result.data;
}
async function settings() {
	const result = await actions.getEquipmentSetup();
	if (!result.success) throw new Error("Expected setup read to succeed");
	return result.data;
}
const laptop = {
	kind: "create_type",
	name: "Laptop",
	trackingMode: "individual",
	defaultReturnRequired: true,
};
async function configure() {
	await accepted({
		kind: "configure_policy",
		retentionMonths: 24,
		expectedRevision: 0,
	});
}

it("blocks item registration until retention is configured and keeps defaults editable before use", async () => {
	const type = await accepted(laptop);
	expect(
		await actions.changeEquipmentSetup({
			kind: "register_item",
			requestId: crypto.randomUUID(),
			typeId: type.id,
			identifier: "L-01",
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "policy_required" },
	});
	await accepted({
		...laptop,
		kind: "update_type",
		id: type.id,
		expectedRevision: 1,
		trackingMode: "quantity",
		defaultReturnRequired: false,
	});
	expect((await settings()).types).toMatchObject([
		{ trackingMode: "quantity", defaultReturnRequired: false, used: false },
	]);
});

it("reserves case and space equivalent identifiers concurrently, including archived identities", async () => {
	await configure();
	const type = await accepted(laptop);
	const results = await Promise.all(
		["  LAP-001  ", "lap-001"].map((identifier) =>
			actions.changeEquipmentSetup({
				kind: "register_item",
				requestId: crypto.randomUUID(),
				typeId: type.id,
				identifier,
				serialNumber: "Manufacturer-12",
			}),
		),
	);
	expect(results.filter((r) => r.success && r.data.ok)).toHaveLength(1);
	expect(
		results.filter(
			(r) => r.success && !r.data.ok && r.data.reason === "identifier_taken",
		),
	).toHaveLength(1);
	const [item] = (await settings()).items;
	await accepted({ kind: "archive_item", id: item.id, expectedRevision: 1 });
	expect(
		await actions.changeEquipmentSetup({
			kind: "register_item",
			requestId: crypto.randomUUID(),
			typeId: type.id,
			identifier: "\tlAp-001\n",
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "identifier_taken" },
	});
	expect((await settings()).items).toMatchObject([
		{ id: item.id, archived: true, serialNumber: "Manufacturer-12" },
	]);
	// Model a later retirement; the setup boundary must never release its identity.
	await pool.query(
		"update equipment_item set status='retired' where organization_id='t1536-org' and id=$1",
		[item.id],
	);
	expect(
		await actions.changeEquipmentSetup({
			kind: "register_item",
			requestId: crypto.randomUUID(),
			typeId: type.id,
			identifier: "LAP-001",
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "identifier_taken" },
	});
});

it("archives a used type without losing readable identities or offering it for new registration", async () => {
	await configure();
	const type = await accepted(laptop);
	await accepted({
		kind: "register_item",
		typeId: type.id,
		identifier: "Laptop-A",
	});
	const used = (await settings()).types[0];
	expect(
		await actions.changeEquipmentSetup({
			...laptop,
			kind: "update_type",
			requestId: crypto.randomUUID(),
			id: type.id,
			expectedRevision: used.revision,
			trackingMode: "quantity",
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "tracking_mode_fixed" },
	});
	const updated = await accepted({
		...laptop,
		kind: "update_type",
		id: type.id,
		expectedRevision: used.revision,
		defaultReturnRequired: false,
	});
	await accepted({
		kind: "archive_type",
		id: type.id,
		expectedRevision: updated.revision,
	});
	expect(await settings()).toMatchObject({
		types: [{ archived: true, defaultReturnRequired: false }],
		selectableTypes: [],
		items: [{ identifier: "Laptop-A" }],
	});
	expect(
		await actions.changeEquipmentSetup({
			kind: "register_item",
			requestId: crypto.randomUUID(),
			typeId: type.id,
			identifier: "Laptop-B",
		}),
	).toMatchObject({ success: true, data: { ok: false, reason: "archived" } });
});

it("replays accepted commands once, refuses changed request reuse and stale revisions", async () => {
	const request = { ...laptop, requestId: crypto.randomUUID() };
	const [first, replay] = await Promise.all([
		actions.changeEquipmentSetup(request),
		actions.changeEquipmentSetup(request),
	]);
	expect(replay).toEqual(first);
	expect((await settings()).types).toHaveLength(1);
	expect(
		await actions.changeEquipmentSetup({ ...request, name: "Changed" }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
	const [type] = (await settings()).types;
	await accepted({
		...laptop,
		kind: "update_type",
		id: type.id,
		expectedRevision: type.revision,
		name: "New name",
	});
	expect(
		await actions.changeEquipmentSetup({
			...laptop,
			kind: "update_type",
			requestId: crypto.randomUUID(),
			id: type.id,
			expectedRevision: type.revision,
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "stale_revision" },
	});
});

it("isolates reads and forged identifiers from another organization", async () => {
	await configure();
	const type = await accepted(laptop);
	const item = await accepted({
		kind: "register_item",
		typeId: type.id,
		identifier: "L-01",
	});
	expect(
		await actions.getEquipmentSetupDetail({ kind: "item", id: item.id }),
	).toMatchObject({
		success: true,
		data: { kind: "item", record: { identifier: "L-01" } },
	});
	session.userId = "t1536-foreign";
	session.organizationId = "t1536-other";
	expect(
		await actions.getEquipmentSetupDetail({ kind: "type", id: type.id }),
	).toMatchObject({ success: true, data: null });
	expect(
		await actions.getEquipmentSetupDetail({ kind: "item", id: item.id }),
	).toMatchObject({ success: true, data: null });
	expect(await settings()).toMatchObject({
		policy: null,
		types: [],
		items: [],
	});
	for (const change of [
		{ kind: "archive_type", id: type.id, expectedRevision: 2 },
		{ kind: "archive_item", id: item.id, expectedRevision: 1 },
		{ kind: "register_item", typeId: type.id, identifier: "Other" },
	]) {
		expect(
			await actions.changeEquipmentSetup({
				...change,
				requestId: crypto.randomUUID(),
			}),
		).toMatchObject({ success: true, data: { ok: false } });
	}
	await configure();
	const own = await accepted(laptop);
	await accepted({ kind: "register_item", typeId: own.id, identifier: "L-01" });
});

it("denies ordinary employees, managers, foreign actors and inaccessible admins on reads and writes", async () => {
	for (const userId of ["t1536-member", "t1536-manager", "t1536-foreign"]) {
		session.userId = userId;
		expect(await actions.getEquipmentSetup()).toMatchObject({ success: false });
		expect(
			await actions.changeEquipmentSetup({
				...laptop,
				requestId: crypto.randomUUID(),
			}),
		).toMatchObject({ success: false });
	}
	session.userId = "t1536-admin";
	expect(await actions.getEquipmentSetup()).toMatchObject({ success: true });
	await pool.query("update member set status='pending' where id='t1536-admin'");
	try {
		expect(await actions.getEquipmentSetup()).toMatchObject({ success: false });
		expect(
			await actions.changeEquipmentSetup({
				...laptop,
				requestId: crypto.randomUUID(),
			}),
		).toMatchObject({ success: false });
	} finally {
		await pool.query(
			"update member set status='approved' where id='t1536-admin'",
		);
	}
	await pool.query(
		"insert into employee(id,user_id,organization_id,is_active,updated_at) values('15360000-0000-4000-8000-000000000002','t1536-admin','t1536-org',false,now())",
	);
	try {
		expect(await actions.getEquipmentSetup()).toMatchObject({ success: false });
		expect(
			await actions.getEquipmentSetupDetail({
				kind: "type",
				id: "15360000-0000-4000-8000-000000000010",
			}),
		).toMatchObject({ success: false });
		expect(
			await actions.changeEquipmentSetup({
				...laptop,
				requestId: crypto.randomUUID(),
			}),
		).toMatchObject({ success: false });
	} finally {
		await pool.query(
			"delete from employee where id='15360000-0000-4000-8000-000000000002' and organization_id='t1536-org'",
		);
	}
});

it("rejects malformed changes and individual identity registration for quantity types without marking them used", async () => {
	await configure();
	const quantity = await accepted({
		...laptop,
		name: "Shirts",
		trackingMode: "quantity",
	});
	for (const input of [
		null,
		{},
		{
			...laptop,
			requestId: crypto.randomUUID(),
			organizationId: "t1536-other",
		},
		{ ...laptop, requestId: crypto.randomUUID(), name: " " },
		{ ...laptop, requestId: crypto.randomUUID(), trackingMode: "unknown" },
	]) {
		expect(await actions.changeEquipmentSetup(input)).toMatchObject({
			success: true,
			data: { ok: false, reason: "invalid_input" },
		});
	}
	expect(
		await actions.changeEquipmentSetup({
			kind: "register_item",
			requestId: crypto.randomUUID(),
			typeId: quantity.id,
			identifier: "Shirt-1",
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "individual_required" },
	});
	expect((await settings()).types).toMatchObject([
		{ used: false, revision: 1 },
	]);
});
