/**
 * #923: a confirmed purge removes the purged document's descriptions (title,
 * file name, ZIP entry name, title-change values, free-text reason) from the
 * audit records about it, against a disposable PostgreSQL database. Audit rows,
 * ids and timestamps stay; other documents and organizations are untouched.
 * The session and object storage are replaced; documents are seeded directly.
 */

import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	objects: new Map<string, Buffer>(),
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("@/lib/storage/export-s3-client", () => ({
	async readPrivateObject(input: { key: string }) {
		const bytes = harness.objects.get(input.key);
		if (!bytes) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
		return new Uint8Array(bytes);
	},
	async deletePrivateObjectVersions(input: { key: string }) {
		harness.objects.delete(input.key);
	},
}));

const { db } = await import("@/db");
const { eq } = await import("drizzle-orm");
const { employeeDocument } = await import("@/db/schema");
const { AuditAction } = await import("@/lib/audit-logger");
const { resolvePersonnelFileAccess } = await import("./access-store");
const { writeDocumentAudit, writeDocumentReadAudit } = await import("./audit");
const { updateDocumentMetadata } = await import("./document-store");
const { purgeDueDocuments, saveRetentionPeriods } = await import("./retention-store");
const { backfillPurgedDocumentAudits } = await import("./audit-minimisation-backfill");
const { planPersonnelFileZip, writePersonnelFileZipAbortAudit, writePersonnelFileZipAudit } =
	await import("./zip-download");

const ORG = "t923-org";
const OTHER_ORG = "t923-other";
const BERLIN = "Europe/Berlin";
const NOW = Temporal.Instant.from("2030-06-01T10:00:00Z");

const ids = {
	owner: "e9230000-0000-4000-8000-000000000001",
	dora: "e9230000-0000-4000-8000-000000000002",
	otherOwner: "e9230000-0000-4000-8000-000000000003",
} as const;
type Person = keyof typeof ids;
const userOf = (person: Person) => `t923-${person}`;

const TITLE = "Payslip Dora secret-title-923";
const NEW_TITLE = "Payslip Dora renamed-title-923";
const FILE_NAME = "dora-secret-file-923.pdf";
const KEPT_TITLE = "Contract Dora kept-title-923";

const admin = integrationAdminPool();

async function cleanup() {
	for (const org of [ORG, OTHER_ORG]) {
		await admin.query("delete from organization where id = $1", [org]);
		await admin.query("delete from personnel_file_upload where organization_id = $1", [org]);
	}
	await admin.query('delete from "user" where id like $1', ["t923-%"]);
}

async function seedOrganization(id: string) {
	await admin.query(
		`insert into organization (id, name, slug, timezone, personnel_files_enabled, created_at)
		 values ($1, $1, $1, $2, true, now())`,
		[id, BERLIN],
	);
}

async function seedPerson(organizationId: string, name: Person, memberRole: string) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
		[userOf(name), name, `${userOf(name)}@example.test`],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
		[`t923-member-${name}`, organizationId, userOf(name), memberRole],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,is_active,updated_at) values ($1,$2,$3,'employee',true,now())",
		[ids[name], userOf(name), organizationId],
	);
}

/** Dora left on 2019-03-31: her payslips (6 years) are due from 2026-01-01. */
async function departed(name: Person) {
	await admin.query(
		`insert into employee_employment_period
		 (organization_id, employee_id, status, started_at, ended_at, start_provenance)
		 values ($1, $2, 'closed', '2010-01-01T00:00:00Z', '2019-03-31T22:00:00Z', 'recorded')`,
		[ORG, ids[name]],
	);
	await admin.query("update employee set is_active = false where id = $1", [ids[name]]);
}

