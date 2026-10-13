/**
 * #1169: the Travel expenses and Personnel file categories of a personal data
 * export against a disposable PostgreSQL database. Both kinds of export carry
 * receipts and documents as original files, referenced from the JSON by their
 * path inside the ZIP; HR-only documents and the internal notes on project
 * attribution exceptions are withheld from the employee export; no storage
 * identity (key, bucket, version, checksum) is ever exported. The session,
 * object storage and the job queue are replaced; data is seeded directly.
 */

import { createHash } from "node:crypto";
import JSZip from "jszip";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1169-org",
	/** Stored objects by key: the seeded originals and the built exports. */
	objects: new Map<string, Uint8Array>(),
	reads: [] as string[],
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("@/lib/email/email-service", async (original) =>
	(await import("@/test/integration-harness")).emailService(original),
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
vi.mock("@/lib/queue", async (original) => ({
	...(await original<typeof import("@/lib/queue")>()),
	addJob: async () => ({ id: "job" }),
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	isExportS3Configured: async () => true,
	async uploadPrivateObjectStream(
		_organizationId: string,
		key: string,
		body: ReadableStream<Uint8Array>,
	) {
		harness.objects.set(key, new Uint8Array(await new Response(body).arrayBuffer()));
		return { bucket: "t1169-exports", versionId: null };
	},
	async readPrivateObject(input: { key: string; bucket: string | null; versionId: string | null }) {
		harness.reads.push(input.key);
		const bytes = harness.objects.get(input.key);
		if (!bytes) throw new Error(`missing object ${input.key}`);
		return bytes;
	},
	async deletePrivateObject(input: { key: string }) {
		harness.objects.delete(input.key);
	},
	async deletePrivateObjectVersions(input: { key: string }) {
		harness.objects.delete(input.key);
	},
}));

const { db } = await import("@/db");
const { requestMyPersonalDataExport } = await import(
	"@/app/[locale]/(app)/settings/my-data/actions"
);
const { requestEmployeePersonalDataExportAction } = await import(
	"@/app/[locale]/(app)/settings/employees/personal-data-export.actions"
);
const { processPersonalDataExport } = await import("./processor");

const ORG = "t1169-org";
const OTHER_ORG = "t1169-other";
const BUCKET = "t1169-bucket";

const ids = {
	ada: "11690000-0000-4000-8000-000000000001",
	owner: "11690000-0000-4000-8000-000000000002",
	bob: "11690000-0000-4000-8000-000000000003",
	adaOther: "11690000-0000-4000-8000-000000000004",
	project: "11690000-0000-4000-8000-0000000000a1",
	claim: "11690000-0000-4000-8000-0000000000b1",
	attachment: "11690000-0000-4000-8000-0000000000b2",
	report: "11690000-0000-4000-8000-0000000000c1",
	item: "11690000-0000-4000-8000-0000000000c2",
	receipt: "11690000-0000-4000-8000-0000000000c3",
	sick: "11690000-0000-4000-8000-0000000000d1",
	absence: "11690000-0000-4000-8000-0000000000d2",
	contract: "11690000-0000-4000-8000-0000000000e1",
	warning: "11690000-0000-4000-8000-0000000000e2",
	sickNote: "11690000-0000-4000-8000-0000000000e3",
	bobContract: "11690000-0000-4000-8000-0000000000e4",
	otherOrgDocument: "11690000-0000-4000-8000-0000000000e5",
} as const;

/** One original file: its stored key and bytes, and their recorded checksum. */
function original(key: string, text: string) {
	const bytes = new TextEncoder().encode(text);
	return {
		key,
		bytes,
		size: bytes.byteLength,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
}

const files = {
	claimReceipt: original("t1169-key-claim-receipt", "%PDF taxi receipt"),
	reportReceipt: original("t1169-key-report-receipt", "%PDF train ticket"),
	contract: original("t1169-key-doc-contract", "%PDF employment contract"),
	warning: original("t1169-key-doc-warning", "%PDF warning letter"),
	sickNote: original("t1169-key-doc-sick-note", "%PDF sick note"),
	bobContract: original("t1169-key-doc-bob", "%PDF bob contract"),
	otherOrgDocument: original("t1169-key-doc-other-org", "%PDF other organization"),
};

/** Values that are storage identity or technical secrets: never in any export. */
const NEVER_EXPORTED = [
	"t1169-key",
	BUCKET,
	"v-t1169",
	"t1169-idem-secret",
	"t1169-fp-secret",
	"deadbeef-t1169",
	...Object.values(files).map((file) => file.sha256),
];

const admin = integrationAdminPool();

async function cleanup() {
	for (const org of [ORG, OTHER_ORG]) {
		await admin.query("delete from audit_log where organization_id = $1", [org]);
		await admin.query("delete from organization where id = $1", [org]);
		for (const ledger of [
			"personal_data_export_file_cleanup",
			"personnel_file_upload",
			"travel_expense_receipt_upload",
		]) {
			await admin.query(`delete from ${ledger} where organization_id = $1`, [org]);
		}
	}
	await admin.query('delete from "user" where id like $1', ["t1169-%"]);
}

async function seedPerson(
	organizationId: string,
	name: string,
	employeeId: string,
	role: "member" | "owner" = "member",
) {
	await admin.query(
		`insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())
		 on conflict (id) do nothing`,
		[
			`t1169-${name}`,
			`${name[0]?.toUpperCase()}${name.slice(1)} Person`,
			`t1169-${name}@example.test`,
		],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
		[`t1169-member-${name}-${organizationId}`, organizationId, `t1169-${name}`, role],
	);
	await admin.query(
		`insert into employee (id,user_id,organization_id,role,is_active,updated_at)
		 values ($1,$2,$3,$4,true,now())`,
		[employeeId, `t1169-${name}`, organizationId, role === "owner" ? "admin" : "employee"],
	);
}

async function seedDocument(input: {
	id: string;
	organizationId?: string;
	employeeId: string;
	category: string;
	title: string;
	visibility: "shared" | "hr_only";
	file: ReturnType<typeof original>;
	absenceEntryId?: string;
}) {
	await admin.query(
		`insert into employee_document (id, organization_id, employee_id, category, title, document_date, visibility,
		   absence_entry_id, storage_provider, storage_bucket, storage_key, storage_version_id, file_name, mime_type,
		   size_bytes, checksum_sha256, uploaded_by)
		 values ($1, $2, $3, $4, $5, '2026-03-01', $6, $7, 's3-private', $8, $9, $10, $11, 'application/pdf', $12, $13,
		   't1169-owner')`,
		[
			input.id,
			input.organizationId ?? ORG,
			input.employeeId,
			input.category,
			input.title,
			input.visibility,
			input.absenceEntryId ?? null,
			BUCKET,
			input.file.key,
			`v-t1169-${input.id}`,
			`${input.title}.pdf`,
			input.file.size,
			input.file.sha256,
		],
	);
}

function signIn(name: string) {
	harness.userId = `t1169-${name}`;
	harness.organizationId = ORG;
}

async function build(exportId: string) {
	return processPersonalDataExport(db, { organizationId: ORG, exportId });
}

async function employeeExport(): Promise<string> {
	signIn("ada");
	const requested = await requestMyPersonalDataExport();
	if (!requested.success) throw new Error(`request refused: ${requested.error}`);
	expect(await build(requested.data.exportId)).toEqual({ status: "completed" });
	return requested.data.exportId;
}

async function adminExport(): Promise<string> {
	signIn("owner");
	const requested = await requestEmployeePersonalDataExportAction(ids.ada);
	if (!requested.success) throw new Error(`request refused: ${requested.error}`);
	expect(await build(requested.data.exportId)).toEqual({ status: "completed" });
	return requested.data.exportId;
}

/** Every entry of a stored export: text for reading, bytes for originals. */
async function archive(exportId: string) {
	const { rows } = await admin.query<{ storage_key: string }>(
		"select storage_key from personal_data_export where id = $1",
		[exportId],
	);
	const bytes = harness.objects.get(rows[0]?.storage_key ?? "");
	expect(bytes, "stored ZIP").toBeDefined();
	const zip = await JSZip.loadAsync(bytes as Uint8Array);
	const text: Record<string, string> = {};
	const binary: Record<string, Uint8Array> = {};
	for (const entry of Object.values(zip.files)) {
		if (entry.dir) continue;
		binary[entry.name] = await entry.async("uint8array");
		text[entry.name] = await entry.async("string");
	}
	return {
		text,
		binary,
		json: (name: string) => JSON.parse(text[name] as string),
		everything: Object.values(text).join("\n"),
	};
}

type Archive = Awaited<ReturnType<typeof archive>>;

function expectNoStorageIdentity(zip: Archive) {
	for (const secret of NEVER_EXPORTED) {
		expect(zip.everything, secret).not.toContain(secret);
	}
	for (const [path, content] of Object.entries(zip.text)) {
		if (!path.endsWith(".json") && !path.endsWith(".csv")) continue;
		expect(content, path).not.toMatch(/storage_?key|storage_?bucket|version_?id|checksum/i);
	}
}

describe("travel expenses and personnel file in personal data exports (#1169)", () => {
	beforeAll(async () => {
		await cleanup();
		for (const org of [ORG, OTHER_ORG]) {
			await admin.query(
				`insert into organization (id, name, slug, timezone, created_at) values ($1, $1, $1, 'Europe/Berlin', now())`,
				[org],
			);
		}
		await seedPerson(ORG, "ada", ids.ada);
		await seedPerson(ORG, "owner", ids.owner, "owner");
		await seedPerson(ORG, "bob", ids.bob);
		await seedPerson(OTHER_ORG, "ada", ids.adaOther);
		for (const file of Object.values(files)) harness.objects.set(file.key, file.bytes);

		await admin.query(
			`insert into project (id, organization_id, name, created_by, updated_at) values ($1, $2, 'Moonshot', 't1169-owner', now())`,
			[ids.project, ORG],
		);

		// A legacy claim with its receipt and decision.
		await admin.query(
			`insert into travel_expense_claim (id, organization_id, employee_id, approver_id, type, status, trip_start,
			   trip_end, trip_start_date, trip_end_date, trip_date_time_zone, destination_city, original_currency,
			   original_amount, calculated_currency, calculated_amount, notes, submitted_at, decided_at, created_by,
			   updated_at)
			 values ($1, $2, $3, $4, 'receipt', 'approved', '2026-02-09T23:00:00Z', '2026-02-10T22:59:59Z', '2026-02-10',
			   '2026-02-10', 'Europe/Berlin', 'Hamburg', 'EUR', '42.00', 'EUR', '42.00', 'Taxi to the client',
			   '2026-02-11T09:00:00Z', '2026-02-12T09:00:00Z', 't1169-ada', now())`,
			[ids.claim, ORG, ids.ada, ids.owner],
		);
		await admin.query(
			`insert into travel_expense_attachment (id, claim_id, organization_id, storage_provider, storage_bucket,
			   storage_key, file_name, mime_type, size_bytes, checksum_sha256, storage_version_id, uploaded_by)
			 values ($1, $2, $3, 's3-private', $4, $5, 'taxi.pdf', 'application/pdf', $6, $7, 'v-t1169-claim', $8)`,
			[
				ids.attachment,
				ids.claim,
				ORG,
				BUCKET,
				files.claimReceipt.key,
				files.claimReceipt.size,
				files.claimReceipt.sha256,
				ids.ada,
			],
		);
		await admin.query(
			`insert into travel_expense_decision_log (claim_id, organization_id, actor_employee_id, approver_id, action, comment)
			 values ($1, $2, $3, $3, 'approved', 'Looks right')`,
			[ids.claim, ORG, ids.owner],
		);

		// An approved trip report with one receipt item, reimbursed.
		await admin.query(
			`insert into travel_expense_report (id, organization_id, employee_id, kind, status, reimbursement_currency,
			   trip_purpose, trip_start_date, trip_end_date, trip_time_zone, project_id, submission_count, submitted_at,
			   decided_at, created_by)
			 values ($1, $2, $3, 'trip', 'approved', 'EUR', 'Customer workshop', '2026-03-02', '2026-03-03',
			   'Europe/Berlin', $4, 1, '2026-03-05T10:00:00Z', '2026-03-06T10:00:00Z', 't1169-ada')`,
			[ids.report, ORG, ids.ada, ids.project],
		);
		await admin.query(
			`insert into travel_expense_report_item (id, organization_id, report_id, type, position, expense_date,
			   category, description, original_amount, original_currency, paid_by)
			 values ($1, $2, $3, 'receipt', 1, '2026-03-02', 'transport', 'Train to Munich', '89.90', 'EUR', 'employee')`,
			[ids.item, ORG, ids.report],
		);
		await admin.query(
			`insert into travel_expense_report_receipt (id, organization_id, report_id, item_id, storage_provider,
			   storage_bucket, storage_key, storage_version_id, file_name, mime_type, size_bytes, checksum_sha256,
			   uploaded_by)
			 values ($1, $2, $3, $4, 's3-private', $5, $6, 'v-t1169-receipt', 'train.pdf', 'application/pdf', $7, $8, $9)`,
			[
				ids.receipt,
				ORG,
				ids.report,
				ids.item,
				BUCKET,
				files.reportReceipt.key,
				files.reportReceipt.size,
				files.reportReceipt.sha256,
				ids.ada,
			],
		);
		await admin.query(
			`insert into travel_expense_settlement_entry (organization_id, source_type, report_id, kind, amount, currency,
			   occurred_on, reference, note, basis_submission_cycle, balance_before, idempotency_key, command_fingerprint,
			   recorded_by_employee_id, recorded_by_user_id)
			 values ($1, 'report', $2, 'reimbursement', '89.90', 'EUR', '2026-03-20', 'SEPA-0320',
			   'Paid with the March transfer', 1, '89.90', 't1169-idem-secret', 't1169-fp-secret', $3, 't1169-owner')`,
			[ORG, ids.report, ids.owner],
		);
		await admin.query(
			`insert into travel_expense_project_attribution_exception (organization_id, employee_id, project_id,
			   valid_from, valid_to, reason, evidence, authorized_by_employee_id, authorized_by_user_id)
			 values ($1, $2, $3, '2026-01-01', '2026-01-31', 'Staffed before history began t1169-reason',
			   'Signed staffing order t1169-evidence', $4, 't1169-owner')`,
			[ORG, ids.ada, ids.project, ids.owner],
		);
		await admin.query(
			`insert into travel_expense_legacy_draft_conversion (organization_id, employee_id, claim_id, report_id,
			   item_id, legacy_facts, flags, converted_by_user_id, converted_at)
			 values ($1, $2, gen_random_uuid(), $3, $4, $5, '["expense_date_unknown"]', 't1169-ada', now())`,
			[
				ORG,
				ids.ada,
				ids.report,
				ids.item,
				JSON.stringify({
					type: "receipt",
					notes: "Converted draft",
					attachments: [
						{
							attachmentId: ids.attachment,
							receiptId: ids.receipt,
							fileName: "taxi.pdf",
							storageKey: "t1169-key-legacy-facts",
							checksumSha256: "deadbeef-t1169",
						},
					],
				}),
			],
		);

		// Personnel file: shared contract, HR-only warning, a sick note on an absence.
		await admin.query(
			`insert into absence_category (id, organization_id, type, name, requires_approval, counts_against_vacation,
			   is_active, updated_at)
			 values ($1, $2, 'sick', 'Sick leave', false, false, true, now())`,
			[ids.sick, ORG],
		);
		await admin.query(
			`insert into absence_entry (id, employee_id, category_id, start_date, end_date, status, sick_detail,
			   organization_id, updated_at)
			 values ($1, $2, $3, '2026-03-09', '2026-03-11', 'approved', 'with_certificate', $4, now())`,
			[ids.absence, ids.ada, ids.sick, ORG],
		);
		await seedDocument({
			id: ids.contract,
			employeeId: ids.ada,
			category: "contract",
			title: "Employment contract",
			visibility: "shared",
			file: files.contract,
		});
		await seedDocument({
			id: ids.warning,
			employeeId: ids.ada,
			category: "other",
			title: "Warning letter",
			visibility: "hr_only",
			file: files.warning,
		});
		await seedDocument({
			id: ids.sickNote,
			employeeId: ids.ada,
			category: "sick_note",
			title: "Sick note March",
			visibility: "shared",
			file: files.sickNote,
			absenceEntryId: ids.absence,
		});
		await seedDocument({
			id: ids.bobContract,
			employeeId: ids.bob,
			category: "contract",
			title: "Bob contract",
			visibility: "shared",
			file: files.bobContract,
		});
		await seedDocument({
			id: ids.otherOrgDocument,
			organizationId: OTHER_ORG,
			employeeId: ids.adaOther,
			category: "contract",
			title: "Other organization contract",
			visibility: "shared",
			file: files.otherOrgDocument,
		});
	});

	beforeEach(async () => {
		await admin.query("delete from personal_data_export where organization_id = $1", [ORG]);
		harness.reads.length = 0;
	});

	afterAll(async () => {
		await cleanup();
	});

	it("puts every receipt into the employee export as its original file, referenced by its ZIP path", async () => {
		const zip = await archive(await employeeExport());
		const travel = zip.json("travel_expenses.json");

		expect(travel.claims).toEqual([
			expect.objectContaining({
				id: ids.claim,
				status: "approved",
				trip_start_date: "2026-02-10",
				trip_date_time_zone: "Europe/Berlin",
				original_amount: "42.00",
				notes: "Taxi to the client",
				approver: "Owner Person",
				decided_at: "2026-02-12T09:00:00Z",
			}),
		]);
		expect(travel.claim_decisions).toEqual([
			expect.objectContaining({
				claim_id: ids.claim,
				action: "approved",
				comment: "Looks right",
				actor: "Owner Person",
			}),
		]);
		expect(travel.reports).toEqual([
			expect.objectContaining({
				id: ids.report,
				status: "approved",
				trip_purpose: "Customer workshop",
				project: "Moonshot",
			}),
		]);
		expect(travel.report_items).toEqual([
			expect.objectContaining({
				id: ids.item,
				report_id: ids.report,
				expense_date: "2026-03-02",
				description: "Train to Munich",
				original_amount: "89.90",
			}),
		]);

		const [claimReceipt] = travel.claim_receipts;
		const [reportReceipt] = travel.report_receipts;
		expect(claimReceipt).toMatchObject({ claim_id: ids.claim, file_name: "taxi.pdf" });
		expect(reportReceipt).toMatchObject({
			report_id: ids.report,
			item_id: ids.item,
			file_name: "train.pdf",
		});
		expect(zip.binary[claimReceipt.file]).toEqual(files.claimReceipt.bytes);
		expect(zip.binary[reportReceipt.file]).toEqual(files.reportReceipt.bytes);
		expect(zip.text["travel_expenses/report_receipts.csv"]).toContain(reportReceipt.file);

		// The settlement note stays in the employee export (decisions-811).
		expect(travel.settlement_entries).toEqual([
			expect.objectContaining({
				report_id: ids.report,
				kind: "reimbursement",
				amount: "89.90",
				occurred_on: "2026-03-20",
				reference: "SEPA-0320",
				note: "Paid with the March transfer",
				recorded_by: "Owner Person",
			}),
		]);
		expect(travel.legacy_draft_conversions).toEqual([
			expect.objectContaining({ report_id: ids.report, flags: '["expense_date_unknown"]' }),
		]);
		expect(JSON.parse(travel.legacy_draft_conversions[0].legacy_facts)).toEqual({
			type: "receipt",
			notes: "Converted draft",
			attachments: [{ attachmentId: ids.attachment, receiptId: ids.receipt, fileName: "taxi.pdf" }],
		});
		expectNoStorageIdentity(zip);
	});

	it("puts only shared documents, sick notes included, into the employee export", async () => {
		const zip = await archive(await employeeExport());
		const documents = zip.json("personnel_file.json").documents;
		expect(documents.map((row: { title: string }) => row.title).sort()).toEqual([
			"Employment contract",
			"Sick note March",
		]);
		const sickNote = documents.find((row: { title: string }) => row.title === "Sick note March");
		expect(sickNote).toMatchObject({
			category: "sick_note",
			absence_id: ids.absence,
			absence_start_date: "2026-03-09",
			absence_end_date: "2026-03-11",
		});
		for (const document of documents) {
			expect(document.file).toMatch(/^personnel_file\//);
			expect(zip.binary[document.file]?.byteLength, document.file).toBeGreaterThan(0);
		}
		expect(zip.binary[sickNote.file]).toEqual(files.sickNote.bytes);

		// Withheld data: HR-only documents and the attribution exception's notes.
		for (const leaked of [
			"Warning letter",
			"warning letter",
			"t1169-reason",
			"t1169-evidence",
			"Bob contract",
			"bob contract",
			"Other organization",
			"other organization",
		]) {
			expect(zip.everything, leaked).not.toContain(leaked);
		}
		expect(harness.reads).not.toContain(files.warning.key);
		const exceptions = zip.json("travel_expenses.json").project_attribution_exceptions;
		expect(exceptions).toEqual([
			expect.objectContaining({
				project: "Moonshot",
				valid_from: "2026-01-01",
				valid_to: "2026-01-31",
			}),
		]);
		expect(exceptions[0]).not.toHaveProperty("reason");
		expect(exceptions[0]).not.toHaveProperty("evidence");
		expectNoStorageIdentity(zip);
	});

	it("adds HR-only documents and the internal notes to the admin export", async () => {
		const zip = await archive(await adminExport());
		const documents = zip.json("personnel_file.json").documents;
		expect(documents.map((row: { title: string }) => row.title).sort()).toEqual([
			"Employment contract",
			"Sick note March",
			"Warning letter",
		]);
		const warning = documents.find((row: { title: string }) => row.title === "Warning letter");
		expect(warning).toMatchObject({ visibility: "hr_only" });
		expect(zip.binary[warning.file]).toEqual(files.warning.bytes);

		const travel = zip.json("travel_expenses.json");
		expect(travel.project_attribution_exceptions).toEqual([
			expect.objectContaining({
				reason: "Staffed before history began t1169-reason",
				evidence: "Signed staffing order t1169-evidence",
				authorized_by: "Owner Person",
			}),
		]);
		expect(zip.binary[travel.report_receipts[0].file]).toEqual(files.reportReceipt.bytes);
		expect(zip.everything).not.toContain("Bob contract");
		expect(zip.everything).not.toContain("Other organization");
		expectNoStorageIdentity(zip);
	});

	it("fails the export when a stored file no longer matches its recorded content", async () => {
		harness.objects.set(files.contract.key, new TextEncoder().encode("tampered"));
		try {
			signIn("ada");
			const requested = await requestMyPersonalDataExport();
			if (!requested.success) throw new Error(requested.error);
			expect(await build(requested.data.exportId)).toEqual({
				status: "failed",
				errorCode: "file_unavailable",
			});
		} finally {
			harness.objects.set(files.contract.key, files.contract.bytes);
		}
	});
});
