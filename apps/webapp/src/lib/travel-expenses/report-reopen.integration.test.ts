/**
 * #614: reopen approved travel expense reports safely before export or reimbursement.
 *
 * Reports are submitted, approved, exported and reimbursed through the real
 * report, Approvals inbox and finance actions against a disposable PostgreSQL
 * database; the session, notifications, the job queue and object storage are
 * replaced. The export worker is simulated by running the processor.
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t614-org",
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
	jobs: [] as Array<{ organizationId: string; batchId: string; attempt: number }>,
	notifications: [] as Array<{ reportId: string; note: string }>,
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
vi.mock("@/lib/notifications/triggers", async (original) => ({
	...(await original<typeof import("@/lib/notifications/triggers")>()),
	onTravelExpenseReportDecided: async () => {},
	onTravelExpenseReportReturned: async (params: { reportId: string; note: string }) => {
		harness.notifications.push({ reportId: params.reportId, note: params.note });
	},
}));
vi.mock("@/lib/queue", () => ({
	async addJob(
		_name: string,
		data: { organizationId: string; batchId: string; attempt: number },
		options?: { jobId?: string },
	) {
		harness.jobs.push({
			organizationId: data.organizationId,
			batchId: data.batchId,
			attempt: data.attempt,
		});
		return { id: options?.jobId };
	},
}));
// An unawaited delivery pass would outlive its test and deadlock the next cleanup.
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t614-public",
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
	async uploadPrivateObject(_organizationId: string, key: string, data: Buffer) {
		harness.objects.set(key, Buffer.from(data));
		return { bucket: "t614-private", versionId: `v-${key.length}` };
	},
	async readPrivateObject(input: { key: string }) {
		const bytes = harness.objects.get(input.key);
		if (!bytes) throw new Error("NoSuchKey");
		return bytes;
	},
	async deletePrivateObject(input: { key: string }) {
		harness.objects.delete(input.key);
	},
}));

const { db } = await import("@/db");
const actions = await import("@/app/[locale]/(app)/travel-expenses/report-actions");
const reopenActions = await import("@/app/[locale]/(app)/travel-expenses/report-reopen-actions");
const exportActions = await import("@/app/[locale]/(app)/travel-expenses/finance-export-actions");
const finance = await import("@/app/[locale]/(app)/travel-expenses/finance-actions");
const exportStore = await import("@/lib/travel-expenses/export-store");
const { processTravelExpenseExportBatch } = await import("@/lib/travel-expenses/export-processor");
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ids = {
	requester: "e6140000-0000-4000-8000-000000000001",
	manager: "e6140000-0000-4000-8000-000000000002",
	admin: "e6140000-0000-4000-8000-000000000003",
	colleague: "e6140000-0000-4000-8000-000000000004",
	foreigner: "e6140000-0000-4000-8000-000000000005",
} as const;
type Person = keyof typeof ids;

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

async function cleanup() {
	await admin.query("delete from organization where id in ('t614-org', 't614-foreign')");
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't614-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t614-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t614-org','Expenses','t614-org','Europe/Berlin',now()),
		 ('t614-foreign','Foreign','t614-foreign','UTC',now())`,
	);
	// The admin is an organization approval manager with finance access.
	const people: Array<[Person, string, string, string]> = [
		["requester", "t614-org", "member", "employee"],
		["manager", "t614-org", "member", "manager"],
		["admin", "t614-org", "admin", "admin"],
		["colleague", "t614-org", "member", "manager"],
		["foreigner", "t614-foreign", "owner", "admin"],
	];
	for (const [name, organizationId, memberRole, role] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t614-${name}`, name, `t614-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t614-member-${name}`, organizationId, `t614-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[ids[name], `t614-${name}`, organizationId, role],
		);
	}
	await admin.query(
		`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
		 values (gen_random_uuid(), $1, $2, true, 't614-manager', now(), now())`,
		[ids.requester, ids.manager],
	);
}

function signIn(name: Person) {
	harness.userId = `t614-${name}`;
	harness.organizationId = name === "foreigner" ? "t614-foreign" : "t614-org";
}

async function upload(reportId: string, itemId: string) {
	signIn("requester");
	const tusFileKey = createOwnedTusFileKey("t614-requester");
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
	expect(submitted).toEqual({ success: true, data: { status: "submitted" } });
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

/** A submitted standalone EUR 12.50 taxi receipt. */
async function submittedReceipt() {
	signIn("requester");
	const created = await actions.createStandaloneReceiptReportAction();
	if (!created.success) throw new Error(created.error);
	const reportId = created.data.reportId;
	const itemId = await saveAmount(reportId, "12.50");
	await upload(reportId, itemId);
	await submit(reportId);
	return reportId;
}