async function seedDocument(input: {
	category: string;
	title: string;
	documentDate: string;
	fileName: string;
}): Promise<string> {
	const id = randomUUID();
	const key = `personnel-files/${ORG}/${ids.dora}/${id}-${input.fileName}`;
	const payslip = input.category === "payslip";
	await admin.query(
		`insert into employee_document
		 (id, organization_id, employee_id, category, title, document_date, pay_period_year, pay_period_month,
		  visibility, storage_provider, storage_bucket, storage_key, file_name, mime_type, size_bytes,
		  checksum_sha256, uploaded_by)
		 values ($1,$2,$3,$4,$5,$6,$7,$8,'hr_only','s3-private','t923-private',$9,$10,
		  'application/pdf',10,'x',$11)`,
		[
			id,
			ORG,
			ids.dora,
			input.category,
			input.title,
			input.documentDate,
			payslip ? Number(input.documentDate.slice(0, 4)) : null,
			payslip ? Number(input.documentDate.slice(5, 7)) : null,
			key,
			input.fileName,
			userOf("owner"),
		],
	);
	harness.objects.set(key, Buffer.from("%PDF-1.4"));
	return id;
}

async function loadDocument(id: string) {
	const [row] = await db.select().from(employeeDocument).where(eq(employeeDocument.id, id));
	if (!row) throw new Error(`document ${id} is gone`);
	return row;
}

async function ownerAccess() {
	const access = await resolvePersonnelFileAccess(db, {
		userId: userOf("owner"),
		organizationId: ORG,
		now: NOW,
	});
	if (!access) throw new Error("the owner has no personnel file access");
	return access;
}

interface AuditRow {
	id: string;
	organization_id: string;
	entity_id: string;
	action: string;
	performed_by: string;
	employee_id: string | null;
	changes: string | null;
	metadata: string | null;
	timestamp: string;
}

async function auditRows(where: string, values: unknown[]): Promise<AuditRow[]> {
	const { rows } = await admin.query<AuditRow>(
		`select id, organization_id, entity_id, action, performed_by, employee_id, changes, metadata,
		        timestamp::text as timestamp
		 from audit_log where ${where} order by timestamp, id`,
		values,
	);
	return rows;
}

const docs = {} as Record<
	"purged" | "kept" | "broken" | "second" | "zipped" | "late" | "raced",
	string
>;

beforeAll(async () => {
	await cleanup();
	await seedOrganization(ORG);
	await seedOrganization(OTHER_ORG);
	await seedPerson(ORG, "owner", "owner");
	await seedPerson(ORG, "dora", "member");
	await seedPerson(OTHER_ORG, "otherOwner", "owner");
	await departed("dora");
	docs.purged = await seedDocument({
		category: "payslip",
		title: TITLE,
		documentDate: "2018-12-31",
		fileName: FILE_NAME,
	});
	// Contracts have no retention period: never due.
	docs.kept = await seedDocument({
		category: "contract",
		title: KEPT_TITLE,
		documentDate: "2015-01-01",
		fileName: "dora-contract-923.pdf",
	});
	docs.broken = await seedDocument({
		category: "payslip",
		title: "Payslip Dora broken-923",
		documentDate: "2018-11-30",
		fileName: "dora-broken-923.pdf",
	});
	docs.second = await seedDocument({
		category: "payslip",
		title: "Payslip Dora second-title-923",
		documentDate: "2018-10-31",
		fileName: "dora-second-923.pdf",
	});
	docs.zipped = await seedDocument({
		category: "payslip",
		title: "Payslip Dora zipped-title-923",
		documentDate: "2018-09-30",
		fileName: "dora-zipped-923.pdf",
	});
	docs.late = await seedDocument({
		category: "payslip",
		title: "Payslip Dora late-title-923",
		documentDate: "2018-08-31",
		fileName: "dora-late-923.pdf",
	});
	docs.raced = await seedDocument({
		category: "payslip",
		title: "Payslip Dora raced-title-923",
		documentDate: "2018-07-31",
		fileName: "dora-raced-923.pdf",
	});
	const saved = await saveRetentionPeriods(db, {
		organizationId: ORG,
		actorUserId: userOf("owner"),
		periods: { payslip: 6 },
	});
	if (saved.kind !== "saved") throw new Error("retention periods not saved");
}, 60_000);

afterAll(async () => {
	await cleanup();
});

