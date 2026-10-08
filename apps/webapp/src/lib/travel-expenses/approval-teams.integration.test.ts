/**
 * #746: an approved expense report records the employee's teams (ADR 0002).
 *
 * Reports are submitted, approved, reopened, reimbursed and adjusted through
 * the real report, Approvals inbox and finance actions against a disposable
 * PostgreSQL database; the session, notifications, the job queue and object
 * storage are replaced. The backfill runs the statements of migration 0135.
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t746-org",
	tus: new Map<string, Buffer>(),
}));
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));
vi.mock("@/env", async (original) => ({
	env: {
		...(await original<typeof import("@/env")>()).env,
		TRAVEL_EXPENSE_MAX_UPLOAD_SIZE_BYTES: "1024",
	},
}));
vi.mock("@/lib/notifications/triggers", async (original) =>
	(await import("@/test/integration-harness")).notificationTriggers(original, [
		"onTravelExpenseReportDecided",
		"onTravelExpenseReportReturned",
	]),
);
vi.mock("@/lib/queue", () => ({
	async addJob() {
		return { id: randomUUID() };
	},
}));
// An unawaited delivery pass would outlive its test and deadlock the next cleanup.
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t746-public",
	s3Client: {
		async send(command: { input: { Key: string } }) {
			if (command.constructor.name === "DeleteObjectCommand") {
				harness.tus.delete(command.input.Key);
				return {};
			}
			const bytes = harness.tus.get(command.input.Key);
			if (!bytes) throw new Error("NoSuchKey");
			return {
				ContentLength: bytes.length,
				Body: { transformToByteArray: async () => new Uint8Array(bytes) },
			};
		},
	},
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	async uploadPrivateObject(_organizationId: string, key: string) {
		return { bucket: "t746-private", versionId: `v-${key.length}` };
	},
	async deletePrivateObject() {},
}));

const { db } = await import("@/db");
const actions = await import("@/app/[locale]/(app)/travel-expenses/report-actions");
const reopenActions = await import("@/app/[locale]/(app)/travel-expenses/report-reopen-actions");
const adjustments = await import("@/app/[locale]/(app)/travel-expenses/adjustment-actions");
const finance = await import("@/app/[locale]/(app)/travel-expenses/finance-actions");
const claimActions = await import("@/app/[locale]/(app)/travel-expenses/actions");
const { readApprovalTeamIds } = await import("@/lib/travel-expenses/approval-teams");
const { insertLegacyTravelExpenseDraft, submitLegacyTravelExpenseClaim } = await import(
	"./__tests__/legacy-claim"
);
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const migration = await readFile(
	new URL("../../../drizzle/0135_travel_expense_approval_teams.sql", import.meta.url),
	"utf8",
);
/** The backfill statements of the migration; the columns already exist here. */
const backfill = migration
	.split("--> statement-breakpoint")
	.filter((statement) => /^\s*(--[^\n]*\n\s*)*UPDATE/i.test(statement));

const ids = {
	requester: "e7460000-0000-4000-8000-000000000001",
	manager: "e7460000-0000-4000-8000-000000000002",
	admin: "e7460000-0000-4000-8000-000000000003",
	leaver: "e7460000-0000-4000-8000-000000000004",
	loner: "e7460000-0000-4000-8000-000000000005",
	foreigner: "e7460000-0000-4000-8000-000000000006",
} as const;
type Person = keyof typeof ids;

const teams = {
	sales: "e7460000-0000-4000-8000-0000000000a1",
	field: "e7460000-0000-4000-8000-0000000000a2",
	support: "e7460000-0000-4000-8000-0000000000a3",
	legal: "e7460000-0000-4000-8000-0000000000a4",
	gone: "e7460000-0000-4000-8000-0000000000a5",
	foreign: "e7460000-0000-4000-8000-0000000000a6",
} as const;

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

