import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t684-org",
	/** Temporary TUS uploads in the public bucket. */
	tus: new Map<string, Buffer>(),
	/** Private receipt objects by key. */
	objects: new Map<string, Buffer>(),
	deleted: [] as string[],
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
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t684-public",
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
		return { bucket: "t684-private", versionId: null };
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
const { addTripPerDiemItemAction } = await import(
	"@/app/[locale]/(app)/travel-expenses/per-diem-actions"
);
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { db } = await import("@/db");
const { readPrivateObject } = await import("@/lib/storage/export-s3-client");
const { convertLegacyDraft } = await import("./legacy-draft-conversion-store");
const { insertLegacyTravelExpenseDraft } = await import("./__tests__/legacy-claim");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ids = {
	requester: "e6840000-0000-4000-8000-000000000001",
	colleague: "e6840000-0000-4000-8000-000000000002",
	foreigner: "e6840000-0000-4000-8000-000000000003",
};
const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% hotel receipt\n%%EOF");
const owner = { organizationId: "t684-org", employeeId: ids.requester, userId: "t684-requester" };
const NOT_DELETABLE = "This expense report can no longer be deleted";

async function cleanup() {
	// Organization first: its cascades record receipt cleanup work, removed next.
	await admin.query("delete from organization where id in ('t684-org', 't684-foreign')");
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't684-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t684-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		"insert into organization (id, name, slug, created_at) values ('t684-org','Expenses','t684-org',now()), ('t684-foreign','Foreign','t684-foreign',now())",
	);
	for (const [name, employeeId, organizationId] of [
		["requester", ids.requester, "t684-org"],
		["colleague", ids.colleague, "t684-org"],
		["foreigner", ids.foreigner, "t684-foreign"],
	]) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t684-${name}`, name, `t684-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,'member','approved',now())",
			[`t684-member-${name}`, organizationId, `t684-${name}`],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,'employee',now())",
			[employeeId, `t684-${name}`, organizationId],
		);
	}
}

function signIn(name: "requester" | "colleague" | "foreigner" | null) {
	harness.userId = name ? `t684-${name}` : null;
	harness.organizationId = name === "foreigner" ? "t684-foreign" : "t684-org";
}

async function createReceiptReport() {
	signIn("requester");
	const created = await actions.createStandaloneReceiptReportAction();
	if (!created.success) throw new Error(created.error);
	const loaded = await actions.getMyTravelExpenseReport(created.data.reportId);
	if (!loaded.success) throw new Error(loaded.error);
	return loaded.data;
}

/** Attaches a receipt to the report's first expense; returns its stored object key. */
async function uploadReceipt(report: { id: string; items: { id: string }[] }): Promise<string> {
	const tusFileKey = createOwnedTusFileKey("t684-requester");
	harness.tus.set(tusFileKey, pdfBytes);
	const response = await processReceipt(
		new Request("http://localhost/api/upload/travel-expense/report-receipt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tusFileKey,
				reportId: report.id,
				itemId: report.items[0]?.id,
				fileName: "Hotel Rechnung.pdf",
			}),
		}) as unknown as NextRequest,
	);
	expect(response.status).toBe(200);
	const receiptId: string = (await response.json()).receipt.id;
	const { rows } = await admin.query(
		"select storage_key from travel_expense_report_receipt where id = $1",
		[receiptId],
	);
	return rows[0].storage_key;
}

async function countRows(table: string, column: string, value: string): Promise<number> {
	const { rows } = await admin.query(
		`select count(*)::int as count from ${table} where ${column} = $1`,
		[value],
	);
	return rows[0].count;
}

async function stagedCleanupWork(): Promise<number> {
	const { rows } = await admin.query(
		"select count(*)::int as count from travel_expense_receipt_upload where organization_id = 't684-org'",
	);
	return rows[0].count;
}

