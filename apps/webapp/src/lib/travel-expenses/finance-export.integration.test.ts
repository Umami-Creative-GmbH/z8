/**
 * #613: tracked CSV/receipt export batches of approved report revisions.
 *
 * Reports are submitted and approved through the real report actions and
 * Approvals inbox route against a disposable PostgreSQL database; the session,
 * notifications, the job queue and object storage are replaced. The worker is
 * simulated by running the processor for each queued job.
 */

import { createHash, randomUUID } from "node:crypto";
import JSZip from "jszip";
import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t613-org",
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
	jobs: [] as Array<{ organizationId: string; batchId: string; attempt: number; jobId?: string }>,
	failQueue: false,
	onUpload: null as null | (() => Promise<void>),
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
}));
vi.mock("@/lib/queue", () => ({
	async addJob(
		_name: string,
		data: { organizationId: string; batchId: string; attempt: number },
		options?: { jobId?: string },
	) {
		if (harness.failQueue) throw new Error("queue down");
		harness.jobs.push({
			organizationId: data.organizationId,
			batchId: data.batchId,
			attempt: data.attempt,
			jobId: options?.jobId,
		});
		return { id: options?.jobId };
	},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t613-public",
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
		if (key.startsWith("travel-expense-exports/")) await harness.onUpload?.();
		return { bucket: "t613-private", versionId: `v-${key.length}` };
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
const exportActions = await import("@/app/[locale]/(app)/travel-expenses/finance-export-actions");
const finance = await import("@/app/[locale]/(app)/travel-expenses/finance-actions");
const store = await import("@/lib/travel-expenses/export-store");
const { processTravelExpenseExportBatch } = await import("@/lib/travel-expenses/export-processor");
const { loadSettlementAccount } = await import("@/lib/travel-expenses/settlement-store");
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { GET: downloadExport } = await import("@/app/api/travel-expenses/exports/[batchId]/route");
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ids = {
	requester: "e6130000-0000-4000-8000-000000000001",
	manager: "e6130000-0000-4000-8000-000000000002",
	finance: "e6130000-0000-4000-8000-000000000004",
	accountant: "e6130000-0000-4000-8000-000000000005",
	foreigner: "e6130000-0000-4000-8000-000000000006",
	role: "e6131000-0000-4000-8000-000000000001",
} as const;
type Person = "requester" | "manager" | "finance" | "accountant" | "foreigner";

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

async function cleanup() {
	await admin.query("delete from organization where id in ('t613-org', 't613-foreign')");
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't613-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t613-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t613-org','Expenses','t613-org','Europe/Berlin',now()),
		 ('t613-foreign','Foreign','t613-foreign','UTC',now())`,
	);
	const people: Array<[Person, string, string, string, string]> = [
		["requester", ids.requester, "t613-org", "member", "employee"],
		["manager", ids.manager, "t613-org", "member", "manager"],
		["finance", ids.finance, "t613-org", "admin", "employee"],
		["accountant", ids.accountant, "t613-org", "member", "employee"],
		["foreigner", ids.foreigner, "t613-foreign", "owner", "admin"],
	];
	for (const [name, employeeId, organizationId, memberRole, role] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t613-${name}`, name, `t613-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t613-member-${name}`, organizationId, `t613-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[employeeId, `t613-${name}`, organizationId, role],
		);
	}
	await admin.query(
		`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
		 values (gen_random_uuid(), $1, $2, true, 't613-manager', now(), now())`,
		[ids.requester, ids.manager],
	);
	// An accountant with read-only finance access: no export.
	await admin.query(
		`insert into custom_role (id, organization_id, name, base_tier, created_by, updated_at)
		 values ($1, 't613-org', 'Accounting', 'employee', 't613-finance', now())`,
		[ids.role],
	);
	await admin.query(
		`insert into custom_role_permission (id, custom_role_id, action, subject)
		 values (gen_random_uuid(), $1, 'read', 'TravelExpenseFinance')`,
		[ids.role],
	);
	await admin.query(
		`insert into employee_custom_role (id, employee_id, custom_role_id, assigned_by)
		 values (gen_random_uuid(), $1, $2, 't613-finance')`,
		[ids.accountant, ids.role],
	);
}

function signIn(name: Person) {
	harness.userId = `t613-${name}`;
	harness.organizationId = name === "foreigner" ? "t613-foreign" : "t613-org";
}

async function upload(reportId: string, itemId: string, fileName = "receipt.pdf") {
	signIn("requester");
	const tusFileKey = createOwnedTusFileKey("t613-requester");
	harness.tus.set(tusFileKey, pdfBytes);
	const response = await processReceipt(
		new Request("http://localhost/api/upload/travel-expense/report-receipt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tusFileKey, reportId, itemId, fileName }),
		}) as unknown as NextRequest,
	);
	expect(response.status).toBe(200);
}

async function submit(reportId: string) {
	signIn("requester");
	const report = await actions.getMyTravelExpenseReport(reportId);
	if (!report.success) throw new Error(report.error);
	const submitted = await actions.submitTravelExpenseReportAction({
		reportId,
		reviewed: {
			detailsVersion: report.data.trip?.version ?? null,
			items: report.data.items.map((item) => ({
				id: item.id,
				version: item.version,
				receiptIds: item.receipts.map((receipt) => receipt.id),
			})),
		},
	});
	expect(submitted).toEqual({ success: true, data: { status: "submitted" } });
}

/** A trip: an employee-paid EUR 89.90 train (formula-like text) and a company-paid EUR 240.00 hotel. */
async function submittedTrip() {
	signIn("requester");
	const created = await actions.createTripReportAction();
	if (!created.success) throw new Error(created.error);
	const reportId = created.data.reportId;
	const loaded = await actions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	await actions.saveTripDetailsDraftAction({
		reportId,
		expectedVersion: loaded.data.trip?.version ?? 1,
		values: {
			purpose: "Customer workshop",
			startDate: "2026-09-14",
			endDate: "2026-09-16",
			timeZone: "America/Los_Angeles",
			destinations: [{ place: "Hamburg", countryCode: "DE" }],
		},
	});
	for (const values of [
		{ category: "transport", description: "=1+2 train", amount: "89.90", paidBy: "employee" },
		{ category: "accommodation", description: "Hotel", amount: "240.00", paidBy: "company" },
	]) {
		signIn("requester");
		const added = await actions.addTripReportItemAction({ reportId });
		if (!added.success) throw new Error("add failed");
		const saved = await actions.saveReceiptItemDraftAction({
			reportId,
			itemId: added.data.item.id,
			expectedVersion: added.data.item.version,
			values: { expenseDate: "2026-09-14", currency: "EUR", accountingReference: null, ...values },
		});
		if (!saved.success) throw new Error("save failed");
		await upload(reportId, added.data.item.id, `${values.description}.pdf`);
	}
	await submit(reportId);
	return reportId;
}

/** A standalone EUR 12.50 taxi receipt. */
async function submittedReceipt() {
	signIn("requester");
	const created = await actions.createStandaloneReceiptReportAction();
	if (!created.success) throw new Error(created.error);
	const reportId = created.data.reportId;
	const loaded = await actions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	const item = loaded.data.items[0];
	if (!item) throw new Error("no item");
	const saved = await actions.saveReceiptItemDraftAction({
		reportId,
		itemId: item.id,
		expectedVersion: item.version,
		values: {
			expenseDate: "2026-09-02",
			category: "transport",
			description: "Taxi",
			amount: "12.50",
			currency: "EUR",
			paidBy: "employee",
			accountingReference: "CC-4711",
		},
	});
	if (!saved.success) throw new Error("save failed");
	await upload(reportId, item.id, "taxi.pdf");
	await submit(reportId);
	return reportId;
}

async function approve(reportId: string) {
	const { rows } = await admin.query<{ id: string }>(
		"select id from approval_request where entity_type = 'travel_expense_report' and entity_id = $1 and status = 'pending'",
		[reportId],
	);
	const requestId = rows[0]?.id;
	if (!requestId) throw new Error("no pending request");
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

async function createExport(
	selection: Array<{ reportId: string; revisionId: string }>,
	key: string = randomUUID(),
) {
	signIn("finance");
	const result = await exportActions.createTravelExpenseExportAction({
		idempotencyKey: key,
		selection,
	});
	if (!result.success) throw new Error(result.error);
	return result.data;
}

/** Runs every queued job like the worker would. */
async function runWorker() {
	const jobs = harness.jobs.splice(0);
	const results = [];
	for (const job of jobs) {
		results.push(
			await processTravelExpenseExportBatch(db, {
				organizationId: job.organizationId,
				batchId: job.batchId,
				attempt: job.attempt,
			}),
		);
	}
	return results;
}

function download(batchId: string) {
	return downloadExport(
		new Request(
			`http://localhost/api/travel-expenses/exports/${batchId}`,
		) as unknown as NextRequest,
		{ params: Promise.resolve({ batchId }) },
	);
}

