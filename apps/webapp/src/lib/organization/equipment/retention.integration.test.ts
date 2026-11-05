import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
	integrationAdminPool,
	openIntegrationPool,
} from "@/test/integration-database";

const session = vi.hoisted(() => ({
	userId: "t1549-owner",
	organizationId: "t1549-org",
}));
const clock = vi.hoisted(() => ({ now: "2026-01-31T22:30:00Z" }));
const transport = vi.hoisted(() => ({
	mail: vi.fn(async () => ({ success: true })),
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
vi.mock("@/lib/email/email-service", async (original) => ({
	...(await (
		await import("@/test/integration-harness")
	).emailService(original)),
	getTransportName: async () => "smtp",
	sendEmail: transport.mail,
}));
vi.mock("@/lib/app-url", () => ({
	getOrganizationBaseUrl: async () => "https://z8.test",
}));
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
const holderId = "15490000-0000-4000-8000-000000000001";
const recipientId = "15490000-0000-4000-8000-000000000002";
async function clean() {
	await pool.query("delete from organization where id like 't1549-%'");
	await pool.query('delete from "user" where id like $1', ["t1549-%"]);
}
beforeAll(async () => {
	await clean();
	for (const org of ["t1549-org", "t1549-other"])
		await pool.query(
			"insert into organization(id,name,slug,timezone,created_at) values($1,$1,$1,'Europe/Berlin',now())",
			[org],
		);
	for (const [name, org, role] of [
		["owner", "org", "owner"],
		["holder", "org", "member"],
		["manager", "org", "member"],
		["foreign", "other", "owner"],
	]) {
		await pool.query(
			'insert into "user"(id,name,email,created_at,updated_at) values($1,$1,$2,now(),now())',
			[`t1549-${name}`, `${name}@t1549.example.test`],
		);
		await pool.query(
			"insert into member(id,user_id,organization_id,role,status,created_at) values($1,$1,$2,$3,'approved',now())",
			[`t1549-${name}`, `t1549-${org}`, role],
		);
	}
	await pool.query(
		"insert into employee(id,user_id,organization_id,role,is_active,updated_at) values($1,'t1549-holder','t1549-org','employee',true,now())",
		[holderId],
	);
	await pool.query(
		"insert into employee(id,user_id,organization_id,role,is_active,updated_at) values($1,'t1549-manager','t1549-org','manager',true,now())",
		[recipientId],
	);
});
afterAll(clean);
beforeEach(async () => {
	transport.mail.mockClear();
	await pool.query(
		"update member set role=case when id='t1549-owner' then 'owner' else 'member' end,status='approved' where id in ('t1549-owner','t1549-manager')",
	);
	session.userId = "t1549-owner";
	session.organizationId = "t1549-org";
	clock.now = "2026-01-31T22:30:00Z";
	for (const table of [
		"equipment_assignment",
		"equipment_command",
		"equipment_setup_command",
		"equipment_item",
		"equipment_type",
		"equipment_policy",
	])
		await pool.query(`delete from ${table} where organization_id='t1549-org'`);
});

it("atomically removes sent/read reminder content and delivery evidence without clearing outstanding dedup", async () => {
	const assignment = await issue({ explicitDeadline: "2026-01-31" });
	const { runEquipmentRemindersJob } = await import(
		"@/lib/jobs/equipment-reminders"
	);
	const { getUserNotifications } = await import(
		"@/lib/notifications/notification-service"
	);
	const { runEquipmentRetentionJob } = await import(
		"@/lib/jobs/equipment-retention"
	);
	await runEquipmentRemindersJob();
	const inbox = () =>
		getUserNotifications("t1549-holder", "t1549-org", { limit: 100 });
	expect((await inbox()).notifications).toHaveLength(1);
	const firstLedger = (
		await pool.query(
			"select count(*)::int as n from equipment_reminder_delivery where organization_id='t1549-org'",
		)
	).rows[0].n;
	expect(firstLedger).toBeGreaterThan(0);
	// An old outstanding return cannot lose its dedup rows on an ordinary retention run.
	clock.now = "2026-03-01T00:00:00Z";
	expect((await runEquipmentRetentionJob()).deletedCount).toBe(0);
	expect(
		(
			await pool.query(
				"select count(*)::int as n from equipment_reminder_delivery where organization_id='t1549-org'",
			)
		).rows[0].n,
	).toBe(firstLedger);
	await command({
		kind: "close_return",
		assignmentId: assignment.id,
		quantity: 3,
		outcome: "waived",
		reason: "Private employee waiver",
		expectedRevision: 1,
	});
	await pool.query(
		"update notification set is_read=true where organization_id='t1549-org'",
	);
	await pool.query(
		"insert into notification(user_id,organization_id,type,title,message,entity_type,entity_id,is_read,metadata) values('t1549-foreign','t1549-other','equipment_return_reminder','Foreign notice','Foreign personal content','equipment_assignment',$1,true,'foreign metadata')",
		[assignment.id],
	);
	clock.now = "2026-04-01T22:00:00Z";
	expect(await runEquipmentRetentionJob()).toMatchObject({
		deletedCount: 1,
		errors: [],
	});
	expect((await inbox()).notifications).toEqual([]);
	expect(
		(await getUserNotifications("t1549-foreign", "t1549-other", { limit: 100 }))
			.notifications,
	).toMatchObject([{ message: "Foreign personal content" }]);
	expect(
		(
			await pool.query(
				"select count(*)::int as n from equipment_reminder_delivery where organization_id='t1549-org'",
			)
		).rows[0].n,
	).toBe(0);
	const sentBefore = transport.mail.mock.calls.length;
	await runEquipmentRemindersJob();
	await runEquipmentRetentionJob();
	await runEquipmentRemindersJob();
	expect((await inbox()).notifications).toEqual([]);
	expect(transport.mail.mock.calls).toHaveLength(sentBefore);
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
async function command(input: Record<string, unknown>) {
	const result = await actions.changeEquipment({
		requestId: crypto.randomUUID(),
		...input,
	});
	if (!result.success || !result.data.ok)
		throw new Error(JSON.stringify(result));
	return result.data;
}
async function issue(extra: Record<string, unknown> = {}) {
	await setup({
		kind: "configure_policy",
		retentionMonths: 1,
		expectedRevision: 0,
	});
	const type = await setup({
		kind: "create_type",
		name: "Shirts",
		trackingMode: "quantity",
		defaultReturnRequired: true,
	});
	return command({
		kind: "issue_quantity",
		typeId: type.id,
		employeeId: holderId,
		quantity: 3,
		returnRequired: true,
		actualDate: "2026-01-31",
		condition: "good",
		notes: "Private original handover",
		expectedRevision: 1,
		...extra,
	});
}
async function view() {
	const result = await actions.getEmployeeEquipment(holderId);
	if (!result.success) throw new Error(JSON.stringify(result));
	return result.data;
}
it("cleans closed history at the organization calendar boundary, never a partial outstanding return", async () => {
	const assignment = await issue();
	await command({
		kind: "receive_quantity",
		assignmentId: assignment.id,
		quantity: 2,
		actualDate: "2026-01-31",
		condition: "good",
		expectedRevision: 1,
	});
	clock.now = "2026-03-01T00:00:00Z";
	const { runEquipmentRetentionJob } = await import(
		"@/lib/jobs/equipment-retention"
	);
	expect((await runEquipmentRetentionJob()).deletedCount).toBe(0);
	expect((await view()).assignments[0].outstandingQuantity).toBe(1);
	clock.now = "2026-03-02T10:00:00Z";
	await command({
		kind: "close_return",
		assignmentId: assignment.id,
		quantity: 1,
		outcome: "lost",
		reason: "Private decision",
		expectedRevision: 2,
	});
	clock.now = "2026-04-02T21:59:59Z";
	expect((await runEquipmentRetentionJob()).deletedCount).toBe(0);
	clock.now = "2026-04-02T22:00:00Z";
	expect((await runEquipmentRetentionJob()).deletedCount).toBe(1);
	expect((await view()).assignments).toEqual([]);
	expect((await runEquipmentRetentionJob()).deletedCount).toBe(0);
});

it("requires attributable admin hold reasons and current revisions, replays safely, and restarts retention on release", async () => {
	const assignment = await issue({ returnRequired: false });
	const request = {
		kind: "place_case_hold",
		assignmentId: assignment.id,
		requestId: crypto.randomUUID(),
		expectedRevision: 1,
		reason: "Case 47: preserve the original handover",
	};
	expect(
		await actions.changeEquipment({ ...request, reason: " " }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "invalid_input" },
	});
	session.userId = "t1549-manager";
	expect(await actions.changeEquipment(request)).toMatchObject({
		success: true,
		data: { ok: false, reason: "forbidden" },
	});
	session.userId = "t1549-foreign";
	session.organizationId = "t1549-other";
	expect(await actions.changeEquipment(request)).toMatchObject({
		success: true,
		data: { ok: false, reason: "not_found" },
	});
	session.userId = "t1549-owner";
	session.organizationId = "t1549-org";
	expect(await actions.changeEquipment(request)).toMatchObject({
		success: true,
		data: { ok: true, revision: 2 },
	});
	expect(await actions.changeEquipment(request)).toMatchObject({
		success: true,
		data: { ok: true, revision: 2 },
	});
	expect(
		await actions.changeEquipment({
			...request,
			reason: "Changed explanation",
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
	clock.now = "2027-01-01T12:00:00Z";
	const { runEquipmentRetentionJob } = await import(
		"@/lib/jobs/equipment-retention"
	);
	expect(await runEquipmentRetentionJob()).toMatchObject({
		deletedCount: 0,
		errors: [],
	});
	expect((await view()).assignments[0]).toMatchObject({
		retention: { status: "case_hold", caseHeld: true },
		caseHolds: [
			{ reason: request.reason, actorName: "t1549-owner", kind: "place" },
		],
	});
	expect(
		await actions.changeEquipment({
			...request,
			kind: "release_case_hold",
			requestId: crypto.randomUUID(),
			expectedRevision: 1,
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "stale_revision" },
	});
	await command({
		...request,
		kind: "release_case_hold",
		expectedRevision: 2,
		requestId: crypto.randomUUID(),
		reason: "Case closed",
	});
	expect((await view()).assignments[0]).toMatchObject({
		retention: {
			status: "retained",
			caseHeld: false,
			expiresAt: "2027-02-01T23:00:00Z",
		},
		caseHolds: [{ kind: "place" }, { kind: "release", reason: "Case closed" }],
	});
	expect((await runEquipmentRetentionJob()).deletedCount).toBe(0);
	clock.now = "2027-02-01T23:00:00Z";
	expect((await runEquipmentRetentionJob()).deletedCount).toBe(1);
	expect((await view()).assignments).toEqual([]);
});

it.each([
	"keep",
	"lost",
	"waived",
	"recovered",
	"damaged",
	"unavailable",
	"retired",
] as const)(
	"preserves normalized identity and independent custody/readiness after %s cleanup",
	async (outcome) => {
		await setup({
			kind: "configure_policy",
			retentionMonths: 1,
			expectedRevision: 0,
		});
		const type = await setup({
			kind: "create_type",
			name: "Laptop",
			trackingMode: "individual",
			defaultReturnRequired: true,
		});
		const item = await setup({
			kind: "register_item",
			typeId: type.id,
			identifier: " LAP-01 ",
		});
		const requestId = crypto.randomUUID();
		const payload = {
			kind: "issue_individual",
			requestId,
			itemId: item.id,
			employeeId: holderId,
			returnRequired: outcome !== "keep",
			actualDate: "2026-01-31",
			condition: "good",
			notes: "Personal handover",
			expectedRevision: 1,
		};
		const assignment = await command(payload);
		if (outcome === "lost" || outcome === "waived" || outcome === "recovered") {
			await command({
				kind: "close_return",
				assignmentId: assignment.id,
				quantity: 1,
				outcome: outcome === "waived" ? "waived" : "lost",
				reason: "Personal exception",
				expectedRevision: 1,
			});
			if (outcome === "recovered") {
				const decision = (await view()).assignments[0].exceptions[0];
				await command({
					kind: "receive_exception",
					assignmentId: assignment.id,
					exceptionId: decision.id,
					quantity: 1,
					actualDate: "2026-01-31",
					condition: "good",
					expectedRevision: 2,
				});
			}
		} else if (outcome !== "keep") {
			await command({
				kind: "receive_individual",
				assignmentId: assignment.id,
				actualDate: "2026-01-31",
				condition: outcome === "damaged" ? "damaged" : "good",
				expectedRevision: 1,
			});
			if (outcome === "unavailable" || outcome === "retired")
				await command({
					kind: outcome === "retired" ? "retire_item" : "mark_item_unavailable",
					itemId: item.id,
					expectedRevision: 3,
				});
		}
		clock.now = "2026-03-01T00:00:00Z";
		const { runEquipmentRetentionJob } = await import(
			"@/lib/jobs/equipment-retention"
		);
		expect(await runEquipmentRetentionJob()).toMatchObject({
			deletedCount: 1,
			errors: [],
		});
		expect((await view()).assignments).toEqual([]);
		const overview = await actions.getEquipmentOverview();
		if (!overview.success) throw new Error(JSON.stringify(overview));
		const inCustody = ["keep", "lost", "waived"].includes(outcome);
		const status =
			outcome === "retired"
				? "retired"
				: ["damaged", "unavailable"].includes(outcome)
					? "unavailable"
					: "available";
		expect(overview.data.readinessItems).toMatchObject([
			{ id: item.id, inCustody, status, personalHistoryCleaned: true },
		]);
		expect(overview.data.availableItems.map((i) => i.id)).toEqual(
			!inCustody && status === "available" ? [item.id] : [],
		);
		expect(
			await actions.changeEquipmentSetup({
				kind: "register_item",
				requestId: crypto.randomUUID(),
				typeId: type.id,
				identifier: "lap-01",
			}),
		).toMatchObject({
			success: true,
			data: { ok: false, reason: "identifier_taken" },
		});
		expect(await actions.changeEquipment(payload)).toMatchObject({
			success: true,
			data: { ok: false, reason: "history_removed" },
		});
		expect(
			(
				await pool.query(
					"select fingerprint,result from equipment_command where organization_id=$1 and request_id=$2",
					[session.organizationId, requestId],
				)
			).rows,
		).toEqual([{ fingerprint: null, result: null }]);
		expect(
			(
				await pool.query(
					"select created_by,updated_by from equipment_item where organization_id='t1549-org' and id=$1",
					[item.id],
				)
			).rows,
		).toEqual([{ created_by: null, updated_by: null }]);
		expect(
			(
				await pool.query(
					"select count(*)::int as n from equipment_command where organization_id='t1549-org' and fingerprint is not null",
				)
			).rows[0].n,
		).toBe(0);
		if (inCustody)
			expect(
				await actions.changeEquipment({
					kind: "clear_item",
					requestId: crypto.randomUUID(),
					itemId: item.id,
					expectedRevision: overview.data.readinessItems[0].revision,
				}),
			).toMatchObject({
				success: true,
				data: { ok: false, reason: "item_in_custody" },
			});
	},
);

it("does not recreate a quantity issuance when an old request is retried after cleanup", async () => {
	const requestId = crypto.randomUUID();
	await issue({ requestId, returnRequired: false });
	const before = await view();
	clock.now = "2026-03-01T00:00:00Z";
	const { runEquipmentRetentionJob } = await import(
		"@/lib/jobs/equipment-retention"
	);
	expect((await runEquipmentRetentionJob()).deletedCount).toBe(1);
	expect(
		await actions.changeEquipment({
			kind: "issue_quantity",
			requestId,
			typeId: before.assignments[0].typeId,
			employeeId: holderId,
			quantity: 3,
			returnRequired: false,
			actualDate: "2026-01-31",
			condition: "good",
			notes: "Private original handover",
			expectedRevision: 1,
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "history_removed" },
	});
	expect((await view()).assignments).toEqual([]);
});

it("rolls back every deletion and command minimization on failure, then retries without losing the original evidence", async () => {
	const assignment = await issue({ returnRequired: false });
	clock.now = "2026-03-01T12:00:00Z";
	await pool.query(
		`create function t1549_refuse_cleanup() returns trigger language plpgsql as $$ begin if OLD.organization_id='t1549-org' then raise exception 'private case evidence'; end if; return OLD; end $$`,
	);
	await pool.query(
		"create trigger t1549_refuse_cleanup before delete on equipment_assignment for each row execute function t1549_refuse_cleanup()",
	);
	const { runEquipmentRetentionJob } = await import(
		"@/lib/jobs/equipment-retention"
	);
	try {
		expect(await runEquipmentRetentionJob()).toMatchObject({
			deletedCount: 0,
			errors: [
				{
					organizationId: "t1549-org",
					error: "Equipment retention cleanup failed",
				},
			],
		});
		expect((await view()).assignments).toMatchObject([
			{ id: assignment.id, issue: { notes: "Private original handover" } },
		]);
		expect(
			(
				await pool.query(
					"select count(*)::int as n from equipment_command where organization_id='t1549-org' and result->>'id'=$1 and fingerprint is not null",
					[assignment.id],
				)
			).rows[0].n,
		).toBe(1);
	} finally {
		await pool.query(
			"drop trigger t1549_refuse_cleanup on equipment_assignment",
		);
		await pool.query("drop function t1549_refuse_cleanup()");
	}
	expect(await runEquipmentRetentionJob()).toMatchObject({
		deletedCount: 1,
		errors: [],
	});
	expect((await view()).assignments).toEqual([]);
});

async function waitForLockWaiters(count: number) {
	const deadline = performance.now() + 5000;
	while (performance.now() < deadline) {
		const result = await pool.query(
			"select count(*)::int as count from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%FROM organization WHERE id%' and pid<>pg_backend_pid()",
		);
		if (result.rows[0].count >= count) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(
		"Equipment transactions did not reach the organization lock barrier",
	);
}

it.each(["hold", "correction", "receipt", "recovery"] as const)(
	"rechecks activity/protection after a racing %s wins the lifecycle lock",
	async (kind) => {
		const assignment = await issue({ returnRequired: false });
		let revision = 1;
		let exceptionId: string | undefined;
		if (kind === "recovery") {
			await command({
				kind: "correct_issue",
				assignmentId: assignment.id,
				expectedRevision: 1,
				quantity: 3,
				actualDate: "2026-01-31",
				condition: "good",
				notes: "",
				returnRequired: true,
				explicitDeadline: null,
				employmentPeriodId: null,
				reason: "Required return",
			});
			await command({
				kind: "close_return",
				assignmentId: assignment.id,
				expectedRevision: 2,
				quantity: 3,
				outcome: "lost",
				reason: "Recorded loss",
			});
			revision = 3;
			exceptionId = (await view()).assignments[0].exceptions[0].id;
		}
		clock.now = "2026-03-01T12:00:00Z";
		const connections = openIntegrationPool({ max: 1 });
		const blocker = await connections.connect();
		await blocker.query("begin");
		await blocker.query(
			"select id from organization where id='t1549-org' for update",
		);
		const write = command(
			kind === "hold"
				? {
						kind: "place_case_hold",
						assignmentId: assignment.id,
						reason: "Open case",
						expectedRevision: revision,
					}
				: kind === "receipt" || kind === "recovery"
					? {
							kind:
								kind === "recovery" ? "receive_exception" : "receive_quantity",
							assignmentId: assignment.id,
							...(exceptionId ? { exceptionId } : {}),
							quantity: 3,
							actualDate: "2026-03-01",
							condition: "good",
							expectedRevision: revision,
						}
					: {
							kind: "correct_issue",
							assignmentId: assignment.id,
							quantity: 3,
							actualDate: "2026-01-31",
							condition: "worn",
							notes: "Later correction",
							returnRequired: true,
							explicitDeadline: null,
							employmentPeriodId: null,
							reason: "Checked later",
							expectedRevision: revision,
						},
		);
		try {
			await waitForLockWaiters(1);
			const { runEquipmentRetentionJob } = await import(
				"@/lib/jobs/equipment-retention"
			);
			const cleanup = runEquipmentRetentionJob();
			await waitForLockWaiters(2);
			await blocker.query("commit");
			await write;
			expect(await cleanup).toMatchObject({ deletedCount: 0, errors: [] });
			expect((await view()).assignments[0].retention).toMatchObject({
				status:
					kind === "hold"
						? "case_hold"
						: kind === "correction"
							? "outstanding"
							: "retained",
				lastActivityAt: "2026-03-01T12:00:00Z",
			});
		} finally {
			await blocker.query("rollback");
			blocker.release();
			await connections.end();
		}
	},
);

it("removes an expired transfer peer without orphaning personal evidence or permitting unpaired quantity/date amendments", async () => {
	const source = await issue({ quantity: 1 });
	const issuanceRevision = (await view()).assignments[0].transfer
		?.expectedIssuanceRevision;
	clock.now = "2026-02-01T12:00:00Z";
	const destination = await command({
		kind: "transfer_equipment",
		assignmentId: source.id,
		employeeId: recipientId,
		quantity: 1,
		expectedRevision: 1,
		expectedIssuanceRevision: issuanceRevision,
		receipt: {
			actualDate: "2026-02-01",
			condition: "good",
			notes: "Personal source transfer",
		},
		issue: {
			actualDate: "2026-02-01",
			condition: "good",
			notes: "Personal destination transfer",
			returnRequired: true,
		},
	});
	clock.now = "2026-03-01T12:00:00Z";
	const { runEquipmentRetentionJob } = await import(
		"@/lib/jobs/equipment-retention"
	);
	// Source's February 1 latest activity expires after March 1, Berlin local midnight.
	expect((await runEquipmentRetentionJob()).deletedCount).toBe(0);
	clock.now = "2026-03-01T23:00:00Z";
	expect((await runEquipmentRetentionJob()).deletedCount).toBe(1);
	expect((await view()).assignments).toEqual([]);
	const read = await actions.getEmployeeEquipment(recipientId);
	if (!read.success) throw new Error(JSON.stringify(read));
	expect(read.data.assignments).toHaveLength(1);
	const remaining = read.data.assignments[0];
	expect(remaining).toMatchObject({
		id: destination.id,
		outstandingQuantity: 1,
		correctionTransfers: [],
	});
	expect(
		await actions.changeEquipment({
			kind: "correct_issue",
			requestId: crypto.randomUUID(),
			assignmentId: destination.id,
			expectedRevision: 1,
			quantity: 2,
			actualDate: "2026-02-01",
			condition: "good",
			notes: "Personal destination transfer",
			returnRequired: true,
			explicitDeadline: null,
			employmentPeriodId: null,
			reason: "Increase linked issue",
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "transfer_conflict" },
	});
	expect(
		(
			await pool.query(
				"select count(*)::int as n from equipment_transfer where organization_id='t1549-org'",
			)
		).rows[0].n,
	).toBe(0);
	expect(
		(
			await pool.query(
				"select count(*)::int as n from equipment_handover where organization_id='t1549-org' and assignment_id=$1",
				[source.id],
			)
		).rows[0].n,
	).toBe(0);
});

it("keeps anonymous individual custody chronology when older retained assignments are corrected", async () => {
	await setup({
		kind: "configure_policy",
		retentionMonths: 1,
		expectedRevision: 0,
	});
	const type = await setup({
		kind: "create_type",
		name: "Laptop",
		trackingMode: "individual",
		defaultReturnRequired: true,
	});
	const item = await setup({
		kind: "register_item",
		typeId: type.id,
		identifier: "L-KEEP",
	});
	const old = await command({
		kind: "issue_individual",
		itemId: item.id,
		employeeId: holderId,
		returnRequired: true,
		actualDate: "2026-01-31",
		condition: "good",
		expectedRevision: 1,
	});
	await command({
		kind: "receive_individual",
		assignmentId: old.id,
		actualDate: "2026-01-31",
		condition: "good",
		expectedRevision: 1,
	});
	await command({
		kind: "place_case_hold",
		assignmentId: old.id,
		reason: "Hold only this older evidence",
		expectedRevision: 2,
	});
	clock.now = "2026-02-01T12:00:00Z";
	const kept = await command({
		kind: "issue_individual",
		itemId: item.id,
		employeeId: recipientId,
		returnRequired: false,
		actualDate: "2026-02-01",
		condition: "good",
		expectedRevision: 3,
	});
	clock.now = "2026-03-01T23:00:00Z";
	const { runEquipmentRetentionJob } = await import(
		"@/lib/jobs/equipment-retention"
	);
	expect((await runEquipmentRetentionJob()).deletedCount).toBe(1);
	const retained = (await view()).assignments[0];
	await command({
		kind: "correct_issue",
		assignmentId: old.id,
		expectedRevision: 3,
		quantity: 1,
		actualDate: "2026-01-31",
		condition: "worn",
		notes: "Checked retained original",
		returnRequired: true,
		explicitDeadline: null,
		employmentPeriodId: retained.employmentPeriodId,
		reason: "Condition correction",
	});
	const overview = await actions.getEquipmentOverview();
	if (!overview.success) throw new Error(JSON.stringify(overview));
	expect(overview.data.readinessItems[0]).toMatchObject({
		id: item.id,
		inCustody: true,
	});
	expect(overview.data.availableItems).toEqual([]);
	expect(
		(
			await pool.query(
				"select employee_id from equipment_assignment where organization_id='t1549-org' and id=$1",
				[kept.id],
			)
		).rows,
	).toEqual([]);
	// The removed later holder's custody cannot be erased by reversing an older receipt.
	expect(
		await actions.changeEquipment({
			kind: "correct_receipt",
			requestId: crypto.randomUUID(),
			assignmentId: old.id,
			handoverId: retained.receipts[0].id,
			expectedRevision: 4,
			quantity: 0,
			actualDate: "2026-01-31",
			condition: "good",
			reason: "Attempt to reopen earlier custody",
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "conflicting_history" },
	});
});

it.each(["keep", "lost", "waived"])(
	"receives purged %s custody with two independent live authorized staff and keeps personal history erased",
	async (outcome) => {
		await setup({
			kind: "configure_policy",
			retentionMonths: 1,
			expectedRevision: 0,
		});
		const type = await setup({
			kind: "create_type",
			name: "Recoverable laptop",
			trackingMode: "individual",
			defaultReturnRequired: true,
		});
		const item = await setup({
			kind: "register_item",
			typeId: type.id,
			identifier: "ANONYMOUS-RECEIPT",
		});
		const held = await command({
			kind: "issue_individual",
			itemId: item.id,
			employeeId: holderId,
			returnRequired: outcome !== "keep",
			actualDate: "2026-01-31",
			condition: "good",
			notes: "Erase private holder note",
			expectedRevision: 1,
		});
		if (outcome !== "keep")
			await command({
				kind: "close_return",
				assignmentId: held.id,
				quantity: 1,
				outcome,
				reason: "Erase private exception",
				expectedRevision: 1,
			});
		clock.now = "2026-03-01T23:00:00Z";
		const { runEquipmentRetentionJob } = await import(
			"@/lib/jobs/equipment-retention"
		);
		expect((await runEquipmentRetentionJob()).deletedCount).toBe(1);
		const overview = await actions.getEquipmentOverview();
		if (!overview.success) throw new Error(JSON.stringify(overview));
		const cleaned = overview.data.readinessItems.find((i) => i.id === item.id);
		if (!cleaned) throw new Error("Missing anonymous item");
		const proposal = {
			kind: "propose_custody_receipt",
			itemId: item.id,
			requestId: crypto.randomUUID(),
			expectedRevision: cleaned.revision,
			actualDate: "2026-03-01",
			condition: "damaged",
		};
		const proposed = await actions.changeEquipment(proposal);
		expect(proposed).toMatchObject({ success: true, data: { ok: true } });
		expect(await actions.changeEquipment(proposal)).toEqual(proposed);
		const pending = await actions.getEquipmentOverview();
		if (!pending.success) throw new Error(JSON.stringify(pending));
		const current = pending.data.readinessItems.find((i) => i.id === item.id);
		if (!current?.custodyReceipt) throw new Error("Missing receipt proposal");
		expect(current).toMatchObject({
			inCustody: true,
			canClear: false,
			custodyReceipt: {
				actualDate: "2026-03-01",
				condition: "damaged",
				confirmedAt: null,
				canConfirm: false,
			},
		});
		const confirm = {
			kind: "confirm_custody_receipt",
			itemId: item.id,
			proposalId: current.custodyReceipt?.id,
			requestId: crypto.randomUUID(),
			expectedRevision: current.revision,
		};
		expect(await actions.changeEquipment(confirm)).toMatchObject({
			success: true,
			data: { ok: false, reason: "self_receipt" },
		});
		await pool.query("update member set role='admin' where id='t1549-manager'");
		session.userId = "t1549-manager";
		expect(await actions.changeEquipment(confirm)).toMatchObject({
			success: true,
			data: { ok: true },
		});
		expect(await actions.changeEquipment(confirm)).toMatchObject({
			success: true,
			data: { ok: true },
		});
		expect((await view()).assignments).toEqual([]);
		const received = await actions.getEquipmentOverview();
		if (!received.success) throw new Error(JSON.stringify(received));
		const ready = received.data.readinessItems.find((i) => i.id === item.id);
		if (!ready) throw new Error("Missing received item");
		expect(ready).toMatchObject({
			inCustody: false,
			status: "unavailable",
			canClear: true,
			custodyReceipt: {
				condition: "damaged",
				actualDate: "2026-03-01",
				proposedBy: "t1549-owner",
				confirmedBy: "t1549-manager",
				confirmedAt: expect.any(String),
			},
		});
		const reissue = {
			kind: "issue_individual",
			itemId: item.id,
			employeeId: holderId,
			returnRequired: true,
			actualDate: "2026-03-01",
			condition: "good",
			expectedRevision: ready.revision,
			requestId: crypto.randomUUID(),
		};
		expect(await actions.changeEquipment(reissue)).toMatchObject({
			success: true,
			data: { ok: false, reason: "item_unavailable" },
		});
		await command({
			kind: "clear_item",
			itemId: item.id,
			expectedRevision: ready.revision,
		});
		expect(
			await actions.changeEquipment({
				...reissue,
				expectedRevision: ready.revision + 1,
			}),
		).toMatchObject({ success: true, data: { ok: true } });
		await pool.query(
			"update member set role='member' where id='t1549-manager'",
		);
	},
);

async function purgedCustody() {
	await setup({
		kind: "configure_policy",
		retentionMonths: 1,
		expectedRevision: 0,
	});
	const type = await setup({
		kind: "create_type",
		name: "Late recovery",
		trackingMode: "individual",
		defaultReturnRequired: false,
	});
	const item = await setup({
		kind: "register_item",
		typeId: type.id,
		identifier: "LATE-RECOVERY",
	});
	const held = await command({
		kind: "issue_individual",
		itemId: item.id,
		employeeId: holderId,
		returnRequired: false,
		actualDate: "2026-01-31",
		condition: "good",
		expectedRevision: 1,
	});
	// Anonymous receipt cannot bypass a surviving holder's ordinary receipt boundary.
	expect(
		await actions.changeEquipment({
			kind: "propose_custody_receipt",
			itemId: item.id,
			requestId: crypto.randomUUID(),
			expectedRevision: 2,
			actualDate: "2026-01-31",
			condition: "good",
		}),
	).toMatchObject({ success: true, data: { ok: false, reason: "forbidden" } });
	clock.now = "2026-03-01T23:00:00Z";
	const { runEquipmentRetentionJob } = await import(
		"@/lib/jobs/equipment-retention"
	);
	expect((await runEquipmentRetentionJob()).deletedCount).toBe(1);
	return { item, held };
}
async function custodyItem(id: string) {
	const r = await actions.getEquipmentOverview();
	if (!r.success) throw new Error(JSON.stringify(r));
	const item = r.data.readinessItems.find((i) => i.id === id);
	if (!item) throw new Error("Missing custody item");
	return item;
}
it("keeps anonymous receipts organization-wide, live-authorized, dated and serialized with reissue", async () => {
	const { item } = await purgedCustody();
	const propose = {
		kind: "propose_custody_receipt",
		itemId: item.id,
		requestId: crypto.randomUUID(),
		expectedRevision: 2,
		actualDate: "2026-03-01",
		condition: "good",
	};
	expect(
		await actions.changeEquipment({ ...propose, actualDate: "2026-03-03" }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "future_date" },
	});
	expect(
		await actions.changeEquipment({ ...propose, actualDate: "2026-01-30" }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "conflicting_history" },
	});
	session.userId = "t1549-manager";
	expect(await actions.changeEquipment(propose)).toMatchObject({
		success: true,
		data: { ok: false, reason: "forbidden" },
	});
	session.userId = "t1549-owner";
	await command(propose);
	const proposal = (await custodyItem(item.id)).custodyReceipt;
	if (!proposal) throw new Error("Missing proposal");
	const confirm = {
		kind: "confirm_custody_receipt",
		itemId: item.id,
		proposalId: proposal.id,
		requestId: crypto.randomUUID(),
		expectedRevision: 3,
	};
	session.organizationId = "t1549-other";
	session.userId = "t1549-foreign";
	expect(await actions.changeEquipment(confirm)).toMatchObject({
		success: true,
		data: { ok: false, reason: "not_found" },
	});
	session.organizationId = "t1549-org";
	session.userId = "t1549-manager";
	await pool.query(
		"update member set role='admin',status='pending' where id='t1549-manager'",
	);
	expect(await actions.changeEquipment(confirm)).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	await pool.query(
		"update member set status='approved' where id='t1549-manager'",
	);
	await pool.query("update member set role='owner' where id='t1549-manager'");
	await pool.query("update member set role='member' where id='t1549-owner'");
	expect(await actions.changeEquipment(confirm)).toMatchObject({
		success: true,
		data: { ok: false, reason: "forbidden" },
	});
	await pool.query("update member set role='owner' where id='t1549-owner'");
	expect(
		await actions.changeEquipment({ ...confirm, expectedRevision: 2 }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "stale_revision" },
	});
	const retry = { ...confirm, requestId: crypto.randomUUID() };
	const [one, two, issue] = await Promise.all([
		actions.changeEquipment(confirm),
		actions.changeEquipment(retry),
		actions.changeEquipment({
			kind: "issue_individual",
			requestId: crypto.randomUUID(),
			itemId: item.id,
			employeeId: holderId,
			expectedRevision: 4,
			actualDate: "2026-03-01",
			condition: "good",
			returnRequired: true,
		}),
	]);
	expect([one, two].filter((r) => r.success && r.data.ok)).toHaveLength(1);
	expect([one, two].filter((r) => r.success && !r.data.ok)).toHaveLength(1);
	expect(issue.success).toBe(true);
	const overview = await actions.getEquipmentOverview();
	if (!overview.success) throw new Error(JSON.stringify(overview));
	expect(
		overview.data.assignments.filter((a) => a.itemId === item.id).length,
	).toBeLessThanOrEqual(1);
	await pool.query("update member set role='member' where id='t1549-manager'");
	expect(
		await actions.changeEquipment(one.success && one.data.ok ? confirm : retry),
	).toMatchObject({ success: true, data: { ok: false, reason: "forbidden" } });
});
it("expires receipt actors and pending proposals without releasing custody or reviving history", async () => {
	const { item } = await purgedCustody();
	await command({
		kind: "propose_custody_receipt",
		itemId: item.id,
		expectedRevision: 2,
		actualDate: "2026-03-01",
		condition: "worn",
	});
	clock.now = "2026-04-03T00:00:00Z";
	const { runEquipmentRetentionJob } = await import(
		"@/lib/jobs/equipment-retention"
	);
	await runEquipmentRetentionJob();
	expect(await custodyItem(item.id)).toMatchObject({
		inCustody: true,
		canProposeCustodyReceipt: true,
		custodyReceipt: undefined,
	});
	await command({
		kind: "propose_custody_receipt",
		itemId: item.id,
		expectedRevision: 3,
		actualDate: "2026-04-01",
		condition: "good",
	});
	const pending = await custodyItem(item.id);
	await pool.query("update member set role='admin' where id='t1549-manager'");
	session.userId = "t1549-manager";
	await command({
		kind: "confirm_custody_receipt",
		itemId: item.id,
		proposalId: pending.custodyReceipt?.id,
		expectedRevision: 4,
	});
	clock.now = "2026-05-04T00:00:00Z";
	await runEquipmentRetentionJob();
	expect(await custodyItem(item.id)).toMatchObject({
		inCustody: false,
		custodyReceipt: undefined,
	});
	expect((await view()).assignments).toEqual([]);
	await pool.query("update member set role='member' where id='t1549-manager'");
});
it("receives retired anonymous custody without restoring readiness", async () => {
	const { item } = await purgedCustody();
	await command({ kind: "retire_item", itemId: item.id, expectedRevision: 2 });
	await command({
		kind: "propose_custody_receipt",
		itemId: item.id,
		expectedRevision: 3,
		actualDate: "2026-03-01",
		condition: "good",
	});
	const pending = await custodyItem(item.id);
	await pool.query("update member set role='admin' where id='t1549-manager'");
	session.userId = "t1549-manager";
	await command({
		kind: "confirm_custody_receipt",
		itemId: item.id,
		proposalId: pending.custodyReceipt?.id,
		expectedRevision: 4,
	});
	expect(await custodyItem(item.id)).toMatchObject({
		inCustody: false,
		status: "retired",
		canClear: false,
	});
	expect(
		await actions.changeEquipment({
			kind: "clear_item",
			itemId: item.id,
			expectedRevision: 5,
			requestId: crypto.randomUUID(),
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "item_retired" },
	});
	await pool.query("update member set role='member' where id='t1549-manager'");
});
