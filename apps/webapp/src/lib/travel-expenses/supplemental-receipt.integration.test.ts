/**
 * #1255: reviewer-supplied receipts preserve submitted expenses and travel
 * evidence, remain authorized, and reach finance exports.
 *
 * The real settings, report and exception actions, submission owner, Approvals
 * inbox routes and decision owner run against a disposable PostgreSQL
 * database. Only the session, notifications and object storage are replaced.
 */

import JSZip from "jszip";
import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1255-org",
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
	jobs: [] as Array<{
		organizationId: string;
		batchId: string;
		attempt: number;
	}>,
	onUpload: null as null | (() => Promise<void>),
	failStorage: false,
}));
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
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
	) {
		harness.jobs.push(data);
		return { id: data.batchId };
	},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t1255-public",
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
	async uploadPrivateObject(
		_organizationId: string,
		key: string,
		data: Buffer,
	) {
		if (harness.failStorage) throw new Error("Storage unavailable");
		harness.objects.set(key, Buffer.from(data));
		await harness.onUpload?.();
		return { bucket: "t1255-private", versionId: `v-${key.length}` };
	},
	async readPrivateObject(input: { key: string }) {
		const bytes = harness.objects.get(input.key);
		if (!bytes) throw new Error("NoSuchKey");
		return bytes;
	},
	async deletePrivateObjectVersions(input: { key: string }) {
		harness.objects.delete(input.key);
	},
	async deletePrivateObject(input: { key: string }) {
		harness.objects.delete(input.key);
	},
}));

const { db } = await import("@/db");
const exportActions = await import(
	"@/app/[locale]/(app)/travel-expenses/finance-export-actions"
);
const { processTravelExpenseExportBatch } = await import(
	"@/lib/travel-expenses/export-processor"
);
const { GET: downloadExport } = await import(
	"@/app/api/travel-expenses/exports/[batchId]/route"
);
const actions = await import(
	"@/app/[locale]/(app)/travel-expenses/report-actions"
);
const exceptionActions = await import(
	"@/app/[locale]/(app)/travel-expenses/receipt-exception-actions"
);
const reviewActions = await import(
	"@/app/[locale]/(app)/travel-expenses/report-review-actions"
);
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { POST: approveRoute } = await import(
	"@/app/api/approvals/inbox/[id]/approve/route"
);
const { POST: rejectRoute } = await import(
	"@/app/api/approvals/inbox/[id]/reject/route"
);
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ids = {
	requester: "e1250000-0000-4000-8000-000000000001",
	manager: "e1250000-0000-4000-8000-000000000002",
	admin: "e1250000-0000-4000-8000-000000000003",
	foreigner: "e1250000-0000-4000-8000-000000000004",
	reader: "e1250000-0000-4000-8000-000000000005",
	colleague: "e1250000-0000-4000-8000-000000000006",
} as const;
type Person = keyof typeof ids;

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

