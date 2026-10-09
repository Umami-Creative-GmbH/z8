/**
 * #867: employees upload certificates and other documents into their own
 * personnel file, against a disposable PostgreSQL database. Employees use the
 * real upload route; officers and admins the real personnel file actions. The
 * session, notification delivery and object storage are replaced.
 */

import type { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t867-org",
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
	notifications: [] as CreateNotificationParams[],
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
	createNotification: async (params: CreateNotificationParams) => {
		harness.notifications.push(params);
		return null;
	},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t867-public",
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
		return { bucket: "t867-private", versionId: null };
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

const { POST: finalizeUpload } = await import("@/app/api/upload/personnel-file/route");
const actions = await import("@/app/[locale]/(app)/personnel-files/actions");
const { seedPersonnelFileOfficerGrant } = await import("./testing/officer-grant.test.fixture");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ORG = "t867-org";

const ids = {
	owner: "e8670000-0000-4000-8000-000000000001",
	admin: "e8670000-0000-4000-8000-000000000002",
	officer: "e8670000-0000-4000-8000-000000000003",
	anna: "e8670000-0000-4000-8000-000000000004",
	ben: "e8670000-0000-4000-8000-000000000005",
	leaver: "e8670000-0000-4000-8000-000000000006",
	berlin: "e8671000-0000-4000-8000-000000000001",
	munich: "e8671000-0000-4000-8000-000000000002",
} as const;
type Person = Exclude<keyof typeof ids, "berlin" | "munich">;
const userOf = (person: Person) => `t867-${person}`;

const admin = integrationAdminPool();
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF`);

async function cleanup() {
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query("delete from personnel_file_upload where organization_id = $1", [ORG]);
	await admin.query('delete from "user" where id like $1', ["t867-%"]);
}

async function seedPerson(
	person: Person,
	displayName: string,
	memberRole: string,
	options: { teamId?: string | null; isActive?: boolean } = {},
) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
		[userOf(person), displayName, `${userOf(person)}@example.test`],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
		[`t867-member-${person}`, ORG, userOf(person), memberRole],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,team_id,is_active,updated_at) values ($1,$2,$3,'employee',$4,$5,now())",
		[ids[person], userOf(person), ORG, options.teamId ?? null, options.isActive ?? true],
	);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, personnel_files_enabled, created_at)
		 values ($1, $1, $1, 'Europe/Berlin', true, now())`,
		[ORG],
	);
	for (const [id, name] of [
		[ids.berlin, "Berlin"],
		[ids.munich, "Munich"],
	] as const) {
		await admin.query(
			"insert into team (id, organization_id, name, updated_at) values ($1, $2, $3, now())",
			[id, ORG, name],
		);
	}
	await seedPerson("owner", "Olga Owner", "owner");
	await seedPerson("admin", "Adam Admin", "admin");
	await seedPerson("officer", "Otto Officer", "member");
	await seedPerson("anna", "Anna Example", "member", { teamId: ids.berlin });
	await seedPerson("ben", "Ben Example", "member", { teamId: ids.munich });
	await seedPerson("leaver", "Lea Leaver", "member", { isActive: false });
	// Otto covers Berlin's certificates only.
	await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.officer,
		createdBy: userOf("owner"),
		teamIds: [ids.berlin],
		categories: ["certificate"],
	});
}

function signIn(person: Person) {
	harness.userId = userOf(person);
	harness.organizationId = ORG;
}

async function upload(input: {
	employeeId: string;
	source?: "own";
	metadata: Record<string, unknown>;
}) {
	if (!harness.userId) throw new Error("not signed in");
	const tusFileKey = createOwnedTusFileKey(harness.userId);
	harness.tus.set(tusFileKey, pdf(JSON.stringify(input.metadata)));
	return finalizeUpload(
		new Request("http://localhost/api/upload/personnel-file", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tusFileKey,
				employeeId: input.employeeId,
				fileName: "document.pdf",
				...(input.source ? { source: input.source } : {}),
				metadata: input.metadata,
			}),
		}) as unknown as NextRequest,
	);
}

