/**
 * #871: downloading a personnel file as one ZIP, against a disposable
 * PostgreSQL database, through the real route. The session and object storage
 * are replaced; documents are seeded directly.
 */

import { createHash, randomUUID } from "node:crypto";
import JSZip from "jszip";
import type { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import { seedPersonnelFileOfficerGrant } from "./testing/officer-grant.test.fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t871-org",
	objects: new Map<string, Buffer>(),
	reads: [] as string[],
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
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
vi.mock("@/lib/storage/export-s3-client", () => ({
	async readPrivateObject(input: { key: string }) {
		harness.reads.push(input.key);
		const bytes = harness.objects.get(input.key);
		if (!bytes) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
		return new Uint8Array(bytes);
	},
}));

const { GET: getZip } = await import("@/app/api/personnel-files/employees/[employeeId]/zip/route");

const ORG = "t871-org";
const OTHER_ORG = "t871-other";

const ids = {
	owner: "e8710000-0000-4000-8000-000000000001",
	former: "e8710000-0000-4000-8000-000000000002",
	payslipOfficer: "e8710000-0000-4000-8000-000000000003",
	manager: "e8710000-0000-4000-8000-000000000004",
	ben: "e8710000-0000-4000-8000-000000000005",
	otherOwner: "e8710000-0000-4000-8000-000000000006",
	bert: "e8710000-0000-4000-8000-000000000007",
} as const;
type Person = keyof typeof ids;

const admin = integrationAdminPool();

async function cleanup() {
	for (const org of [ORG, OTHER_ORG]) {
		await admin.query("delete from organization where id = $1", [org]);
		await admin.query("delete from personnel_file_upload where organization_id = $1", [org]);
	}
	await admin.query('delete from "user" where id like $1', ["t871-%"]);
}

async function seedPerson(
	organizationId: string,
	name: Person,
	memberRole: string,
	options: { isActive?: boolean; displayName?: string } = {},
) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
		[`t871-${name}`, options.displayName ?? name, `t871-${name}@example.test`],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
		[`t871-member-${name}`, organizationId, `t871-${name}`, memberRole],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,is_active,updated_at) values ($1,$2,$3,'employee',$4,now())",
		[ids[name], `t871-${name}`, organizationId, options.isActive ?? true],
	);
}

interface SeededDocument {
	id: string;
	category: string;
	title: string;
	documentDate: string;
	visibility: "shared" | "hr_only";
	content: string;
}

async function seedDocument(
	organizationId: string,
	employeeId: string,
	input: Omit<SeededDocument, "id" | "content"> & { mimeType?: string },
): Promise<SeededDocument> {
	const id = randomUUID();
	const content = `%PDF-1.4\n% ${input.title} ${id}\n%%EOF`;
	const bytes = Buffer.from(content);
	const storageKey = `personnel-files/${organizationId}/${employeeId}/${id}-file.pdf`;
	harness.objects.set(storageKey, bytes);
	const payslip = input.category === "payslip";
	await admin.query(
		`insert into employee_document (id, organization_id, employee_id, category, title, document_date,
		  pay_period_year, pay_period_month, visibility, storage_provider, storage_bucket, storage_key,
		  file_name, mime_type, size_bytes, checksum_sha256)
		 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'s3-private','t871-private',$10,'file.pdf',$11,$12,$13)`,
		[
			id,
			organizationId,
			employeeId,
			input.category,
			input.title,
			input.documentDate,
			payslip ? Number(input.documentDate.slice(0, 4)) : null,
			payslip ? Number(input.documentDate.slice(5, 7)) : null,
			input.visibility,
			storageKey,
			input.mimeType ?? "application/pdf",
			bytes.byteLength,
			createHash("sha256").update(bytes).digest("hex"),
		],
	);
	return { id, content, ...input };
}

function signIn(name: Person, organizationId = ORG) {
	harness.userId = `t871-${name}`;
	harness.organizationId = organizationId;
}

function requestZip(employeeId: string, query = "") {
	return getZip(
		new Request(
			`http://localhost/api/personnel-files/employees/${employeeId}/zip${query}`,
		) as unknown as NextRequest,
		{ params: Promise.resolve({ employeeId }) },
	);
}

async function zipContents(response: Response): Promise<Record<string, string>> {
	expect(response.status).toBe(200);
	const zip = await JSZip.loadAsync(await response.arrayBuffer());
	const files: Record<string, string> = {};
	for (const entry of Object.values(zip.files)) files[entry.name] = await entry.async("string");
	return files;
}

async function zipAudits(employeeId: string) {
	const { rows } = await admin.query<{
		action: string;
		performed_by: string;
		entity_type: string;
		metadata: string;
	}>(
		"select action, performed_by, entity_type, metadata from audit_log where organization_id = $1 and employee_id = $2 and action = 'personnel_file.zip_downloaded' order by timestamp, id",
		[ORG, employeeId],
	);
	return rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadata) }));
}