async function cleanup() {
	await admin.query(
		"delete from organization where id in ('t1255-org', 't1255-foreign')",
	);
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't1255-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t1255-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t1255-org','Expenses','t1255-org','Europe/Berlin',now()),
		 ('t1255-foreign','Foreign','t1255-foreign','UTC',now())`,
	);
	const people: Array<[Person, string, string, string]> = [
		["requester", "t1255-org", "employee", "member"],
		["manager", "t1255-org", "manager", "member"],
		["admin", "t1255-org", "admin", "admin"],
		["foreigner", "t1255-foreign", "admin", "admin"],
		["reader", "t1255-org", "employee", "member"],
		["colleague", "t1255-org", "manager", "member"],
	];
	for (const [name, organizationId, role, memberRole] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t1255-${name}`, name, `t1255-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t1255-member-${name}`, organizationId, `t1255-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[ids[name], `t1255-${name}`, organizationId, role],
		);
	}
	await admin.query(
		`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
		 values (gen_random_uuid(), $1, $2, true, 't1255-manager', now(), now())`,
		[ids.requester, ids.manager],
	);
	await admin.query(
		`insert into employee_managers (id,employee_id,manager_id,is_primary,assigned_by,assigned_at,created_at) values (gen_random_uuid(),$1,$2,false,'t1255-admin',now(),now())`,
		[ids.requester, ids.colleague],
	);

	await admin.query(
		`insert into expense_officer_grant (organization_id,officer_employee_id,scope,created_by) values ('t1255-org',$1,'all','t1255-admin')`,
		[ids.reader],
	);
}

function signIn(name: Person) {
	harness.userId = `t1255-${name}`;
	harness.organizationId = name === "foreigner" ? "t1255-foreign" : "t1255-org";
}

async function setPolicy(allowed: boolean) {
	await admin.query(
		`insert into travel_expense_settings (organization_id, missing_receipt_exceptions_allowed)
		 values ('t1255-org', $1)
		 on conflict (organization_id) do update set missing_receipt_exceptions_allowed = $1`,
		[allowed],
	);
}

async function load(reportId: string) {
	signIn("requester");
	const loaded = await actions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	return loaded.data;
}

/** A complete standalone dinner expense without a receipt. */
async function dinnerWithoutReceipt(trip = false) {
	signIn("requester");
	const created = await (trip
		? actions.createTripReportAction()
		: actions.createStandaloneReceiptReportAction());
	if (!created.success) throw new Error(created.error);
	const reportId = created.data.reportId;
	if (trip) {
		const draft = await load(reportId);
		const details = await actions.saveTripDetailsDraftAction({
			reportId,
			expectedVersion: draft.trip?.version ?? 1,
			values: {
				purpose: "Customer workshop",
				startDate: "2026-09-14",
				endDate: "2026-09-16",
				timeZone: "America/Los_Angeles",
				destinations: [{ place: "Hamburg", countryCode: "DE" }],
			},
		});
		if (!details.success) throw new Error(details.error);
		const added = await actions.addTripReportItemAction({ reportId });
		if (!added.success) throw new Error(added.error);
	}
	const [item] = (await load(reportId)).items;
	if (!item) throw new Error("item missing");
	const saved = await actions.saveReceiptItemDraftAction({
		reportId,
		itemId: item.id,
		expectedVersion: item.version,
		values: {
			expenseDate: "2026-09-14",
			category: "meals",
			description: "Customer dinner",
			amount: "64.20",
			currency: "EUR",
			paidBy: "employee",
			accountingReference: null,
		},
	});
	if (!saved.success || saved.data.status !== "saved")
		throw new Error("save failed");
	return { reportId, itemId: item.id };
}

async function requestException(
	reportId: string,
	itemId: string,
	reason: string | null,
	options: { requested?: boolean; expectedVersion?: number } = {},
) {
	signIn("requester");
	const report = await load(reportId);
	const item = report.items.find((candidate) => candidate.id === itemId);
	return exceptionActions.saveReceiptExceptionAction({
		reportId,
		itemId,
		expectedVersion:
			options.expectedVersion ?? item?.receiptException.version ?? 0,
		requested: options.requested ?? true,
		reason,
	});
}

async function reviewed(reportId: string) {
	const report = await load(reportId);
	return {
		detailsVersion: report.trip?.version ?? null,
		items: report.items.map((item) => ({
			id: item.id,
			version: item.version,
			receiptIds: item.receipts.map((receipt) => receipt.id),
			receiptExceptionVersion: item.receiptException.version,
		})),
	};
}

async function submit(
	reportId: string,
	versions?: Awaited<ReturnType<typeof reviewed>>,
) {
	const reviewedVersions = versions ?? (await reviewed(reportId));
	signIn("requester");
	return actions.submitTravelExpenseReportAction({
		reportId,
		reviewed: reviewedVersions,
	});
}

async function pendingRequestId(reportId: string) {
	const { rows } = await admin.query<{ id: string }>(
		`select id from approval_request where entity_type = 'travel_expense_report'
		 and entity_id = $1 and status = 'pending'`,
		[reportId],
	);
	if (!rows[0]) throw new Error("no pending request");
	return rows[0].id;
}

function decide(
	kind: "approve" | "reject",
	requestId: string,
	body: Record<string, unknown> = {},
) {
	signIn("manager");
	const route = kind === "approve" ? approveRoute : rejectRoute;
	return route(
		new Request(`http://localhost/api/approvals/inbox/${requestId}/${kind}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}) as unknown as NextRequest,
		{ params: Promise.resolve({ id: requestId }) },
	);
}

