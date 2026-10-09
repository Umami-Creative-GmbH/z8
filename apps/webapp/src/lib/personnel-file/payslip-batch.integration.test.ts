/**
 * #868: payslip batches matched by personnel number, against a disposable
 * PostgreSQL database. Files are staged through the real upload route and
 * matched, fixed and confirmed through the real server actions. The session,
 * notification delivery and object storage are replaced.
 */

import type { NextRequest } from "next/server";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t868-org",
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
	failCopy: false,
	notifications: [] as Array<{
		userId: string;
		type: string;
		entityId?: string;
		idempotencyKey?: string;
	}>,
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
	createNotification: async (params: {
		userId: string;
		type: string;
		entityId?: string;
		idempotencyKey?: string;
	}) => {
		harness.notifications.push({
			userId: params.userId,
			type: params.type,
			entityId: params.entityId,
			idempotencyKey: params.idempotencyKey,
		});
		return null;
	},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t868-public",
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
		return { bucket: "t868-private", versionId: null };
	},
	async copyPrivateObject(input: { sourceKey: string; targetKey: string }) {
		if (harness.failCopy) throw new Error("copy failed");
		const bytes = harness.objects.get(input.sourceKey);
		if (!bytes) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
		harness.objects.set(input.targetKey, Buffer.from(bytes));
		return { bucket: "t868-private", versionId: null };
	},
	async readPrivateObject(input: { key: string }) {
		const bytes = harness.objects.get(input.key);
		if (!bytes) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
		return new Uint8Array(bytes);
	},
	async deletePrivateObject(input: { key: string }) {
		harness.objects.delete(input.key);
	},
	async deletePrivateObjectVersions(input: { key: string }) {
		harness.objects.delete(input.key);
	},
	async privateObjectExists(input: { key: string }) {
		return harness.objects.has(input.key);
	},
}));

const { db } = await import("@/db");
const { POST: stageFile } = await import("@/app/api/upload/personnel-file/payslip-batch/route");
const { GET: getDocument } = await import("@/app/api/personnel-files/documents/[documentId]/route");
const actions = await import("@/app/[locale]/(app)/personnel-files/payslip-batches/actions");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
const { runPersonnelFileCleanup } = await import("./upload-ledger");
const { deletePersonnelDocumentObject } = await import("./storage");
const { deleteAbandonedPayslipBatches } = await import("./payslip-batch-store");
const { seedPersonnelFileOfficerGrant } = await import("./testing/officer-grant.test.fixture");

const ORG = "t868-org";

const ids = {
	owner: "e8680000-0000-4000-8000-000000000001",
	officer: "e8680000-0000-4000-8000-000000000002",
	contractOfficer: "e8680000-0000-4000-8000-000000000003",
	anna: "e8680000-0000-4000-8000-000000000004",
	ben: "e8680000-0000-4000-8000-000000000005",
	carla: "e8680000-0000-4000-8000-000000000006",
	dora: "e8680000-0000-4000-8000-000000000007",
	eve: "e8680000-0000-4000-8000-000000000008",
	nina: "e8680000-0000-4000-8000-000000000009",
	berlin: "e8681000-0000-4000-8000-000000000001",
} as const;
type Person = Exclude<keyof typeof ids, "berlin">;

const admin = integrationAdminPool();
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF`);

async function cleanup() {
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query("delete from personnel_file_upload where organization_id = $1", [ORG]);
	await admin.query('delete from "user" where id like $1', ["t868-%"]);
}

async function seedPerson(
	name: Person,
	memberRole: string,
	options: { personnelNumber?: string | null; teamId?: string | null } = {},
) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
		[`t868-${name}`, name, `t868-${name}@example.test`],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
		[`t868-member-${name}`, ORG, `t868-${name}`, memberRole],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,team_id,employee_number,is_active,updated_at) values ($1,$2,$3,'employee',$4,$5,true,now())",
		[ids[name], `t868-${name}`, ORG, options.teamId ?? null, options.personnelNumber ?? null],
	);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, personnel_files_enabled, created_at)
		 values ($1, $1, $1, 'Europe/Berlin', true, now())`,
		[ORG],
	);
	await admin.query(
		"insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Berlin', now())",
		[ids.berlin, ORG],
	);
	await seedPerson("owner", "owner");
	await seedPerson("officer", "member");
	await seedPerson("contractOfficer", "member");
	await seedPerson("anna", "member", { personnelNumber: "0042", teamId: ids.berlin });
	await seedPerson("ben", "member", { personnelNumber: "00421", teamId: ids.berlin });
	await seedPerson("carla", "member", { personnelNumber: "7777", teamId: ids.berlin });
	await seedPerson("dora", "member", { personnelNumber: " 7777 ", teamId: ids.berlin });
	// Outside the officer's team.
	await seedPerson("eve", "member", { personnelNumber: "0500" });
	await seedPerson("nina", "member", { personnelNumber: null, teamId: ids.berlin });
	await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.officer,
		createdBy: "t868-owner",
		categories: ["payslip", "contract"],
		teamIds: [ids.berlin],
	});
	await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.contractOfficer,
		createdBy: "t868-owner",
		categories: ["contract"],
		scope: "all",
	});
}