describe("a confirmed purge", () => {
	it("removes the purged document's descriptions from its earlier audit records and keeps the evidence", async () => {
		const access = await ownerAccess();
		await writeDocumentAudit(db, {
			action: AuditAction.PERSONNEL_FILE_DOCUMENT_UPLOADED,
			actorUserId: userOf("owner"),
			document: await loadDocument(docs.purged),
			metadata: { fileName: FILE_NAME, mimeType: "application/pdf", sizeBytes: 10 },
		});
		const edited = await updateDocumentMetadata(
			db,
			access,
			{
				documentId: docs.purged,
				metadata: {
					category: "payslip",
					title: NEW_TITLE,
					documentDate: "2018-12-31",
					payPeriod: { year: 2018, month: 12 },
					visibility: "shared",
					expiryDate: null,
				},
			},
			NOW,
		);
		expect(edited.kind).toBe("updated");
		await writeDocumentAudit(db, {
			action: AuditAction.PERSONNEL_FILE_DOCUMENT_DOWNLOADED,
			actorUserId: userOf("owner"),
			document: await loadDocument(docs.purged),
			metadata: { variant: "original" },
			ipAddress: "203.0.113.9",
			userAgent: "t923-browser",
		});
		await writeDocumentAudit(db, {
			action: AuditAction.PERSONNEL_FILE_SICK_NOTE_UNLINKED,
			actorUserId: userOf("owner"),
			document: await loadDocument(docs.purged),
			changes: { absenceEntryId: { from: "absence-1", to: null } },
			metadata: { absenceId: "absence-1", reason: "linked by mistake" },
		});
		// The kept document's records and another organization's record naming the same id stay.
		await writeDocumentAudit(db, {
			action: AuditAction.PERSONNEL_FILE_DOCUMENT_VIEWED,
			actorUserId: userOf("owner"),
			document: await loadDocument(docs.kept),
			metadata: { variant: "original" },
		});
		await admin.query(
			`insert into audit_log (id, organization_id, entity_type, entity_id, action, performed_by, metadata)
			 values ($1, $2, 'employee_document', $3, 'personnel_file.document_viewed', $4, $5)`,
			[
				randomUUID(),
				OTHER_ORG,
				docs.purged,
				userOf("otherOwner"),
				JSON.stringify({ document: { title: TITLE } }),
			],
		);
		const before = await auditRows("organization_id = $1 and entity_id = $2", [ORG, docs.purged]);
		expect(before).toHaveLength(5);
		const keptBefore = await auditRows("entity_id = $1", [docs.kept]);
		const otherBefore = await auditRows("organization_id = $1", [OTHER_ORG]);

		const result = await purgeDueDocuments(db, access, { documentIds: [docs.purged] }, NOW);
		expect(result).toEqual({ purged: [docs.purged], skipped: [] });

		const after = await auditRows("organization_id = $1 and entity_id = $2", [ORG, docs.purged]);
		expect(after).toHaveLength(6);
		const text = JSON.stringify(after);
		for (const description of [TITLE, NEW_TITLE, FILE_NAME, "linked by mistake"]) {
			expect(text).not.toContain(description);
		}
		// Rows, ids, actors, timestamps and request context are kept.
		for (const row of before) {
			const kept = after.find((candidate) => candidate.id === row.id);
			expect(kept).toMatchObject({
				action: row.action,
				performed_by: row.performed_by,
				employee_id: ids.dora,
				timestamp: row.timestamp,
			});
		}
		const byAction = (action: string) => {
			const row = after.find((candidate) => candidate.action === action);
			if (!row) throw new Error(`no ${action} record`);
			return {
				changes: row.changes ? JSON.parse(row.changes) : null,
				metadata: JSON.parse(row.metadata as string),
			};
		};
		expect(byAction("personnel_file.document_uploaded").metadata).toEqual({
			document: {
				category: "payslip",
				documentDate: "2018-12-31",
				payPeriod: { year: 2018, month: 12 },
				visibility: "hr_only",
				expiryDate: null,
			},
			mimeType: "application/pdf",
			sizeBytes: 10,
			descriptionsRemoved: true,
		});
		expect(byAction("personnel_file.document_updated").changes).toEqual({
			title: { removed: true },
		});
		expect(byAction("personnel_file.visibility_changed").changes).toEqual({
			visibility: { from: "hr_only", to: "shared" },
		});
		expect(byAction("personnel_file.sick_note_unlinked")).toEqual({
			changes: { absenceEntryId: { from: "absence-1", to: null } },
			metadata: expect.objectContaining({ absenceId: "absence-1", descriptionsRemoved: true }),
		});
		const downloaded = after.find(
			(row) => row.action === "personnel_file.document_downloaded",
		) as AuditRow;
		const { rows: context } = await admin.query(
			"select ip_address, user_agent from audit_log where id = $1",
			[downloaded.id],
		);
		expect(context[0]).toEqual({ ip_address: "203.0.113.9", user_agent: "t923-browser" });

		// The purge record keeps no title, file or reason, only the structured evidence.
		expect(byAction("personnel_file.document_purged").metadata).toEqual({
			document: {
				category: "payslip",
				documentDate: "2018-12-31",
				payPeriod: { year: 2018, month: 12 },
			},
			retentionStart: "2020-01-01",
			dueOn: "2026-01-01",
			retentionYears: 6,
		});

		expect(await auditRows("entity_id = $1", [docs.kept])).toEqual(keptBefore);
		expect(await auditRows("organization_id = $1", [OTHER_ORG])).toEqual(otherBefore);
	});
});

