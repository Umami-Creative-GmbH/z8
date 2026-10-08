import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t616-org",
	tus: new Map<string, Buffer>(),
	/** Private receipt objects by key. */
	objects: new Map<string, Buffer>(),
	reads: [] as string[],
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
vi.mock("@/lib/notifications/triggers", async (original) =>
	(await import("@/test/integration-harness")).notificationTriggers(original),
);
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t616-public",
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
		return { bucket: "t616-private", versionId: null };
	},
	async readPrivateObject(input: { key: string }) {
		harness.reads.push(input.key);
		const bytes = harness.objects.get(input.key);
		if (!bytes) throw new Error("NoSuchKey");
		return bytes;
	},
	async deletePrivateObject(input: { key: string }) {
		harness.deleted.push(input.key);
		harness.objects.delete(input.key);
	},
}));

const { db } = await import("@/db");
const { readPrivateObject, deletePrivateObject } = await import("@/lib/storage/export-s3-client");
const {
	finalizeTravelExpenseReceiptUpload,
	runTravelExpenseReceiptCleanup,
	stageTravelExpenseReceiptUpload,
} = await import("./receipt-upload");
const { removeReportReceipt } = await import("./report-receipt-upload");
const { convertLegacyDraft } = await import("./legacy-draft-conversion-store");
const { loadOwnReport } = await import("./report-store");
const { loadOwnLegacyConversion } = await import("./legacy-draft-conversion-read");
const { resolveReportProjectAttribution } = await import("./project-attribution-store");
const { authorizeProjectAttributionException } = await import(
	"./project-attribution-exception-store"
);
const { insertLegacyTravelExpenseDraft, submitLegacyTravelExpenseClaim } = await import(
	"./__tests__/legacy-claim"
);
const { approveTravelExpenseClaim } = await import("@/app/[locale]/(app)/travel-expenses/actions");
const { loadSettlementAccount, recordSettlementEntry } = await import("./settlement-store");
const { GET: getReportReceipt } = await import(
	"@/app/api/travel-expenses/reports/[reportId]/receipts/[receiptId]/route"
);

const ids = {
	requester: "e6160000-0000-4000-8000-000000000001",
	manager: "e6160000-0000-4000-8000-000000000002",
	colleague: "e6160000-0000-4000-8000-000000000003",
	foreigner: "e6160000-0000-4000-8000-000000000004",
};
const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% legacy taxi receipt\n%%EOF");
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const owner = { organizationId: "t616-org", employeeId: ids.requester, userId: "t616-requester" };
const options = { readObject: readPrivateObject, defaultTimeZone: "Europe/Berlin" };

async function cleanup() {
	await admin.query("delete from organization where id in ('t616-org', 't616-foreign')");
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't616-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t616-%"]);
}

async function seed() {
	await cleanup();
	harness.objects.clear();
	harness.reads.length = 0;
	harness.deleted.length = 0;
	await admin.query(
		"insert into organization (id, name, slug, created_at) values ('t616-org','Expenses','t616-org',now()), ('t616-foreign','Foreign','t616-foreign',now())",
	);
	for (const [name, employeeId, organizationId, role] of [
		["requester", ids.requester, "t616-org", "employee"],
		["manager", ids.manager, "t616-org", "manager"],
		["colleague", ids.colleague, "t616-org", "employee"],
		["foreigner", ids.foreigner, "t616-foreign", "employee"],
	]) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t616-${name}`, name, `t616-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,'member','approved',now())",
			[`t616-member-${name}`, organizationId, `t616-${name}`],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[employeeId, `t616-${name}`, organizationId, role],
		);
	}
}

function signIn(name: "requester" | "colleague" | "manager") {
	harness.userId = `t616-${name}`;
	harness.organizationId = "t616-org";
}

/** A legacy attachment as the legacy upload route stored it (or, without identity, as historical uploads were). */
async function attachLegacyReceipt(
	claimId: string,
	input: { bytes?: Buffer; fileName?: string; historical?: boolean } = {},
) {
	const bytes = input.bytes ?? pdfBytes;
	const attachmentId = randomUUID();
	const fileName = input.fileName ?? "taxi.pdf";
	const key = `travel-expenses/t616-org/${claimId}/${attachmentId}-${fileName}`;
	harness.objects.set(key, bytes);
	await admin.query(
		`insert into travel_expense_attachment
			(id, claim_id, organization_id, storage_provider, storage_bucket, storage_key, file_name,
			 mime_type, size_bytes, checksum_sha256, uploaded_by, created_at)
		 values ($1,$2,'t616-org','s3-private','t616-private',$3,$4,$5,$6,$7,$8,now())`,
		[
			attachmentId,
			claimId,
			key,
			fileName,
			input.historical ? null : "application/pdf",
			input.historical ? null : bytes.length,
			input.historical ? null : sha256(bytes),
			ids.requester,
		],
	);
	return { attachmentId, key };
}