async function cleanup() {
	await admin.query("delete from organization where id in ('t746-org', 't746-foreign')");
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't746-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t746-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t746-org','Expenses','t746-org','Europe/Berlin',now()),
		 ('t746-foreign','Foreign','t746-foreign','UTC',now())`,
	);
	const people: Array<[Person, string, string, string]> = [
		["requester", "t746-org", "member", "employee"],
		["manager", "t746-org", "member", "manager"],
		["admin", "t746-org", "admin", "admin"],
		["leaver", "t746-org", "member", "employee"],
		["loner", "t746-org", "member", "employee"],
		["foreigner", "t746-foreign", "owner", "admin"],
	];
	for (const [name, organizationId, memberRole, role] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t746-${name}`, name, `t746-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t746-member-${name}`, organizationId, `t746-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[ids[name], `t746-${name}`, organizationId, role],
		);
	}
	await admin.query(
		`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
		 values (gen_random_uuid(), $1, $2, true, 't746-manager', now(), now())`,
		[ids.requester, ids.manager],
	);
	for (const [name, id] of Object.entries(teams)) {
		await admin.query(
			"insert into team (id, organization_id, name, updated_at) values ($1, $2, $3, now())",
			[id, name === "foreign" ? "t746-foreign" : "t746-org", name],
		);
	}
	// The requester works in sales and also belongs to the field team.
	await placeRequester(teams.sales, [teams.field]);
}

/** Sets the requester's team and replaces their team memberships. */
async function placeRequester(teamId: string | null, memberships: string[] = []) {
	await admin.query("update employee set team_id = $1 where id = $2", [teamId, ids.requester]);
	await admin.query("delete from team_membership where employee_id = $1", [ids.requester]);
	for (const membership of memberships) {
		await admin.query(
			"insert into team_membership (organization_id, team_id, employee_id) values ('t746-org', $1, $2)",
			[membership, ids.requester],
		);
	}
}

function signIn(name: Person) {
	harness.userId = `t746-${name}`;
	harness.organizationId = name === "foreigner" ? "t746-foreign" : "t746-org";
}

async function upload(reportId: string, itemId: string) {
	signIn("requester");
	const tusFileKey = createOwnedTusFileKey("t746-requester");
	harness.tus.set(tusFileKey, pdfBytes);
	const response = await processReceipt(
		new Request("http://localhost/api/upload/travel-expense/report-receipt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tusFileKey, reportId, itemId, fileName: "taxi.pdf" }),
		}) as unknown as NextRequest,
	);
	expect(response.status).toBe(200);
}

async function loadOwn(reportId: string) {
	signIn("requester");
	const loaded = await actions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	return loaded.data;
}

async function submit(reportId: string) {
	const report = await loadOwn(reportId);
	const submitted = await actions.submitTravelExpenseReportAction({
		reportId,
		reviewed: {
			detailsVersion: report.trip?.version ?? null,
			items: report.items.map((item) => ({
				id: item.id,
				version: item.version,
				receiptIds: item.receipts.map((receipt) => receipt.id),
			})),
		},
	});
	if (!submitted.success) throw new Error(submitted.error);
	return submitted.data.status;
}

async function saveAmount(reportId: string, amount: string) {
	const report = await loadOwn(reportId);
	const item = report.items[0];
	if (!item) throw new Error("no item");
	const saved = await actions.saveReceiptItemDraftAction({
		reportId,
		itemId: item.id,
		expectedVersion: item.version,
		values: {
			expenseDate: "2026-09-02",
			category: "transport",
			description: "Taxi",
			amount,
			currency: "EUR",
			paidBy: "employee",
			accountingReference: null,
		},
	});
	if (!saved.success || saved.data.status !== "saved") throw new Error("save failed");
	return item.id;
}

/** A standalone EUR 12.50 taxi receipt, submitted. */
async function submittedReceipt(expected = "submitted") {
	signIn("requester");
	const created = await actions.createStandaloneReceiptReportAction();
	if (!created.success) throw new Error(created.error);
	const reportId = created.data.reportId;
	const itemId = await saveAmount(reportId, "12.50");
	await upload(reportId, itemId);
	expect(await submit(reportId)).toBe(expected);
	return reportId;
}

async function approve(reportId: string, as: Person = "manager") {
	const { rows } = await admin.query<{ id: string }>(
		"select id from approval_request where entity_type = 'travel_expense_report' and entity_id = $1 and status = 'pending'",
		[reportId],
	);
	const requestId = rows[0]?.id;
	if (!requestId) throw new Error("no pending request");
	signIn(as);
	const response = await approveRoute(
		new Request(`http://localhost/api/approvals/inbox/${requestId}/approve`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		}) as unknown as NextRequest,
		{ params: Promise.resolve({ id: requestId }) },
	);
	expect(response.status).toBe(200);
	return reportId;
}

function reportTeams(reportId: string, organizationId = "t746-org") {
	return readApprovalTeamIds(db, { organizationId, source: { type: "report", id: reportId } });
}

function claimTeams(claimId: string) {
	return readApprovalTeamIds(db, {
		organizationId: "t746-org",
		source: { type: "legacy_claim", id: claimId },
	});
}

async function storedReportTeams(reportId: string) {
	const { rows } = await admin.query<{ approval_team_ids: string[] | null }>(
		"select approval_team_ids from travel_expense_report where id = $1",
		[reportId],
	);
	return rows[0]?.approval_team_ids;
}