async function uploadOwn(employeeId: string, metadata: Record<string, unknown>): Promise<string> {
	const response = await upload({ employeeId, source: "own", metadata });
	const body = (await response.json()) as { document?: { id: string }; error?: string };
	if (response.status !== 200 || !body.document) {
		throw new Error(`upload failed: ${response.status} ${body.error}`);
	}
	return body.document.id;
}

const certificate = {
	category: "certificate",
	title: "First aid course",
	documentDate: "2026-09-01",
	expiryDate: "2028-08-31",
};

function notified(documentId: string) {
	return harness.notifications
		.filter((notification) => notification.entityId === documentId)
		.map((notification) => ({
			userId: notification.userId,
			type: notification.type,
			message: notification.message,
			actionUrl: notification.actionUrl,
		}))
		.toSorted((a, b) => a.userId.localeCompare(b.userId));
}

describe("employee uploads (#867)", () => {
	beforeAll(seed);
	afterAll(async () => {
		await cleanup();
		await admin.end();
	});
	beforeEach(async () => {
		harness.notifications.length = 0;
		await admin.query("update organization set personnel_files_enabled = true where id = $1", [
			ORG,
		]);
	});

	it("puts an employee's certificate with expiry date in their file as shared", async () => {
		signIn("anna");
		const documentId = await uploadOwn(ids.anna, certificate);

		const mine = await actions.getMyDocumentsAction();
		if (!mine.success) throw new Error(mine.error);
		expect(mine.data.find((document) => document.id === documentId)).toMatchObject({
			category: "certificate",
			title: "First aid course",
			documentDate: "2026-09-01",
			expiryDate: "2028-08-31",
			visibility: "shared",
		});

		signIn("officer");
		const file = await actions.getPersonnelFileAction({ employeeId: ids.anna });
		if (!file.success) throw new Error(file.error);
		expect(file.data.documents.find((document) => document.id === documentId)).toMatchObject({
			visibility: "shared",
			expiryDate: "2028-08-31",
		});
	});

	it("keeps an employee's other document shared even when another visibility is sent", async () => {
		signIn("anna");
		const documentId = await uploadOwn(ids.anna, {
			category: "other",
			title: "Language course",
			documentDate: "2026-08-15",
			visibility: "hr_only",
		});
		const mine = await actions.getMyDocumentsAction();
		if (!mine.success) throw new Error(mine.error);
		expect(mine.data.find((document) => document.id === documentId)?.visibility).toBe("shared");
	});

	it("audits the upload with the employee as actor", async () => {
		signIn("anna");
		const documentId = await uploadOwn(ids.anna, certificate);
		const { rows } = await admin.query<{
			action: string;
			performed_by: string;
			employee_id: string;
			metadata: string;
		}>(
			"select action, performed_by, employee_id, metadata from audit_log where entity_type = 'employee_document' and entity_id = $1",
			[documentId],
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			action: "personnel_file.document_uploaded",
			performed_by: userOf("anna"),
			employee_id: ids.anna,
		});
		expect(JSON.parse(rows[0]?.metadata ?? "{}")).toMatchObject({
			source: "employee",
			document: { category: "certificate", visibility: "shared" },
		});
	});

	describe("notifications", () => {
		it("notifies the officers covering the employee and category", async () => {
			signIn("anna");
			const documentId = await uploadOwn(ids.anna, certificate);
			expect(notified(documentId)).toEqual([
				{
					userId: userOf("officer"),
					type: "personnel_file_employee_upload",
					message: "Anna Example uploaded a certificate",
					actionUrl: `/personnel-files/${ids.anna}`,
				},
			]);
		});

		it("notifies owners and admins when no officer covers the category", async () => {
			signIn("anna");
			const documentId = await uploadOwn(ids.anna, {
				category: "other",
				title: "Training plan",
				documentDate: "2026-09-01",
			});
			expect(notified(documentId).map((notification) => notification.userId)).toEqual(
				[userOf("admin"), userOf("owner")].toSorted(),
			);
			expect(notified(documentId)[0]?.message).toBe("Anna Example uploaded a document");
		});

		it("notifies owners and admins when no officer covers the employee", async () => {
			signIn("ben");
			const documentId = await uploadOwn(ids.ben, { ...certificate, title: "Forklift licence" });
			expect(notified(documentId).map((notification) => notification.userId)).toEqual(
				[userOf("admin"), userOf("owner")].toSorted(),
			);
		});

		it("does not tell the employee about their own upload", async () => {
			signIn("anna");
			const documentId = await uploadOwn(ids.anna, certificate);
			expect(notified(documentId).map((notification) => notification.userId)).not.toContain(
				userOf("anna"),
			);
		});
	});

	describe("server refusals", () => {
		it("refuses employee uploads as contract, payslip or sick note", async () => {
			signIn("anna");
			for (const metadata of [
				{ category: "contract", title: "Contract", documentDate: "2026-01-01" },
				{
					category: "payslip",
					title: "Payslip",
					documentDate: "2026-01-28",
					payPeriod: { year: 2026, month: 1 },
				},
				{ category: "sick_note", title: "Sick note", documentDate: "2026-02-02" },
			]) {
				const response = await upload({ employeeId: ids.anna, source: "own", metadata });
				expect(response.status).toBe(403);
			}
			const { rows } = await admin.query(
				"select id from employee_document where organization_id = $1 and employee_id = $2 and category in ('contract','payslip','sick_note')",
				[ORG, ids.anna],
			);
			expect(rows).toEqual([]);
		});

		it("refuses employee uploads into another employee's file", async () => {
			signIn("anna");
			expect(
				(await upload({ employeeId: ids.ben, source: "own", metadata: certificate })).status,
			).toBe(404);
			// Nor as a manager, without a grant.
			expect((await upload({ employeeId: ids.ben, metadata: certificate })).status).toBe(404);
		});

		it("refuses former employees and everyone while personnel files are off", async () => {
			signIn("leaver");
			expect(
				(await upload({ employeeId: ids.leaver, source: "own", metadata: certificate })).status,
			).toBe(404);
			await admin.query("update organization set personnel_files_enabled = false where id = $1", [
				ORG,
			]);
			signIn("anna");
			expect(
				(await upload({ employeeId: ids.anna, source: "own", metadata: certificate })).status,
			).toBe(404);
		});
	});

	describe("afterwards", () => {
		const edited = {
			category: "certificate" as const,
			title: "First aid course (renewed)",
			documentDate: "2026-09-01",
			payPeriod: null,
			visibility: "hr_only" as const,
			expiryDate: "2028-08-31",
		};

		it("lets the employee neither edit nor delete the document", async () => {
			signIn("anna");
			const documentId = await uploadOwn(ids.anna, certificate);
			expect(
				await actions.updateEmployeeDocumentAction({ documentId, metadata: edited }),
			).toMatchObject({ success: false, error: "Document not found" });
			expect(
				await actions.deleteEmployeeDocumentAction({ documentId, reason: null }),
			).toMatchObject({ success: false });
			const { rows } = await admin.query("select title from employee_document where id = $1", [
				documentId,
			]);
			expect(rows).toEqual([{ title: "First aid course" }]);
		});

		it("lets a covering officer edit its metadata and visibility and delete it", async () => {
			signIn("anna");
			const documentId = await uploadOwn(ids.anna, certificate);
			signIn("officer");
			expect(
				await actions.updateEmployeeDocumentAction({ documentId, metadata: edited }),
			).toMatchObject({
				success: true,
				data: { title: "First aid course (renewed)", visibility: "hr_only" },
			});
			signIn("anna");
			const mine = await actions.getMyDocumentsAction();
			if (!mine.success) throw new Error(mine.error);
			expect(mine.data.map((document) => document.id)).not.toContain(documentId);

			signIn("officer");
			expect(
				await actions.deleteEmployeeDocumentAction({ documentId, reason: "Duplicate" }),
			).toMatchObject({ success: true });
		});

		it("lets an admin delete it", async () => {
			signIn("anna");
			const documentId = await uploadOwn(ids.anna, {
				category: "other",
				title: "Misc",
				documentDate: "2026-09-01",
			});
			signIn("admin");
			expect(
				await actions.deleteEmployeeDocumentAction({ documentId, reason: null }),
			).toMatchObject({ success: true });
		});
	});
});