async function claimRow(claimId: string) {
	const result = await admin.query("select * from travel_expense_claim where id = $1", [claimId]);
	return result.rows[0];
}

function receiptRequest(reportId: string, receiptId: string) {
	return getReportReceipt(
		new Request(
			`http://localhost/api/travel-expenses/reports/${reportId}/receipts/${receiptId}`,
		) as unknown as NextRequest,
		{ params: Promise.resolve({ reportId, receiptId }) },
	);
}

describe("legacy draft conversion (#616)", () => {
	beforeEach(async () => {
		await seed();
	});
	afterAll(async () => {
		await cleanup();
	});

	it("continues a receipt draft as a standalone report with its amount, date, notes and receipt identity", async () => {
		const claimId = await insertLegacyTravelExpenseDraft(db, {
			...owner,
			tripStart: "2026-03-29",
			tripEnd: "2026-03-29",
			amount: "42.80",
			notes: "Taxi to the customer",
		});
		const { key } = await attachLegacyReceipt(claimId);
		const before = await claimRow(claimId);

		const result = await convertLegacyDraft(db, owner, { claimId }, options);
		expect(result).toMatchObject({ kind: "converted", replayed: false });
		if (result.kind !== "converted") throw new Error("not converted");

		const report = await loadOwnReport(db, owner, result.reportId);
		expect(report).toMatchObject({
			kind: "standalone",
			status: "draft",
			reimbursementCurrency: "EUR",
		});
		expect(report?.items).toHaveLength(1);
		expect(report?.items[0]).toMatchObject({
			type: "receipt",
			expenseDate: "2026-03-29",
			description: "Taxi to the customer",
			amount: "42.80",
			currency: "EUR",
			paidBy: null,
			category: null,
		});
		const receipt = report?.items[0]?.receipts[0];
		expect(receipt).toMatchObject({ fileName: "taxi.pdf", sizeBytes: pdfBytes.length });
		const stored = await admin.query(
			"select storage_key, checksum_sha256 from travel_expense_report_receipt where report_id = $1",
			[result.reportId],
		);
		// The same stored object, not a copy: neither orphaned nor duplicated.
		expect(stored.rows).toEqual([{ storage_key: key, checksum_sha256: sha256(pdfBytes) }]);

		signIn("requester");
		const download = await receiptRequest(result.reportId, receipt?.id ?? "");
		expect(download.status).toBe(200);
		expect(Buffer.from(await download.arrayBuffer())).toEqual(pdfBytes);

		// The legacy draft itself is never rewritten.
		expect(await claimRow(claimId)).toEqual(before);
	});

	it("converts each draft once: a repeat or a concurrent attempt returns the same report", async () => {
		const claimId = await insertLegacyTravelExpenseDraft(db, owner);
		await attachLegacyReceipt(claimId);
		const [first, second] = await Promise.all([
			convertLegacyDraft(db, owner, { claimId }, options),
			convertLegacyDraft(db, owner, { claimId }, options),
		]);
		const third = await convertLegacyDraft(db, owner, { claimId }, options);
		if (first.kind !== "converted" || second.kind !== "converted" || third.kind !== "converted") {
			throw new Error("not converted");
		}
		expect(new Set([first.reportId, second.reportId, third.reportId]).size).toBe(1);
		expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
		expect(third.replayed).toBe(true);
		const counts = await admin.query(
			`select (select count(*)::int from travel_expense_report where organization_id = 't616-org') as reports,
				(select count(*)::int from travel_expense_report_receipt where organization_id = 't616-org') as receipts,
				(select count(*)::int from travel_expense_legacy_draft_conversion where organization_id = 't616-org') as conversions`,
		);
		expect(counts.rows[0]).toEqual({ reports: 1, receipts: 1, conversions: 1 });
	});

	it("only converts the owner's own drafts and never a submitted or decided claim", async () => {
		const claimId = await insertLegacyTravelExpenseDraft(db, owner);
		for (const other of [
			{ ...owner, employeeId: ids.colleague, userId: "t616-colleague" },
			{ organizationId: "t616-foreign", employeeId: ids.foreigner, userId: "t616-foreigner" },
		]) {
			expect(await convertLegacyDraft(db, other, { claimId }, options)).toEqual({
				kind: "not_found",
			});
		}
		for (const status of ["submitted", "approved", "rejected"]) {
			await admin.query(
				"update travel_expense_claim set status = $2::travel_expense_claim_status, submitted_at = now(), decided_at = case when $2::text = 'submitted' then null else now() end where id = $1",
				[claimId, status],
			);
			const before = await claimRow(claimId);
			expect(await convertLegacyDraft(db, owner, { claimId }, options)).toEqual({
				kind: "not_draft",
			});
			expect(await claimRow(claimId)).toEqual(before);
		}
		const reports = await admin.query(
			"select count(*)::int as count from travel_expense_report where organization_id = 't616-org'",
		);
		expect(reports.rows[0].count).toBe(0);
	});

	it("establishes a historical receipt's identity from its stored bytes, and refuses unreadable ones whole", async () => {
		const claimId = await insertLegacyTravelExpenseDraft(db, owner);
		const pngBytes = Buffer.concat([
			Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
			Buffer.alloc(32, 1),
		]);
		const historical = await attachLegacyReceipt(claimId, {
			bytes: pngBytes,
			fileName: "scan.png",
			historical: true,
		});
		const missing = await attachLegacyReceipt(claimId, { historical: true, fileName: "lost.pdf" });
		harness.objects.delete(missing.key);

		const refused = await convertLegacyDraft(db, owner, { claimId }, options);
		expect(refused).toEqual({
			kind: "receipt_unavailable",
			attachments: [
				{ attachmentId: missing.attachmentId, fileName: "lost.pdf", reason: "unreadable" },
			],
		});
		const nothing = await admin.query(
			"select count(*)::int as count from travel_expense_report where organization_id = 't616-org'",
		);
		expect(nothing.rows[0].count).toBe(0);

		// Restored by an administrator: the conversion now succeeds with both identities.
		harness.objects.set(missing.key, pdfBytes);
		const converted = await convertLegacyDraft(db, owner, { claimId }, options);
		if (converted.kind !== "converted") throw new Error("not converted");
		const receipts = await admin.query(
			"select storage_key, mime_type, size_bytes, checksum_sha256 from travel_expense_report_receipt where report_id = $1 order by file_name",
			[converted.reportId],
		);
		expect(receipts.rows).toEqual([
			{
				storage_key: missing.key,
				mime_type: "application/pdf",
				size_bytes: pdfBytes.length,
				checksum_sha256: sha256(pdfBytes),
			},
			{
				storage_key: historical.key,
				mime_type: "image/png",
				size_bytes: pngBytes.length,
				checksum_sha256: sha256(pngBytes),
			},
		]);
		// The legacy attachment rows keep what they recorded.
		const legacy = await admin.query(
			"select count(*)::int as count from travel_expense_attachment where claim_id = $1 and checksum_sha256 is null",
			[claimId],
		);
		expect(legacy.rows[0].count).toBe(2);
	});

	it("serializes with legacy uploads: one finished before is carried, one finishing after is refused and cleaned up", async () => {
		const claimId = await insertLegacyTravelExpenseDraft(db, owner);
		const upload = (attachmentId: string) => ({
			attachmentId,
			organizationId: owner.organizationId,
			claimId,
			uploadedBy: ids.requester,
			storageKey: `travel-expenses/t616-org/${claimId}/${attachmentId}-late.pdf`,
		});
		const finalize = (staged: ReturnType<typeof upload>) =>
			finalizeTravelExpenseReceiptUpload(db, {
				...staged,
				stored: { bucket: "t616-private", versionId: null },
				fileName: "late.pdf",
				mimeType: "application/pdf",
				sizeBytes: pdfBytes.length,
				checksumSha256: sha256(pdfBytes),
			});
		const early = upload(randomUUID());
		await stageTravelExpenseReceiptUpload(db, early);
		harness.objects.set(early.storageKey, pdfBytes);
		expect((await finalize(early)).kind).toBe("attached");

		// Staged while the draft was open, stored only after it was converted.
		const late = upload(randomUUID());
		await stageTravelExpenseReceiptUpload(db, late);
		const converted = await convertLegacyDraft(db, owner, { claimId }, options);
		if (converted.kind !== "converted") throw new Error("not converted");
		harness.objects.set(late.storageKey, pdfBytes);
		expect(await finalize(late)).toEqual({ kind: "claim_not_draft" });

		const cleanup = await runTravelExpenseReceiptCleanup(db, {
			deleteObject: deletePrivateObject,
			only: { attachmentId: late.attachmentId, organizationId: owner.organizationId },
		});
		expect(cleanup).toMatchObject({ deleted: 1 });
		expect(harness.deleted).toEqual([late.storageKey]);
		const receipts = await admin.query(
			"select storage_key from travel_expense_report_receipt where report_id = $1",
			[converted.reportId],
		);
		expect(receipts.rows).toEqual([{ storage_key: early.storageKey }]);
	});

	it("keeps the shared stored object when the converted receipt is removed from the new draft", async () => {
		const claimId = await insertLegacyTravelExpenseDraft(db, owner);
		const { key } = await attachLegacyReceipt(claimId);
		const converted = await convertLegacyDraft(db, owner, { claimId }, options);
		if (converted.kind !== "converted") throw new Error("not converted");
		const report = await loadOwnReport(db, owner, converted.reportId);
		const item = report?.items[0];
		const receiptId = item?.receipts[0]?.id ?? "";
		expect(
			await removeReportReceipt(db, owner, {
				reportId: converted.reportId,
				itemId: item?.id ?? "",
				receiptId,
			}),
		).toMatchObject({ kind: "removed" });
		await admin.query(
			"update travel_expense_receipt_upload set next_attempt_at = now() - interval '1 minute' where organization_id = 't616-org'",
		);
		const cleanup = await runTravelExpenseReceiptCleanup(db, { deleteObject: deletePrivateObject });
		expect(cleanup).toMatchObject({ deleted: 0, released: 1 });
		expect(harness.objects.has(key)).toBe(true);
	});

	it("leaves mileage and per diem facts the legacy draft never recorded empty, keeping its typed totals for reference", async () => {
		const mileageClaim = await insertLegacyTravelExpenseDraft(db, {
			...owner,
			type: "mileage",
			tripStart: "2026-04-02",
			tripEnd: "2026-04-02",
			amount: "84.00",
		});
		const mileage = await convertLegacyDraft(db, owner, { claimId: mileageClaim }, options);
		if (mileage.kind !== "converted") throw new Error("not converted");
		const mileageReport = await loadOwnReport(db, owner, mileage.reportId);
		expect(mileageReport?.kind).toBe("standalone");
		expect(mileageReport?.items[0]).toMatchObject({
			type: "mileage",
			expenseDate: "2026-04-02",
			amount: null,
			mileage: { route: null, distanceKm: null, vehicle: null, amount: null },
		});
		expect(await loadOwnLegacyConversion(db, owner, { reportId: mileage.reportId })).toMatchObject({
			claimId: mileageClaim,
			flags: ["manual_total_not_used"],
			legacy: { type: "mileage", originalAmount: "84.00", destinationCity: "Hamburg" },
		});

		const perDiemClaim = await insertLegacyTravelExpenseDraft(db, {
			...owner,
			type: "per_diem",
			tripStart: "2026-04-06",
			tripEnd: "2026-04-08",
			destinationCity: "Wien",
			destinationCountry: "Österreich",
			amount: "70.00",
		});
		const perDiem = await convertLegacyDraft(db, owner, { claimId: perDiemClaim }, options);
		if (perDiem.kind !== "converted") throw new Error("not converted");
		const trip = await loadOwnReport(db, owner, perDiem.reportId);
		expect(trip?.kind).toBe("trip");
		expect(trip?.trip).toMatchObject({
			purpose: null,
			startDate: "2026-04-06",
			endDate: "2026-04-08",
			timeZone: "Europe/Berlin",
			destinations: [{ place: "Wien", countryCode: "AT" }],
		});
		expect(trip?.items[0]?.type).toBe("per_diem");
		expect(trip?.items[0]?.perDiem).toMatchObject({
			itinerary: {
				startDate: "2026-04-06",
				startTime: null,
				endDate: "2026-04-08",
				endTime: null,
				overnight: null,
				meals: [],
			},
		});
		// Nothing priced from the typed total: the per diem is incomplete until the itinerary is entered.
		expect(trip?.items[0]?.perDiem?.calculation.status).toBe("incomplete");
	});

	it("keeps the legacy project, which a new submission can only use with history or an authorized exception", async () => {
		const projectId = randomUUID();
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at)
			 values ($1, 't616-org', 'Legacy rollout', 'completed', true, 't616-manager', now())`,
			[projectId],
		);
		// Assigned today: current access never proves the March expense date.
		await admin.query(
			`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
			 values (gen_random_uuid(), $1, 't616-org', 'employee', $2, 't616-manager')`,
			[projectId, ids.requester],
		);
		const claimId = await insertLegacyTravelExpenseDraft(db, {
			...owner,
			tripStart: "2026-03-29",
			tripEnd: "2026-03-29",
		});
		await admin.query("update travel_expense_claim set project_id = $2 where id = $1", [
			claimId,
			projectId,
		]);
		const converted = await convertLegacyDraft(db, owner, { claimId }, options);
		if (converted.kind !== "converted") throw new Error("not converted");
		const report = await loadOwnReport(db, owner, converted.reportId);
		const item = report?.items[0];
		expect(item).toMatchObject({ projectId, projectInherits: false });
		expect((await loadOwnLegacyConversion(db, owner, { claimId }))?.flags).toEqual([
			"project_eligibility_required",
		]);

		const resolve = () =>
			resolveReportProjectAttribution(db, owner, {
				report: { organizationId: owner.organizationId, kind: "standalone", tripTimeZone: null },
				items: [
					{
						id: item?.id ?? "",
						expenseDate: item?.expenseDate ?? null,
						projectId: item?.projectId ?? null,
						projectInherits: item?.projectInherits ?? true,
					},
				],
			});
		expect(await resolve()).toEqual({ ok: false, itemIds: [item?.id] });

		expect(
			await authorizeProjectAttributionException(
				db,
				{ organizationId: "t616-org", employeeId: ids.manager, userId: "t616-manager" },
				{
					employeeId: ids.requester,
					projectId,
					validFrom: "2026-03-01",
					validTo: "2026-03-31",
					reason: "Legacy claim drafted before assignment history",
					evidence: "Project staffing plan March 2026",
				},
			),
		).toMatchObject({ kind: "authorized" });
		const resolved = await resolve();
		expect(resolved.ok && resolved.attribution[item?.id ?? ""]).toMatchObject({
			projectId,
			basis: "exception",
		});
	});

	it("rolls a failed conversion back completely and converts on retry", async () => {
		const claimId = await insertLegacyTravelExpenseDraft(db, owner);
		const { key } = await attachLegacyReceipt(claimId, { fileName: "fail-on-copy.pdf" });
		await admin.query(`
			create or replace function t616_fail_receipt_copy() returns trigger language plpgsql as $$
			begin
				if new.storage_key like '%fail-on-copy%' then raise exception 't616 injected failure'; end if;
				return new;
			end $$;
			create trigger t616_fail_receipt_copy before insert on travel_expense_report_receipt
				for each row execute function t616_fail_receipt_copy();
		`);
		try {
			await expect(convertLegacyDraft(db, owner, { claimId }, options)).rejects.toThrow();
		} finally {
			await admin.query(`
				drop trigger if exists t616_fail_receipt_copy on travel_expense_report_receipt;
				drop function if exists t616_fail_receipt_copy();
			`);
		}
		const leftovers = await admin.query(
			`select (select count(*)::int from travel_expense_report where organization_id = 't616-org') as reports,
				(select count(*)::int from travel_expense_report_item where organization_id = 't616-org') as items,
				(select count(*)::int from travel_expense_legacy_draft_conversion where organization_id = 't616-org') as conversions`,
		);
		expect(leftovers.rows[0]).toEqual({ reports: 0, items: 0, conversions: 0 });

		const retried = await convertLegacyDraft(db, owner, { claimId }, options);
		expect(retried).toMatchObject({ kind: "converted", replayed: false });
		const receipts = await admin.query(
			"select storage_key from travel_expense_report_receipt where organization_id = 't616-org'",
		);
		expect(receipts.rows).toEqual([{ storage_key: key }]);
	});
});

const LIFECYCLE_MODES = ["legacy", "shadow", "ready", "canonical", "complete"] as const;

describe.each(LIFECYCLE_MODES)("legacy claims under lifecycle mode %s (#616)", (mode) => {
	beforeEach(async () => {
		await seed();
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, 't616-manager', now(), now())`,
			[ids.requester, ids.manager],
		);
		await admin.query(
			`insert into approval_evidence_control (organization_id, workflow_type, mode)
			 values ('t616-org', 'travel_expense', 'capture')`,
		);
	});
	afterAll(async () => {
		await cleanup();
	});

	/** Every approval and legacy row the old claims own; conversion must leave all of it as it was. */
	async function legacyApprovalState(claimIds: string[]) {
		const query = async (sql: string) => (await admin.query(sql, [claimIds])).rows;
		return {
			claims: await query(
				"select * from travel_expense_claim where id = any($1::uuid[]) order by id",
			),
			attachments: await query(
				"select * from travel_expense_attachment where claim_id = any($1::uuid[]) order by id",
			),
			decisions: await query(
				"select * from travel_expense_decision_log where claim_id = any($1::uuid[]) order by id",
			),
			requests: await query(
				"select * from approval_request where entity_id = any($1::uuid[]) order by id",
			),
			revisions: await query(
				"select * from approval_submitted_revision where source_id = any($1::uuid[]) order by id",
			),
			evidence: await query(
				`select e.* from approval_decision_evidence e
				 join approval_submitted_revision r on r.id = e.submitted_revision_id
				 where r.source_id = any($1::uuid[]) order by e.id`,
			),
		};
	}

	it("converts drafts without touching pending or decided claims, which finish and settle under their original authority", async () => {
		const pendingClaim = await insertLegacyTravelExpenseDraft(db, { ...owner, amount: "55.00" });
		await attachLegacyReceipt(pendingClaim);
		const approvedClaim = await insertLegacyTravelExpenseDraft(db, { ...owner, amount: "75.00" });
		await attachLegacyReceipt(approvedClaim);
		// Submitted while the organization still ran legacy authority.
		const pending = await submitLegacyTravelExpenseClaim(db, { ...owner, claimId: pendingClaim });
		await submitLegacyTravelExpenseClaim(db, { ...owner, claimId: approvedClaim });
		signIn("manager");
		expect(await approveTravelExpenseClaim({ claimId: approvedClaim })).toMatchObject({
			success: true,
		});
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ('t616-org', 'travel_expense', $1, $2, now(), now())
			 on conflict (organization_id, workflow_type)
			 do update set lifecycle_mode = excluded.lifecycle_mode, side_effect_mode = excluded.side_effect_mode`,
			[mode, mode === "canonical" || mode === "complete" ? "canonical" : "legacy"],
		);
		const draftClaim = await insertLegacyTravelExpenseDraft(db, owner);
		await attachLegacyReceipt(draftClaim);
		const before = await legacyApprovalState([pendingClaim, approvedClaim]);
		expect(before.requests).toHaveLength(2);
		expect(before.revisions).toHaveLength(2);

		const converted = await convertLegacyDraft(db, owner, { claimId: draftClaim }, options);
		expect(converted).toMatchObject({ kind: "converted", replayed: false });
		for (const claimId of [pendingClaim, approvedClaim]) {
			expect(await convertLegacyDraft(db, owner, { claimId }, options)).toEqual({
				kind: "not_draft",
			});
		}
		expect(await legacyApprovalState([pendingClaim, approvedClaim])).toEqual(before);
		const draftApprovals = await admin.query(
			"select count(*)::int as count from approval_request where entity_id = $1",
			[draftClaim],
		);
		expect(draftApprovals.rows[0].count).toBe(0);

		// The pending review finishes through the legacy decision owner.
		signIn("manager");
		expect(await approveTravelExpenseClaim({ claimId: pendingClaim })).toMatchObject({
			success: true,
		});
		const decided = await admin.query(
			"select c.status, r.status as request_status from travel_expense_claim c join approval_request r on r.id = $2 where c.id = $1",
			[pendingClaim, pending.approvalRequestId],
		);
		expect(decided.rows[0]).toEqual({ status: "approved", request_status: "approved" });

		// Finance references the approved claim without rewriting its decision facts.
		const decidedState = await legacyApprovalState([approvedClaim]);
		const account = await loadSettlementAccount(db, {
			organizationId: "t616-org",
			source: { type: "legacy_claim", id: approvedClaim },
		});
		expect(account).toMatchObject({ approved: true, currency: "EUR" });
		const recorded = await recordSettlementEntry(db, {
			actor: { organizationId: "t616-org", employeeId: ids.manager, userId: "t616-manager" },
			scope: { kind: "all" },
			source: { type: "legacy_claim", id: approvedClaim },
			idempotencyKey: `t616-${mode}`,
			command: {
				kind: "reimbursement",
				amount: "75.00",
				currency: "EUR",
				occurredOn: "2026-10-01",
				reference: "SEPA 616",
				note: null,
			},
			expectedBalance: { currency: "EUR", amount: "75.00" },
		});
		expect(recorded).toMatchObject({ status: "recorded", replayed: false });
		expect(await legacyApprovalState([approvedClaim])).toEqual(decidedState);
	});
});
