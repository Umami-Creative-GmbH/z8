/**
 * #865: employee documents in personnel files, against a disposable PostgreSQL
 * database. Uploads go through the real finalize route, downloads through the
 * real document route, edits and deletions through the real server actions.
 * The session, notification delivery and object storage are replaced.
 */

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t865-org",
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
	failDeletes: false,
	notifications: [] as Array<{ userId: string; type: string; idempotencyKey?: string }>,
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
vi.mock("@/lib/notifications/notification-service", () => ({
	createNotification: async (params: { userId: string; type: string; idempotencyKey?: string }) => {
		harness.notifications.push({
			userId: params.userId,
			type: params.type,
			idempotencyKey: params.idempotencyKey,
		});
		return null;
	},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t865-public",
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
	async uploadPrivateObject(_organizationId: string, key: string, data: Uint8Array) {
		harness.objects.set(key, Buffer.from(data));
		return { bucket: "t865-private", versionId: null };
	},
	async readPrivateObject(input: { key: string }) {
		const bytes = harness.objects.get(input.key);
		if (!bytes) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
		return new Uint8Array(bytes);
	},
	async deletePrivateObject(input: { key: string }) {
		if (harness.failDeletes) throw new Error("Storage unavailable");
		harness.objects.delete(input.key);
	},
	async deletePrivateObjectVersions(input: { key: string }) {
		if (harness.failDeletes) throw new Error("Storage unavailable");
		harness.objects.delete(input.key);
	},
	async privateObjectExists(input: { key: string }) {
		return harness.objects.has(input.key);
	},
}));

const { db } = await import("@/db");
const { POST: finalizeUpload } = await import("@/app/api/upload/personnel-file/route");
const { GET: getDocument } = await import("@/app/api/personnel-files/documents/[documentId]/route");
const actions = await import("@/app/[locale]/(app)/personnel-files/actions");
const { resolvePersonnelFileAccess } = await import("./access-store");
const { loadVisibleDocument } = await import("./document-store");
type EmployeeScope = import("./access").EmployeeScope;
type DocumentCategory = import("./document.types").DocumentCategory;
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
const { runPersonnelFileUploadCleanupJob } = await import(
	"@/lib/jobs/personnel-file-upload-cleanup"
);
const { runOrganizationCleanup } = await import("@/lib/jobs/organization-cleanup");

const ORG = "t865-org";
const OTHER_ORG = "t865-other";
const PURGED_ORG = "t865-purged";

const ids = {
	owner: "e8650000-0000-4000-8000-000000000001",
	admin: "e8650000-0000-4000-8000-000000000002",
	anna: "e8650000-0000-4000-8000-000000000003",
	ben: "e8650000-0000-4000-8000-000000000004",
	manager: "e8650000-0000-4000-8000-000000000005",
	payroll: "e8650000-0000-4000-8000-000000000006",
	officer: "e8650000-0000-4000-8000-000000000007",
	leaver: "e8650000-0000-4000-8000-000000000008",
	bert: "e8650000-0000-4000-8000-000000000009",
	otherOwner: "e8650000-0000-4000-8000-000000000010",
	paula: "e8650000-0000-4000-8000-000000000011",
	purgeOwner: "e8650000-0000-4000-8000-000000000012",
	berlin: "e8651000-0000-4000-8000-000000000001",
} as const;
type Person = Exclude<keyof typeof ids, "berlin">;