/** A legacy claim of `person` stored with `status`, as claims decided before #621 were. */
async function legacyClaim(
	person: Person,
	status: "draft" | "submitted" | "approved" | "rejected",
) {
	const { rows } = await admin.query<{ id: string }>(
		`insert into travel_expense_claim (organization_id, employee_id, type, status, trip_start, trip_end,
		   original_currency, original_amount, calculated_currency, calculated_amount,
		   submitted_at, decided_at, created_by, updated_at)
		 values ('t746-org', $1, 'receipt', $2, now(), now(), 'EUR', 10, 'EUR', 10, $3, $4, $5, now())
		 returning id`,
		[
			ids[person],
			status,
			status === "draft" ? null : new Date(),
			status === "approved" || status === "rejected" ? new Date() : null,
			`t746-${person}`,
		],
	);
	const id = rows[0]?.id;
	if (!id) throw new Error("claim insert returned no row");
	return id;
}

async function runBackfill() {
	expect(backfill.length).toBeGreaterThan(0);
	for (const statement of backfill) await admin.query(statement);
}

const sorted = (...teamIds: string[]) => teamIds.toSorted();

describe("teams recorded on approved expense reports (#746)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
	});
	afterAll(cleanup);

	it("records the employee's team and memberships at the final approval, and never changes them", async () => {
		const reportId = await submittedReceipt();
		// A submitted report has no recorded teams yet.
		expect(await storedReportTeams(reportId)).toBeNull();
		expect(await reportTeams(reportId)).toEqual([]);

		await approve(reportId);
		expect(await reportTeams(reportId)).toEqual(sorted(teams.sales, teams.field));

		// Moving the employee afterwards changes nothing.
		await placeRequester(teams.support, []);
		expect(await reportTeams(reportId)).toEqual(sorted(teams.sales, teams.field));
		// Another organization never reads them.
		expect(await reportTeams(reportId, "t746-foreign")).toEqual([]);
	});

	it("records nothing at an intermediate chain stage, and the teams at the final one", async () => {
		const policyId = randomUUID();
		await admin.query(
			`insert into approval_policy (id, organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, 't746-org', 'T746 two stages', true, 1, 't746-manager', now())`,
			[policyId],
		);
		await admin.query(
			`insert into approval_policy_stage (id, organization_id, policy_id, step_order, label, approver_type,
			   approver_employee_id, fallback_behavior, updated_at) values
			 (gen_random_uuid(), 't746-org', $1, 1, 'Manager', 'direct_manager', null, 'fail', now()),
			 (gen_random_uuid(), 't746-org', $1, 2, 'Admin', 'specific_employee', $2, 'fail', now())`,
			[policyId, ids.admin],
		);
		const reportId = await approve(await submittedReceipt());
		expect(await storedReportTeams(reportId)).toBeNull();

		// The teams in force at the final approval are the ones recorded.
		await placeRequester(teams.support, []);
		await approve(reportId, "admin");
		expect(await reportTeams(reportId)).toEqual([teams.support]);
	});

	it("records none for an employee without teams", async () => {
		await placeRequester(null, []);
		const reportId = await approve(await submittedReceipt());
		expect(await storedReportTeams(reportId)).toEqual([]);
		expect(await reportTeams(reportId)).toEqual([]);
	});

	it("records the teams when an organization owner's report is approved on submission", async () => {
		await admin.query("update member set role = 'owner' where id = 't746-member-requester'");
		await admin.query("update employee set role = 'admin' where id = $1", [ids.requester]);
		await admin.query("delete from employee_managers where employee_id = $1", [ids.requester]);

		const reportId = await submittedReceipt("self_approved");
		expect(await reportTeams(reportId)).toEqual(sorted(teams.sales, teams.field));
	});

	it("records the teams again when a reopened report is approved again", async () => {
		const reportId = await approve(await submittedReceipt());
		signIn("manager");
		expect(
			await reopenActions.reopenTravelExpenseReportAction({
				reportId,
				submissionCycle: 1,
				reason: "Wrong amount",
			}),
		).toEqual({ success: true, data: { status: "reopened" } });

		await placeRequester(teams.support, [teams.legal]);
		await saveAmount(reportId, "10.00");
		expect(await submit(reportId)).toBe("submitted");
		// Until the new approval, the report keeps the teams of its last approval.
		expect(await reportTeams(reportId)).toEqual(sorted(teams.sales, teams.field));

		await approve(reportId);
		expect(await reportTeams(reportId)).toEqual(sorted(teams.support, teams.legal));
	});

	it("resolves an adjustment report to its original report's teams", async () => {
		const original = await approve(await submittedReceipt());
		signIn("admin");
		const paid = await finance.recordTravelExpenseReimbursementAction({
			source: { type: "report", id: original },
			idempotencyKey: randomUUID(),
			amount: "12.50",
			occurredOn: "2026-10-01",
			reference: "SEPA-746",
			note: null,
			expectedBalance: { currency: "EUR", amount: "12.50" },
		});
		expect(paid).toMatchObject({ success: true, data: { status: "recorded" } });

		await placeRequester(teams.support, []);
		signIn("requester");
		const created = await adjustments.createTravelExpenseAdjustmentAction({
			originalReportId: original,
			reason: "The taxi refunded part of the fare",
			idempotencyKey: randomUUID(),
		});
		if (!created.success || created.data.status !== "created") throw new Error("no adjustment");
		const adjustment = created.data.reportId;
		await saveAmount(adjustment, "10.00");
		expect(await submit(adjustment)).toBe("submitted");
		await approve(adjustment);

		expect(await reportTeams(adjustment)).toEqual(sorted(teams.sales, teams.field));
		// Its own row records nothing: the original's teams are the only record.
		expect(await storedReportTeams(adjustment)).toBeNull();
	});

	it("records the teams when a submitted legacy claim is approved", async () => {
		const requester = {
			organizationId: "t746-org",
			employeeId: ids.requester,
			userId: "t746-requester",
		};
		const claimId = await insertLegacyTravelExpenseDraft(db, requester);
		await submitLegacyTravelExpenseClaim(db, { ...requester, claimId });
		expect(await claimTeams(claimId)).toEqual([]);

		signIn("manager");
		expect(await claimActions.approveTravelExpenseClaim({ claimId })).toEqual({
			success: true,
			data: { status: "approved" },
		});
		expect(await claimTeams(claimId)).toEqual(sorted(teams.sales, teams.field));

		await placeRequester(teams.support, []);
		expect(await claimTeams(claimId)).toEqual(sorted(teams.sales, teams.field));
	});

	it("backfills approved reports and legacy claims once, departed employees by their last team", async () => {
		const approvedBefore = await approve(await submittedReceipt());
		const recordedAlready = await approve(await submittedReceipt());
		const pending = await submittedReceipt();
		// Approved before this change: nothing recorded.
		await admin.query("update travel_expense_report set approval_team_ids = null where id = $1", [
			approvedBefore,
		]);
		await admin.query("update travel_expense_report set approval_team_ids = $1 where id = $2", [
			[teams.legal],
			recordedAlready,
		]);

		// The leaver was in support, then in legal, and left without a team.
		await admin.query("update employee set team_id = $1 where id = $2", [
			teams.support,
			ids.leaver,
		]);
		await admin.query("update employee set team_id = $1 where id = $2", [teams.legal, ids.leaver]);
		await admin.query("update employee set team_id = null, is_active = false where id = $1", [
			ids.leaver,
		]);
		const leaverClaim = await legacyClaim("leaver", "approved");
		const lonerClaim = await legacyClaim("loner", "approved");
		const requesterClaim = await legacyClaim("requester", "approved");
		const draftClaim = await legacyClaim("requester", "draft");
		const rejectedClaim = await legacyClaim("requester", "rejected");

		await runBackfill();

		expect(await reportTeams(approvedBefore)).toEqual(sorted(teams.sales, teams.field));
		expect(await reportTeams(recordedAlready)).toEqual([teams.legal]);
		expect(await storedReportTeams(pending)).toBeNull();
		expect(await claimTeams(requesterClaim)).toEqual(sorted(teams.sales, teams.field));
		expect(await claimTeams(leaverClaim)).toEqual([teams.legal]);
		expect(await claimTeams(lonerClaim)).toEqual([]);
		const { rows } = await admin.query<{ id: string; approval_team_ids: string[] | null }>(
			"select id, approval_team_ids from travel_expense_claim where id = any($1)",
			[[lonerClaim, draftClaim, rejectedClaim]],
		);
		expect(Object.fromEntries(rows.map((row) => [row.id, row.approval_team_ids]))).toEqual({
			[lonerClaim]: [],
			[draftClaim]: null,
			[rejectedClaim]: null,
		});

		// Once only: a later team move and a second run change nothing.
		await placeRequester(teams.support, []);
		await runBackfill();
		expect(await reportTeams(approvedBefore)).toEqual(sorted(teams.sales, teams.field));
		expect(await claimTeams(requesterClaim)).toEqual(sorted(teams.sales, teams.field));
	});

	it("backfills a departed employee whose last team was deleted with none", async () => {
		await admin.query("update employee set team_id = $1 where id = $2", [teams.gone, ids.leaver]);
		await admin.query("update employee set team_id = null, is_active = false where id = $1", [
			ids.leaver,
		]);
		await admin.query("delete from team where id = $1", [teams.gone]);
		const claim = await legacyClaim("leaver", "approved");

		await runBackfill();
		expect(await claimTeams(claim)).toEqual([]);
	});
});
