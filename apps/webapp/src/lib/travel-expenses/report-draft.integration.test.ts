import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t600-org",
	/** Temporary TUS uploads in the public bucket. */
	tus: new Map<string, Buffer>(),
	/** Private receipt objects by key. */
	objects: new Map<string, Buffer>(),
	deleted: [] as string[],
	failPrivateUpload: false,
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
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t600-public",
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
		if (harness.failPrivateUpload) throw new Error("storage unavailable");
		harness.objects.set(key, Buffer.from(data));
		return { bucket: "t600-private", versionId: null };
	},
	async readPrivateObject(input: { key: string }) {
		const bytes = harness.objects.get(input.key);
		if (!bytes) throw new Error("NoSuchKey");
		return bytes;
	},
	async deletePrivateObject(input: { key: string }) {
		harness.deleted.push(input.key);
		harness.objects.delete(input.key);
	},
}));

const actions = await import("@/app/[locale]/(app)/travel-expenses/report-actions");
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { GET: getReceipt } = await import(
	"@/app/api/travel-expenses/reports/[reportId]/receipts/[receiptId]/route"
);
const { db } = await import("@/db");
const { saveReceiptItemDraft } = await import("./report-store");
const { finalizeReportReceiptUpload, stageReportReceiptUpload } = await import(
	"./report-receipt-upload"
);
const { runTravelExpenseReceiptCleanup } = await import("./receipt-upload");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
const { systemClock } = await import("@/lib/datetime/temporal-core");

const ids = {
	requester: "e6000000-0000-4000-8000-000000000001",
	colleague: "e6000000-0000-4000-8000-000000000002",
	foreigner: "e6000000-0000-4000-8000-000000000003",
};
const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% hotel receipt\n%%EOF");

async function cleanup() {
	// Organization first: its cascades record receipt cleanup work, removed next.
	await admin.query("delete from organization where id in ('t600-org', 't600-foreign')");
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't600-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t600-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		"insert into organization (id, name, slug, created_at) values ('t600-org','Expenses','t600-org',now()), ('t600-foreign','Foreign','t600-foreign',now())",
	);
	for (const [name, employeeId, organizationId] of [
		["requester", ids.requester, "t600-org"],
		["colleague", ids.colleague, "t600-org"],
		["foreigner", ids.foreigner, "t600-foreign"],
	]) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t600-${name}`, name, `t600-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,'member','approved',now())",
			[`t600-member-${name}`, organizationId, `t600-${name}`],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,'employee',now())",
			[employeeId, `t600-${name}`, organizationId],
		);
	}
}

function signIn(name: "requester" | "colleague" | "foreigner") {
	harness.userId = `t600-${name}`;
	harness.organizationId = name === "foreigner" ? "t600-foreign" : "t600-org";
}

const requesterOwner = {
	organizationId: "t600-org",
	employeeId: ids.requester,
	userId: "t600-requester",
};

async function createReport() {
	signIn("requester");
	const created = await actions.createStandaloneReceiptReportAction();
	if (!created.success) throw new Error(created.error);
	const loaded = await actions.getMyTravelExpenseReport(created.data.reportId);
	if (!loaded.success) throw new Error(loaded.error);
	return loaded.data;
}

const completeValues = {
	expenseDate: "2026-09-14",
	category: "accommodation",
	description: "Hotel Hamburg",
	amount: "129,90",
	currency: "EUR",
	paidBy: "company",
	accountingReference: "KST-4711",
};

function uploadRequest(body: unknown) {
	return new Request("http://localhost/api/upload/travel-expense/report-receipt", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	}) as unknown as NextRequest;
}

async function upload(report: { id: string; items: { id: string }[] }, bytes = pdfBytes) {
	const tusFileKey = createOwnedTusFileKey("t600-requester");
	harness.tus.set(tusFileKey, bytes);
	return processReceipt(
		uploadRequest({
			tusFileKey,
			reportId: report.id,
			itemId: report.items[0]?.id,
			fileName: "Hotel Rechnung.pdf",
		}),
	);
}

