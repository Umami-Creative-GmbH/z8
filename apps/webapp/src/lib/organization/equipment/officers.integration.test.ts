import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const session = vi.hoisted(() => ({
	userId: "t1539-owner",
	organizationId: "t1539-org",
}));
const clock = vi.hoisted(() => ({ now: "2026-11-04T23:30:00Z" }));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual =
		await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: { nowInstant: () => actual.parseInstant(clock.now) },
	};
});
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
const ids = {
	officer: "15390000-0000-4000-8000-000000000001",
	subject: "15390000-0000-4000-8000-000000000002",
	other: "15390000-0000-4000-8000-000000000003",
	team: "15390000-0000-4000-8000-000000000004",
	foreign: "15390000-0000-4000-8000-000000000005",
};
async function clean() {
	await pool.query("delete from organization where id like 't1539-%'");
	await pool.query('delete from "user" where id like $1', ["t1539-%"]);
}
beforeAll(async () => {
	await clean();
	for (const org of ["org", "foreign"])
		await pool.query(
			"insert into organization(id,name,slug,timezone,created_at) values($1,$1,$1,'Europe/Berlin',now())",
			[`t1539-${org}`],
		);
	for (const [name, role] of [
		["owner", "owner"],
		["officer", "member"],
		["subject", "member"],
		["other", "member"],
		["foreign", "owner"],
	]) {
		const org = name === "foreign" ? "t1539-foreign" : "t1539-org";
		await pool.query(
			'insert into "user"(id,name,email,created_at,updated_at) values($1,$1,$2,now(),now())',
			[`t1539-${name}`, `${name}@t1539.example.test`],
		);
		await pool.query(
			"insert into member(id,user_id,organization_id,role,status,created_at) values($1,$1,$2,$3,'approved',now())",
			[`t1539-${name}`, org, role],
		);
		if (name !== "owner")
			await pool.query(
				"insert into employee(id,user_id,organization_id,role,is_active,updated_at) values($1,$2,$3,'manager',true,now())",
				[
					ids[name as "officer" | "subject" | "other" | "foreign"],
					`t1539-${name}`,
					org,
				],
			);
	}
	await pool.query(
		"insert into team(id,organization_id,name,updated_at) values($1,'t1539-org','Operations',now())",
		[ids.team],
	);
});
afterAll(clean);
beforeEach(async () => {
	clock.now = "2026-11-04T23:30:00Z";
	session.userId = "t1539-owner";
	session.organizationId = "t1539-org";
	await pool.query(
		"delete from equipment_assignment where organization_id='t1539-org'",
	);
	await pool.query(
		"delete from equipment_item where organization_id='t1539-org'",
	);
	await pool.query(
		"delete from equipment_type where organization_id='t1539-org'",
	);
	await pool.query(
		"delete from equipment_policy where organization_id='t1539-org'",
	);
	await pool.query(
		"delete from equipment_setup_command where organization_id='t1539-org'",
	);
	await pool.query(
		"delete from equipment_former_team_scope where organization_id='t1539-org'",
	);
	await pool.query(
		"delete from team_membership where organization_id='t1539-org'",
	);
	await pool.query(
		"delete from equipment_officer_grant where organization_id='t1539-org'",
	);
	await pool.query(
		"delete from equipment_command where organization_id='t1539-org'",
	);
	await pool.query(
		"update employee set is_active=true, team_id=null where organization_id='t1539-org'",
	);
});