describe("deleting a draft travel expense report (#684)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
		harness.deleted.length = 0;
	});
	afterAll(cleanup);

	it("deletes a never-submitted standalone draft and cleans up its receipt", async () => {
		const report = await createReceiptReport();
		const key = await uploadReceipt(report);

		const deleted = await actions.deleteDraftTravelExpenseReportAction({ reportId: report.id });
		expect(deleted).toEqual({ success: true, data: { reportId: report.id } });

		expect(await countRows("travel_expense_report", "id", report.id)).toBe(0);
		expect(await countRows("travel_expense_report_item", "report_id", report.id)).toBe(0);
		expect(await countRows("travel_expense_report_receipt", "report_id", report.id)).toBe(0);
		expect(harness.deleted).toEqual([key]);
		expect(await stagedCleanupWork()).toBe(0);
		expect(await actions.getMyTravelExpenseReport(report.id)).toEqual({
			success: false,
			error: "Expense report not found",
		});
		expect(await actions.getMyDraftTravelExpenseReports()).toEqual({ success: true, data: [] });
		// A deleted draft takes no further edits.
		const late = await actions.saveReceiptItemDraftAction({
			reportId: report.id,
			itemId: report.items[0]?.id ?? "",
			expectedVersion: 1,
			values: {
				expenseDate: null,
				category: null,
				description: "Late",
				amount: null,
				currency: "EUR",
				paidBy: null,
				accountingReference: null,
			},
		});
		expect(late).toEqual({ success: false, error: "Expense report not found" });
	});

	it("deletes a draft trip with all of its expenses and its per diem", async () => {
		signIn("requester");
		const created = await actions.createTripReportAction();
		if (!created.success) throw new Error(created.error);
		const { reportId } = created.data;
		expect(await actions.addTripReportItemAction({ reportId })).toMatchObject({ success: true });
		expect(await addTripPerDiemItemAction({ reportId })).toMatchObject({ success: true });
		expect(await countRows("travel_expense_report_per_diem", "report_id", reportId)).toBe(1);

		expect(await actions.deleteDraftTravelExpenseReportAction({ reportId })).toEqual({
			success: true,
			data: { reportId },
		});
		expect(await countRows("travel_expense_report", "id", reportId)).toBe(0);
		expect(await countRows("travel_expense_report_item", "report_id", reportId)).toBe(0);
		expect(await countRows("travel_expense_report_per_diem", "report_id", reportId)).toBe(0);
	});

	it.each([
		["submitted", "submitted", "now()", "null"],
		["returned", "returned", "now()", "now()"],
		["approved", "approved", "now()", "now()"],
		["rejected", "rejected", "now()", "now()"],
		["withdrawn", "draft", "now()", "null"],
	])(
		"refuses to delete a %s report and keeps it with its receipt",
		async (_label, status, submittedAt, decidedAt) => {
			const report = await createReceiptReport();
			const key = await uploadReceipt(report);
			await admin.query(
				`update travel_expense_report set status = $2, submission_count = 1,
				submitted_at = ${submittedAt}, decided_at = ${decidedAt} where id = $1`,
				[report.id, status],
			);

			expect(await actions.deleteDraftTravelExpenseReportAction({ reportId: report.id })).toEqual({
				success: false,
				error: NOT_DELETABLE,
			});
			expect(await countRows("travel_expense_report", "id", report.id)).toBe(1);
			expect(await countRows("travel_expense_report_receipt", "report_id", report.id)).toBe(1);
			expect(harness.deleted).not.toContain(key);
			expect(await stagedCleanupWork()).toBe(0);
		},
	);

	it("lets only the owner, signed in to the report's organization, delete it", async () => {
		const report = await createReceiptReport();
		const notFound = { success: false, error: "Expense report not found" };

		signIn("colleague");
		expect(await actions.deleteDraftTravelExpenseReportAction({ reportId: report.id })).toEqual(
			notFound,
		);
		signIn("foreigner");
		expect(await actions.deleteDraftTravelExpenseReportAction({ reportId: report.id })).toEqual(
			notFound,
		);
		signIn(null);
		expect(await actions.deleteDraftTravelExpenseReportAction({ reportId: report.id })).toEqual({
			success: false,
			error: "Unauthorized",
		});
		signIn("requester");
		expect(await actions.deleteDraftTravelExpenseReportAction({ reportId: "not-a-uuid" })).toEqual(
			notFound,
		);
		expect(await countRows("travel_expense_report", "id", report.id)).toBe(1);
	});

	it("keeps a stored object that another report's receipt still names", async () => {
		const kept = await createReceiptReport();
		const key = await uploadReceipt(kept);
		const copy = await createReceiptReport();
		// An adjustment copy (#615) names the original's stored object.
		await admin.query(
			`insert into travel_expense_report_receipt
				(id, organization_id, report_id, item_id, storage_provider, storage_bucket, storage_key,
				 file_name, mime_type, size_bytes, checksum_sha256, uploaded_by)
			 select $1, organization_id, $2, $3, storage_provider, storage_bucket, storage_key,
				 file_name, mime_type, size_bytes, checksum_sha256, uploaded_by
			 from travel_expense_report_receipt where report_id = $4`,
			[randomUUID(), copy.id, copy.items[0]?.id, kept.id],
		);

		expect(await actions.deleteDraftTravelExpenseReportAction({ reportId: copy.id })).toMatchObject(
			{
				success: true,
			},
		);
		expect(harness.deleted).toEqual([]);
		expect(harness.objects.has(key)).toBe(true);
		expect(await countRows("travel_expense_report_receipt", "report_id", kept.id)).toBe(1);
		expect(await stagedCleanupWork()).toBe(0);
	});

	describe("a draft continued from a legacy claim (#616)", () => {
		async function convertedDraft() {
			const claimId = await insertLegacyTravelExpenseDraft(db, { ...owner, amount: "42.80" });
			const attachmentId = randomUUID();
			const key = `travel-expenses/t684-org/${claimId}/${attachmentId}-taxi.pdf`;
			harness.objects.set(key, pdfBytes);
			await admin.query(
				`insert into travel_expense_attachment
					(id, claim_id, organization_id, storage_provider, storage_bucket, storage_key, file_name,
					 mime_type, size_bytes, checksum_sha256, uploaded_by, created_at)
				 values ($1,$2,'t684-org','s3-private','t684-private',$3,'taxi.pdf','application/pdf',$4,$5,$6,now())`,
				[
					attachmentId,
					claimId,
					key,
					pdfBytes.length,
					createHash("sha256").update(pdfBytes).digest("hex"),
					ids.requester,
				],
			);
			const converted = await convertLegacyDraft(
				db,
				owner,
				{ claimId },
				{ readObject: readPrivateObject, defaultTimeZone: "Europe/Berlin" },
			);
			if (converted.kind !== "converted") throw new Error(`not converted: ${converted.kind}`);
			return { claimId, key, reportId: converted.reportId };
		}

		it("deletes the legacy draft too, so it does not come back, and cleans up its receipt", async () => {
			const { claimId, key, reportId } = await convertedDraft();
			signIn("requester");

			expect(await actions.deleteDraftTravelExpenseReportAction({ reportId })).toEqual({
				success: true,
				data: { reportId },
			});
			expect(await countRows("travel_expense_report", "id", reportId)).toBe(0);
			expect(await countRows("travel_expense_claim", "id", claimId)).toBe(0);
			expect(await countRows("travel_expense_attachment", "claim_id", claimId)).toBe(0);
			expect(await countRows("travel_expense_legacy_draft_conversion", "claim_id", claimId)).toBe(
				0,
			);
			expect(harness.deleted).toEqual([key]);
			expect(await stagedCleanupWork()).toBe(0);
		});

		it("cleans up a legacy receipt that was already removed from the report", async () => {
			const { claimId, key, reportId } = await convertedDraft();
			// Removing it from the draft left the object to the legacy attachment.
			await admin.query("delete from travel_expense_report_receipt where report_id = $1", [
				reportId,
			]);
			await admin.query(
				"delete from travel_expense_receipt_upload where organization_id = 't684-org'",
			);
			signIn("requester");

			expect(await actions.deleteDraftTravelExpenseReportAction({ reportId })).toMatchObject({
				success: true,
			});
			expect(await countRows("travel_expense_claim", "id", claimId)).toBe(0);
			expect(harness.deleted).toEqual([key]);
			expect(await stagedCleanupWork()).toBe(0);
		});

		it("keeps a legacy claim that is no longer a draft, with its receipt", async () => {
			const { claimId, key, reportId } = await convertedDraft();
			await admin.query(
				"update travel_expense_claim set status = 'submitted', submitted_at = now() where id = $1",
				[claimId],
			);
			signIn("requester");

			expect(await actions.deleteDraftTravelExpenseReportAction({ reportId })).toMatchObject({
				success: true,
			});
			expect(await countRows("travel_expense_report", "id", reportId)).toBe(0);
			expect(await countRows("travel_expense_claim", "id", claimId)).toBe(1);
			expect(await countRows("travel_expense_attachment", "claim_id", claimId)).toBe(1);
			expect(harness.deleted).toEqual([]);
			expect(harness.objects.has(key)).toBe(true);
		});
	});
});