const admin = integrationAdminPool();
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF`);
// A 1x1 PNG.
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

async function cleanup() {
	for (const org of [ORG, OTHER_ORG, PURGED_ORG]) {
		await admin.query("delete from organization where id = $1", [org]);
		await admin.query("delete from personnel_file_upload where organization_id = $1", [org]);
	}
	await admin.query('delete from "user" where id like $1', ["t865-%"]);
}

async function seedPerson(
	organizationId: string,
	name: Person,
	memberRole: string,
	employeeRole: string,
	options: { teamId?: string | null; isActive?: boolean } = {},
) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
		[`t865-${name}`, name, `t865-${name}@example.test`],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
		[`t865-member-${name}`, organizationId, `t865-${name}`, memberRole],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,team_id,is_active,updated_at) values ($1,$2,$3,$4,$5,$6,now())",
		[
			ids[name],
			`t865-${name}`,
			organizationId,
			employeeRole,
			options.teamId ?? null,
			options.isActive ?? true,
		],
	);
}

async function seed() {
	await cleanup();
	for (const [id, enabled] of [
		[ORG, true],
		[OTHER_ORG, true],
		[PURGED_ORG, true],
	] as const) {
		await admin.query(
			`insert into organization (id, name, slug, timezone, personnel_files_enabled, created_at)
			 values ($1, $1, $1, 'Europe/Berlin', $2, now())`,
			[id, enabled],
		);
	}
	await admin.query(
		"insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Berlin', now())",
		[ids.berlin, ORG],
	);
	await seedPerson(ORG, "owner", "owner", "admin");
	await seedPerson(ORG, "admin", "admin", "employee");
	await seedPerson(ORG, "anna", "member", "employee", { teamId: ids.berlin });
	await seedPerson(ORG, "ben", "member", "employee");
	await seedPerson(ORG, "manager", "member", "manager");
	// Berlin through a team membership rather than the primary team.
	await admin.query(
		"insert into team_membership (organization_id, team_id, employee_id) values ($1, $2, $3)",
		[ORG, ids.berlin, ids.manager],
	);
	await seedPerson(ORG, "payroll", "member", "employee");
	await seedPerson(ORG, "officer", "member", "employee");
	await seedPerson(ORG, "leaver", "admin", "employee", { isActive: false });
	await seedPerson(OTHER_ORG, "otherOwner", "owner", "admin");
	await seedPerson(OTHER_ORG, "bert", "member", "employee");
	await seedPerson(PURGED_ORG, "purgeOwner", "owner", "admin");
	await seedPerson(PURGED_ORG, "paula", "member", "employee");
	await admin.query(
		`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
		 values (gen_random_uuid(), $1, $2, true, 't865-owner', now(), now())`,
		[ids.anna, ids.manager],
	);
	await admin.query(
		`insert into payroll_access_grant (organization_id, payroll_employee_id, scope, created_by, updated_at)
		 values ($1, $2, 'all', 't865-owner', now())`,
		[ORG, ids.payroll],
	);
	await admin.query(
		`insert into expense_officer_grant (organization_id, officer_employee_id, scope, can_export, can_record_reimbursements, created_by)
		 values ($1, $2, 'all', true, true, 't865-owner')`,
		[ORG, ids.officer],
	);
}

function signIn(name: Person, organizationId = ORG) {
	harness.userId = `t865-${name}`;
	harness.organizationId = organizationId;
}

async function setPersonnelFiles(organizationId: string, enabled: boolean) {
	await admin.query("update organization set personnel_files_enabled = $2 where id = $1", [
		organizationId,
		enabled,
	]);
}

async function upload(input: {
	employeeId: string;
	metadata: Record<string, unknown>;
	bytes?: Buffer;
	fileName?: string;
}) {
	if (!harness.userId) throw new Error("not signed in");
	const tusFileKey = createOwnedTusFileKey(harness.userId);
	harness.tus.set(tusFileKey, input.bytes ?? pdf(JSON.stringify(input.metadata)));
	return finalizeUpload(
		new Request("http://localhost/api/upload/personnel-file", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tusFileKey,
				employeeId: input.employeeId,
				fileName: input.fileName ?? "document.pdf",
				metadata: input.metadata,
			}),
		}) as unknown as NextRequest,
	);
}

async function uploadDocument(input: Parameters<typeof upload>[0]): Promise<string> {
	const response = await upload(input);
	const body = (await response.json()) as { document?: { id: string }; error?: string };
	if (response.status !== 200 || !body.document) {
		throw new Error(`upload failed: ${response.status} ${body.error}`);
	}
	return body.document.id;
}

function download(documentId: string, query = "") {
	return getDocument(
		new Request(
			`http://localhost/api/personnel-files/documents/${documentId}${query}`,
		) as unknown as NextRequest,
		{ params: Promise.resolve({ documentId }) },
	);
}

async function auditActions(documentId: string): Promise<string[]> {
	const { rows } = await admin.query<{ action: string }>(
		"select action from audit_log where entity_type = 'employee_document' and entity_id = $1 order by timestamp, id",
		[documentId],
	);
	return rows.map((row) => row.action);
}