it("revokes live authority before replay, while preserving self-history and owner fallback", async () => {
	const command = {
		kind: "set_officer_grant",
		requestId: crypto.randomUUID(),
		employeeId: ids.officer,
		expectedRevision: 0,
		scope: "all",
		teamIds: [],
		employeeIds: [],
	};
	const first = await actions.changeEquipmentOfficerGrant(command);
	expect(await actions.changeEquipmentOfficerGrant(command)).toEqual(first);
	expect(
		await actions.changeEquipmentOfficerGrant({
			...command,
			scope: "selected",
			employeeIds: [ids.subject],
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
	expect(await grant({ expectedRevision: 0 })).toMatchObject({
		success: true,
		data: { ok: false, reason: "stale_revision" },
	});
	await actions.changeEquipmentOfficerGrant({
		kind: "revoke_officer_grant",
		requestId: crypto.randomUUID(),
		employeeId: ids.officer,
		expectedRevision: 1,
	});
	session.userId = "t1539-officer";
	expect(await actions.getEquipmentOverview()).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	expect(await actions.getEmployeeEquipment(ids.subject)).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	expect(await actions.getMyEquipment()).toMatchObject({
		success: true,
		data: { canManage: false },
	});
	expect(
		await actions.changeEquipment({
			kind: "issue_individual",
			requestId: crypto.randomUUID(),
			itemId: crypto.randomUUID(),
			employeeId: ids.subject,
			expectedRevision: 1,
			actualDate: "2026-11-01",
			condition: "good",
			returnRequired: true,
		}),
	).toMatchObject({ success: true, data: { ok: false, reason: "forbidden" } });
	session.userId = "t1539-owner";
	expect(await actions.getEquipmentOverview()).toMatchObject({
		success: true,
		data: { canManage: true, canAdminister: true },
	});
});

it("refuses former grant holders and foreign scope identifiers", async () => {
	expect(await grant({ employeeId: ids.foreign })).toMatchObject({
		success: true,
		data: { ok: false, reason: "not_found" },
	});
	expect(
		await grant({ scope: "selected", employeeIds: [ids.foreign] }),
	).toMatchObject({ success: true, data: { ok: false, reason: "not_found" } });
	expect(
		await grant({ scope: "selected", teamIds: [crypto.randomUUID()] }),
	).toMatchObject({ success: true, data: { ok: false, reason: "not_found" } });
	await grant();
	await pool.query("update employee set is_active=false where id=$1", [
		ids.officer,
	]);
	session.userId = "t1539-officer";
	expect(await actions.getEquipmentOverview()).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	expect(await actions.getMyEquipment()).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	session.userId = "t1539-owner";
	expect(await grant({ expectedRevision: 1 })).toMatchObject({
		success: true,
		data: { ok: false, reason: "employee_not_current" },
	});
});
async function grant(extra: Record<string, unknown> = {}) {
	return actions.changeEquipmentOfficerGrant({
		kind: "set_officer_grant",
		requestId: crypto.randomUUID(),
		employeeId: ids.officer,
		expectedRevision: 0,
		scope: "all",
		teamIds: [],
		employeeIds: [],
		...extra,
	});
}

it("serializes competing responsibility changes and concurrent retries", async () => {
	const command = {
		kind: "set_officer_grant",
		requestId: crypto.randomUUID(),
		employeeId: ids.officer,
		expectedRevision: 0,
		scope: "selected",
		teamIds: [ids.team],
		employeeIds: [],
	};
	const retry = await Promise.all([
		actions.changeEquipmentOfficerGrant(command),
		actions.changeEquipmentOfficerGrant(command),
	]);
	expect(retry[0]).toMatchObject({
		success: true,
		data: { ok: true, revision: 1 },
	});
	expect(retry[1]).toEqual(retry[0]);
	const changes = await Promise.all([
		grant({ expectedRevision: 1 }),
		grant({
			expectedRevision: 1,
			scope: "selected",
			employeeIds: [ids.subject],
		}),
	]);
	expect(changes.filter((r) => r.success && r.data.ok)).toHaveLength(1);
	expect(
		changes.filter(
			(r) => r.success && !r.data.ok && r.data.reason === "stale_revision",
		),
	).toHaveLength(1);
	expect(await actions.getEquipmentOfficerGrants()).toMatchObject({
		success: true,
		data: { grants: [{ revision: 2 }] },
	});
});
it("delegates equipment responsibility without granting setup administration or implied manager access", async () => {
	session.userId = "t1539-officer";
	expect(await actions.getEquipmentOverview()).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	session.userId = "t1539-owner";
	expect(await grant()).toMatchObject({
		success: true,
		data: { ok: true, revision: 1 },
	});
	expect(await actions.getEquipmentOfficerGrants()).toMatchObject({
		success: true,
		data: { grants: [{ employeeId: ids.officer, scope: "all", revision: 1 }] },
	});
	session.userId = "t1539-officer";
	expect(await actions.getEquipmentOverview()).toMatchObject({
		success: true,
		data: { canManage: true, canAdminister: false },
	});
	expect(await actions.getEquipmentSetup()).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	expect(await grant()).toMatchObject({
		success: true,
		data: { ok: false, reason: "forbidden" },
	});
});

it("revalidates selected teams and employees on every read, and uses only captured teams for former subjects", async () => {
	await pool.query("update employee set team_id=$1 where id=$2", [
		ids.team,
		ids.subject,
	]);
	expect(
		await grant({
			scope: "selected",
			teamIds: [ids.team],
			employeeIds: [ids.officer],
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	session.userId = "t1539-officer";
	expect(await actions.getEquipmentOverview()).toMatchObject({
		success: true,
		data: {
			employees: expect.arrayContaining([
				{ id: ids.subject, name: "t1539-subject", former: false },
			]),
		},
	});
	expect(await actions.getEmployeeEquipment(ids.other)).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	expect(
		await actions.getEquipmentOverview({ holderId: ids.foreign }),
	).toMatchObject({ success: false, code: "AuthorizationError" });
	await pool.query("update employee set team_id=null where id=$1", [
		ids.subject,
	]);
	expect(await actions.getEmployeeEquipment(ids.subject)).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	await pool.query(
		"insert into team_membership(organization_id,team_id,employee_id) values('t1539-org',$1,$2)",
		[ids.team, ids.subject],
	);
	expect(await actions.getEmployeeEquipment(ids.subject)).toMatchObject({
		success: true,
	});
	await pool.query("update employee set is_active=false where id=$1", [
		ids.subject,
	]);
	expect(await actions.getEmployeeEquipment(ids.subject)).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	await pool.query(
		"insert into equipment_former_team_scope(organization_id,employee_id,team_ids,captured_at) values('t1539-org',$1,ARRAY[$2]::uuid[],now())",
		[ids.subject, ids.team],
	);
	expect(await actions.getEmployeeEquipment(ids.subject)).toMatchObject({
		success: true,
	});
	expect(await actions.getEquipmentOverview({ former: true })).toMatchObject({
		success: true,
		data: {
			employees: expect.arrayContaining([
				{ id: ids.subject, name: "t1539-subject", former: true },
			]),
		},
	});
});

it("registers and issues atomically within an employee grant, without opening setup or another holder's history", async () => {
	const configure = await actions.changeEquipmentSetup({
		kind: "configure_policy",
		requestId: crypto.randomUUID(),
		expectedRevision: 0,
		retentionMonths: 24,
	});
	expect(configure).toMatchObject({ success: true, data: { ok: true } });
	const type = await actions.changeEquipmentSetup({
		kind: "create_type",
		requestId: crypto.randomUUID(),
		name: "Laptop",
		trackingMode: "individual",
		defaultReturnRequired: true,
	});
	if (!type.success || !type.data.ok) throw new Error("type failed");
	await grant({ scope: "selected", employeeIds: [ids.subject] });
	session.userId = "t1539-officer";
	const command = {
		kind: "register_and_issue_individual",
		requestId: crypto.randomUUID(),
		typeId: type.data.id,
		identifier: "L-OFFICER",
		employeeId: ids.subject,
		expectedRevision: 0,
		actualDate: "2026-11-01",
		condition: "good",
		returnRequired: true,
	};
	const result = await actions.changeEquipment(command);
	expect(result).toMatchObject({ success: true, data: { ok: true } });
	expect(await actions.changeEquipment(command)).toEqual(result);
	expect(await actions.getEmployeeEquipment(ids.subject)).toMatchObject({
		success: true,
		data: { assignments: [{ identifier: "L-OFFICER", canReceive: true }] },
	});
	const originalHistory = await actions.getEmployeeEquipment(ids.subject);
	if (!originalHistory.success) throw new Error("equipment read failed");
	const originalItem = originalHistory.data.assignments[0].itemId;
	if (!result.success || !result.data.ok) throw new Error("issue failed");
	expect(
		await actions.changeEquipment({
			kind: "receive_individual",
			assignmentId: result.data.id,
			expectedRevision: 1,
			requestId: crypto.randomUUID(),
			actualDate: "2026-11-02",
			condition: "damaged",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	expect(
		await actions.changeEquipment({
			kind: "clear_item",
			itemId: originalItem,
			expectedRevision: 3,
			requestId: crypto.randomUUID(),
		}),
	).toMatchObject({ success: true, data: { ok: true, revision: 4 } });
	session.userId = "t1539-owner";
	expect(
		await actions.changeEquipment({
			kind: "issue_individual",
			itemId: originalItem,
			employeeId: ids.other,
			expectedRevision: 4,
			requestId: crypto.randomUUID(),
			actualDate: "2026-11-03",
			condition: "good",
			returnRequired: true,
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	session.userId = "t1539-officer";
	const afterTransfer = await actions.getEquipmentOverview();
	if (!afterTransfer.success) throw new Error("scope read failed");
	expect(
		afterTransfer.data.readinessItems.map((item) => item.id),
	).not.toContain(originalItem);
	expect(
		await actions.changeEquipment({
			kind: "retire_item",
			itemId: originalItem,
			expectedRevision: 5,
			requestId: crypto.randomUUID(),
		}),
	).toMatchObject({ success: true, data: { ok: false, reason: "forbidden" } });
	expect(
		await actions.changeEquipment({
			...command,
			requestId: crypto.randomUUID(),
			identifier: "L-FORBIDDEN",
			employeeId: ids.other,
		}),
	).toMatchObject({ success: true, data: { ok: false, reason: "forbidden" } });
	session.userId = "t1539-owner";
	expect(await actions.getEquipmentSetup()).toMatchObject({
		success: true,
		data: { items: [{ identifier: "L-OFFICER", inCustody: true }] },
	});
	// A stale officer page cannot replay a committed command after its subject leaves scope.
	await grant({
		expectedRevision: 1,
		scope: "selected",
		employeeIds: [ids.officer],
	});
	session.userId = "t1539-officer";
	const scopedOverview = await actions.getEquipmentOverview();
	if (!scopedOverview.success) throw new Error("overview failed");
	expect(
		scopedOverview.data.readinessItems.map((item) => item.id),
	).not.toContain(originalItem);
	expect(
		await actions.changeEquipment({
			kind: "retire_item",
			itemId: originalItem,
			expectedRevision: 2,
			requestId: crypto.randomUUID(),
		}),
	).toMatchObject({ success: true, data: { ok: false, reason: "forbidden" } });
	expect(await actions.changeEquipment(command)).toMatchObject({
		success: true,
		data: { ok: false, reason: "forbidden" },
	});
	if (!result.success || !result.data.ok) throw new Error("issuance failed");
	expect(
		await actions.changeEquipment({
			kind: "receive_individual",
			assignmentId: result.data.id,
			requestId: crypto.randomUUID(),
			expectedRevision: 1,
			actualDate: "2026-11-02",
			condition: "good",
		}),
	).toMatchObject({ success: true, data: { ok: false, reason: "forbidden" } });
	const own = await actions.changeEquipment({
		...command,
		identifier: "SELF",
		employeeId: ids.officer,
		requestId: crypto.randomUUID(),
	});
	if (!own.success || !own.data.ok) throw new Error("self issuance failed");
	const ownEquipment = await actions.getMyEquipment();
	if (!ownEquipment.success) throw new Error("self history failed");
	const ownItem = ownEquipment.data.assignments[0].itemId;
	expect(
		await actions.changeEquipment({
			kind: "mark_item_unavailable",
			itemId: ownItem,
			expectedRevision: 2,
			requestId: crypto.randomUUID(),
		}),
	).toMatchObject({ success: true, data: { ok: true, revision: 3 } });
	expect(
		await actions.changeEquipment({
			kind: "receive_individual",
			assignmentId: own.data.id,
			requestId: crypto.randomUUID(),
			expectedRevision: 1,
			actualDate: "2026-11-02",
			condition: "good",
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "self_receipt" },
	});
	// Two different requests cannot reserve case/space equivalent identities twice.
	const concurrent = await Promise.all([
		actions.changeEquipment({
			...command,
			identifier: "  DUPLICATE ",
			employeeId: ids.officer,
			requestId: crypto.randomUUID(),
		}),
		actions.changeEquipment({
			...command,
			identifier: "duplicate",
			employeeId: ids.officer,
			requestId: crypto.randomUUID(),
		}),
	]);
	expect(concurrent.filter((r) => r.success && r.data.ok)).toHaveLength(1);
	expect(
		concurrent.filter(
			(r) => r.success && !r.data.ok && r.data.reason === "identifier_taken",
		),
	).toHaveLength(1);
	const rollback = {
		...command,
		identifier: "L-ROLLBACK",
		employeeId: ids.officer,
		requestId: crypto.randomUUID(),
	};
	await pool.query(`CREATE FUNCTION t1539_fail_registration() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.organization_id = 't1539-org' AND NEW.identifier = 'L-ROLLBACK' AND NEW.in_custody THEN RAISE EXCEPTION 'simulated custody failure'; END IF;
 RETURN NEW; END $$;
 CREATE TRIGGER t1539_fail_registration BEFORE UPDATE ON equipment_item FOR EACH ROW EXECUTE FUNCTION t1539_fail_registration()`);
	try {
		expect(await actions.changeEquipment(rollback)).toMatchObject({
			success: false,
			code: "DatabaseError",
		});
		const personal = await actions.getMyEquipment();
		expect(personal).toMatchObject({ success: true });
		if (!personal.success) throw new Error("self read failed");
		expect(personal.data.assignments.map((a) => a.identifier)).not.toContain(
			"L-ROLLBACK",
		);
	} finally {
		await pool.query(
			"DROP TRIGGER t1539_fail_registration ON equipment_item; DROP FUNCTION t1539_fail_registration()",
		);
	}
	expect(await actions.changeEquipment(rollback)).toMatchObject({
		success: true,
		data: { ok: true },
	});
});

it("applies live officer scope to quantity issuance and partial receipts", async () => {
	await actions.changeEquipmentSetup({
		kind: "configure_policy",
		requestId: crypto.randomUUID(),
		expectedRevision: 0,
		retentionMonths: 24,
	});
	const type = await actions.changeEquipmentSetup({
		kind: "create_type",
		requestId: crypto.randomUUID(),
		name: "Shirts",
		trackingMode: "quantity",
		defaultReturnRequired: true,
	});
	if (!type.success || !type.data.ok) throw new Error("quantity setup failed");
	await grant({ scope: "selected", employeeIds: [ids.subject] });
	session.userId = "t1539-officer";
	const command = {
		kind: "issue_quantity",
		requestId: crypto.randomUUID(),
		expectedRevision: type.data.revision,
		typeId: type.data.id,
		employeeId: ids.subject,
		quantity: 3,
		actualDate: "2026-11-01",
		condition: "good",
		returnRequired: true,
	};
	const result = await actions.changeEquipment(command);
	expect(result).toMatchObject({ success: true, data: { ok: true } });
	expect(
		await actions.changeEquipment({
			...command,
			requestId: crypto.randomUUID(),
			employeeId: ids.other,
		}),
	).toMatchObject({ success: true, data: { ok: false, reason: "forbidden" } });
	if (!result.success || !result.data.ok)
		throw new Error("quantity issue failed");
	const receipt = {
		kind: "receive_quantity",
		requestId: crypto.randomUUID(),
		assignmentId: result.data.id,
		expectedRevision: 1,
		quantity: 2,
		actualDate: "2026-11-02",
		condition: "good",
	};
	session.userId = "t1539-owner";
	await grant({
		expectedRevision: 1,
		scope: "selected",
		employeeIds: [ids.other],
	});
	session.userId = "t1539-officer";
	expect(await actions.changeEquipment(receipt)).toMatchObject({
		success: true,
		data: { ok: false, reason: "forbidden" },
	});
	session.userId = "t1539-owner";
	await grant({
		expectedRevision: 2,
		scope: "selected",
		employeeIds: [ids.subject],
	});
	session.userId = "t1539-officer";
	expect(await actions.changeEquipment(receipt)).toMatchObject({
		success: true,
		data: { ok: true, revision: 2 },
	});
	expect(await actions.getEmployeeEquipment(ids.subject)).toMatchObject({
		success: true,
		data: {
			assignments: [
				{ quantity: 3, physicallyReceivedQuantity: 2, outstandingQuantity: 1 },
			],
		},
	});
});

it("denies officer authority at a pending departure's live cutoff before follow-up runs", async () => {
	await grant();
	const { db } = await import("@/db");
	const { createDepartureCommands } = await import(
		"@/lib/employee-lifecycle/commands"
	);
	const { createDepartureClockOut } = await import(
		"@/lib/employee-lifecycle/clock-out"
	);
	const { parseInstant } = await import("@/lib/datetime/temporal-core");
	await pool.query(
		"insert into employee_employment_period(id,organization_id,employee_id,status,started_at,start_provenance) values('15390000-0000-4000-8000-000000000100','t1539-org',$1,'open','2026-01-01Z','recorded')",
		[ids.officer],
	);
	const commands = createDepartureCommands({
		db,
		clock: { nowInstant: () => parseInstant(clock.now) },
		clockOut: createDepartureClockOut(),
	});
	await commands.scheduleDeparture(
		{ userId: "t1539-owner", organizationId: "t1539-org" },
		{
			employeeId: ids.officer,
			requestId: crypto.randomUUID(),
			expectedRevision: null,
			lastWorkingDay: "2026-11-05",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		},
	);
	session.userId = "t1539-officer";
	expect(await actions.getEquipmentOverview()).toMatchObject({ success: true });
	clock.now = "2026-11-05T23:30:00Z";
	expect(await actions.getEquipmentOverview()).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	expect(
		await actions.changeEquipment({
			kind: "issue_individual",
			requestId: crypto.randomUUID(),
			expectedRevision: 1,
			itemId: crypto.randomUUID(),
			employeeId: ids.subject,
			actualDate: "2026-11-05",
			condition: "good",
			returnRequired: true,
		}),
	).toMatchObject({ success: false, code: "AuthorizationError" });
	session.userId = "t1539-owner";
	expect(await grant({ expectedRevision: 1 })).toMatchObject({
		success: true,
		data: { ok: false, reason: "employee_not_current" },
	});
});