function signIn(name: Person) {
	harness.userId = `t868-${name}`;
	harness.organizationId = ORG;
}

async function startBatch(
	input: { year?: number; month?: number; visibility?: "shared" | "hr_only" } = {},
): Promise<string> {
	const result = await actions.startPayslipBatchAction({
		payPeriod: { year: input.year ?? 2026, month: input.month ?? 9 },
		visibility: input.visibility ?? "shared",
	});
	if (!result.success) throw new Error(`start failed: ${result.error}`);
	return result.data.id;
}

function stage(batchId: string, fileName: string, bytes: Buffer = pdf(fileName)) {
	if (!harness.userId) throw new Error("not signed in");
	const tusFileKey = createOwnedTusFileKey(harness.userId);
	harness.tus.set(tusFileKey, bytes);
	return stageFile(
		new Request("http://localhost/api/upload/personnel-file/payslip-batch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ batchId, tusFileKey, fileName }),
		}) as unknown as NextRequest,
	);
}

async function stageOk(batchId: string, fileName: string): Promise<string> {
	const response = await stage(batchId, fileName);
	const body = (await response.json()) as { file?: { id: string }; error?: string };
	if (response.status !== 200 || !body.file) {
		throw new Error(`staging failed: ${response.status} ${body.error}`);
	}
	return body.file.id;
}

async function preview(batchId: string) {
	const result = await actions.getPayslipBatchAction({ batchId });
	if (!result.success) throw new Error(`preview failed: ${result.error}`);
	return result.data;
}

async function fileOf(batchId: string, fileId: string) {
	const file = (await preview(batchId)).files.find((entry) => entry.id === fileId);
	if (!file) throw new Error("file not in preview");
	return file;
}

async function payslipsOf(employeeId: string) {
	const { rows } = await admin.query<{
		id: string;
		title: string;
		document_date: string;
		pay_period_year: number;
		pay_period_month: number;
		visibility: string;
	}>(
		`select id, title, to_char(document_date, 'YYYY-MM-DD') as document_date, pay_period_year,
		 pay_period_month, visibility
		 from employee_document where organization_id = $1 and employee_id = $2 and category = 'payslip'
		 order by created_at, id`,
		[ORG, employeeId],
	);
	return rows;
}

async function documentCount(): Promise<number> {
	const { rows } = await admin.query<{ count: number }>(
		"select count(*)::int as count from employee_document where organization_id = $1",
		[ORG],
	);
	return rows[0]?.count ?? 0;
}

async function resetDocuments() {
	await admin.query("delete from employee_document where organization_id = $1", [ORG]);
	await admin.query("delete from payslip_batch where organization_id = $1", [ORG]);
	await admin.query("delete from personnel_file_upload where organization_id = $1", [ORG]);
	await admin.query("delete from audit_log where organization_id = $1", [ORG]);
	harness.objects.clear();
}