describe("a purge whose audit records cannot be minimised", () => {
	it("fails as a whole: no document is purged and no record changes", async () => {
		const access = await ownerAccess();
		await writeDocumentAudit(db, {
			action: AuditAction.PERSONNEL_FILE_DOCUMENT_VIEWED,
			actorUserId: userOf("owner"),
			document: await loadDocument(docs.second),
			metadata: { variant: "original" },
		});
		await admin.query(
			`insert into audit_log (id, organization_id, entity_type, entity_id, action, performed_by, metadata)
			 values ($1, $2, 'employee_document', $3, 'personnel_file.document_viewed', $4, $5)`,
			[randomUUID(), ORG, docs.broken, userOf("owner"), "{not json"],
		);
		const before = await auditRows("organization_id = $1 and entity_id = any($2)", [
			ORG,
			[docs.second, docs.broken],
		]);

		await expect(
			purgeDueDocuments(db, access, { documentIds: [docs.second, docs.broken] }, NOW),
		).rejects.toMatchObject({ name: "PurgeAuditMinimisationError" });

		const { rows: remaining } = await admin.query(
			"select id from employee_document where id = any($1)",
			[[docs.second, docs.broken]],
		);
		expect(remaining).toHaveLength(2);
		const { rows: ledger } = await admin.query(
			"select id from personnel_file_upload where id = any($1)",
			[[docs.second, docs.broken]],
		);
		expect(ledger).toHaveLength(0);
		expect(
			await auditRows("organization_id = $1 and entity_id = any($2)", [
				ORG,
				[docs.second, docs.broken],
			]),
		).toEqual(before);
	});
});

