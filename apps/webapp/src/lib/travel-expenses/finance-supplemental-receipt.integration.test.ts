/**
 * #1256: finance-supplied receipts preserve approved expenses and travel
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
	organizationId: "t1256-org",
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
	S3_PUBLIC_BUCKET: "t1256-public",
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
		return { bucket: "t1256-private", versionId: `v-${key.length}` };
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
	requester: "e1260000-0000-4000-8000-000000000001",
	manager: "e1260000-0000-4000-8000-000000000002",
	admin: "e1260000-0000-4000-8000-000000000003",
	foreigner: "e1260000-0000-4000-8000-000000000004",
	reader: "e1260000-0000-4000-8000-000000000005",
	colleague: "e1260000-0000-4000-8000-000000000006",
	owner: "e1260000-0000-4000-8000-000000000007",
} as const;
type Person = keyof typeof ids;

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

async function cleanup() {
	await admin.query(
		"delete from organization where id in ('t1256-org', 't1256-foreign')",
	);
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't1256-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t1256-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t1256-org','Expenses','t1256-org','Europe/Berlin',now()),
		 ('t1256-foreign','Foreign','t1256-foreign','UTC',now())`,
	);
	const people: Array<[Person, string, string, string]> = [
		["requester", "t1256-org", "employee", "member"],
		["manager", "t1256-org", "manager", "member"],
		["admin", "t1256-org", "admin", "admin"],
		["owner", "t1256-org", "admin", "owner"],
		["foreigner", "t1256-foreign", "admin", "admin"],
		["reader", "t1256-org", "employee", "member"],
		["colleague", "t1256-org", "manager", "member"],
	];
	for (const [name, organizationId, role, memberRole] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t1256-${name}`, name, `t1256-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t1256-member-${name}`, organizationId, `t1256-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[ids[name], `t1256-${name}`, organizationId, role],
		);
	}
	await admin.query(
		`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
		 values (gen_random_uuid(), $1, $2, true, 't1256-manager', now(), now())`,
		[ids.requester, ids.manager],
	);
	await admin.query(
		`insert into employee_managers (id,employee_id,manager_id,is_primary,assigned_by,assigned_at,created_at) values (gen_random_uuid(),$1,$2,false,'t1256-admin',now(),now())`,
		[ids.requester, ids.colleague],
	);

	await admin.query(
		`insert into expense_officer_grant (organization_id,officer_employee_id,scope,created_by) values ('t1256-org',$1,'all','t1256-admin')`,
		[ids.reader],
	);
}

function signIn(name: Person) {
	harness.userId = `t1256-${name}`;
	harness.organizationId = name === "foreigner" ? "t1256-foreign" : "t1256-org";
}

async function setPolicy(allowed: boolean) {
	await admin.query(
		`insert into travel_expense_settings (organization_id, missing_receipt_exceptions_allowed)
		 values ('t1256-org', $1)
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
	actor: Person = "manager",
) {
	signIn(actor);
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
const adjustments = await import(
	"@/app/[locale]/(app)/travel-expenses/adjustment-actions"
);
const recovery = await import(
	"@/app/[locale]/(app)/travel-expenses/finance-recovery-actions"
);
const reopenActions = await import(
	"@/app/[locale]/(app)/travel-expenses/report-reopen-actions"
);
const finance = await import(
	"@/app/[locale]/(app)/travel-expenses/finance-actions"
);
const officers = await import(
	"@/app/[locale]/(app)/settings/travel-expenses/expense-officer-actions"
);
async function approvedMissing() {
	const report = await submittedMissing();
	expect(
		(
			await decide("approve", await pendingRequestId(report.reportId), {
				acceptedReceiptExceptionItemIds: [report.itemId],
			})
		).status,
	).toBe(200);
	return report;
}
async function grantFinance(
	canExport = true,
	canRecordReimbursements = false,
	options: {
		officer?: Person;
		employeeIds?: string[];
		teamIds?: string[];
	} = {},
) {
	signIn("admin");
	const saved = await officers.saveExpenseOfficerGrantAction({
		officerEmployeeId: ids[options.officer ?? "reader"],
		scope: "specific",
		teamIds: options.teamIds ?? [],
		employeeIds: options.employeeIds ?? [ids.requester],
		canExport,
		canRecordReimbursements,
	});
	if (!saved.success) throw new Error(saved.error);
	return saved.data.grantId;
}
async function createBatch(reportId: string) {
	signIn("admin");
	const listed = await exportActions.getTravelExpenseExports();
	if (!listed.success) throw new Error(listed.error);
	const row = listed.data.exportable.find(
		(candidate) => candidate.reportId === reportId,
	);
	if (!row) throw new Error("approved report not exportable");
	const selection = [{ reportId, revisionId: row.revisionId }];
	const created = await exportActions.createTravelExpenseExportAction({
		idempotencyKey: crypto.randomUUID(),
		selection,
	});
	if (!created.success || created.data.status !== "created")
		throw new Error("export not created");
	const job = harness.jobs.shift();
	if (!job) throw new Error("export not queued");
	return { batchId: created.data.batchId, job, selection };
}
async function archiveOf(batchId: string) {
	signIn("admin");
	const response = await downloadExport(
		new Request("http://localhost/export") as NextRequest,
		{ params: Promise.resolve({ batchId }) },
	);
	expect(response.status).toBe(200);
	const bytes = Buffer.from(await response.arrayBuffer());
	const archive = await JSZip.loadAsync(bytes);
	const file = archive.file("manifest.json");
	if (!file) throw new Error("manifest missing");
	return {
		bytes,
		manifest: JSON.parse(await file.async("string")),
		receipts: Object.values(archive.files).filter(
			(file) => file.name.startsWith("receipts/") && !file.dir,
		),
	};
}
describe("finance supplemental receipts (#1256)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
		harness.jobs.length = 0;
		harness.onUpload = null;
		harness.failStorage = false;
	});
	afterAll(cleanup);
	it("lets an export-only scoped officer supply an approved report receipt and its owner download it without financial or approval changes", async () => {
		const { reportId, itemId } = await approvedMissing();
		await grantFinance();
		signIn("reader");
		const before = await view(reportId);
		expect((await uploadMissing(reportId, itemId)).status).toBe(201);
		const after = await view(reportId);
		expect(after.status).toBe("approved");
		expect((await uploadMissing(reportId, itemId)).status).toBe(404);
		expect({
			...after.facts,
			items: after.facts.items.map((item) => ({ ...item, receipts: [] })),
		}).toEqual(before.facts);
		expect(after.facts.items[0]?.receiptException).toEqual({
			reason: "Printer broken",
		});
		expect(after.decision).toEqual(before.decision);
		expect(after.cycles).toEqual(before.cycles);
		const receipt = receiptOf(after);
		expect(receipt).toMatchObject({
			addedAfterSubmission: true,
			uploadedByName: "reader",
		});
		signIn("requester");
		const response = await downloadReceipt(
			new Request("http://localhost/receipt?download=1") as NextRequest,
			{ params: Promise.resolve({ reportId, receiptId: receipt.receiptId }) },
		);
		expect(response.status).toBe(200);
		expect(Buffer.from(await response.arrayBuffer())).toEqual(pdfBytes);
	});
	it.each(["admin", "owner"] as const)(
		"allows the organization %s without an explicit officer grant",
		async (person) => {
			const { reportId, itemId } = await approvedMissing();
			signIn(person);
			expect((await view(reportId)).canAddReceipt).toBe(true);
			expect((await uploadMissing(reportId, itemId)).status).toBe(201);
			expect(receiptOf(await view(reportId))).toMatchObject({
				uploadedByName: person,
			});
		},
	);
	it("allows a reimbursement-only officer and preserves the entire settlement account", async () => {
		const { reportId, itemId } = await approvedMissing();
		await grantFinance(false, true);
		signIn("reader");
		const before = await finance.getTravelExpenseSettlement({
			type: "report",
			id: reportId,
		});
		expect(before).toMatchObject({ success: true });
		expect((await view(reportId)).canAddReceipt).toBe(true);
		expect((await uploadMissing(reportId, itemId)).status).toBe(201);
		expect(
			await finance.getTravelExpenseSettlement({
				type: "report",
				id: reportId,
			}),
		).toEqual(before);
	});
	it.each(["requester", "manager", "reader", "foreigner"] as const)(
		"denies %s when report read or historical review is the only authority",
		async (person) => {
			const { reportId, itemId } = await approvedMissing();
			signIn(person);
			expect((await uploadMissing(reportId, itemId)).status).toBe(404);
			expect(harness.objects.size).toBe(0);
			if (person !== "foreigner")
				expect((await view(reportId)).canAddReceipt).toBe(false);
			signIn("requester");
			expect((await view(reportId)).facts.items[0]?.receipts).toEqual([]);
		},
	);
	it("denies a capable officer whose named-employee scope excludes the report", async () => {
		const { reportId, itemId } = await approvedMissing();
		await grantFinance(true, false, { employeeIds: [ids.colleague] });
		signIn("reader");
		expect((await uploadMissing(reportId, itemId)).status).toBe(404);
		expect(harness.objects.size).toBe(0);
	});
	it.each([
		"grant_revoked",
		"capability_removed",
		"scope_changed",
		"officer_inactive",
		"admin_inactive",
		"membership_removed",
	] as const)(
		"revalidates %s during storage and removes the unauthorized object",
		async (change) => {
			const { reportId, itemId } = await approvedMissing();
			const grantId = await grantFinance();
			const uploader = change === "admin_inactive" ? "admin" : "reader";
			signIn(uploader);
			harness.onUpload = async () => {
				if (change === "grant_revoked") {
					signIn("admin");
					expect(
						await officers.revokeExpenseOfficerGrantAction({ grantId }),
					).toMatchObject({ success: true });
				} else if (change === "capability_removed")
					await grantFinance(false, false);
				else if (change === "scope_changed")
					await grantFinance(true, false, { employeeIds: [ids.colleague] });
				else if (change === "membership_removed")
					await admin.query(
						"delete from member where organization_id='t1256-org' and user_id='t1256-reader'",
					);
				else
					await admin.query("update employee set is_active=false where id=$1", [
						ids[uploader],
					]);
				signIn(uploader);
			};
			expect((await uploadMissing(reportId, itemId)).status).toBe(409);
			expect(harness.objects.size).toBe(0);
			signIn("requester");
			const report = await view(reportId);
			expect(report.facts.items[0]?.receipts).toEqual([]);
			expect(
				report.history.filter((event) => event.label === "receipt_added"),
			).toEqual([]);
		},
	);
	it.each([false, true])(
		"keeps approval-time team scope after a move (departed=%s)",
		async (departed) => {
			const berlin = "e1260000-0000-4000-8000-000000000101",
				munich = "e1260000-0000-4000-8000-000000000102";
			for (const [id, name] of [
				[berlin, "Berlin"],
				[munich, "Munich"],
			])
				await admin.query(
					"insert into team(id,organization_id,name,updated_at) values($1,'t1256-org',$2,now())",
					[id, name],
				);
			await admin.query("update employee set team_id=$1 where id=$2", [
				berlin,
				ids.requester,
			]);
			const { reportId, itemId } = await approvedMissing();
			await grantFinance(true, false, { employeeIds: [], teamIds: [berlin] });
			await grantFinance(false, true, {
				officer: "colleague",
				employeeIds: [],
				teamIds: [munich],
			});
			await admin.query(
				"update employee set team_id=$1,is_active=$2 where id=$3",
				[munich, !departed, ids.requester],
			);
			signIn("colleague");
			expect((await uploadMissing(reportId, itemId)).status).toBe(404);
			signIn("reader");
			expect((await view(reportId)).canAddReceipt).toBe(true);
			expect((await uploadMissing(reportId, itemId)).status).toBe(201);
		},
	);
	it.each([false, true])(
		"freezes the export manifest at batch creation and preserves it through failure/retry (uploadFirst=%s)",
		async (uploadFirst) => {
			const { reportId, itemId } = await approvedMissing();
			await grantFinance();
			signIn("requester");
			const original = await view(reportId);
			if (uploadFirst) {
				signIn("reader");
				expect((await uploadMissing(reportId, itemId)).status).toBe(201);
			}
			const batch = await createBatch(reportId);
			if (!uploadFirst) {
				signIn("reader");
				expect((await uploadMissing(reportId, itemId)).status).toBe(201);
			}
			// A failed artifact write retries the same stored manifest, after the late document exists.
			harness.failStorage = true;
			expect(
				await processTravelExpenseExportBatch(db, batch.job),
			).toMatchObject({ status: "failed" });
			harness.failStorage = false;
			signIn("admin");
			expect(
				await exportActions.retryTravelExpenseExportAction(batch.batchId),
			).toMatchObject({ success: true, data: { status: "queued" } });
			const retry = harness.jobs.shift();
			if (!retry) throw new Error("retry not queued");
			expect(await processTravelExpenseExportBatch(db, retry)).toEqual({
				status: "completed",
			});
			const archive = await archiveOf(batch.batchId);
			expect(archive.receipts).toHaveLength(uploadFirst ? 1 : 0);
			if (uploadFirst)
				expect(await archive.receipts[0]?.async("nodebuffer")).toEqual(
					pdfBytes,
				);
			expect(archive.manifest.revisions[0].facts.items[0].receipts).toEqual([]);
			expect(
				archive.manifest.revisions[0].facts.items[0].receiptException,
			).toEqual({ reason: "Printer broken" });
			expect(archive.manifest.revisions[0].facts.totals).toEqual(
				original.facts.totals,
			);
			expect(
				archive.manifest.revisions[0].supplementalReceipts ?? [],
			).toHaveLength(uploadFirst ? 1 : 0);
			// A duplicate worker delivery cannot rebuild the completed artifact with newer evidence.
			expect(await processTravelExpenseExportBatch(db, batch.job)).toEqual({
				status: "skipped",
			});
			expect((await archiveOf(batch.batchId)).bytes).toEqual(archive.bytes);
			signIn("admin");
			expect(
				await exportActions.createTravelExpenseExportAction({
					idempotencyKey: crypto.randomUUID(),
					selection: batch.selection,
				}),
			).toMatchObject({ success: true, data: { status: "already_exported" } });
			signIn("requester");
			const after = await view(reportId);
			expect(after.status).toBe("approved");
			expect(after.decision).toEqual(original.decision);
			const receiptId = receiptOf(after).receiptId;
			const response = await downloadReceipt(
				new Request("http://localhost/receipt?download=1") as NextRequest,
				{ params: Promise.resolve({ reportId, receiptId }) },
			);
			expect(response.status).toBe(200);
			expect(Buffer.from(await response.arrayBuffer())).toEqual(pdfBytes);
		},
	);
	it("adds a document after reimbursement without changing any settlement entry or balance", async () => {
		const { reportId, itemId } = await approvedMissing();
		signIn("admin");
		expect(
			await finance.recordTravelExpenseReimbursementAction({
				source: { type: "report", id: reportId },
				idempotencyKey: crypto.randomUUID(),
				amount: "64.20",
				occurredOn: "2026-10-01",
				reference: "BANK-1256",
				note: null,
				expectedBalance: { currency: "EUR", amount: "64.20" },
			}),
		).toMatchObject({ success: true, data: { status: "recorded" } });
		const before = await finance.getTravelExpenseSettlement({
			type: "report",
			id: reportId,
		});
		expect(before).toMatchObject({
			success: true,
			data: {
				account: { entries: [{ amount: "64.20", reference: "BANK-1256" }] },
			},
		});
		expect((await uploadMissing(reportId, itemId)).status).toBe(201);
		expect(
			await finance.getTravelExpenseSettlement({
				type: "report",
				id: reportId,
			}),
		).toEqual(before);
		expect((await view(reportId)).status).toBe("approved");
	});
	it("finalizes one concurrent finance upload and cleans up the losing private object", async () => {
		const { reportId, itemId } = await approvedMissing();
		await grantFinance();
		signIn("reader");
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
		const first = uploadMissing(reportId, itemId),
			second = uploadMissing(reportId, itemId);
		await stored;
		release();
		const results = await Promise.all([first, second]);
		expect(results.map((response) => response.status).sort()).toEqual([
			201, 409,
		]);
		expect(harness.objects.size).toBe(1);
		const report = await view(reportId);
		expect(report.facts.items[0]?.receipts).toHaveLength(1);
		expect(
			report.history.filter((event) => event.label === "receipt_added"),
		).toHaveLength(1);
	});
	it("combines historical reviewer access with current approved finance access without revealing unrelated cycles", async () => {
		const { reportId, itemId } = await submittedMissing();
		signIn("manager");
		expect((await view(reportId)).submissionCycle).toBe(1);
		signIn("requester");
		expect(
			await reviewActions.withdrawTravelExpenseReportAction({
				reportId,
				submissionCycle: 1,
			}),
		).toMatchObject({ success: true, data: { status: "withdrawn" } });
		await admin.query(
			"delete from employee_managers where employee_id=$1 and manager_id=$2",
			[ids.requester, ids.manager],
		);
		await admin.query(
			"update employee_managers set is_primary=true where employee_id=$1 and manager_id=$2",
			[ids.requester, ids.colleague],
		);
		expect(await submit(reportId)).toMatchObject({
			success: true,
			data: { status: "submitted" },
		});
		signIn("requester");
		expect(
			await reviewActions.withdrawTravelExpenseReportAction({
				reportId,
				submissionCycle: 2,
			}),
		).toMatchObject({ success: true, data: { status: "withdrawn" } });
		expect(await submit(reportId)).toMatchObject({
			success: true,
			data: { status: "submitted" },
		});
		expect(
			(
				await decide(
					"approve",
					await pendingRequestId(reportId),
					{ acceptedReceiptExceptionItemIds: [itemId] },
					"colleague",
				)
			).status,
		).toBe(200);
		await grantFinance(true, false, { officer: "manager" });
		signIn("manager");
		expect(await view(reportId)).toMatchObject({
			submissionCycle: 3,
			status: "approved",
			canAddReceipt: true,
		});
		expect(
			await actions.getTravelExpenseReportSubmission(reportId, 1),
		).toMatchObject({
			success: true,
			data: { submissionCycle: 1, canAddReceipt: false },
		});
		expect(
			await actions.getTravelExpenseReportSubmission(reportId, 2),
		).toMatchObject({ success: false });
		expect(
			await actions.getTravelExpenseReportSubmission(reportId, 3),
		).toMatchObject({ success: true, data: { submissionCycle: 3 } });
		expect((await uploadMissing(reportId, itemId, 3)).status).toBe(201);
		const receiptId = receiptOf(await view(reportId)).receiptId;
		for (const cycle of [undefined, 3]) {
			const response = await downloadReceipt(
				new Request(
					`http://localhost/receipt?download=1${cycle ? `&cycle=${cycle}` : ""}`,
				) as NextRequest,
				{ params: Promise.resolve({ reportId, receiptId }) },
			);
			expect(response.status).toBe(200);
			expect(Buffer.from(await response.arrayBuffer())).toEqual(pdfBytes);
		}
		for (const cycle of [1, 2])
			expect(
				(
					await downloadReceipt(
						new Request(
							`http://localhost/receipt?cycle=${cycle}`,
						) as NextRequest,
						{ params: Promise.resolve({ reportId, receiptId }) },
					)
				).status,
			).toBe(404);
	});
	it("discards a finance upload when the approved report reopens during storage", async () => {
		const { reportId, itemId } = await approvedMissing();
		await grantFinance();
		signIn("reader");
		harness.onUpload = async () => {
			signIn("manager");
			expect(
				await reopenActions.reopenTravelExpenseReportAction({
					reportId,
					submissionCycle: 1,
					reason: "Correct the cost centre",
				}),
			).toMatchObject({ success: true, data: { status: "reopened" } });
			signIn("reader");
		};
		expect((await uploadMissing(reportId, itemId)).status).toBe(409);
		expect(harness.objects.size).toBe(0);
		signIn("requester");
		const report = await view(reportId);
		expect(report.facts.items[0]?.receipts).toEqual([]);
	});
	it("rejects a mismatched report item and stale cycle before storing a finance document", async () => {
		const { reportId, itemId } = await approvedMissing(),
			other = await approvedMissing();
		await grantFinance();
		signIn("reader");
		expect((await uploadMissing(reportId, other.itemId)).status).toBe(404);
		expect((await uploadMissing(reportId, itemId, 2)).status).toBe(404);
		expect(harness.objects.size).toBe(0);
	});
	it("allows a report owner who separately has the scoped export grant", async () => {
		const { reportId, itemId } = await approvedMissing();
		await grantFinance(true, false, { officer: "requester" });
		signIn("requester");
		expect((await view(reportId)).canAddReceipt).toBe(true);
		expect((await uploadMissing(reportId, itemId)).status).toBe(201);
	});
	it("serializes overlapping uploads from a scoped officer and an implicit administrator", async () => {
		const { reportId, itemId } = await approvedMissing();
		await grantFinance();
		signIn("reader");
		let release: () => void = () => {},
			stored: () => void = () => {};
		const reached = new Promise<void>((resolve) => {
			stored = resolve;
		});
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let uploads = 0;
		harness.onUpload = async () => {
			if (++uploads === 1) {
				stored();
				await gate;
			}
		};
		const pending = uploadMissing(reportId, itemId);
		await reached;
		signIn("admin");
		expect((await uploadMissing(reportId, itemId)).status).toBe(201);
		signIn("reader");
		release();
		expect((await pending).status).toBe(409);
		expect(harness.objects.size).toBe(1);
		expect(receiptOf(await view(reportId))).toMatchObject({
			uploadedByName: "admin",
		});
	});
	it("preserves an approved adjustment and the reimbursement and recovery ledger when supplying the original missing receipt", async () => {
		const { reportId, itemId } = await approvedMissing();
		signIn("admin");
		expect(
			await finance.recordTravelExpenseReimbursementAction({
				source: { type: "report", id: reportId },
				idempotencyKey: crypto.randomUUID(),
				amount: "64.20",
				occurredOn: "2026-10-01",
				reference: "BANK-1256",
				note: null,
				expectedBalance: { currency: "EUR", amount: "64.20" },
			}),
		).toMatchObject({ success: true, data: { status: "recorded" } });
		signIn("requester");
		const created = await adjustments.createTravelExpenseAdjustmentAction({
			originalReportId: reportId,
			reason: "Correct dinner amount",
			idempotencyKey: crypto.randomUUID(),
		});
		if (!created.success || created.data.status !== "created")
			throw new Error("adjustment not created");
		const adjustmentId = created.data.reportId;
		const item = (await load(adjustmentId)).items[0];
		if (!item) throw new Error("adjustment item missing");
		expect(
			await actions.saveReceiptItemDraftAction({
				reportId: adjustmentId,
				itemId: item.id,
				expectedVersion: item.version,
				values: {
					expenseDate: "2026-09-14",
					category: "meals",
					description: "Customer dinner",
					amount: "40.00",
					currency: "EUR",
					paidBy: "employee",
					accountingReference: null,
				},
			}),
		).toMatchObject({ success: true, data: { status: "saved" } });
		expect(
			await requestException(adjustmentId, item.id, "Printer broken"),
		).toMatchObject({ success: true });
		expect(await submit(adjustmentId)).toMatchObject({
			success: true,
			data: { status: "submitted" },
		});
		expect(
			(
				await decide("approve", await pendingRequestId(adjustmentId), {
					acceptedReceiptExceptionItemIds: [item.id],
				})
			).status,
		).toBe(200);
		signIn("admin");
		expect(
			await recovery.recordTravelExpenseRecoveryAction({
				source: { type: "report", id: reportId },
				idempotencyKey: crypto.randomUUID(),
				amount: "24.20",
				occurredOn: "2026-10-01",
				reference: "RETURN-1256",
				note: null,
				expectedBalance: { currency: "EUR", amount: "-24.20" },
			}),
		).toMatchObject({ success: true, data: { status: "recorded" } });
		const before = await finance.getTravelExpenseSettlement({
			type: "report",
			id: reportId,
		});
		expect(before).toMatchObject({
			success: true,
			data: {
				account: {
					entries: expect.arrayContaining([
						expect.objectContaining({ kind: "reimbursement", amount: "64.20" }),
						expect.objectContaining({ kind: "recovery", amount: "24.20" }),
					]),
					adjustments: [{ reportId: adjustmentId, delta: "-24.20" }],
				},
			},
		});
		expect((await uploadMissing(reportId, itemId)).status).toBe(201);
		expect(
			await finance.getTravelExpenseSettlement({
				type: "report",
				id: reportId,
			}),
		).toEqual(before);
	});
});