describe("payslip batches matched by personnel number (#868)", () => {
	beforeAll(seed);
	afterAll(async () => {
		await cleanup();
		await admin.end();
	});
	beforeEach(async () => {
		harness.notifications.length = 0;
		harness.failCopy = false;
		await resetDocuments();
		await admin.query("update employee set team_id = $2 where id = $1", [ids.ben, ids.berlin]);
	});

	describe("starting a batch", () => {
		it("refuses an officer whose grant does not include payslips", async () => {
			signIn("contractOfficer");
			const result = await actions.startPayslipBatchAction({
				payPeriod: { year: 2026, month: 9 },
				visibility: "shared",
			});
			expect(result.success).toBe(false);

			signIn("officer");
			const batchId = await startBatch();
			signIn("contractOfficer");
			expect((await stage(batchId, "0042.pdf")).status).toBe(404);
			expect((await actions.getPayslipBatchAction({ batchId })).success).toBe(false);
		});

		it("shows a batch only to whoever started it", async () => {
			signIn("officer");
			const batchId = await startBatch();
			signIn("owner");
			expect((await actions.getPayslipBatchAction({ batchId })).success).toBe(false);
			expect((await stage(batchId, "0042.pdf")).status).toBe(404);
		});

		it("takes PDF files only", async () => {
			signIn("officer");
			const batchId = await startBatch();
			// A 1x1 PNG.
			const png = Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
				"base64",
			);
			expect((await stage(batchId, "0042.png", png)).status).toBe(400);
		});
	});

	describe("matching", () => {
		it("matches the whole personnel number token, never part of a longer number", async () => {
			signIn("officer");
			const batchId = await startBatch();
			const annaFile = await stageOk(batchId, "0042_payslip.pdf");
			const benFile = await stageOk(batchId, "00421_payslip.pdf");
			expect(await fileOf(batchId, annaFile)).toMatchObject({
				matchKind: "matched",
				employeeId: ids.anna,
			});
			expect(await fileOf(batchId, benFile)).toMatchObject({
				matchKind: "matched",
				employeeId: ids.ben,
			});
		});

		it("makes a number two employees share ambiguous, to be assigned by hand", async () => {
			signIn("officer");
			const batchId = await startBatch();
			const fileId = await stageOk(batchId, "7777.pdf");
			expect(await fileOf(batchId, fileId)).toMatchObject({
				matchKind: "ambiguous",
				matchedEmployeeIds: [ids.carla, ids.dora].sort(),
				employeeId: null,
			});
			const refused = await actions.confirmPayslipBatchAction({ batchId });
			expect(refused).toMatchObject({ success: false, code: "unresolved_files" });

			expect(
				(
					await actions.updatePayslipBatchFileAction({
						batchId,
						fileId,
						assignedEmployeeId: ids.dora,
					})
				).success,
			).toBe(true);
			expect(await fileOf(batchId, fileId)).toMatchObject({ employeeId: ids.dora });
			expect((await actions.confirmPayslipBatchAction({ batchId })).success).toBe(true);
			expect(await payslipsOf(ids.dora)).toHaveLength(1);
			expect(await payslipsOf(ids.carla)).toHaveLength(0);
		});

		it("leaves a file of an out-of-scope employee unmatched for the officer", async () => {
			signIn("officer");
			const batchId = await startBatch();
			const fileId = await stageOk(batchId, "0500_payslip.pdf");
			expect(await fileOf(batchId, fileId)).toMatchObject({ matchKind: "unmatched" });
			// Nor can the officer assign it to that employee by hand.
			const assigned = await actions.updatePayslipBatchFileAction({
				batchId,
				fileId,
				assignedEmployeeId: ids.eve,
			});
			expect(assigned.success).toBe(false);
			expect((await preview(batchId)).employees.map((employee) => employee.id)).not.toContain(
				ids.eve,
			);

			signIn("owner");
			const ownerBatch = await startBatch();
			const ownerFile = await stageOk(ownerBatch, "0500_payslip.pdf");
			expect(await fileOf(ownerBatch, ownerFile)).toMatchObject({
				matchKind: "matched",
				employeeId: ids.eve,
			});
		});

		it("lets the officer assign a file of an employee without a personnel number, or drop it", async () => {
			signIn("officer");
			const batchId = await startBatch();
			const ninaFile = await stageOk(batchId, "payslip-nina.pdf");
			const strayFile = await stageOk(batchId, "cover-letter.pdf");
			expect(await fileOf(batchId, ninaFile)).toMatchObject({ matchKind: "unmatched" });
			await actions.updatePayslipBatchFileAction({
				batchId,
				fileId: ninaFile,
				assignedEmployeeId: ids.nina,
			});
			await actions.updatePayslipBatchFileAction({ batchId, fileId: strayFile, included: false });
			const confirmed = await actions.confirmPayslipBatchAction({ batchId });
			expect(confirmed.success && confirmed.data.created.map((file) => file.fileId)).toEqual([
				ninaFile,
			]);
			expect(await payslipsOf(ids.nina)).toHaveLength(1);
			expect(await documentCount()).toBe(1);
		});
	});

	describe("confirmation", () => {
		it("stores nothing as an employee document before confirmation", async () => {
			signIn("officer");
			const batchId = await startBatch();
			await stageOk(batchId, "0042_payslip.pdf");
			await stageOk(batchId, "00421_payslip.pdf");
			expect(await documentCount()).toBe(0);
			expect(harness.objects.size).toBe(2);
			const { rows } = await admin.query<{ status: string; employee_id: string | null }>(
				"select status, employee_id from personnel_file_upload where organization_id = $1 and batch_id = $2",
				[ORG, batchId],
			);
			expect(rows).toEqual([
				{ status: "pending", employee_id: null },
				{ status: "pending", employee_id: null },
			]);
		});

		it("creates a payslip per included file with the batch's pay period and visibility", async () => {
			signIn("officer");
			const batchId = await startBatch({ visibility: "hr_only" });
			const fileId = await stageOk(batchId, "Lohn 2026-09 0042.pdf");
			const result = await actions.confirmPayslipBatchAction({ batchId });
			expect(result).toMatchObject({
				success: true,
				data: { batch: { status: "confirmed" }, failed: [] },
			});
			const today = Temporal.Now.plainDateISO("Europe/Berlin").toString();
			expect(await payslipsOf(ids.anna)).toEqual([
				{
					id: fileId,
					title: "Lohn 2026-09 0042.pdf",
					document_date: today,
					pay_period_year: 2026,
					pay_period_month: 9,
					visibility: "hr_only",
				},
			]);
			// The stored object is served from the document.
			const response = await getDocument(
				new Request(
					`http://localhost/api/personnel-files/documents/${fileId}`,
				) as unknown as NextRequest,
				{ params: Promise.resolve({ documentId: fileId }) },
			);
			expect(response.status).toBe(200);
			// An HR-only batch notifies nobody.
			expect(harness.notifications).toEqual([]);
			// No staged files are added after confirmation.
			expect((await stage(batchId, "00421.pdf")).status).toBe(409);
		});

		it("stores a confirmed payslip under the employee's key and cleans up the staged object", async () => {
			signIn("officer");
			const batchId = await startBatch();
			const fileId = await stageOk(batchId, "0042.pdf");
			const [stagedKey] = [...harness.objects.keys()];
			expect(stagedKey).toContain(`/payslip-batches/${batchId}/`);
			await actions.confirmPayslipBatchAction({ batchId });

			const { rows } = await admin.query<{ storage_key: string }>(
				"select storage_key from employee_document where organization_id = $1 and id = $2",
				[ORG, fileId],
			);
			const documentKey = rows[0]?.storage_key ?? "";
			expect(documentKey.startsWith(`personnel-files/${ORG}/${ids.anna}/${fileId}-`)).toBe(true);

			const cleaned = await runPersonnelFileCleanup(db, {
				deleteObject: deletePersonnelDocumentObject,
			});
			expect(cleaned.deleted).toBe(1);
			expect([...harness.objects.keys()]).toEqual([documentKey]);
			expect(harness.objects.get(documentKey)).toEqual(pdf("0042.pdf"));

			// Deleting the document later still hands its own object to cleanup.
			await admin.query("delete from employee_document where id = $1", [fileId]);
			await runPersonnelFileCleanup(db, { deleteObject: deletePersonnelDocumentObject });
			expect(harness.objects.size).toBe(0);
		});

		it("keeps the staged file when storing the payslip fails, and confirms it on retry", async () => {
			signIn("officer");
			const batchId = await startBatch();
			const fileId = await stageOk(batchId, "0042.pdf");
			harness.failCopy = true;
			const first = await actions.confirmPayslipBatchAction({ batchId });
			expect(first).toMatchObject({
				success: true,
				data: { created: [], failed: [{ fileId, failure: "error" }] },
			});
			expect(await documentCount()).toBe(0);
			// The failed copy is cleaned up; the staged object stays.
			await runPersonnelFileCleanup(db, { deleteObject: deletePersonnelDocumentObject });
			expect(await fileOf(batchId, fileId)).toMatchObject({ state: "failed" });

			harness.failCopy = false;
			const retry = await actions.confirmPayslipBatchAction({ batchId });
			expect(retry).toMatchObject({
				success: true,
				data: { created: [{ fileId }], failed: [] },
			});
			expect(await payslipsOf(ids.anna)).toHaveLength(1);
			await runPersonnelFileCleanup(db, { deleteObject: deletePersonnelDocumentObject });
			expect([...harness.objects.keys()]).toEqual([
				expect.stringMatching(new RegExp(`^personnel-files/${ORG}/${ids.anna}/`)),
			]);
		});

		it("flags an employee who already has a payslip for the pay period and keeps both", async () => {
			signIn("officer");
			const first = await startBatch();
			await stageOk(first, "0042.pdf");
			await actions.confirmPayslipBatchAction({ batchId: first });

			const second = await startBatch();
			const correction = await stageOk(second, "0042_corrected.pdf");
			const other = await stageOk(second, "00421.pdf");
			expect(await fileOf(second, correction)).toMatchObject({
				alreadyHasPayslip: true,
				included: true,
			});
			expect(await fileOf(second, other)).toMatchObject({ alreadyHasPayslip: false });
			// Another pay period is no duplicate.
			const october = await startBatch({ month: 10 });
			const octoberFile = await stageOk(october, "0042.pdf");
			expect(await fileOf(october, octoberFile)).toMatchObject({ alreadyHasPayslip: false });

			await actions.confirmPayslipBatchAction({ batchId: second });
			expect(await payslipsOf(ids.anna)).toHaveLength(2);
		});

		it("creates no duplicates when a confirmation is retried after a partial failure", async () => {
			signIn("officer");
			const batchId = await startBatch();
			const annaFile = await stageOk(batchId, "0042.pdf");
			const benFile = await stageOk(batchId, "00421.pdf");
			// Ben leaves the officer's team before confirmation.
			await admin.query("update employee set team_id = null where id = $1", [ids.ben]);

			const first = await actions.confirmPayslipBatchAction({ batchId });
			expect(first).toMatchObject({
				success: true,
				data: {
					created: [{ fileId: annaFile, employeeId: ids.anna }],
					failed: [{ fileId: benFile, failure: "out_of_scope" }],
				},
			});
			expect(await fileOf(batchId, benFile)).toMatchObject({ state: "failed" });

			await admin.query("update employee set team_id = $2 where id = $1", [ids.ben, ids.berlin]);
			const retry = await actions.confirmPayslipBatchAction({ batchId });
			expect(retry).toMatchObject({
				success: true,
				data: { created: [{ fileId: benFile }], failed: [] },
			});
			const again = await actions.confirmPayslipBatchAction({ batchId });
			expect(again).toMatchObject({ success: true, data: { created: [], failed: [] } });

			expect(await payslipsOf(ids.anna)).toHaveLength(1);
			expect(await payslipsOf(ids.ben)).toHaveLength(1);
			expect(await documentCount()).toBe(2);
			expect((await preview(batchId)).files.map((file) => file.state)).toEqual([
				"created",
				"created",
			]);
		});

		it("notifies each employee once per shared batch, however many files are theirs", async () => {
			signIn("officer");
			const batchId = await startBatch();
			await stageOk(batchId, "0042.pdf");
			await stageOk(batchId, "0042_supplement.pdf");
			const benFile = await stageOk(batchId, "00421.pdf");
			await admin.query("update employee set team_id = null where id = $1", [ids.ben]);
			await actions.confirmPayslipBatchAction({ batchId });
			await admin.query("update employee set team_id = $2 where id = $1", [ids.ben, ids.berlin]);
			await actions.confirmPayslipBatchAction({ batchId });
			await actions.confirmPayslipBatchAction({ batchId });

			expect(await payslipsOf(ids.anna)).toHaveLength(2);
			expect(await payslipsOf(ids.ben)).toHaveLength(1);
			expect(harness.notifications.map((entry) => entry.userId).sort()).toEqual([
				"t868-anna",
				"t868-ben",
			]);
			expect(harness.notifications).toContainEqual({
				userId: "t868-anna",
				type: "personnel_file_document_shared",
				entityId: batchId,
				idempotencyKey: `personnel-file-payslip-batch:${batchId}:t868-anna`,
			});
			expect(benFile).toBeTruthy();
		});

		it("audits every created document and one batch summary per confirmation", async () => {
			signIn("officer");
			const batchId = await startBatch();
			const annaFile = await stageOk(batchId, "0042.pdf");
			const benFile = await stageOk(batchId, "00421.pdf");
			const dropped = await stageOk(batchId, "unknown.pdf");
			await actions.updatePayslipBatchFileAction({ batchId, fileId: dropped, included: false });
			await actions.confirmPayslipBatchAction({ batchId });

			const { rows } = await admin.query<{
				entity_type: string;
				entity_id: string;
				action: string;
				performed_by: string;
				metadata: string;
			}>(
				"select entity_type, entity_id, action, performed_by, metadata from audit_log where organization_id = $1 order by entity_type, entity_id",
				[ORG],
			);
			expect(
				rows
					.filter((row) => row.entity_type === "employee_document")
					.map((row) => [row.entity_id, row.action])
					.sort(),
			).toEqual(
				[
					[annaFile, "personnel_file.document_uploaded"],
					[benFile, "personnel_file.document_uploaded"],
				].sort(),
			);
			const summaries = rows.filter((row) => row.entity_type === "payslip_batch");
			expect(summaries).toHaveLength(1);
			expect(summaries[0]).toMatchObject({
				entity_id: batchId,
				action: "personnel_file.payslip_batch_confirmed",
				performed_by: "t868-officer",
			});
			expect(JSON.parse(summaries[0]?.metadata ?? "{}")).toMatchObject({
				payPeriod: { year: 2026, month: 9 },
				created: 2,
				failed: 0,
				dropped: 1,
			});
		});
	});

	describe("cleanup", () => {
		it("cleans up staged files that are never confirmed, after a day", async () => {
			signIn("officer");
			const batchId = await startBatch();
			const fileId = await stageOk(batchId, "0042.pdf");
			const now = Temporal.Instant.fromEpochMilliseconds(Date.now());

			const early = await runPersonnelFileCleanup(db, {
				deleteObject: deletePersonnelDocumentObject,
				now: now.add({ hours: 2 }),
			});
			expect(early.deleted).toBe(0);
			expect(harness.objects.size).toBe(1);

			const late = await runPersonnelFileCleanup(db, {
				deleteObject: deletePersonnelDocumentObject,
				now: now.add({ hours: 25 }),
			});
			expect(late.deleted).toBe(1);
			expect(harness.objects.size).toBe(0);
			expect(await fileOf(batchId, fileId)).toMatchObject({ state: "expired" });

			const confirmed = await actions.confirmPayslipBatchAction({ batchId });
			expect(confirmed).toMatchObject({
				success: true,
				data: { created: [], failed: [{ fileId, failure: "expired" }] },
			});
			expect(await documentCount()).toBe(0);

			signIn("officer");
			const abandoned = await startBatch();
			await stageOk(abandoned, "00421.pdf");
			expect(await deleteAbandonedPayslipBatches(db, now.add({ hours: 49 }))).toBe(1);
			expect((await actions.getPayslipBatchAction({ batchId: abandoned })).success).toBe(false);
		});

		it("releases dropped files once every included file is a document", async () => {
			signIn("officer");
			const batchId = await startBatch();
			await stageOk(batchId, "0042.pdf");
			const dropped = await stageOk(batchId, "unknown.pdf");
			await actions.updatePayslipBatchFileAction({ batchId, fileId: dropped, included: false });
			await actions.confirmPayslipBatchAction({ batchId });

			const result = await runPersonnelFileCleanup(db, {
				deleteObject: deletePersonnelDocumentObject,
			});
			// The dropped file and the confirmed file's staged object; the document's copy stays.
			expect(result.deleted).toBe(2);
			expect(harness.objects.size).toBe(1);
			expect(await documentCount()).toBe(1);
		});
	});
});