async function batchRow(batchId: string) {
	const { rows } = await admin.query(
		"select status, attempt, error_code, storage_key, checksum_sha256, cancel_reason from travel_expense_export_batch where id = $1",
		[batchId],
	);
	return rows[0];
}

function csvRows(content: string): string[] {
	return content.replace(/^﻿/, "").trimEnd().split("\r\n");
}

describe("travel expense export batches (#613)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
		harness.jobs.length = 0;
		harness.failQueue = false;
		harness.onUpload = null;
	});
	afterAll(cleanup);

	it("exports selected approved revisions of mixed report types as one tracked, re-downloadable batch", async () => {
		const trip = await approve(await submittedTrip());
		const receipt = await approve(await submittedReceipt());
		const pending = await submittedReceipt();

		signIn("finance");
		const listed = await exportActions.getTravelExpenseExports();
		if (!listed.success) throw new Error(listed.error);
		expect(listed.data.exportable.map((row) => row.reportId).toSorted()).toEqual(
			[trip, receipt].toSorted(),
		);
		expect(listed.data.exportable.some((row) => row.reportId === pending)).toBe(false);

		const selection = [await currentRevision(trip), await currentRevision(receipt)];
		const key = randomUUID();
		const created = await createExport(selection, key);
		if (created.status !== "created") throw new Error(created.status);
		expect(created.replayed).toBe(false);
		expect(await batchRow(created.batchId)).toMatchObject({ status: "queued", attempt: 1 });
		expect(harness.jobs).toEqual([
			expect.objectContaining({
				batchId: created.batchId,
				attempt: 1,
				jobId: `travel-expense-export-${created.batchId}-1`,
			}),
		]);

		expect(await runWorker()).toEqual([{ status: "completed" }]);
		const response = await download(created.batchId);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("application/zip");
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		const zipBytes = Buffer.from(await response.arrayBuffer());
		const zip = await JSZip.loadAsync(zipBytes);
		const paths = Object.keys(zip.files);
		expect(paths.filter((path) => path.startsWith("receipts/"))).toHaveLength(3);
		const expenses = csvRows((await zip.file("expenses.csv")?.async("string")) ?? "");
		expect(expenses).toHaveLength(4);
		const all = expenses.join("\n");
		// Formula-like input is neutralized; logical dates and the trip zone are kept as entered.
		expect(all).toContain(`"'=1+2 train"`);
		expect(all).toContain(`"2026-09-14","2026-09-16","America/Los_Angeles"`);
		// Explicit money with currency: company-paid stays visible but is not reimbursable.
		expect(all).toMatch(/"employee",89\.90,"EUR",89\.90,0\.00,"EUR","receipt_amount"/);
		expect(all).toMatch(/"company",240\.00,"EUR",0\.00,240\.00,"EUR"/);
		expect(all).toContain(`"CC-4711"`);
		// Every bundled receipt is the frozen object, byte for byte.
		for (const path of paths.filter((candidate) => candidate.startsWith("receipts/"))) {
			const bytes = await zip.file(path)?.async("nodebuffer");
			expect(bytes?.equals(pdfBytes)).toBe(true);
		}

		// Downloading again returns the same file; nothing is paid or duplicated.
		const again = Buffer.from(await (await download(created.batchId)).arrayBuffer());
		expect(again.equals(zipBytes)).toBe(true);
		const replay = await createExport(selection, key);
		expect(replay).toEqual({ status: "created", replayed: true, batchId: created.batchId });
		const counts = await admin.query<{ batches: number; entries: number }>(
			`select (select count(*)::int from travel_expense_export_batch where organization_id = 't613-org') as batches,
			        (select count(*)::int from travel_expense_settlement_entry where organization_id = 't613-org') as entries`,
		);
		expect(counts.rows[0]).toEqual({ batches: 1, entries: 0 });
		signIn("requester");
		const own = await finance.getTravelExpenseSettlement({ type: "report", id: trip });
		expect(own.success && own.data?.account.summary.state).toBe("outstanding");

		// An exported revision is not exported a second time.
		expect(await createExport([selection[0] as (typeof selection)[number]])).toEqual({
			status: "already_exported",
			reportIds: [trip],
		});
		signIn("finance");
		const after = await exportActions.getTravelExpenseExports();
		expect(after.success && after.data.exportable).toEqual([]);
		expect(after.success && after.data.batches[0]).toMatchObject({
			id: created.batchId,
			status: "completed",
			revisionCount: 2,
			itemCount: 3,
			receiptCount: 3,
			totals: [{ currency: "EUR", reimbursable: "102.40", companyPaid: "240.00" }],
		});
	});

	it("refuses selections that are not the approved current revision, including concurrent changes", async () => {
		const approved = await approve(await submittedReceipt());
		const pending = await submittedReceipt();
		const selection = await currentRevision(approved);

		expect(await createExport([{ reportId: approved, revisionId: randomUUID() }])).toEqual({
			status: "stale_selection",
			reportIds: [approved],
		});
		expect(await createExport([await currentRevision(pending)])).toEqual({
			status: "stale_selection",
			reportIds: [pending],
		});
		expect(await createExport([selection, selection])).toEqual({ status: "invalid_selection" });

		// The report was returned for correction after finance loaded the list.
		await admin.query("update travel_expense_report set status = 'returned' where id = $1", [
			approved,
		]);
		expect(await createExport([selection])).toEqual({
			status: "stale_selection",
			reportIds: [approved],
		});
		expect(await admin.query("select 1 from travel_expense_export_batch")).toHaveProperty(
			"rowCount",
			0,
		);
	});

	it("serializes concurrent batches for the same revision: exactly one consumes it", async () => {
		const reportId = await approve(await submittedReceipt());
		const selection = [await currentRevision(reportId)];
		signIn("finance");
		const results = await Promise.all([
			exportActions.createTravelExpenseExportAction({ idempotencyKey: randomUUID(), selection }),
			exportActions.createTravelExpenseExportAction({ idempotencyKey: randomUUID(), selection }),
		]);
		expect(results.map((result) => result.success && result.data.status).toSorted()).toEqual([
			"already_exported",
			"created",
		]);
	});

	it("checks the export permission and the organization on every action and download", async () => {
		const reportId = await approve(await submittedReceipt());
		const created = await createExport([await currentRevision(reportId)]);
		if (created.status !== "created") throw new Error(created.status);
		await runWorker();

		for (const person of ["accountant", "manager", "requester"] as const) {
			signIn(person);
			expect(await exportActions.getTravelExpenseExports()).toEqual({
				success: false,
				error: "Unauthorized",
			});
			expect(
				await exportActions.createTravelExpenseExportAction({
					idempotencyKey: randomUUID(),
					selection: [await currentRevision(reportId)],
				}),
			).toEqual({ success: false, error: "Unauthorized" });
			expect(await exportActions.retryTravelExpenseExportAction(created.batchId)).toEqual({
				success: false,
				error: "Unauthorized",
			});
			expect((await download(created.batchId)).status).toBe(404);
		}
		signIn("foreigner");
		expect((await download(created.batchId)).status).toBe(404);
		expect(await exportActions.cancelTravelExpenseExportAction(created.batchId)).toEqual({
			success: false,
			error: "Not found",
		});
		harness.userId = null;
		expect((await download(created.batchId)).status).toBe(401);
	});

	it("tracks a failed attempt and retries the same batch until it completes", async () => {
		const reportId = await approve(await submittedReceipt());
		const created = await createExport([await currentRevision(reportId)]);
		if (created.status !== "created") throw new Error(created.status);

		// The frozen receipt object is temporarily unreadable.
		const receiptKeys = [...harness.objects.keys()].filter((key) =>
			key.startsWith("travel-expenses/"),
		);
		const saved = new Map(receiptKeys.map((key) => [key, harness.objects.get(key) as Buffer]));
		for (const key of receiptKeys) harness.objects.delete(key);
		expect(await runWorker()).toEqual([{ status: "failed", errorCode: "receipt_unavailable" }]);
		expect(await batchRow(created.batchId)).toMatchObject({
			status: "failed",
			attempt: 1,
			error_code: "receipt_unavailable",
		});
		expect((await download(created.batchId)).status).toBe(404);
		signIn("finance");
		const listed = await exportActions.getTravelExpenseExports();
		expect(listed.success && listed.data.batches[0]).toMatchObject({
			status: "failed",
			retryable: true,
			errorCode: "receipt_unavailable",
		});
		// Its revision stays with the failed batch until it is retried or cancelled.
		expect(listed.success && listed.data.exportable).toEqual([]);

		for (const [key, bytes] of saved) harness.objects.set(key, bytes);
		expect(await exportActions.retryTravelExpenseExportAction(created.batchId)).toEqual({
			success: true,
			data: { status: "queued" },
		});
		expect(await exportActions.retryTravelExpenseExportAction(created.batchId)).toEqual({
			success: true,
			data: { status: "not_retryable" },
		});
		// A late duplicate of attempt 1 does nothing.
		expect(
			await processTravelExpenseExportBatch(db, {
				organizationId: "t613-org",
				batchId: created.batchId,
				attempt: 1,
			}),
		).toEqual({ status: "skipped" });
		expect(await runWorker()).toEqual([{ status: "completed" }]);
		expect(await batchRow(created.batchId)).toMatchObject({ status: "completed", attempt: 2 });
		const { rows } = await admin.query(
			"select count(*)::int as count from travel_expense_export_batch where organization_id = 't613-org'",
		);
		expect(rows[0]).toEqual({ count: 1 });
	});

	it("records a queue failure as a retryable failed attempt", async () => {
		const reportId = await approve(await submittedReceipt());
		harness.failQueue = true;
		const created = await createExport([await currentRevision(reportId)]);
		if (created.status !== "created") throw new Error(created.status);
		expect(await batchRow(created.batchId)).toMatchObject({
			status: "failed",
			error_code: "enqueue_failed",
		});
		harness.failQueue = false;
		signIn("finance");
		await exportActions.retryTravelExpenseExportAction(created.batchId);
		expect(await runWorker()).toEqual([{ status: "completed" }]);
	});

	it("lets a batch stuck in queued (lost job) be retried once it is stale, and a failing claim mark it failed", async () => {
		const { instantFromDate } = await import("@/lib/datetime/temporal-core");
		const reportId = await approve(await submittedReceipt());
		const created = await createExport([await currentRevision(reportId)]);
		if (created.status !== "created") throw new Error(created.status);
		// The queue lost the job: nothing will ever claim attempt 1.
		harness.jobs.length = 0;
		const scope = { organizationId: "t613-org", batchId: created.batchId };
		const { rows } = await admin.query<{ queued_at: Date }>(
			"select queued_at from travel_expense_export_batch where id = $1",
			[created.batchId],
		);
		const queued = rows[0]?.queued_at;
		if (!queued) throw new Error("queued_at not recorded");
		const queuedAt = instantFromDate(queued);
		const minutesLater = (minutes: number) =>
			queuedAt.add({ minutes: store.TRAVEL_EXPENSE_EXPORT_STALE_MINUTES + minutes });

		// Freshly queued: not retryable yet, nothing changes.
		signIn("finance");
		expect(await exportActions.retryTravelExpenseExportAction(created.batchId)).toEqual({
			success: true,
			data: { status: "not_retryable" },
		});
		const stale = await store.listTravelExpenseExportBatches(
			db,
			{ organizationId: "t613-org" },
			minutesLater(1),
		);
		expect(stale[0]).toMatchObject({ id: created.batchId, status: "queued", retryable: true });

		const retried = await store.retryTravelExpenseExportBatch(db, scope, minutesLater(1));
		expect(retried).toMatchObject({ status: "queued", batch: { attempt: 2, retryable: false } });
		// The fresh attempt is not stale again right away: a double retry changes nothing.
		expect(await store.retryTravelExpenseExportBatch(db, scope, minutesLater(2))).toMatchObject({
			status: "not_retryable",
			batch: { attempt: 2 },
		});

		// The claim of attempt 2 fails (here: the clock throws inside the claim):
		// the attempt is recorded as failed and retryable instead of staying queued.
		let calls = 0;
		const failingClaimClock = () => {
			calls += 1;
			if (calls === 1) throw new Error("claim failed");
			return minutesLater(3);
		};
		expect(
			await processTravelExpenseExportBatch(db, { ...scope, attempt: 2 }, failingClaimClock),
		).toEqual({ status: "failed", errorCode: "unexpected" });
		expect(await batchRow(created.batchId)).toMatchObject({
			status: "failed",
			attempt: 2,
			error_code: "unexpected",
		});

		signIn("finance");
		expect(await exportActions.retryTravelExpenseExportAction(created.batchId)).toEqual({
			success: true,
			data: { status: "queued" },
		});
		// The lost attempt 1 job showing up late does nothing; attempt 3 completes.
		expect(await processTravelExpenseExportBatch(db, { ...scope, attempt: 1 })).toEqual({
			status: "skipped",
		});
		expect(await runWorker()).toEqual([{ status: "completed" }]);
		expect(await batchRow(created.batchId)).toMatchObject({ status: "completed", attempt: 3 });
	});

	it("lets finance cancel an unfinished batch, releasing its revisions, but never a completed one", async () => {
		const reportId = await approve(await submittedReceipt());
		const selection = [await currentRevision(reportId)];
		const first = await createExport(selection);
		if (first.status !== "created") throw new Error(first.status);
		signIn("finance");
		expect(await exportActions.cancelTravelExpenseExportAction(first.batchId)).toEqual({
			success: true,
			data: { status: "cancelled" },
		});
		expect(await runWorker()).toEqual([{ status: "skipped" }]);
		expect(await batchRow(first.batchId)).toMatchObject({
			status: "cancelled",
			cancel_reason: "cancelled_by_finance",
		});

		const second = await createExport(selection);
		if (second.status !== "created") throw new Error(second.status);
		await runWorker();
		signIn("finance");
		expect(await exportActions.cancelTravelExpenseExportAction(second.batchId)).toEqual({
			success: true,
			data: { status: "completed" },
		});
		expect(await batchRow(second.batchId)).toMatchObject({ status: "completed" });
	});

	it("gives #614 an export state and a cancel that races safely with a running job", async () => {
		const reportId = await approve(await submittedReceipt());
		const selection = [await currentRevision(reportId)];
		const created = await createExport(selection);
		if (created.status !== "created") throw new Error(created.status);
		expect(
			await store.loadTravelExpenseReportExportState(db, { organizationId: "t613-org", reportId }),
		).toMatchObject({ exported: false, pending: true });

		// The job starts, then the report is reopened before the job finishes.
		const [job] = harness.jobs.splice(0);
		if (!job) throw new Error("no job");
		const claimed = await store.claimTravelExpenseExportAttempt(db, job);
		expect(claimed.status).toBe("claimed");
		const reopened = await db.transaction(async (tx) => {
			await loadSettlementAccount(
				tx,
				{ organizationId: "t613-org", source: { type: "report", id: reportId } },
				{ lock: true },
			);
			return store.cancelUncompletedTravelExpenseExportsForReport(tx, {
				organizationId: "t613-org",
				reportId,
				cancelledByUserId: "t613-manager",
			});
		});
		expect(reopened).toEqual({ status: "cleared", cancelledBatchIds: [created.batchId] });
		expect(
			await store.completeTravelExpenseExportAttempt(db, {
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
		expect(await batchRow(created.batchId)).toMatchObject({
			status: "cancelled",
			cancel_reason: "report_reopened",
		});
		expect(
			await store.loadTravelExpenseReportExportState(db, { organizationId: "t613-org", reportId }),
		).toEqual({ exported: false, pending: false, batches: [] });

		// Exported for real: reopening is refused (it must become an adjustment).
		const exported = await createExport(selection);
		if (exported.status !== "created") throw new Error(exported.status);
		await runWorker();
		const state = await store.loadTravelExpenseReportExportState(db, {
			organizationId: "t613-org",
			reportId,
			revisionId: selection[0]?.revisionId,
		});
		expect(state).toMatchObject({ exported: true, pending: false });
		const refused = await db.transaction((tx) =>
			store.cancelUncompletedTravelExpenseExportsForReport(tx, {
				organizationId: "t613-org",
				reportId,
				cancelledByUserId: null,
			}),
		);
		expect(refused).toEqual({ status: "exported", batchIds: [exported.batchId] });
	});

	it("discards a job result whose batch was cancelled while it ran, and keeps batches immutable", async () => {
		const reportId = await approve(await submittedReceipt());
		const created = await createExport([await currentRevision(reportId)]);
		if (created.status !== "created") throw new Error(created.status);
		// Finance cancels after the job stored its file but before it completes.
		harness.onUpload = async () => {
			signIn("finance");
			expect(await exportActions.cancelTravelExpenseExportAction(created.batchId)).toEqual({
				success: true,
				data: { status: "cancelled" },
			});
		};
		try {
			expect(await runWorker()).toEqual([{ status: "discarded" }]);
		} finally {
			harness.onUpload = null;
		}
		expect(
			[...harness.objects.keys()].some((key) => key.startsWith("travel-expense-exports/")),
		).toBe(false);
		expect(await batchRow(created.batchId)).toMatchObject({
			status: "cancelled",
			storage_key: null,
		});

		const fresh = await createExport([await currentRevision(reportId)]);
		if (fresh.status !== "created") throw new Error(fresh.status);
		await runWorker();
		await expect(
			admin.query("update travel_expense_export_batch set manifest = '{}' where id = $1", [
				fresh.batchId,
			]),
		).rejects.toThrow(/immutable/);
		await expect(
			admin.query("update travel_expense_export_batch set status = 'failed' where id = $1", [
				fresh.batchId,
			]),
		).rejects.toThrow(/immutable/);
		const { rows } = await admin.query<{ checksum_sha256: string; storage_key: string }>(
			"select checksum_sha256, storage_key from travel_expense_export_batch where id = $1",
			[fresh.batchId],
		);
		const stored = harness.objects.get(rows[0]?.storage_key ?? "");
		expect(
			createHash("sha256")
				.update(stored ?? Buffer.alloc(0))
				.digest("hex"),
		).toBe(rows[0]?.checksum_sha256);
	});
});