/** A small receipt photo that stays below this suite's 1 KB upload limit. */
function receiptPhoto() {
	return sharp({
		create: { width: 400, height: 300, channels: 3, background: { r: 240, g: 236, b: 228 } },
	})
		.png({ compressionLevel: 9 })
		.toBuffer();
}

function receiptRequest(reportId: string, receiptId: string, query = "") {
	return getReceipt(
		new Request(
			`http://localhost/api/travel-expenses/reports/${reportId}/receipts/${receiptId}${query}`,
		) as unknown as NextRequest,
		{ params: Promise.resolve({ reportId, receiptId }) },
	);
}

describe("standalone receipt report drafts (#600)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
		harness.deleted.length = 0;
		harness.failPrivateUpload = false;
	});
	afterAll(cleanup);

	it("creates a standalone report without trip dates and resumes saved fields after reload", async () => {
		const report = await createReport();
		expect(report).toMatchObject({
			kind: "standalone",
			status: "draft",
			reimbursementCurrency: "EUR",
		});
		const [item] = report.items;
		expect(item).toMatchObject({ version: 1, currency: "EUR", expenseDate: null, receipts: [] });

		const saved = await actions.saveReceiptItemDraftAction({
			reportId: report.id,
			itemId: item!.id,
			expectedVersion: 1,
			values: completeValues,
		});
		expect(saved).toMatchObject({ success: true, data: { status: "saved", item: { version: 2 } } });

		const reloaded = await actions.getMyTravelExpenseReport(report.id);
		expect(reloaded.success && reloaded.data.items[0]).toMatchObject({
			version: 2,
			expenseDate: "2026-09-14",
			category: "accommodation",
			description: "Hotel Hamburg",
			amount: "129.90",
			currency: "EUR",
			paidBy: "company",
			accountingReference: "KST-4711",
		});
		const drafts = await actions.getMyDraftTravelExpenseReports();
		expect(drafts).toMatchObject({
			success: true,
			data: [{ id: report.id, description: "Hotel Hamburg", amount: "129.90", receiptCount: 0 }],
		});
	});

	it("keeps an incomplete draft and rejects malformed values without writing", async () => {
		const report = await createReport();
		const itemId = report.items[0]!.id;
		const partial = await actions.saveReceiptItemDraftAction({
			reportId: report.id,
			itemId,
			expectedVersion: 1,
			values: { ...completeValues, category: null, amount: null, paidBy: null },
		});
		expect(partial).toMatchObject({ success: true, data: { status: "saved" } });

		const malformed = await actions.saveReceiptItemDraftAction({
			reportId: report.id,
			itemId,
			expectedVersion: 2,
			values: { ...completeValues, amount: "12.345", paidBy: "manager" },
		});
		expect(malformed).toEqual({
			success: true,
			data: { status: "invalid", errors: { amount: "invalid_amount", paidBy: "invalid_payer" } },
		});
		const reloaded = await actions.getMyTravelExpenseReport(report.id);
		expect(reloaded.success && reloaded.data.items[0]).toMatchObject({
			version: 2,
			description: "Hotel Hamburg",
			amount: null,
		});
	});

	it("refuses a stale save and returns the newer saved item instead of overwriting it", async () => {
		const report = await createReport();
		const itemId = report.items[0]!.id;
		await actions.saveReceiptItemDraftAction({
			reportId: report.id,
			itemId,
			expectedVersion: 1,
			values: { ...completeValues, description: "Newer edit" },
		});
		const stale = await actions.saveReceiptItemDraftAction({
			reportId: report.id,
			itemId,
			expectedVersion: 1,
			values: { ...completeValues, description: "Stale tab" },
		});
		expect(stale).toMatchObject({
			success: true,
			data: { status: "conflict", item: { version: 2, description: "Newer edit" } },
		});
	});

	it("lets exactly one of two concurrent saves of the same version win", async () => {
		const report = await createReport();
		const itemId = report.items[0]!.id;
		const results = await Promise.all(
			["First", "Second"].map((description) =>
				saveReceiptItemDraft(db, requesterOwner, {
					reportId: report.id,
					itemId,
					expectedVersion: 1,
					draft: {
						expenseDate: null,
						category: null,
						description,
						amount: null,
						currency: "EUR",
						paidBy: null,
						accountingReference: null,
					},
				}),
			),
		);
		expect(results.map((result) => result.kind).sort()).toEqual(["conflict", "saved"]);
		const winner = results.find((result) => result.kind === "saved");
		const { rows } = await admin.query(
			"select description, version from travel_expense_report_item where id = $1",
			[itemId],
		);
		expect(rows[0]).toEqual({
			description: winner?.kind === "saved" ? winner.item.description : undefined,
			version: 2,
		});
	});

	it("scopes reads, saves, uploads and previews to the owning employee", async () => {
		const report = await createReport();
		const itemId = report.items[0]!.id;
		const uploaded = await upload(report);
		expect(uploaded.status).toBe(200);
		const receiptId: string = (await uploaded.json()).receipt.id;

		for (const other of ["colleague", "foreigner"] as const) {
			signIn(other);
			expect(await actions.getMyTravelExpenseReport(report.id)).toEqual({
				success: false,
				error: "Expense report not found",
			});
			expect(
				await actions.saveReceiptItemDraftAction({
					reportId: report.id,
					itemId,
					expectedVersion: 1,
					values: completeValues,
				}),
			).toEqual({ success: false, error: "Expense report not found" });
			expect(
				await actions.removeReportReceiptAction({ reportId: report.id, itemId, receiptId }),
			).toEqual({ success: false, error: "Receipt not found" });
			expect((await receiptRequest(report.id, receiptId)).status).toBe(404);
			const tusFileKey = createOwnedTusFileKey(`t600-${other}`);
			harness.tus.set(tusFileKey, pdfBytes);
			const response = await processReceipt(
				uploadRequest({ tusFileKey, reportId: report.id, itemId }),
			);
			expect(response.status).toBe(404);
		}
		const { rows } = await admin.query(
			"select count(*)::int as count from travel_expense_report_receipt where report_id = $1",
			[report.id],
		);
		expect(rows[0].count).toBe(1);
	});

	it("attaches a validated receipt with its checksum, previews it and survives reload", async () => {
		const report = await createReport();
		const response = await upload(report);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.receipt).toMatchObject({
			fileName: "Hotel-Rechnung.pdf",
			mimeType: "application/pdf",
			sizeBytes: pdfBytes.length,
		});

		const { rows } = await admin.query(
			"select storage_key, checksum_sha256 from travel_expense_report_receipt where id = $1",
			[body.receipt.id],
		);
		expect(rows[0].checksum_sha256).toBe(createHash("sha256").update(pdfBytes).digest("hex"));
		expect(rows[0].storage_key).toMatch(/^travel-expenses\/t600-org\/reports\//);
		const staged = await admin.query(
			"select count(*)::int as count from travel_expense_receipt_upload where organization_id = 't600-org'",
		);
		expect(staged.rows[0].count).toBe(0);
		expect(harness.tus.size).toBe(0);

		const reloaded = await actions.getMyTravelExpenseReport(report.id);
		expect(reloaded.success && reloaded.data.items[0]?.receipts).toEqual([
			expect.objectContaining({ id: body.receipt.id, fileName: "Hotel-Rechnung.pdf" }),
		]);

		const preview = await receiptRequest(report.id, body.receipt.id);
		expect(preview.status).toBe(200);
		expect(preview.headers.get("content-type")).toBe("application/pdf");
		expect(preview.headers.get("cache-control")).toBe("private, no-store");
		expect(Buffer.from(await preview.arrayBuffer())).toEqual(pdfBytes);
		// A PDF has no image preview; its tile shows an icon.
		expect((await receiptRequest(report.id, body.receipt.id, "?variant=thumb")).status).toBe(404);

		// Changed stored content is never served as the recorded receipt.
		harness.objects.set(rows[0].storage_key, Buffer.from("%PDF-1.4 tampered"));
		expect((await receiptRequest(report.id, body.receipt.id)).status).toBe(503);
	});

	it("rejects files by their actual bytes and size without staging anything", async () => {
		const report = await createReport();
		const disguised = await upload(report, Buffer.from("just text pretending to be a pdf"));
		expect(disguised.status).toBe(400);
		const oversized = await upload(report, Buffer.concat([pdfBytes, Buffer.alloc(2048)]));
		expect(oversized.status).toBe(413);
		const { rows } = await admin.query(
			"select (select count(*)::int from travel_expense_receipt_upload where organization_id = 't600-org') as staged, (select count(*)::int from travel_expense_report_receipt where report_id = $1) as attached",
			[report.id],
		);
		expect(rows[0]).toEqual({ staged: 0, attached: 0 });
	});

	it("records a failed storage write as durable cleanup work", async () => {
		const report = await createReport();
		harness.failPrivateUpload = true;
		expect((await upload(report)).status).toBe(500);
		const { rows } = await admin.query(
			"select status, reason, report_id, item_id, claim_id from travel_expense_receipt_upload where organization_id = 't600-org'",
		);
		expect(rows).toEqual([
			{
				status: "cleanup_required",
				reason: "finalization_failed",
				report_id: report.id,
				item_id: report.items[0]!.id,
				claim_id: null,
			},
		]);
	});

	it("serves a small preview of a receipt photo, and only to who may open the receipt (#690)", async () => {
		const report = await createReport();
		const photo = await receiptPhoto();
		const body = await (await upload(report, photo)).json();
		expect(body.receipt).toMatchObject({ mimeType: "image/png" });

		const preview = await receiptRequest(report.id, body.receipt.id, "?variant=thumb");
		expect(preview.status).toBe(200);
		expect(preview.headers.get("content-type")).toBe("image/webp");
		expect(preview.headers.get("cache-control")).toBe("private, no-store");
		const previewBytes = Buffer.from(await preview.arrayBuffer());
		expect(await sharp(previewBytes).metadata()).toMatchObject({
			format: "webp",
			width: 192,
			height: 192,
		});
		// The tile reloads the same preview.
		const again = await receiptRequest(report.id, body.receipt.id, "?variant=thumb");
		expect(Buffer.from(await again.arrayBuffer())).toEqual(previewBytes);

		// Opening and downloading still serve the original.
		const original = await receiptRequest(report.id, body.receipt.id);
		expect(original.headers.get("content-type")).toBe("image/png");
		expect(Buffer.from(await original.arrayBuffer())).toEqual(photo);

		for (const other of ["colleague", "foreigner"] as const) {
			signIn(other);
			expect((await receiptRequest(report.id, body.receipt.id, "?variant=thumb")).status).toBe(404);
		}
	});

	it("removes a receipt and deletes its stored object and preview through durable cleanup", async () => {
		const report = await createReport();
		const body = await (await upload(report, await receiptPhoto())).json();
		const { rows } = await admin.query(
			"select storage_key from travel_expense_report_receipt where id = $1",
			[body.receipt.id],
		);
		expect((await receiptRequest(report.id, body.receipt.id, "?variant=thumb")).status).toBe(200);
		const removed = await actions.removeReportReceiptAction({
			reportId: report.id,
			itemId: report.items[0]!.id,
			receiptId: body.receipt.id,
		});
		expect(removed).toEqual({ success: true, data: { receiptId: body.receipt.id } });
		expect(harness.deleted).toHaveLength(2);
		expect(harness.deleted.at(-1)).toBe(rows[0].storage_key);
		expect([...harness.objects.keys()]).toEqual([]);
		const remaining = await admin.query(
			"select (select count(*)::int from travel_expense_report_receipt where report_id = $1) as attached, (select count(*)::int from travel_expense_receipt_upload where organization_id = 't600-org') as staged",
			[report.id],
		);
		expect(remaining.rows[0]).toEqual({ attached: 0, staged: 0 });
		const again = await actions.removeReportReceiptAction({
			reportId: report.id,
			itemId: report.items[0]!.id,
			receiptId: body.receipt.id,
		});
		expect(again).toEqual({ success: false, error: "Receipt not found" });
	});

	it("never attaches to an item outside the report and leaves the object for cleanup", async () => {
		const report = await createReport();
		const other = await createReport();
		const receiptId = crypto.randomUUID();
		const staged = {
			receiptId,
			organizationId: "t600-org",
			reportId: report.id,
			itemId: other.items[0]!.id,
			uploadedBy: ids.requester,
			userId: "t600-requester",
			storageKey: `travel-expenses/t600-org/reports/${report.id}/x/${receiptId}-a.pdf`,
		};
		await stageReportReceiptUpload(db, staged);
		const result = await finalizeReportReceiptUpload(db, {
			...staged,
			stored: { bucket: "t600-private", versionId: null },
			fileName: "a.pdf",
			mimeType: "application/pdf",
			sizeBytes: 10,
			checksumSha256: "0".repeat(64),
		});
		expect(result).toEqual({ kind: "report_not_draft" });
		const { rows } = await admin.query(
			"select status, reason from travel_expense_receipt_upload where id = $1",
			[receiptId],
		);
		expect(rows[0]).toEqual({ status: "cleanup_required", reason: "report_not_draft" });
	});

	it("records cleanup work for receipts deleted by an owner cascade", async () => {
		const report = await createReport();
		const body = await (await upload(report)).json();
		const { rows } = await admin.query(
			"select storage_key from travel_expense_report_receipt where id = $1",
			[body.receipt.id],
		);
		// Deleting the report cascades through its item and receipt rows.
		await admin.query("delete from travel_expense_report where id = $1", [report.id]);

		const staged = await admin.query(
			"select status, reason, storage_key from travel_expense_receipt_upload where id = $1",
			[body.receipt.id],
		);
		expect(staged.rows).toEqual([
			{ status: "cleanup_required", reason: "removed", storage_key: rows[0].storage_key },
		]);
		const result = await runTravelExpenseReceiptCleanup(db, {
			// The trigger stamps database time, which may run slightly ahead.
			now: systemClock.nowInstant().add({ minutes: 5 }),
			deleteObject: async (input) => {
				harness.deleted.push(input.key);
			},
		});
		expect(result).toMatchObject({ claimed: 1, deleted: 1 });
		expect(harness.deleted).toEqual([rows[0].storage_key]);
	});

	it("never deletes a stored object that a report receipt references", async () => {
		const report = await createReport();
		const body = await (await upload(report)).json();
		const { rows } = await admin.query(
			"select storage_key from travel_expense_report_receipt where id = $1",
			[body.receipt.id],
		);
		// A stale cleanup claim for an attached object (e.g. after a crash).
		await admin.query(
			`insert into travel_expense_receipt_upload (id, organization_id, report_id, item_id, uploaded_by, storage_key, status, reason, next_attempt_at)
			 values ($1, 't600-org', $2, $3, $4, $5, 'cleanup_required', 'finalization_failed', now() - interval '1 minute')`,
			[crypto.randomUUID(), report.id, report.items[0]!.id, ids.requester, rows[0].storage_key],
		);
		const result = await runTravelExpenseReceiptCleanup(db, {
			deleteObject: async () => {
				throw new Error("must not delete an attached receipt");
			},
		});
		expect(result).toMatchObject({ claimed: 1, released: 1, deleted: 0, failed: 0 });
	});
});