async function pendingRequest(reportId: string) {
	const { rows } = await admin.query<{ id: string }>(
		"select id from approval_request where entity_type = 'travel_expense_report' and entity_id = $1 and status = 'pending'",
		[reportId],
	);
	const id = rows[0]?.id;
	if (!id) throw new Error("no pending request");
	return id;
}

async function approve(reportId: string) {
	const requestId = await pendingRequest(reportId);
	signIn("manager");
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

function reopen(as: Person, reportId: string, submissionCycle: number, reason: string) {
	signIn(as);
	return reopenActions.reopenTravelExpenseReportAction({ reportId, submissionCycle, reason });
}

function reopenState(as: Person, reportId: string) {
	signIn(as);
	return reopenActions.getTravelExpenseReportReopenState(reportId);
}

async function currentRevision(reportId: string) {
	const { rows } = await admin.query<{ id: string }>(
		`select r.id from approval_submitted_revision r join travel_expense_report t on t.id = r.source_id
		 where r.source_type = 'travel_expense_report' and r.source_id = $1
		   and r.request_cycle_key = 'travel_expense_report:' || t.id || ':submission:' || t.submission_count`,
		[reportId],
	);
	const id = rows[0]?.id;
	if (!id) throw new Error("no revision");
	return { reportId, revisionId: id };
}

async function createExport(selection: Array<{ reportId: string; revisionId: string }>) {
	signIn("admin");
	const result = await exportActions.createTravelExpenseExportAction({
		idempotencyKey: randomUUID(),
		selection,
	});
	if (!result.success) throw new Error(result.error);
	return result.data;
}

async function runWorker() {
	for (const job of harness.jobs.splice(0)) {
		await processTravelExpenseExportBatch(db, job);
	}
}

function reimburse(reportId: string, amount: string, expected: string) {
	signIn("admin");
	return finance.recordTravelExpenseReimbursementAction({
		source: { type: "report", id: reportId },
		idempotencyKey: randomUUID(),
		amount,
		occurredOn: "2026-10-01",
		reference: "SEPA-4711",
		note: null,
		expectedBalance: { currency: "EUR", amount: expected },
	});
}

async function reportRow(reportId: string) {
	const { rows } = await admin.query<{
		status: string;
		submission_count: number;
		requests: Array<{ status: string }>;
		decisions: number;
		revisions: number;
	}>(
		`select r.status, r.submission_count,
		   coalesce((select json_agg(json_build_object('status', a.status) order by a.created_at)
		     from approval_request a where a.entity_type = 'travel_expense_report' and a.entity_id = r.id), '[]') as requests,
		   (select count(*)::int from approval_decision_evidence d
		     join approval_submitted_revision s on s.id = d.submitted_revision_id
		     where s.source_id = r.id) as decisions,
		   (select count(*)::int from approval_submitted_revision s where s.source_id = r.id) as revisions
		 from travel_expense_report r where r.id = $1`,
		[reportId],
	);
	const row = rows[0];
	if (!row) throw new Error("report missing");
	return row;
}

async function closures(reportId: string) {
	const { rows } = await admin.query<{
		submission_cycle: number;
		kind: string;
		note: string | null;
		decision_evidence_id: string | null;
		actor_employee_id: string;
	}>(
		`select submission_cycle, kind, note, decision_evidence_id, actor_employee_id
		 from travel_expense_report_cycle_closure where report_id = $1 order by submission_cycle`,
		[reportId],
	);
	return rows;
}

async function approvedEvidenceIds(reportId: string) {
	const { rows } = await admin.query<{ id: string }>(
		`select d.id from approval_decision_evidence d
		 join approval_submitted_revision s on s.id = d.submitted_revision_id
		 where s.source_id = $1 and d.request_outcome = 'approved' order by d.decided_at`,
		[reportId],
	);
	return rows.map((row) => row.id);
}

async function queueIds() {
	signIn("admin");
	const queue = await finance.getTravelExpenseFinanceQueue("all");
	if (!queue.success) throw new Error(queue.error);
	return queue.data.accounts.map((account) => account.source.id);
}

async function holdReportLock(reportId: string): Promise<PoolClient> {
	const holder = await admin.connect();
	await holder.query("begin");
	await holder.query("select id from travel_expense_report where id = $1 for update", [reportId]);
	return holder;
}

async function waitForLockWaiters(count: number) {
	for (let attempt = 0; attempt < 400; attempt += 1) {
		const { rows } = await admin.query<{ waiters: number }>(
			`select count(*)::int as waiters from pg_stat_activity
			 where datname = current_database() and wait_event_type = 'Lock'`,
		);
		if ((rows[0]?.waiters ?? 0) >= count) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Expected ${count} blocked sessions`);
}

describe("reopening approved travel expense reports (#614)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
		harness.jobs.length = 0;
		harness.notifications.length = 0;
	});
	afterAll(cleanup);

	it("reopens an approved report for correction; resubmission needs fresh approval and history stays", async () => {
		const reportId = await approve(await submittedReceipt());
		expect(await queueIds()).toContain(reportId);
		const [approvedEvidence] = await approvedEvidenceIds(reportId);

		expect(await reopenState("manager", reportId)).toEqual({
			success: true,
			data: { status: "available", submissionCycle: 1 },
		});
		expect(await reopen("manager", reportId, 1, "  Wrong amount on the taxi receipt ")).toEqual({
			success: true,
			data: { status: "reopened" },
		});

		// The report is editable again; the approval and its evidence stay as they were.
		expect(await reportRow(reportId)).toMatchObject({
			status: "returned",
			submission_count: 1,
			requests: [{ status: "approved" }],
			decisions: 1,
			revisions: 1,
		});
		expect(await closures(reportId)).toEqual([
			{
				submission_cycle: 1,
				kind: "reopened",
				note: "Wrong amount on the taxi receipt",
				decision_evidence_id: approvedEvidence,
				actor_employee_id: ids.manager,
			},
		]);
		expect(harness.notifications).toEqual([{ reportId, note: "Wrong amount on the taxi receipt" }]);

		// The superseded approval is no longer payable or exportable.
		expect(await queueIds()).not.toContain(reportId);
		expect(await reimburse(reportId, "12.50", "12.50")).toEqual({
			success: true,
			data: { status: "not_approved" },
		});
		signIn("admin");
		const exportable = await exportActions.getTravelExpenseExports();
		if (!exportable.success) throw new Error(exportable.error);
		expect(JSON.stringify(exportable.data.exportable)).not.toContain(reportId);

		// The employee and the reviewer read the reopened submission with its approval.
		signIn("requester");
		const view = await actions.getTravelExpenseReportSubmission(reportId);
		if (!view.success) throw new Error(view.error);
		expect(view.data).toMatchObject({
			status: "returned",
			cycleOutcome: "reopened",
			decision: { outcome: "approved", deciderName: "manager" },
			reopened: { reason: "Wrong amount on the taxi receipt", actorName: "manager" },
		});
		expect(view.data.history.map((event) => event.label)).toEqual([
			"submitted",
			"approved",
			"reopened",
		]);

		// Corrected and resubmitted: a new frozen revision that needs a fresh approval.
		await saveAmount(reportId, "10.00");
		await submit(reportId);
		expect(await reportRow(reportId)).toMatchObject({
			status: "submitted",
			submission_count: 2,
			revisions: 2,
		});
		expect(await queueIds()).not.toContain(reportId);
		await approve(reportId);
		expect(await queueIds()).toContain(reportId);
		signIn("admin");
		const account = await finance.getTravelExpenseSettlement({ type: "report", id: reportId });
		if (!account.success) throw new Error(account.error);
		expect(account.data?.account.summary.currencies).toEqual([
			expect.objectContaining({ currency: "EUR", entitlement: "10.00" }),
		]);
		signIn("manager");
		const first = await actions.getTravelExpenseReportSubmission(reportId, 1);
		if (!first.success) throw new Error(first.error);
		expect(first.data).toMatchObject({
			cycleOutcome: "reopened",
			facts: { totals: { reimbursable: "12.50" } },
		});
		expect(first.data.cycles.map((cycle) => cycle.outcome)).toEqual(["reopened", "approved"]);
	});

	it("lets only an authorized approver reopen, never the employee, colleagues or other organizations", async () => {
		const reportId = await approve(await submittedReceipt());
		for (const person of ["requester", "colleague", "foreigner"] as const) {
			expect(await reopenState(person, reportId)).toEqual({
				success: true,
				data: { status: "unavailable" },
			});
			expect(await reopen(person, reportId, 1, "Not mine to reopen")).toEqual({
				success: false,
				error: "Expense report not found",
			});
		}
		expect((await reportRow(reportId)).status).toBe("approved");
		expect(await reopen("manager", reportId, 1, "   ")).toEqual({
			success: false,
			error: "A reason is required to reopen an expense report",
		});
		// An organization approval manager may reopen too.
		expect(await reopen("admin", reportId, 1, "Policy check")).toEqual({
			success: true,
			data: { status: "reopened" },
		});
		expect((await closures(reportId))[0]).toMatchObject({ actor_employee_id: ids.admin });
	});

	it("replays an exact retry, refuses a second reopen and stale cycles", async () => {
		const reportId = await approve(await submittedReceipt());
		expect(await reopen("manager", reportId, 1, "Fix the date")).toEqual({
			success: true,
			data: { status: "reopened" },
		});
		expect(await reopen("manager", reportId, 1, "Fix the date")).toEqual({
			success: true,
			data: { status: "reopened" },
		});
		expect(harness.notifications).toHaveLength(1);
		expect(await reopen("manager", reportId, 1, "Something else")).toEqual({
			success: true,
			data: { status: "not_approved" },
		});
		expect(await reopen("admin", reportId, 1, "Fix the date")).toEqual({
			success: true,
			data: { status: "not_approved" },
		});
		expect(await closures(reportId)).toHaveLength(1);

		await submit(reportId);
		await approve(reportId);
		// A binding to cycle 1 cannot reopen cycle 2.
		expect(await reopen("manager", reportId, 1, "Fix the date")).toEqual({
			success: true,
			data: { status: "stale" },
		});
		expect((await reportRow(reportId)).status).toBe("approved");
		expect(await reopen("manager", reportId, 2, "Again")).toEqual({
			success: true,
			data: { status: "reopened" },
		});
	});

	it("cancels unfinished exports of the report before reopening", async () => {
		const reportId = await approve(await submittedReceipt());
		const other = await approve(await submittedReceipt());
		const created = await createExport([
			await currentRevision(reportId),
			await currentRevision(other),
		]);
		if (created.status !== "created") throw new Error(created.status);

		expect(await reopen("manager", reportId, 1, "Wrong receipt")).toEqual({
			success: true,
			data: { status: "reopened" },
		});
		const { rows } = await admin.query(
			"select status, cancel_reason from travel_expense_export_batch where id = $1",
			[created.batchId],
		);
		expect(rows[0]).toEqual({ status: "cancelled", cancel_reason: "report_reopened" });
		// The job that was queued for it finds the batch cancelled and writes nothing.
		await runWorker();
		expect(
			await exportStore.loadTravelExpenseReportExportState(db, {
				organizationId: "t614-org",
				reportId,
			}),
		).toEqual({ exported: false, pending: false, batches: [] });
		// The other report's revision was released and can be exported again.
		const again = await createExport([await currentRevision(other)]);
		expect(again.status).toBe("created");

		// A job already running when the report is reopened cannot complete its handoff.
		const [job] = harness.jobs.splice(0);
		if (!job) throw new Error("no job");
		expect((await exportStore.claimTravelExpenseExportAttempt(db, job)).status).toBe("claimed");
		expect(await reopen("manager", other, 1, "Running export")).toEqual({
			success: true,
			data: { status: "reopened" },
		});
		expect(
			await exportStore.completeTravelExpenseExportAttempt(db, {
				...job,
				file: {
					fileName: "x.zip",
					bucket: "b",
					key: "k",
					versionId: null,
					sizeBytes: 1,
					checksumSha256: "0".repeat(64),
				},
			}),
		).toBe(false);
		expect(
			(
				await admin.query(
					"select status, cancel_reason from travel_expense_export_batch where id = $1",
					[again.status === "created" ? again.batchId : ""],
				)
			).rows[0],
		).toEqual({ status: "cancelled", cancel_reason: "report_reopened" });
	});

	it("points exported or reimbursed reports to an adjustment and changes nothing", async () => {
		const exported = await approve(await submittedReceipt());
		const created = await createExport([await currentRevision(exported)]);
		if (created.status !== "created") throw new Error(created.status);
		await runWorker();
		const adjustment = { status: "adjustment_required", reason: "exported" };
		expect(await reopenState("manager", exported)).toEqual({ success: true, data: adjustment });
		expect(await reopen("manager", exported, 1, "Too late")).toEqual({
			success: true,
			data: adjustment,
		});
		expect((await reportRow(exported)).status).toBe("approved");
		const { rows } = await admin.query(
			"select status from travel_expense_export_batch where id = $1",
			[created.batchId],
		);
		expect(rows[0]).toEqual({ status: "completed" });

		const paid = await approve(await submittedReceipt());
		expect(await reimburse(paid, "5.00", "12.50")).toMatchObject({
			success: true,
			data: { status: "recorded" },
		});
		const reimbursed = { status: "adjustment_required", reason: "reimbursed" };
		expect(await reopenState("manager", paid)).toEqual({ success: true, data: reimbursed });
		expect(await reopen("manager", paid, 1, "Too late")).toEqual({
			success: true,
			data: reimbursed,
		});
		expect((await reportRow(paid)).status).toBe("approved");
		expect(await closures(paid)).toEqual([]);
	});

	it("serializes reopening with a reimbursement and an export on the report lock", async () => {
		for (const reopenFirst of [true, false]) {
			const reportId = await approve(await submittedReceipt());
			const holder = await holdReportLock(reportId);
			let reopened: Promise<unknown>;
			let paid: ReturnType<typeof reimburse>;
			try {
				if (reopenFirst) {
					reopened = reopen("manager", reportId, 1, "Race");
					await waitForLockWaiters(1);
					paid = reimburse(reportId, "12.50", "12.50");
					await waitForLockWaiters(2);
				} else {
					paid = reimburse(reportId, "12.50", "12.50");
					await waitForLockWaiters(1);
					reopened = reopen("manager", reportId, 1, "Race");
					await waitForLockWaiters(2);
				}
			} finally {
				await holder.query("commit");
				holder.release();
			}
			const [reopenResult, payResult] = await Promise.all([reopened, paid]);
			if (reopenFirst) {
				expect(reopenResult).toEqual({ success: true, data: { status: "reopened" } });
				expect(payResult).toEqual({ success: true, data: { status: "not_approved" } });
			} else {
				expect(payResult).toMatchObject({ success: true, data: { status: "recorded" } });
				expect(reopenResult).toEqual({
					success: true,
					data: { status: "adjustment_required", reason: "reimbursed" },
				});
			}
		}

		// An export created while the reopen holds the report sees it reopened.
		const reportId = await approve(await submittedReceipt());
		const selection = [await currentRevision(reportId)];
		const holder = await holdReportLock(reportId);
		let reopened: Promise<unknown>;
		let exported: Promise<{ status: string }>;
		try {
			reopened = reopen("manager", reportId, 1, "Race");
			await waitForLockWaiters(1);
			exported = createExport(selection);
			await waitForLockWaiters(2);
		} finally {
			await holder.query("commit");
			holder.release();
		}
		expect(await reopened).toEqual({ success: true, data: { status: "reopened" } });
		expect((await exported).status).toBe("stale_selection");
	});

	it("retires the reopened cycle's cards through a cycle-keyed withdrawn intent", async () => {
		await admin.query(
			`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
			 values ('t614-org', 'travel_expense', 'telegram', now())`,
		);
		const reportId = await approve(await submittedReceipt());
		expect(await reopen("manager", reportId, 1, "Cards")).toEqual({
			success: true,
			data: { status: "reopened" },
		});
		const { rows } = await admin.query<{ event: string; cycles: number }>(
			`select array_agg(event order by created_at, id) as events,
			   count(distinct legacy_cycle_id)::int as cycles
			 from approval_delivery_intent where source_id = $1`,
			[reportId],
		);
		expect(rows[0]).toMatchObject({ events: ["submitted", "decided", "withdrawn"], cycles: 1 });
	});
});