const { GET: downloadReceipt } = await import(
	"@/app/api/travel-expenses/reports/[reportId]/receipts/[receiptId]/route"
);
async function view(reportId: string) {
	const result = await actions.getTravelExpenseReportSubmission(reportId);
	if (!result.success) throw new Error(result.error);
	return result.data;
}
async function uploadMissing(
	reportId: string,
	itemId: string,
	submissionCycle: number | undefined = 1,
	bytes = pdfBytes,
) {
	if (!harness.userId) throw new Error("Sign in before uploading");
	const key = createOwnedTusFileKey(harness.userId, crypto.randomUUID());
	harness.tus.set(key, bytes);
	return processReceipt(
		new Request("http://localhost/api/upload/travel-expense/report-receipt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				reportId,
				itemId,
				submissionCycle,
				tusFileKey: key,
				fileName: "later.pdf",
			}),
		}) as unknown as NextRequest,
	);
}
function receiptOf(report: Awaited<ReturnType<typeof view>>) {
	const receipt = report.facts.items[0]?.receipts[0];
	if (!receipt) throw new Error("receipt missing from submitted report");
	return receipt;
}
async function submittedMissing() {
	await setPolicy(true);
	const report = await dinnerWithoutReceipt();
	await requestException(report.reportId, report.itemId, "Printer broken");
	expect(await submit(report.reportId)).toMatchObject({
		success: true,
		data: { status: "submitted" },
	});
	return report;
}
describe("supplemental receipts during review (#1255)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
		harness.jobs.length = 0;
		harness.onUpload = null;
		harness.failStorage = false;
	});
	afterAll(cleanup);
	it.each([false, true])(
		"lets the current reviewer supply a missing document without changing the frozen submission (trip=%s)",
		async (trip) => {
			await setPolicy(true);
			const { reportId, itemId } = await dinnerWithoutReceipt(trip);
			await requestException(reportId, itemId, "Printer broken");
			expect(await submit(reportId)).toMatchObject({
				success: true,
				data: { status: "submitted" },
			});
			signIn("manager");
			const before = await view(reportId);
			expect(before.canAddReceipt).toBe(true);
			const response = await uploadMissing(reportId, itemId);
			expect(response.status).toBe(201);
			const after = await view(reportId);
			expect(after.status).toBe("submitted");
			expect(after.facts.items[0]).toMatchObject({
				...before.facts.items[0],
				receipts: [
					expect.objectContaining({
						fileName: "later.pdf",
						addedAfterSubmission: true,
						uploadedByName: "manager",
					}),
				],
			});
			expect(after.facts.totals).toEqual(before.facts.totals);
			expect(after.facts.trip).toEqual(before.facts.trip);
			expect(after.history).toContainEqual(
				expect.objectContaining({
					label: "receipt_added",
					cycle: 1,
					actorName: "manager",
					at: expect.any(String),
				}),
			);
			expect(after.facts.items[0]?.receiptException).toEqual({
				reason: "Printer broken",
			});
			expect(after.facts.items[0]?.receipts[0]?.uploadedAt).toEqual(
				expect.any(String),
			);
			const receiptId = receiptOf(after).receiptId;
			signIn("requester");
			const downloaded = await downloadReceipt(
				new Request("http://localhost/receipt?download=1") as NextRequest,
				{ params: Promise.resolve({ reportId, receiptId }) },
			);
			expect(downloaded.status).toBe(200);
			expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(pdfBytes);
		},
	);
	it.each(["admin", "colleague"] as const)(
		"accepts current review authority for %s",
		async (person) => {
			const { reportId, itemId } = await submittedMissing();
			signIn(person);
			expect((await view(reportId)).canAddReceipt).toBe(true);
			expect((await uploadMissing(reportId, itemId)).status).toBe(201);
			expect(receiptOf(await view(reportId))).toMatchObject({
				addedAfterSubmission: true,
				uploadedByName: person,
			});
		},
	);
	it("scopes document downloads to their report and organization and refuses corrupted bytes", async () => {
		const { reportId, itemId } = await submittedMissing();
		const other = await submittedMissing();
		signIn("manager");
		expect((await uploadMissing(reportId, itemId)).status).toBe(201);
		const receiptId = receiptOf(await view(reportId)).receiptId;
		const download = (scopeReportId = reportId) =>
			downloadReceipt(
				new Request("http://localhost/receipt?download=1") as NextRequest,
				{ params: Promise.resolve({ reportId: scopeReportId, receiptId }) },
			);
		expect((await download(other.reportId)).status).toBe(404);
		signIn("foreigner");
		expect((await download()).status).toBe(404);
		signIn("requester");
		for (const key of harness.objects.keys())
			harness.objects.set(key, Buffer.from("%PDF-corrupted"));
		expect((await download()).status).toBe(503);
	});

	it.each(["requester", "reader", "foreigner"] as const)(
		"denies supplemental uploads to %s without review authority",
		async (person) => {
			const { reportId, itemId } = await submittedMissing();
			signIn(person);
			expect((await uploadMissing(reportId, itemId)).status).toBe(404);
			expect(harness.objects.size).toBe(0);
			if (person === "requester")
				expect((await view(reportId)).canAddReceipt).toBe(false);
			else
				expect(
					await actions.getTravelExpenseReportSubmission(reportId),
				).toMatchObject({ success: false });
			signIn("requester");
			expect((await view(reportId)).facts.items[0]?.receipts).toEqual([]);
		},
	);
	it("rejects a different item, a stale cycle, and a second document for the same expense", async () => {
		const { reportId, itemId } = await submittedMissing();
		const other = await submittedMissing();
		signIn("manager");
		expect((await uploadMissing(reportId, other.itemId)).status).toBe(404);
		expect((await uploadMissing(reportId, itemId, 2)).status).toBe(404);
		expect(harness.objects.size).toBe(0);
		expect((await uploadMissing(reportId, itemId)).status).toBe(201);
		expect((await uploadMissing(reportId, itemId)).status).toBe(404);
		expect(harness.objects.size).toBe(1);
		expect((await view(reportId)).facts.items[0]?.receipts).toHaveLength(1);
	});
	it("denies additions to an expense that already had a receipt when submitted", async () => {
		const { reportId, itemId } = await dinnerWithoutReceipt();
		signIn("requester");
		if (!harness.userId) throw new Error("Sign in before uploading");
		const key = createOwnedTusFileKey(harness.userId, crypto.randomUUID());
		harness.tus.set(key, pdfBytes);
		const original = await processReceipt(
			new Request("http://localhost/upload", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					reportId,
					itemId,
					tusFileKey: key,
					fileName: "original.pdf",
				}),
			}) as NextRequest,
		);
		expect(original.status).toBe(200);
		expect(await submit(reportId)).toMatchObject({
			success: true,
			data: { status: "submitted" },
		});
		signIn("manager");
		expect((await uploadMissing(reportId, itemId)).status).toBe(404);
		expect((await view(reportId)).facts.items[0]?.receipts).toEqual([
			expect.objectContaining({ fileName: "original.pdf" }),
		]);
		expect(harness.objects.size).toBe(1);
	});
	it.each([
		{ bytes: Buffer.from("This is not a PDF"), status: 400 },
		{ bytes: Buffer.alloc(1025), status: 413 },
	])(
		"rejects invalid or oversized bytes before storage ($status)",
		async ({ bytes, status }) => {
			const { reportId, itemId } = await submittedMissing();
			signIn("manager");
			expect((await uploadMissing(reportId, itemId, 1, bytes)).status).toBe(
				status,
			);
			expect(harness.objects.size).toBe(0);
			expect((await view(reportId)).facts.items[0]?.receipts).toEqual([]);
		},
	);
	it("leaves no visible receipt after storage failure and accepts a fresh retry", async () => {
		const { reportId, itemId } = await submittedMissing();
		signIn("manager");
		harness.failStorage = true;
		expect((await uploadMissing(reportId, itemId)).status).toBe(500);
		expect((await view(reportId)).facts.items[0]?.receipts).toEqual([]);
		harness.failStorage = false;
		expect((await uploadMissing(reportId, itemId)).status).toBe(201);
		expect((await view(reportId)).facts.items[0]?.receipts).toHaveLength(1);
	});
	it("finalizes exactly one of two concurrent uploads and removes the losing object", async () => {
		const { reportId, itemId } = await submittedMissing();
		signIn("manager");
		let arrivals = 0;
		let bothStored: () => void = () => {};
		let release: () => void = () => {};
		const stored = new Promise<void>((resolve) => {
			bothStored = resolve;
		});
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		harness.onUpload = async () => {
			if (++arrivals === 2) bothStored();
			await gate;
		};
		const first = uploadMissing(reportId, itemId);
		const second = uploadMissing(reportId, itemId);
		await stored;
		release();
		const responses = await Promise.all([first, second]);
		expect(responses.map((response) => response.status).sort()).toEqual([
			201, 409,
		]);
		expect(harness.objects.size).toBe(1);
		const report = await view(reportId);
		expect(report.facts.items[0]?.receipts).toHaveLength(1);
		expect(
			report.history.filter((event) => event.label === "receipt_added"),
		).toHaveLength(1);
	});
	it("discards an upload if approval finishes while its object is being stored", async () => {
		const { reportId, itemId } = await submittedMissing();
		const requestId = await pendingRequestId(reportId);
		signIn("manager");
		harness.onUpload = async () => {
			expect(
				(
					await decide("approve", requestId, {
						acceptedReceiptExceptionItemIds: [itemId],
					})
				).status,
			).toBe(200);
		};
		expect((await uploadMissing(reportId, itemId)).status).toBe(409);
		expect(harness.objects.size).toBe(0);
		const report = await view(reportId);
		expect(report.status).toBe("approved");
		expect(report.facts.items[0]?.receipts).toEqual([]);
	});
	it("discards an upload if the report is withdrawn and resubmitted during storage", async () => {
		const { reportId, itemId } = await submittedMissing();
		signIn("manager");
		harness.onUpload = async () => {
			signIn("requester");
			expect(
				await reviewActions.withdrawTravelExpenseReportAction({
					reportId,
					submissionCycle: 1,
				}),
			).toMatchObject({ success: true, data: { status: "withdrawn" } });
			expect(await submit(reportId)).toMatchObject({
				success: true,
				data: { status: "submitted" },
			});
			signIn("manager");
		};
		expect((await uploadMissing(reportId, itemId)).status).toBe(409);
		expect(harness.objects.size).toBe(0);
		const current = await view(reportId);
		expect(current.submissionCycle).toBe(2);
		expect(current.facts.items[0]?.receipts).toEqual([]);
		const historical = await actions.getTravelExpenseReportSubmission(
			reportId,
			1,
		);
		expect(historical).toMatchObject({
			success: true,
			data: { canAddReceipt: false },
		});
		expect((await uploadMissing(reportId, itemId, 1)).status).toBe(404);
	});
	it("rechecks reviewer authority after storage and cleans up a revoked reviewer upload", async () => {
		const { reportId, itemId } = await submittedMissing();
		signIn("manager");
		harness.onUpload = async () => {
			await admin.query("update employee set role='employee' where id=$1", [
				ids.manager,
			]);
			await admin.query("delete from employee_managers where manager_id=$1", [
				ids.manager,
			]);
		};
		expect((await uploadMissing(reportId, itemId)).status).toBe(409);
		expect(harness.objects.size).toBe(0);
		signIn("requester");
		expect((await view(reportId)).facts.items[0]?.receipts).toEqual([]);
	});
	it("keeps the later receipt downloadable after approval and includes its bytes in the finance export", async () => {
		await setPolicy(true);
		const { reportId, itemId } = await dinnerWithoutReceipt();
		await requestException(reportId, itemId, "Printer broken");
		expect(await submit(reportId)).toMatchObject({
			success: true,
			data: { status: "submitted" },
		});
		signIn("manager");
		const before = await view(reportId);
		expect((await uploadMissing(reportId, itemId)).status).toBe(201);
		const receiptId = receiptOf(await view(reportId)).receiptId;
		expect(
			(
				await decide("approve", await pendingRequestId(reportId), {
					acceptedReceiptExceptionItemIds: [itemId],
				})
			).status,
		).toBe(200);
		signIn("requester");
		expect(await view(reportId)).toMatchObject({
			status: "approved",
			canAddReceipt: false,
		});
		const receiptResponse = await downloadReceipt(
			new Request("http://localhost/receipt?download=1") as NextRequest,
			{ params: Promise.resolve({ reportId, receiptId }) },
		);
		expect(receiptResponse.status).toBe(200);
		expect(Buffer.from(await receiptResponse.arrayBuffer())).toEqual(pdfBytes);
		signIn("admin");
		const listed = await exportActions.getTravelExpenseExports();
		if (!listed.success) throw new Error(listed.error);
		const revision = listed.data.exportable.find(
			(row) => row.reportId === reportId,
		);
		if (!revision)
			throw new Error("approved expense missing from export selection");
		const created = await exportActions.createTravelExpenseExportAction({
			idempotencyKey: crypto.randomUUID(),
			selection: [{ reportId, revisionId: revision.revisionId }],
		});
		if (!created.success || created.data.status !== "created")
			throw new Error("export not created");
		const [job] = harness.jobs.splice(0);
		if (!job) throw new Error("export not queued");
		expect(await processTravelExpenseExportBatch(db, job)).toEqual({
			status: "completed",
		});
		const downloaded = await downloadExport(
			new Request("http://localhost/export") as NextRequest,
			{ params: Promise.resolve({ batchId: created.data.batchId }) },
		);
		expect(downloaded.status).toBe(200);
		const archive = await JSZip.loadAsync(await downloaded.arrayBuffer());
		const receipts = Object.values(archive.files).filter(
			(file) => file.name.startsWith("receipts/") && !file.dir,
		);
		expect(receipts).toHaveLength(1);
		expect(await receipts[0]?.async("nodebuffer")).toEqual(pdfBytes);
		const manifestFile = archive.file("manifest.json");
		if (!manifestFile) throw new Error("export manifest missing");
		const manifest = JSON.parse(await manifestFile.async("string"));
		expect(manifest.revisions[0].facts.items[0].receipts).toEqual([]);
		expect(manifest.revisions[0].facts.items[0].receiptException).toEqual({
			reason: "Printer broken",
		});
		expect(manifest.revisions[0].facts.totals).toEqual(before.facts.totals);

		signIn("requester");
		const after = await view(reportId);
		expect(after.facts.totals).toEqual(before.facts.totals);
		expect(after.facts.items[0]?.receiptException).toEqual({
			reason: "Printer broken",
		});
	});
});