const docs = {} as Record<
	| "contract"
	| "payslipMarch"
	| "payslipApril"
	| "certificate"
	| "sickNote"
	| "hrOther"
	| "hrPayslip",
	SeededDocument
>;

describe("personnel file ZIP download (#871)", () => {
	beforeAll(async () => {
		await cleanup();
		for (const organizationId of [ORG, OTHER_ORG]) {
			await admin.query(
				`insert into organization (id, name, slug, timezone, personnel_files_enabled, created_at)
				 values ($1, $1, $1, 'Europe/Berlin', true, now())`,
				[organizationId],
			);
		}
		await seedPerson(ORG, "owner", "owner");
		await seedPerson(ORG, "former", "member", { isActive: false, displayName: "Anna Früh" });
		await seedPerson(ORG, "payslipOfficer", "member");
		await seedPerson(ORG, "manager", "member");
		await seedPerson(ORG, "ben", "member");
		await seedPerson(OTHER_ORG, "otherOwner", "owner");
		await seedPerson(OTHER_ORG, "bert", "member");
		await seedPersonnelFileOfficerGrant(admin, {
			organizationId: ORG,
			officerEmployeeId: ids.payslipOfficer,
			createdBy: "t871-owner",
			categories: ["payslip"],
			employeeIds: [ids.former],
		});

		const former = (input: Parameters<typeof seedDocument>[2]) =>
			seedDocument(ORG, ids.former, input);
		docs.contract = await former({
			category: "contract",
			title: "Arbeitsvertrag",
			documentDate: "2024-01-15",
			visibility: "shared",
		});
		docs.payslipMarch = await former({
			category: "payslip",
			title: "Payslip",
			documentDate: "2027-03-31",
			visibility: "shared",
		});
		docs.payslipApril = await former({
			category: "payslip",
			title: "Payslip",
			documentDate: "2027-03-31",
			visibility: "shared",
		});
		docs.certificate = await former({
			category: "certificate",
			title: "Arbeitszeugnis",
			documentDate: "2027-06-30",
			visibility: "shared",
		});
		docs.sickNote = await former({
			category: "sick_note",
			title: "AU",
			documentDate: "2026-11-02",
			visibility: "hr_only",
		});
		docs.hrOther = await former({
			category: "other",
			title: "Abmahnung",
			documentDate: "2026-05-05",
			visibility: "hr_only",
		});
		docs.hrPayslip = await former({
			category: "payslip",
			title: "Correction",
			documentDate: "2027-04-30",
			visibility: "hr_only",
		});
		await seedDocument(ORG, ids.ben, {
			category: "contract",
			title: "Ben contract",
			documentDate: "2025-01-01",
			visibility: "shared",
		});
		await seedDocument(OTHER_ORG, ids.bert, {
			category: "contract",
			title: "Bert contract",
			documentDate: "2025-01-01",
			visibility: "shared",
		});
	});
	afterAll(async () => {
		await cleanup();
		await admin.end();
	});
	beforeEach(async () => {
		harness.reads.length = 0;
		await admin.query(
			"delete from audit_log where organization_id = $1 and action like 'personnel_file.zip_download%'",
			[ORG],
		);
		await admin.query("update organization set personnel_files_enabled = true where id = $1", [
			ORG,
		]);
	});

	it("contains exactly a former employee's shared documents, arranged by category and date", async () => {
		signIn("owner");
		const response = await requestZip(ids.former);

		expect(response.headers.get("Content-Type")).toBe("application/zip");
		expect(response.headers.get("Content-Disposition")).toMatch(
			/^attachment; filename\*=UTF-8''personnel-file_Anna%20Fr%C3%BCh\.zip$/,
		);
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		expect(await zipContents(response)).toEqual({
			"contract/2024-01-15_Arbeitsvertrag.pdf": docs.contract.content,
			"payslip/2027-03-31_Payslip.pdf": docs.payslipMarch.content,
			"payslip/2027-03-31_Payslip (2).pdf": docs.payslipApril.content,
			"certificate/2027-06-30_Arbeitszeugnis.pdf": docs.certificate.content,
		});
	});

	it("includes HR-only documents when shared documents only is switched off", async () => {
		signIn("owner");
		const files = await zipContents(await requestZip(ids.former, "?sharedOnly=0"));
		expect(Object.keys(files).sort()).toEqual(
			[
				"contract/2024-01-15_Arbeitsvertrag.pdf",
				"payslip/2027-03-31_Payslip.pdf",
				"payslip/2027-03-31_Payslip (2).pdf",
				"payslip/2027-04-30_Correction.pdf",
				"certificate/2027-06-30_Arbeitszeugnis.pdf",
				"sick_note/2026-11-02_AU.pdf",
				"other/2026-05-05_Abmahnung.pdf",
			].sort(),
		);
	});

	it("gives an officer limited to payslips only payslips", async () => {
		signIn("payslipOfficer");
		expect(Object.keys(await zipContents(await requestZip(ids.former)))).toEqual([
			"payslip/2027-03-31_Payslip.pdf",
			"payslip/2027-03-31_Payslip (2).pdf",
		]);
		expect(Object.keys(await zipContents(await requestZip(ids.former, "?sharedOnly=0")))).toEqual([
			"payslip/2027-03-31_Payslip.pdf",
			"payslip/2027-03-31_Payslip (2).pdf",
			"payslip/2027-04-30_Correction.pdf",
		]);
	});

	it("audits each download once with the list of included documents", async () => {
		signIn("payslipOfficer");
		await zipContents(await requestZip(ids.former));

		const audits = await zipAudits(ids.former);
		expect(audits).toHaveLength(1);
		expect(audits[0]?.performed_by).toBe("t871-payslipOfficer");
		expect(audits[0]?.entity_type).toBe("employee_personnel_file");
		expect(audits[0]?.metadata).toMatchObject({ sharedOnly: true, categories: ["payslip"] });
		expect(audits[0]?.metadata.documents).toEqual([
			expect.objectContaining({
				id: docs.payslipMarch.id,
				category: "payslip",
				title: "Payslip",
				documentDate: "2027-03-31",
				entryName: "payslip/2027-03-31_Payslip.pdf",
			}),
			expect.objectContaining({
				id: docs.payslipApril.id,
				entryName: "payslip/2027-03-31_Payslip (2).pdf",
			}),
		]);
	});

	it("streams the archive: no document is read before the body is consumed", async () => {
		signIn("owner");
		const response = await requestZip(ids.former, "?sharedOnly=0");
		expect(response.status).toBe(200);
		expect(harness.reads).toEqual([]);
		await zipContents(response);
		expect(harness.reads).toHaveLength(7);
	});

	it("refuses everyone without a grant for the employee like a not-found", async () => {
		for (const person of ["manager", "ben", "former"] as const) {
			signIn(person);
			expect((await requestZip(ids.former)).status).toBe(404);
		}
		signIn("payslipOfficer");
		expect((await requestZip(ids.ben)).status).toBe(404);
		signIn("owner");
		expect((await requestZip(ids.bert)).status).toBe(404);
		expect((await requestZip("not-a-uuid")).status).toBe(404);
		harness.userId = null;
		expect((await requestZip(ids.former)).status).toBe(401);
		expect(await zipAudits(ids.former)).toEqual([]);
	});

	it("is unavailable while personnel files are off", async () => {
		await admin.query("update organization set personnel_files_enabled = false where id = $1", [
			ORG,
		]);
		signIn("owner");
		expect((await requestZip(ids.former)).status).toBe(404);
	});

	it("aborts the download when a stored file no longer matches its recorded identity", async () => {
		signIn("owner");
		const key = [...harness.objects.keys()].find((candidate) =>
			candidate.includes(docs.certificate.id),
		);
		if (!key) throw new Error("missing seeded object");
		const original = harness.objects.get(key) as Buffer;
		harness.objects.set(key, Buffer.from("tampered"));
		try {
			const response = await requestZip(ids.former);
			expect(response.status).toBe(200);
			await expect(response.arrayBuffer()).rejects.toThrow();

			// The up-front record keeps the planned documents; a follow-up record
			// names the failed document and what was actually handed over.
			const [planned] = await zipAudits(ids.former);
			expect(planned?.metadata.documents).toHaveLength(4);
			const { rows } = await admin.query<{
				id: string;
				performed_by: string;
				entity_type: string;
				metadata: string;
			}>(
				"select id, performed_by, entity_type, metadata from audit_log where organization_id = $1 and employee_id = $2 and action = 'personnel_file.zip_download_aborted'",
				[ORG, ids.former],
			);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				performed_by: "t871-owner",
				entity_type: "employee_personnel_file",
			});
			const { rows: plannedRows } = await admin.query<{ id: string }>(
				"select id from audit_log where organization_id = $1 and employee_id = $2 and action = 'personnel_file.zip_downloaded'",
				[ORG, ids.former],
			);
			expect(JSON.parse(rows[0]?.metadata ?? "{}")).toEqual({
				downloadAuditId: plannedRows[0]?.id,
				failedDocument: {
					id: docs.certificate.id,
					entryName: "certificate/2027-06-30_Arbeitszeugnis.pdf",
				},
				deliveredDocumentIds: [docs.contract.id, docs.payslipMarch.id, docs.payslipApril.id],
			});
		} finally {
			harness.objects.set(key, original);
		}
	});
});