describe("personnel file ZIP records", () => {
	it("lose only the purged document's descriptions, in downloads and aborts", async () => {
		const access = await ownerAccess();
		const plan = await planPersonnelFileZip(db, access, {
			employeeId: ids.dora,
			sharedOnly: false,
		});
		if (!plan) throw new Error("no ZIP plan");
		const zipped = plan.entries.find((entry) => entry.document.id === docs.zipped);
		const kept = plan.entries.find((entry) => entry.document.id === docs.kept);
		if (!zipped || !kept) throw new Error("the ZIP plan misses a document");
		const downloadAuditId = await writePersonnelFileZipAudit(db, {
			actorUserId: userOf("owner"),
			plan,
		});
		await writePersonnelFileZipAbortAudit(db, {
			actorUserId: userOf("owner"),
			plan,
			downloadAuditId,
			abort: {
				failedDocument: { id: docs.zipped, entryName: zipped.entryName },
				deliveredDocumentIds: [docs.kept],
			},
		});
		await writePersonnelFileZipAbortAudit(db, {
			actorUserId: userOf("owner"),
			plan,
			downloadAuditId,
			abort: {
				failedDocument: { id: docs.kept, entryName: kept.entryName },
				deliveredDocumentIds: [docs.zipped],
			},
		});
		const zipWhere = "organization_id = $1 and entity_type = 'employee_personnel_file'";
		const before = await auditRows(zipWhere, [ORG]);
		expect(before).toHaveLength(3);
		expect(JSON.stringify(before)).toContain("zipped-title-923");

		const result = await purgeDueDocuments(db, access, { documentIds: [docs.zipped] }, NOW);
		expect(result.purged).toEqual([docs.zipped]);

		const after = await auditRows(zipWhere, [ORG]);
		expect(after.map((row) => [row.id, row.timestamp])).toEqual(
			before.map((row) => [row.id, row.timestamp]),
		);
		expect(JSON.stringify(after)).not.toContain("zipped-title-923");
		expect(JSON.stringify(after)).not.toContain("dora-zipped-923.pdf");

		const metadataOf = (rows: AuditRow[], action: string, failedId?: string) => {
			const row = rows.find((candidate) => {
				if (candidate.action !== action) return false;
				const metadata = JSON.parse(candidate.metadata as string);
				return failedId === undefined || metadata.failedDocument?.id === failedId;
			});
			if (!row) throw new Error(`no ${action} record`);
			return JSON.parse(row.metadata as string);
		};
		const download = "personnel_file.zip_downloaded";
		const aborted = "personnel_file.zip_download_aborted";
		const entriesBefore = metadataOf(before, download).documents as Array<{ id: string }>;
		const entriesAfter = metadataOf(after, download).documents as Array<{ id: string }>;
		expect(entriesAfter.map((entry) => entry.id)).toEqual(entriesBefore.map((entry) => entry.id));
		for (const entry of entriesAfter) {
			if (entry.id === docs.zipped) {
				expect(entry).toEqual({
					id: docs.zipped,
					category: "payslip",
					documentDate: "2018-09-30",
					visibility: "hr_only",
					sizeBytes: 10,
					descriptionsRemoved: true,
				});
			} else {
				expect(entry).toEqual(entriesBefore.find((candidate) => candidate.id === entry.id));
			}
		}
		expect(entriesAfter.find((entry) => entry.id === docs.kept)).toMatchObject({
			title: KEPT_TITLE,
			entryName: kept.entryName,
		});
		expect(metadataOf(after, aborted, docs.zipped)).toEqual({
			downloadAuditId,
			failedDocument: { id: docs.zipped, descriptionsRemoved: true },
			deliveredDocumentIds: [docs.kept],
		});
		expect(metadataOf(after, aborted, docs.kept)).toEqual(metadataOf(before, aborted, docs.kept));
	});
});
describe("audit records written after a purge from a stale snapshot", () => {
	it("keep none of the purged document's descriptions", async () => {
		const access = await ownerAccess();
		const stale = await loadDocument(docs.late);
		const plan = await planPersonnelFileZip(db, access, {
			employeeId: ids.dora,
			sharedOnly: false,
		});
		const entry = plan?.entries.find((candidate) => candidate.document.id === docs.late);
		if (!plan || !entry) throw new Error("the ZIP plan misses the document");

		expect((await purgeDueDocuments(db, access, { documentIds: [docs.late] }, NOW)).purged).toEqual(
			[docs.late],
		);

		await writeDocumentReadAudit(db, {
			action: AuditAction.PERSONNEL_FILE_DOCUMENT_VIEWED,
			actorUserId: userOf("owner"),
			document: stale,
			metadata: { variant: "original" },
		});
		const downloadAuditId = await writePersonnelFileZipAudit(db, {
			actorUserId: userOf("owner"),
			plan,
		});
		await writePersonnelFileZipAbortAudit(db, {
			actorUserId: userOf("owner"),
			plan,
			downloadAuditId,
			abort: {
				failedDocument: { id: docs.late, entryName: entry.entryName },
				deliveredDocumentIds: [],
			},
		});

		const written = await auditRows(
			"organization_id = $1 and (entity_id = $2 or id = $3 or metadata like $4)",
			[ORG, docs.late, downloadAuditId, `%${downloadAuditId}%`],
		);
		const viewed = written.find((row) => row.action === "personnel_file.document_viewed");
		expect(JSON.parse(viewed?.metadata as string)).toEqual({
			document: {
				category: "payslip",
				documentDate: "2018-08-31",
				payPeriod: { year: 2018, month: 8 },
				visibility: "hr_only",
				expiryDate: null,
			},
			variant: "original",
			descriptionsRemoved: true,
		});
		const download = written.find((row) => row.id === downloadAuditId);
		const lateEntry = JSON.parse(download?.metadata as string).documents.find(
			(candidate: { id: string }) => candidate.id === docs.late,
		);
		expect(lateEntry).toMatchObject({ id: docs.late, descriptionsRemoved: true });
		const abort = written.find((row) => row.action === "personnel_file.zip_download_aborted");
		expect(JSON.parse(abort?.metadata as string).failedDocument).toEqual({
			id: docs.late,
			descriptionsRemoved: true,
		});
		expect(JSON.stringify(written)).not.toContain("late-title-923");
		expect(JSON.stringify(written)).not.toContain("dora-late-923.pdf");
	});

	it("written while the purge is still running wait for it and keep no descriptions", async () => {
		const access = await ownerAccess();
		await writeDocumentAudit(db, {
			action: AuditAction.PERSONNEL_FILE_DOCUMENT_VIEWED,
			actorUserId: userOf("owner"),
			document: await loadDocument(docs.raced),
			metadata: { variant: "original" },
		});
		const stale = await loadDocument(docs.raced);
		const plan = await planPersonnelFileZip(db, access, {
			employeeId: ids.dora,
			sharedOnly: false,
		});
		const entry = plan?.entries.find((candidate) => candidate.document.id === docs.raced);
		if (!plan || !entry) throw new Error("the ZIP plan misses the document");

		// Park the purge inside its minimisation, after it read the records to minimise.
		const lockKey = 923_923;
		await admin.query(`
			create or replace function t923_park_minimisation() returns trigger language plpgsql as $$
			begin perform pg_advisory_xact_lock(${lockKey}); return new; end $$`);
		await admin.query(`
			create trigger t923_park_minimisation before update on audit_log for each row
			when (old.entity_id = '${docs.raced}') execute function t923_park_minimisation()`);
		const holder = await admin.connect();
		try {
			await holder.query("select pg_advisory_lock($1)", [lockKey]);
			const waiting = async (count: number) => {
				for (let attempt = 0; attempt < 200; attempt += 1) {
					const { rows } = await admin.query(
						`select count(*)::int as count from pg_stat_activity
						 where datname = current_database() and wait_event_type = 'Lock'`,
					);
					if (rows[0].count >= count) return;
					await new Promise((resolve) => setTimeout(resolve, 25));
				}
				throw new Error(`fewer than ${count} sessions waiting on a lock`);
			};

			const purge = purgeDueDocuments(db, access, { documentIds: [docs.raced] }, NOW);
			await waiting(1);
			const read = writeDocumentReadAudit(db, {
				action: AuditAction.PERSONNEL_FILE_DOCUMENT_DOWNLOADED,
				actorUserId: userOf("owner"),
				document: stale,
				metadata: { variant: "original" },
			});
			const aborted = writePersonnelFileZipAbortAudit(db, {
				actorUserId: userOf("owner"),
				plan,
				downloadAuditId: randomUUID(),
				abort: {
					failedDocument: { id: docs.raced, entryName: entry.entryName },
					deliveredDocumentIds: [],
				},
			});
			// Both late writers wait for the purge rather than slipping past its minimisation.
			await waiting(3);
			await holder.query("select pg_advisory_unlock($1)", [lockKey]);
			expect((await purge).purged).toEqual([docs.raced]);
			await Promise.all([read, aborted]);
		} finally {
			// Destroyed, not returned to the pool: it may still hold the session lock.
			holder.release(true);
			await admin.query("drop trigger if exists t923_park_minimisation on audit_log");
			await admin.query("drop function if exists t923_park_minimisation()");
		}

		const records = await auditRows(
			"organization_id = $1 and (entity_id = $2 or metadata like $3)",
			[ORG, docs.raced, `%"failedDocument":{"id":"${docs.raced}"%`],
		);
		expect(records.map((row) => row.action).toSorted()).toEqual([
			"personnel_file.document_downloaded",
			"personnel_file.document_purged",
			"personnel_file.document_viewed",
			"personnel_file.zip_download_aborted",
		]);
		expect(JSON.stringify(records)).not.toContain("raced-title-923");
	}, 30_000);
});
describe("the historical backfill", () => {
	const old = {
		purged: randomUUID(),
		otherOrgPurged: randomUUID(),
		deleted: randomUUID(),
	};
	const audit = async (input: {
		organizationId: string;
		entityType?: string;
		entityId: string;
		action: string;
		employeeId?: string | null;
		changes?: unknown;
		metadata: unknown;
	}) => {
		const id = randomUUID();
		await admin.query(
			`insert into audit_log (id, organization_id, entity_type, entity_id, action, performed_by,
			  employee_id, changes, metadata)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			[
				id,
				input.organizationId,
				input.entityType ?? "employee_document",
				input.entityId,
				input.action,
				input.organizationId === ORG ? userOf("owner") : userOf("otherOwner"),
				input.employeeId === undefined ? ids.dora : input.employeeId,
				input.changes === undefined ? null : JSON.stringify(input.changes),
				typeof input.metadata === "string" ? input.metadata : JSON.stringify(input.metadata),
			],
		);
		return id;
	};
	const snapshot = (title: string) => ({
		document: { category: "payslip", title, documentDate: "2017-12-31", payPeriod: null },
	});
	let unreadable = "";
	let stillPresentEvidence = "";

	beforeAll(async () => {
		// Purged before #923: the purge record keeps its reason, earlier records their title.
		await audit({
			organizationId: ORG,
			entityId: old.purged,
			action: "personnel_file.document_uploaded",
			metadata: { ...snapshot("Old purged title-923"), fileName: "old-purged-923.pdf" },
		});
		await audit({
			organizationId: ORG,
			entityId: old.purged,
			action: "personnel_file.document_updated",
			changes: { title: { from: "Old draft title-923", to: "Old purged title-923" } },
			metadata: snapshot("Old purged title-923"),
		});
		await audit({
			organizationId: ORG,
			entityId: old.purged,
			action: "personnel_file.document_purged",
			metadata: {
				document: { category: "payslip", documentDate: "2017-12-31", payPeriod: null },
				reason: "Old purge reason-923",
				retentionStart: "2019-01-01",
				dueOn: "2025-01-01",
				retentionYears: 6,
			},
		});
		await audit({
			organizationId: ORG,
			entityType: "employee_personnel_file",
			entityId: ids.dora,
			action: "personnel_file.zip_downloaded",
			metadata: {
				documents: [
					{
						id: old.purged,
						title: "Old purged title-923",
						fileName: "old-purged-923.pdf",
						entryName: "Payslips/Old purged title-923.pdf",
					},
					{ id: old.deleted, title: "Old deleted title-923", entryName: "Other/deleted.pdf" },
				],
			},
		});
		unreadable = await audit({
			organizationId: ORG,
			entityId: old.purged,
			action: "personnel_file.document_viewed",
			metadata: "{broken",
		});
		// Deleted by hand, never purged: no explicit purge evidence, so nothing changes.
		await audit({
			organizationId: ORG,
			entityId: old.deleted,
			action: "personnel_file.document_deleted",
			metadata: { ...snapshot("Old deleted title-923"), reason: "Duplicate", fileName: "d.pdf" },
		});
		// A purge record whose document still exists is not trusted.
		stillPresentEvidence = await audit({
			organizationId: ORG,
			entityId: docs.kept,
			action: "personnel_file.document_purged",
			metadata: { document: { category: "contract" }, reason: "Mistaken evidence" },
		});
		await audit({
			organizationId: OTHER_ORG,
			entityId: old.otherOrgPurged,
			action: "personnel_file.document_viewed",
			employeeId: null,
			metadata: snapshot("Other org purged title-923"),
		});
		await audit({
			organizationId: OTHER_ORG,
			entityId: old.otherOrgPurged,
			action: "personnel_file.document_purged",
			employeeId: null,
			metadata: { document: { category: "payslip" }, reason: "Other org reason-923" },
		});
	});

	it("minimises the audits of documents explicitly purged, per organization, and reports the rest", async () => {
		const unrelatedBefore = await auditRows("entity_id = any($1)", [[old.deleted, docs.kept]]);
		const otherBefore = await auditRows("organization_id = $1", [OTHER_ORG]);
		const purgedBefore = await auditRows("organization_id = $1 and entity_id = $2", [
			ORG,
			old.purged,
		]);

		const [report, ...rest] = await backfillPurgedDocumentAudits(db, {
			organizationIds: [ORG],
			batchSize: 1,
		});
		expect(rest).toEqual([]);
		expect(report).toMatchObject({
			organizationId: ORG,
			documentStillPresent: [{ auditId: stillPresentEvidence, documentId: docs.kept }],
			unprocessable: [
				{ auditId: unreadable, entityType: "employee_document", entityId: old.purged },
			],
		});
		// Upload, edit, purge and the ZIP entry. The new purges' records were minimised already.
		expect(report?.minimised).toBe(4);

		const purgedAfter = await auditRows("organization_id = $1 and entity_id = $2", [
			ORG,
			old.purged,
		]);
		expect(purgedAfter.map((row) => [row.id, row.timestamp])).toEqual(
			purgedBefore.map((row) => [row.id, row.timestamp]),
		);
		const zip = await auditRows(
			"organization_id = $1 and entity_type = 'employee_personnel_file' and metadata like $2",
			[ORG, `%${old.purged}%`],
		);
		const text = JSON.stringify([...purgedAfter, ...zip]);
		for (const description of [
			"Old purged title-923",
			"Old draft title-923",
			"old-purged-923.pdf",
			"Old purge reason-923",
		]) {
			expect(text).not.toContain(description);
		}
		expect(JSON.parse(zip[0]?.metadata as string).documents[1]).toEqual({
			id: old.deleted,
			title: "Old deleted title-923",
			entryName: "Other/deleted.pdf",
		});
		expect(purgedAfter.find((row) => row.id === unreadable)?.metadata).toBe("{broken");
		expect(await auditRows("entity_id = any($1)", [[old.deleted, docs.kept]])).toEqual(
			unrelatedBefore,
		);
		expect(await auditRows("organization_id = $1", [OTHER_ORG])).toEqual(otherBefore);
	});

	it("is safe to run again and covers every organization when none is named", async () => {
		const reports = await backfillPurgedDocumentAudits(db, {});
		const mine = reports.find((report) => report.organizationId === ORG);
		const other = reports.find((report) => report.organizationId === OTHER_ORG);
		expect(mine?.minimised).toBe(0);
		expect(mine?.unprocessable).toHaveLength(1);
		expect(other).toMatchObject({ minimised: 2, unprocessable: [], documentStillPresent: [] });
		expect(JSON.stringify(await auditRows("organization_id = $1", [OTHER_ORG]))).not.toMatch(
			/Other org (purged title|reason)-923/,
		);
		const again = await backfillPurgedDocumentAudits(db, { organizationIds: [OTHER_ORG] });
		expect(again[0]?.minimised).toBe(0);
	});
});