const contract = (title = "Employment contract") => ({
	category: "contract" as const,
	title,
	documentDate: "2026-03-01",
});

describe("personnel file employee documents (#865)", () => {
	beforeAll(seed);
	afterAll(async () => {
		await cleanup();
		await admin.end();
	});
	beforeEach(async () => {
		harness.failDeletes = false;
		harness.notifications.length = 0;
		await setPersonnelFiles(ORG, true);
	});

	describe("access resolver", () => {
		it("gives owners and admins every category of every employee", async () => {
			for (const person of ["owner", "admin"] as const) {
				const access = await resolvePersonnelFileAccess(db, {
					userId: `t865-${person}`,
					organizationId: ORG,
				});
				expect(access?.grants).toHaveLength(1);
				expect(access?.grants[0]?.scope).toEqual({ kind: "all" });
				expect([...(access?.grants[0]?.categories ?? [])].sort()).toEqual([
					"certificate",
					"contract",
					"other",
					"payslip",
					"sick_note",
				]);
			}
		});

		it("gives employees, managers, payroll access holders and expense officers only themselves", async () => {
			for (const person of ["anna", "manager", "payroll", "officer"] as const) {
				const access = await resolvePersonnelFileAccess(db, {
					userId: `t865-${person}`,
					organizationId: ORG,
				});
				expect(access).toMatchObject({ selfEmployeeId: ids[person], grants: [] });
			}
		});

		it("grants nothing to a former employee, a non-member or anyone while the feature is off", async () => {
			expect(
				await resolvePersonnelFileAccess(db, { userId: "t865-leaver", organizationId: ORG }),
			).toBeNull();
			expect(
				await resolvePersonnelFileAccess(db, { userId: "t865-otherOwner", organizationId: ORG }),
			).toBeNull();
			await setPersonnelFiles(ORG, false);
			expect(
				await resolvePersonnelFileAccess(db, { userId: "t865-owner", organizationId: ORG }),
			).toBeNull();
		});
	});

	describe("document rules", () => {
		beforeEach(() => signIn("admin"));

		it("records a payslip with a pay period", async () => {
			const response = await upload({
				employeeId: ids.anna,
				metadata: {
					category: "payslip",
					title: "Payslip February",
					documentDate: "2026-02-28",
					payPeriod: { year: 2026, month: 2 },
				},
			});
			expect(response.status).toBe(200);
			const { document } = (await response.json()) as {
				document: { payPeriod: unknown; visibility: string };
			};
			expect(document).toMatchObject({ payPeriod: { year: 2026, month: 2 }, visibility: "shared" });
		});

		it("refuses a payslip without a pay period and a contract with one", async () => {
			const missing = await upload({
				employeeId: ids.anna,
				metadata: { category: "payslip", title: "Payslip", documentDate: "2026-02-28" },
			});
			expect(missing.status).toBe(400);
			expect(await missing.json()).toMatchObject({ field: "payPeriod" });
			const extra = await upload({
				employeeId: ids.anna,
				metadata: { ...contract(), payPeriod: { year: 2026, month: 2 } },
			});
			expect(extra.status).toBe(400);
			expect(await extra.json()).toMatchObject({ field: "payPeriod" });
		});

		it("refuses an expiry date on contracts, payslips and sick notes", async () => {
			for (const metadata of [
				{ ...contract(), expiryDate: "2030-01-01" },
				{
					category: "payslip",
					title: "Payslip",
					documentDate: "2026-02-28",
					payPeriod: { year: 2026, month: 2 },
					expiryDate: "2030-01-01",
				},
				{
					category: "sick_note",
					title: "Sick note",
					documentDate: "2026-02-28",
					expiryDate: "2030-01-01",
				},
			]) {
				const response = await upload({ employeeId: ids.anna, metadata });
				expect(response.status).toBe(400);
				expect(await response.json()).toMatchObject({ field: "expiryDate" });
			}
			const certificate = await upload({
				employeeId: ids.anna,
				metadata: {
					category: "certificate",
					title: "First aid",
					documentDate: "2026-02-28",
					expiryDate: "2028-02-27",
				},
			});
			expect(certificate.status).toBe(200);
		});

		it("refuses files that are not PDF, JPEG, PNG or WebP by their real bytes", async () => {
			const response = await upload({
				employeeId: ids.anna,
				metadata: contract(),
				bytes: Buffer.from("GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000;"),
				fileName: "photo.gif",
			});
			expect(response.status).toBe(400);
		});

		it("enforces the rules in the database too", async () => {
			const insert = (category: string, payYear: number | null, expiry: string | null) =>
				admin.query(
					`insert into employee_document (id, organization_id, employee_id, category, title, document_date,
						pay_period_year, pay_period_month, visibility, expiry_date, storage_provider, storage_key,
						file_name, mime_type, size_bytes, checksum_sha256)
					 values (gen_random_uuid(), $1, $2, $3, 'x', '2026-01-01', $4, $5, 'shared', $6,
						's3-private', gen_random_uuid()::text, 'x.pdf', 'application/pdf', 1, 'x')`,
					[ORG, ids.anna, category, payYear, payYear ? 1 : null, expiry],
				);
			await expect(insert("payslip", null, null)).rejects.toThrow(/pay_period_check/);
			await expect(insert("contract", 2026, null)).rejects.toThrow(/pay_period_check/);
			await expect(insert("sick_note", null, "2030-01-01")).rejects.toThrow(/expiry_check/);
		});
	});

	describe("visibility and access", () => {
		let shared: string;
		let hrOnly: string;
		let bens: string;
		let otherOrgDocument: string;

		beforeAll(async () => {
			signIn("admin");
			shared = await uploadDocument({
				employeeId: ids.anna,
				metadata: contract("Shared contract"),
			});
			hrOnly = await uploadDocument({
				employeeId: ids.anna,
				metadata: { category: "sick_note", title: "Sick note", documentDate: "2026-04-01" },
			});
			bens = await uploadDocument({ employeeId: ids.ben, metadata: contract("Ben's contract") });
			signIn("otherOwner", OTHER_ORG);
			otherOrgDocument = await uploadDocument({
				employeeId: ids.bert,
				metadata: contract("Bert's contract"),
			});
		});

		it("defaults sick notes to HR-only and contracts to shared", async () => {
			signIn("admin");
			const file = await actions.getPersonnelFileAction({ employeeId: ids.anna });
			if (!file.success) throw new Error(file.error);
			const byId = new Map(file.data.documents.map((document) => [document.id, document]));
			expect(byId.get(shared)?.visibility).toBe("shared");
			expect(byId.get(hrOnly)?.visibility).toBe("hr_only");
		});

		it("lets an employee see and download only their own shared documents", async () => {
			signIn("anna");
			const mine = await actions.getMyDocumentsAction();
			if (!mine.success) throw new Error(mine.error);
			const visible = mine.data.map((document) => document.id);
			expect(visible).toContain(shared);
			expect(visible).not.toContain(hrOnly);
			expect(visible).not.toContain(bens);
			expect(mine.data.every((document) => document.visibility === "shared")).toBe(true);

			const own = await download(shared, "?download=1");
			expect(own.status).toBe(200);
			expect(own.headers.get("Cache-Control")).toBe("private, no-store");
			expect(own.headers.get("X-Content-Type-Options")).toBe("nosniff");
			expect(own.headers.get("Content-Security-Policy")).toBe("sandbox");
			expect(own.headers.get("Content-Disposition")).toMatch(/^attachment;/);
			expect((await download(hrOnly)).status).toBe(404);
			expect((await download(bens)).status).toBe(404);
			expect(await actions.getPersonnelFileAction({ employeeId: ids.anna })).toMatchObject({
				success: false,
			});
		});

		it("refuses managers, payroll access holders and expense officers like a not-found", async () => {
			for (const person of ["manager", "payroll", "officer"] as const) {
				signIn(person);
				expect((await download(shared)).status).toBe(404);
				expect((await download(hrOnly)).status).toBe(404);
				expect(await actions.getPersonnelFileAction({ employeeId: ids.anna })).toMatchObject({
					success: false,
				});
				expect((await upload({ employeeId: ids.anna, metadata: contract() })).status).toBe(404);
				expect(
					await actions.deleteEmployeeDocumentAction({ documentId: shared, reason: null }),
				).toMatchObject({ success: false });
			}
		});

		it("keeps every query inside the organization", async () => {
			signIn("admin");
			expect((await download(otherOrgDocument)).status).toBe(404);
			expect(await actions.getPersonnelFileAction({ employeeId: ids.bert })).toMatchObject({
				success: false,
			});
			expect((await upload({ employeeId: ids.bert, metadata: contract() })).status).toBe(404);
			expect(
				await actions.updateEmployeeDocumentAction({
					documentId: otherOrgDocument,
					metadata: {
						...contract(),
						payPeriod: null,
						visibility: "hr_only" as const,
						expiryDate: null,
					},
				}),
			).toMatchObject({ success: false });
			signIn("otherOwner", OTHER_ORG);
			expect((await download(shared)).status).toBe(404);
			expect((await download(otherOrgDocument)).status).toBe(200);
		});

		it("matches scoped grants by named employees, live team membership and category", async () => {
			signIn("admin");
			const managers = await uploadDocument({
				employeeId: ids.manager,
				metadata: contract("Manager's contract"),
			});
			const scoped = (scope: EmployeeScope, categories: DocumentCategory[]) => ({
				organizationId: ORG,
				userId: "t865-officer",
				selfEmployeeId: ids.officer,
				grants: [{ source: "officer_grant" as const, scope, categories: new Set(categories) }],
			});
			const visible = async (access: ReturnType<typeof scoped>) => {
				const result: string[] = [];
				for (const documentId of [shared, hrOnly, bens, managers, otherOrgDocument]) {
					if (await loadVisibleDocument(db, access, documentId)) result.push(documentId);
				}
				return result;
			};

			expect(
				await visible(
					scoped({ kind: "specific", employeeIds: [], teamIds: [ids.berlin] }, ["contract"]),
				),
			).toEqual([shared, managers]);
			expect(
				await visible(
					scoped({ kind: "specific", employeeIds: [ids.ben], teamIds: [] }, ["sick_note"]),
				),
			).toEqual([]);
			expect(
				await visible(
					scoped({ kind: "specific", employeeIds: [ids.ben], teamIds: [ids.berlin] }, [
						"contract",
						"sick_note",
					]),
				),
			).toEqual([shared, hrOnly, bens, managers]);
			expect(await visible(scoped({ kind: "all" }, ["sick_note"]))).toEqual([hrOnly]);
		});

		it("does not serve a file whose stored sha256 or size no longer matches", async () => {
			signIn("admin");
			const { rows } = await admin.query<{ storage_key: string }>(
				"select storage_key from employee_document where id = $1",
				[bens],
			);
			const key = rows[0]?.storage_key ?? "";
			const original = harness.objects.get(key);
			if (!original) throw new Error("no object");
			const tampered = Buffer.from(original);
			tampered[tampered.length - 1] = tampered[tampered.length - 1] === 0x41 ? 0x42 : 0x41;
			harness.objects.set(key, tampered);
			expect((await download(bens)).status).toBe(503);
			harness.objects.set(key, Buffer.concat([original, Buffer.from("x")]));
			expect((await download(bens)).status).toBe(503);
			harness.objects.set(key, original);
			expect((await download(bens)).status).toBe(200);
		});

		it("serves a small preview of an image document", async () => {
			signIn("admin");
			const image = await uploadDocument({
				employeeId: ids.ben,
				metadata: { category: "other", title: "Scan", documentDate: "2026-04-01" },
				bytes: png,
				fileName: "scan.png",
			});
			const thumb = await download(image, "?variant=thumb");
			expect(thumb.status).toBe(200);
			expect(thumb.headers.get("Content-Type")).toBe("image/webp");
			expect(thumb.headers.get("Content-Security-Policy")).toBe("sandbox");
		});
	});

	describe("notifications and audit", () => {
		it("notifies the employee once per sharing, never when a document becomes HR-only", async () => {
			signIn("admin");
			const documentId = await uploadDocument({
				employeeId: ids.anna,
				metadata: { category: "other", title: "Reference letter", documentDate: "2026-05-01" },
			});
			expect(harness.notifications).toEqual([]);
			const setVisibility = (visibility: "shared" | "hr_only") =>
				actions.updateEmployeeDocumentAction({
					documentId,
					metadata: {
						category: "other",
						title: "Reference letter",
						documentDate: "2026-05-01",
						payPeriod: null,
						visibility,
						expiryDate: null,
					},
				});

			expect((await setVisibility("shared")).success).toBe(true);
			expect(harness.notifications).toEqual([
				expect.objectContaining({ userId: "t865-anna", type: "personnel_file_document_shared" }),
			]);

			// Saving again without a change shares nothing new; making it HR-only sends nothing.
			await setVisibility("shared");
			await setVisibility("hr_only");
			expect(harness.notifications).toHaveLength(1);

			// Sharing again later is a new event.
			await setVisibility("shared");
			expect(harness.notifications).toHaveLength(2);
			expect(harness.notifications[1]?.idempotencyKey).not.toBe(
				harness.notifications[0]?.idempotencyKey,
			);
		});

		it("notifies the employee of a document uploaded as shared", async () => {
			signIn("admin");
			await uploadDocument({ employeeId: ids.ben, metadata: contract("Amendment") });
			expect(harness.notifications).toEqual([
				expect.objectContaining({ userId: "t865-ben", type: "personnel_file_document_shared" }),
			]);
		});

		it("audits upload, edit, visibility change, delete and admin downloads, never the employee's own views", async () => {
			signIn("admin");
			const documentId = await uploadDocument({
				employeeId: ids.anna,
				metadata: contract("Audited contract"),
			});
			await actions.updateEmployeeDocumentAction({
				documentId,
				metadata: {
					category: "contract",
					title: "Audited contract v2",
					documentDate: "2026-03-01",
					payPeriod: null,
					visibility: "hr_only",
					expiryDate: null,
				},
			});
			await actions.updateEmployeeDocumentAction({
				documentId,
				metadata: {
					category: "contract",
					title: "Audited contract v2",
					documentDate: "2026-03-01",
					payPeriod: null,
					visibility: "shared",
					expiryDate: null,
				},
			});
			expect((await download(documentId)).status).toBe(200);
			expect((await download(documentId, "?download=1")).status).toBe(200);

			signIn("anna");
			expect((await download(documentId)).status).toBe(200);
			expect((await download(documentId, "?download=1")).status).toBe(200);

			signIn("admin");
			expect(
				await actions.deleteEmployeeDocumentAction({ documentId, reason: "Uploaded twice" }),
			).toEqual({ success: true, data: { documentId } });

			// One edit can write two records in one transaction (same timestamp), so compare as sets.
			expect((await auditActions(documentId)).sort()).toEqual(
				[
					"personnel_file.document_uploaded",
					"personnel_file.document_updated",
					"personnel_file.visibility_changed",
					"personnel_file.visibility_changed",
					"personnel_file.document_viewed",
					"personnel_file.document_downloaded",
					"personnel_file.document_deleted",
				].sort(),
			);
			const { rows } = await admin.query<{
				changes: string | null;
				metadata: string;
				performed_by: string;
			}>(
				`select changes, metadata, performed_by from audit_log
				 where entity_id = $1 and action in ('personnel_file.visibility_changed', 'personnel_file.document_deleted')
				 order by timestamp, id`,
				[documentId],
			);
			expect(JSON.parse(rows[0]?.changes ?? "{}")).toEqual({
				visibility: { from: "shared", to: "hr_only" },
			});
			expect(JSON.parse(rows[2]?.metadata ?? "{}")).toMatchObject({
				reason: "Uploaded twice",
				document: { category: "contract", title: "Audited contract v2" },
			});
			expect(rows.every((row) => row.performed_by === "t865-admin")).toBe(true);
		});
	});

	describe("feature toggle", () => {
		it("makes every page, action and download unavailable while off and restores everything when back on", async () => {
			signIn("admin");
			const documentId = await uploadDocument({
				employeeId: ids.anna,
				metadata: contract("Toggled"),
			});
			await setPersonnelFiles(ORG, false);

			expect((await download(documentId)).status).toBe(404);
			expect(await actions.getPersonnelFileAction({ employeeId: ids.anna })).toMatchObject({
				success: false,
			});
			expect((await upload({ employeeId: ids.anna, metadata: contract() })).status).toBe(404);
			expect(
				await actions.deleteEmployeeDocumentAction({ documentId, reason: null }),
			).toMatchObject({ success: false });
			signIn("anna");
			expect(await actions.getMyDocumentsAction()).toMatchObject({ success: false });
			expect((await download(documentId)).status).toBe(404);

			await setPersonnelFiles(ORG, true);
			expect((await download(documentId)).status).toBe(200);
			const mine = await actions.getMyDocumentsAction();
			expect(mine.success && mine.data.some((document) => document.id === documentId)).toBe(true);
		});
	});

	describe("storage cleanup", () => {
		async function storageKeyOf(documentId: string): Promise<string> {
			const { rows } = await admin.query<{ storage_key: string }>(
				"select storage_key from employee_document where id = $1",
				[documentId],
			);
			if (!rows[0]) throw new Error("no document");
			return rows[0].storage_key;
		}

		it("removes a deleted document's stored object", async () => {
			signIn("admin");
			const documentId = await uploadDocument({ employeeId: ids.ben, metadata: contract("Gone") });
			const key = await storageKeyOf(documentId);
			expect(harness.objects.has(key)).toBe(true);

			await actions.deleteEmployeeDocumentAction({ documentId, reason: null });

			expect(harness.objects.has(key)).toBe(false);
			const { rows } = await admin.query("select 1 from personnel_file_upload where id = $1", [
				documentId,
			]);
			expect(rows).toHaveLength(0);
		});

		it("queues the removal for retry when storage fails", async () => {
			signIn("admin");
			const documentId = await uploadDocument({ employeeId: ids.ben, metadata: contract("Retry") });
			const key = await storageKeyOf(documentId);
			harness.failDeletes = true;

			expect(
				await actions.deleteEmployeeDocumentAction({ documentId, reason: null }),
			).toMatchObject({
				success: true,
			});
			expect(harness.objects.has(key)).toBe(true);
			const { rows } = await admin.query<{ status: string; reason: string; attempts: number }>(
				"select status, reason, attempts from personnel_file_upload where id = $1",
				[documentId],
			);
			expect(rows[0]).toMatchObject({ status: "cleanup_required", reason: "removed", attempts: 1 });

			harness.failDeletes = false;
			await admin.query(
				"update personnel_file_upload set next_attempt_at = now() - interval '1 minute' where id = $1",
				[documentId],
			);
			await runPersonnelFileUploadCleanupJob();
			expect(harness.objects.has(key)).toBe(false);
		});

		it("purges every personnel file object of a hard-deleted organization", async () => {
			signIn("purgeOwner", PURGED_ORG);
			const first = await uploadDocument({ employeeId: ids.paula, metadata: contract("One") });
			const second = await uploadDocument({
				employeeId: ids.paula,
				metadata: { category: "sick_note", title: "Two", documentDate: "2026-02-01" },
			});
			const keys = [await storageKeyOf(first), await storageKeyOf(second)];
			expect(keys.every((key) => harness.objects.has(key))).toBe(true);

			await admin.query(
				"update organization set deleted_at = now() - interval '6 days' where id = $1",
				[PURGED_ORG],
			);
			const deleted = await runOrganizationCleanup();
			expect(deleted.errors).toEqual([]);
			const { rows } = await admin.query("select 1 from organization where id = $1", [PURGED_ORG]);
			expect(rows).toHaveLength(0);

			await runPersonnelFileUploadCleanupJob();
			expect(keys.some((key) => harness.objects.has(key))).toBe(false);
			const ledger = await admin.query(
				"select 1 from personnel_file_upload where organization_id = $1",
				[PURGED_ORG],
			);
			expect(ledger.rows).toHaveLength(0);
		});
	});

	it("stores the server-computed sha256 of the exact bytes", async () => {
		signIn("admin");
		const bytes = pdf("checksum");
		const documentId = await uploadDocument({ employeeId: ids.anna, metadata: contract(), bytes });
		const { rows } = await admin.query<{ checksum_sha256: string; size_bytes: number }>(
			"select checksum_sha256, size_bytes from employee_document where id = $1",
			[documentId],
		);
		expect(rows[0]).toEqual({
			checksum_sha256: createHash("sha256").update(bytes).digest("hex"),
			size_bytes: bytes.length,
		});
	});
});
