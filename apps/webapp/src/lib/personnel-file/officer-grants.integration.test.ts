/**
 * #866: personnel file officer grants against a disposable PostgreSQL
 * database. Grants are saved and revoked through the real settings actions;
 * officers then use the real upload and download routes and the personnel
 * file actions. The session, notification delivery and object storage are
 * replaced.
 */

import type { NextRequest } from "next/server";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t866-org",
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
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
	createNotification: async () => null,
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t866-public",
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
		return { bucket: "t866-private", versionId: null };
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
const { POST: finalizeUpload } = await import("@/app/api/upload/personnel-file/route");
const { GET: getDocument } = await import("@/app/api/personnel-files/documents/[documentId]/route");
const actions = await import("@/app/[locale]/(app)/personnel-files/actions");
const officerActions = await import(
	"@/app/[locale]/(app)/settings/personnel-files/officer-actions"
);
const { resolvePersonnelFileAccess, listManagedEmployees } = await import("./access-store");
const { listPersonnelFileNotificationRecipients } = await import("./notification-recipients");
const { listExpiringDocuments } = await import("./expiry-store");
const { seedPersonnelFileOfficerGrant, deactivateSeededPersonnelFileOfficerGrant } = await import(
	"./testing/officer-grant.test.fixture"
);
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ORG = "t866-org";

const ids = {
	owner: "e8660000-0000-4000-8000-000000000001",
	admin: "e8660000-0000-4000-8000-000000000002",
	officer: "e8660000-0000-4000-8000-000000000003",
	anna: "e8660000-0000-4000-8000-000000000004",
	ben: "e8660000-0000-4000-8000-000000000005",
	carla: "e8660000-0000-4000-8000-000000000006",
	payroll: "e8660000-0000-4000-8000-000000000007",
	leaver: "e8660000-0000-4000-8000-000000000008",
	second: "e8660000-0000-4000-8000-000000000009",
	berlin: "e8661000-0000-4000-8000-000000000001",
	munich: "e8661000-0000-4000-8000-000000000002",
} as const;
type Person = Exclude<keyof typeof ids, "berlin" | "munich">;
const userOf = (person: Person) => `t866-${person}`;

const admin = integrationAdminPool();
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF`);

async function cleanup() {
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query("delete from personnel_file_upload where organization_id = $1", [ORG]);
	await admin.query('delete from "user" where id like $1', ["t866-%"]);
}

async function seedPerson(
	name: Person,
	memberRole: string,
	options: { teamId?: string | null; isActive?: boolean } = {},
) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
		[userOf(name), name, `${userOf(name)}@example.test`],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
		[`t866-member-${name}`, ORG, userOf(name), memberRole],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,team_id,is_active,updated_at) values ($1,$2,$3,'employee',$4,$5,now())",
		[ids[name], userOf(name), ORG, options.teamId ?? null, options.isActive ?? true],
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
	await seedPerson("owner", "owner");
	await seedPerson("admin", "admin");
	await seedPerson("officer", "member");
	await seedPerson("second", "member");
	await seedPerson("anna", "member", { teamId: ids.berlin });
	await seedPerson("ben", "member", { teamId: ids.munich });
	await seedPerson("carla", "member", { teamId: ids.munich });
	await seedPerson("payroll", "member");
	await seedPerson("leaver", "member", { isActive: false });
	await admin.query(
		`insert into payroll_access_grant (organization_id, payroll_employee_id, scope, created_by, updated_at)
		 values ($1, $2, 'all', $3, now())`,
		[ORG, ids.payroll, userOf("owner")],
	);
}

function signIn(name: Person) {
	harness.userId = userOf(name);
	harness.organizationId = ORG;
}

async function upload(input: { employeeId: string; metadata: Record<string, unknown> }) {
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

const payslip = (month: number) => ({
	category: "payslip",
	title: `Payslip ${month}`,
	documentDate: `2026-0${month}-28`,
	payPeriod: { year: 2026, month },
});
const contract = { category: "contract", title: "Contract", documentDate: "2026-01-01" };

async function grantAudits(grantId: string) {
	const { rows } = await admin.query<{
		action: string;
		performed_by: string;
		employee_id: string;
		changes: string;
		metadata: string | null;
	}>(
		`select action, performed_by, employee_id, changes, metadata from audit_log
		 where entity_type = 'personnel_file_officer_grant' and entity_id = $1 order by timestamp, id`,
		[grantId],
	);
	return rows.map((row) => ({
		action: row.action,
		performedBy: row.performed_by,
		employeeId: row.employee_id,
		changes: JSON.parse(row.changes),
		metadata: row.metadata ? JSON.parse(row.metadata) : null,
	}));
}

async function saveGrant(input: {
	officerEmployeeId: string;
	scope: "all" | "specific";
	teamIds?: string[];
	employeeIds?: string[];
	categories: Array<"contract" | "payslip" | "certificate" | "sick_note" | "other">;
}) {
	signIn("owner");
	const result = await officerActions.savePersonnelFileOfficerGrantAction({
		teamIds: [],
		employeeIds: [],
		...input,
	});
	if (!result.success) throw new Error(result.error);
	return result.data.grantId;
}

describe("personnel file officer grants (#866)", () => {
	let annaPayslip: string;
	let annaContract: string;
	let benPayslip: string;
	let berlinGrant: string;

	beforeAll(async () => {
		await seed();
		signIn("owner");
		annaPayslip = await uploadDocument({ employeeId: ids.anna, metadata: payslip(1) });
		annaContract = await uploadDocument({ employeeId: ids.anna, metadata: contract });
		benPayslip = await uploadDocument({ employeeId: ids.ben, metadata: payslip(1) });
		berlinGrant = await saveGrant({
			officerEmployeeId: ids.officer,
			scope: "specific",
			teamIds: [ids.berlin],
			employeeIds: [ids.leaver],
			categories: ["payslip"],
		});
	});
	afterAll(async () => {
		await cleanup();
		await admin.end();
	});
	beforeEach(async () => {
		await admin.query("update organization set personnel_files_enabled = true where id = $1", [
			ORG,
		]);
	});

	describe("scope and category resolution", () => {
		it("resolves the officer's grant with its scope and categories", async () => {
			const access = await resolvePersonnelFileAccess(db, {
				userId: userOf("officer"),
				organizationId: ORG,
			});
			expect(access?.grants).toHaveLength(1);
			expect(access?.grants[0]).toMatchObject({
				source: "officer_grant",
				scope: { kind: "specific", teamIds: [ids.berlin], employeeIds: [ids.leaver] },
			});
			expect([...(access?.grants[0]?.categories ?? [])]).toEqual(["payslip"]);
		});

		it("shows a Berlin payslip officer Berlin payslips and not-founds contracts and other teams", async () => {
			signIn("officer");
			const file = await actions.getPersonnelFileAction({ employeeId: ids.anna });
			if (!file.success) throw new Error(file.error);
			expect(file.data.capability.categories).toEqual(["payslip"]);
			expect(file.data.documents.map((document) => document.id)).toEqual([annaPayslip]);

			expect((await download(annaPayslip)).status).toBe(200);
			expect((await download(annaContract)).status).toBe(404);
			expect((await download(benPayslip)).status).toBe(404);
			expect(await actions.getPersonnelFileAction({ employeeId: ids.ben })).toMatchObject({
				success: false,
			});
		});

		it("follows live team membership", async () => {
			signIn("officer");
			expect((await download(benPayslip)).status).toBe(404);
			await admin.query(
				"insert into team_membership (organization_id, team_id, employee_id) values ($1, $2, $3)",
				[ORG, ids.berlin, ids.ben],
			);
			try {
				expect((await download(benPayslip)).status).toBe(200);
			} finally {
				await admin.query("delete from team_membership where employee_id = $1", [ids.ben]);
			}
			expect((await download(benPayslip)).status).toBe(404);
		});

		it("lists the employees in scope, a named departed employee included", async () => {
			const access = await resolvePersonnelFileAccess(db, {
				userId: userOf("officer"),
				organizationId: ORG,
			});
			if (!access) throw new Error("no access");
			const managed = await listManagedEmployees(db, access);
			expect(managed.map((employee) => employee.id).toSorted()).toEqual(
				[ids.anna, ids.leaver].toSorted(),
			);
			expect(managed.find((employee) => employee.id === ids.leaver)?.isActive).toBe(false);
		});

		it("gives payroll access holders and employees without a grant nothing", async () => {
			for (const person of ["payroll", "ben"] as const) {
				signIn(person);
				expect((await download(annaPayslip)).status).toBe(404);
				expect(await actions.getPersonnelFileAction({ employeeId: ids.anna })).toMatchObject({
					success: false,
				});
				expect((await upload({ employeeId: ids.anna, metadata: payslip(2) })).status).toBe(404);
			}
			const payroll = await resolvePersonnelFileAccess(db, {
				userId: userOf("payroll"),
				organizationId: ORG,
			});
			expect(payroll?.grants).toEqual([]);
		});
	});

	describe("own personnel file (decision A)", () => {
		async function accessOf(person: Person) {
			const access = await resolvePersonnelFileAccess(db, {
				userId: userOf(person),
				organizationId: ORG,
			});
			if (!access) throw new Error("no access");
			return access;
		}

		it("gives an officer whose own team is in scope only the employee view of their own file", async () => {
			await admin.query("update employee set team_id = $2 where id = $1", [
				ids.officer,
				ids.berlin,
			]);
			signIn("owner");
			const ownHrOnly = await uploadDocument({
				employeeId: ids.officer,
				metadata: { ...payslip(4), visibility: "hr_only" },
			});
			const ownShared = await uploadDocument({
				employeeId: ids.officer,
				metadata: { ...payslip(5), visibility: "shared" },
			});
			try {
				signIn("officer");
				expect((await download(ownHrOnly)).status).toBe(404);
				expect((await download(ownShared)).status).toBe(200);
				expect(await actions.getPersonnelFileAction({ employeeId: ids.officer })).toMatchObject({
					success: false,
				});
				expect((await upload({ employeeId: ids.officer, metadata: payslip(6) })).status).toBe(404);
				expect(
					await actions.deleteEmployeeDocumentAction({ documentId: ownShared, reason: "mine" }),
				).toMatchObject({ success: false });
				const mine = await actions.getMyDocumentsAction();
				expect(mine.success && mine.data.map((document) => document.id)).toEqual([ownShared]);

				const managed = await listManagedEmployees(db, await accessOf("officer"));
				expect(managed.map((employee) => employee.id).toSorted()).toEqual(
					[ids.anna, ids.leaver].toSorted(),
				);
				// Their HR-only payslip goes to someone else: the owners and admins.
				expect(
					await listPersonnelFileNotificationRecipients(db, {
						organizationId: ORG,
						employeeId: ids.officer,
						category: "payslip",
					}),
				).toEqual([userOf("admin"), userOf("owner")].toSorted());
			} finally {
				await admin.query("delete from employee_document where id = any($1::uuid[])", [
					[ownHrOnly, ownShared],
				]);
				await admin.query("update employee set team_id = null where id = $1", [ids.officer]);
			}
		});

		it("gives an admin who is an employee only the employee view of their own file", async () => {
			signIn("owner");
			const ownHrOnly = await uploadDocument({
				employeeId: ids.admin,
				metadata: {
					category: "certificate",
					title: "First aid",
					documentDate: "2025-01-01",
					expiryDate: "2026-01-01",
					visibility: "hr_only",
				},
			});
			const ownShared = await uploadDocument({
				employeeId: ids.admin,
				metadata: { ...contract, visibility: "shared" },
			});
			try {
				signIn("admin");
				expect((await download(ownHrOnly)).status).toBe(404);
				expect((await download(ownShared)).status).toBe(200);
				expect(await actions.getPersonnelFileAction({ employeeId: ids.admin })).toMatchObject({
					success: false,
				});
				expect((await actions.getPersonnelFileAction({ employeeId: ids.anna })).success).toBe(true);
				const access = await accessOf("admin");
				const managed = (await listManagedEmployees(db, access)).map((employee) => employee.id);
				expect(managed).not.toContain(ids.admin);
				expect(managed).toContain(ids.anna);
				const expiring = await listExpiringDocuments(db, access, {
					now: Temporal.Instant.fromEpochMilliseconds(Date.now()),
				});
				expect(expiring.map((document) => document.documentId)).not.toContain(ownHrOnly);

				// The owner still manages the admin's file.
				signIn("owner");
				expect((await download(ownHrOnly)).status).toBe(200);
			} finally {
				await admin.query("delete from employee_document where id = any($1::uuid[])", [
					[ownHrOnly, ownShared],
				]);
			}
		});
	});

	describe("officer writes", () => {
		it("lets the officer upload a payslip in scope", async () => {
			signIn("officer");
			const response = await upload({ employeeId: ids.anna, metadata: payslip(3) });
			expect(response.status).toBe(200);
		});

		it("refuses out-of-scope uploads, edits, deletes and downloads on the server", async () => {
			signIn("officer");
			expect((await upload({ employeeId: ids.anna, metadata: contract })).status).toBe(404);
			expect((await upload({ employeeId: ids.ben, metadata: payslip(2) })).status).toBe(404);
			expect(
				await actions.updateEmployeeDocumentAction({
					documentId: annaContract,
					metadata: {
						...contract,
						category: "contract",
						payPeriod: null,
						visibility: "hr_only",
						expiryDate: null,
					},
				}),
			).toMatchObject({ success: false, error: "Document not found" });
			expect(
				await actions.updateEmployeeDocumentAction({
					documentId: annaPayslip,
					metadata: {
						...contract,
						category: "contract",
						payPeriod: null,
						visibility: "shared",
						expiryDate: null,
					},
				}),
			).toMatchObject({ success: false, code: "invalid_category" });
			expect(
				await actions.deleteEmployeeDocumentAction({ documentId: annaContract, reason: null }),
			).toMatchObject({ success: false });
			expect(
				await actions.deleteEmployeeDocumentAction({ documentId: benPayslip, reason: null }),
			).toMatchObject({ success: false });
			expect((await download(benPayslip, "?download=1")).status).toBe(404);
		});

		it("audits the officer's downloads and views", async () => {
			signIn("officer");
			expect((await download(annaPayslip, "?download=1")).status).toBe(200);
			const { rows } = await admin.query<{ action: string; performed_by: string }>(
				`select action, performed_by from audit_log
				 where entity_type = 'employee_document' and entity_id = $1 and performed_by = $2
				 order by timestamp, id`,
				[annaPayslip, userOf("officer")],
			);
			expect(rows.map((row) => row.action)).toContain("personnel_file.document_downloaded");
			expect(rows.map((row) => row.action)).toContain("personnel_file.document_viewed");
		});

		it("hides a document whose category an admin moves outside the grant", async () => {
			signIn("owner");
			const moved = await uploadDocument({ employeeId: ids.anna, metadata: payslip(4) });
			signIn("officer");
			expect((await download(moved)).status).toBe(200);
			signIn("admin");
			expect(
				await actions.updateEmployeeDocumentAction({
					documentId: moved,
					metadata: {
						category: "other",
						title: "Not a payslip",
						documentDate: "2026-04-28",
						payPeriod: null,
						visibility: "hr_only",
						expiryDate: null,
					},
				}),
			).toMatchObject({ success: true });
			signIn("officer");
			expect((await download(moved)).status).toBe(404);
		});
	});

	describe("grant administration", () => {
		it("audits create, change and revoke with old and new scope and categories", async () => {
			const grantId = await saveGrant({
				officerEmployeeId: ids.second,
				scope: "all",
				categories: ["contract", "certificate"],
			});
			await saveGrant({
				officerEmployeeId: ids.second,
				scope: "specific",
				teamIds: [ids.munich],
				categories: ["certificate"],
			});
			signIn("owner");
			expect(await officerActions.revokePersonnelFileOfficerGrantAction({ grantId })).toMatchObject(
				{ success: true },
			);

			const audits = await grantAudits(grantId);
			const allContractCertificate = {
				scope: "all",
				teamIds: [],
				employeeIds: [],
				categories: ["contract", "certificate"],
			};
			const munichCertificate = {
				scope: "specific",
				teamIds: [ids.munich],
				employeeIds: [],
				categories: ["certificate"],
			};
			expect(audits).toEqual([
				{
					action: "personnel_file.grant_created",
					performedBy: userOf("owner"),
					employeeId: ids.second,
					changes: { from: null, to: allContractCertificate },
					metadata: null,
				},
				{
					action: "personnel_file.grant_changed",
					performedBy: userOf("owner"),
					employeeId: ids.second,
					changes: { from: allContractCertificate, to: munichCertificate },
					metadata: null,
				},
				{
					action: "personnel_file.grant_revoked",
					performedBy: userOf("owner"),
					employeeId: ids.second,
					changes: { from: munichCertificate, to: null },
					metadata: null,
				},
			]);
		});

		it("ends access immediately when the grant is revoked", async () => {
			const grantId = await saveGrant({
				officerEmployeeId: ids.second,
				scope: "specific",
				employeeIds: [ids.ben],
				categories: ["payslip"],
			});
			signIn("second");
			expect((await download(benPayslip)).status).toBe(200);
			signIn("owner");
			await officerActions.revokePersonnelFileOfficerGrantAction({ grantId });
			signIn("second");
			expect((await download(benPayslip)).status).toBe(404);
			expect(await actions.getPersonnelFileAction({ employeeId: ids.ben })).toMatchObject({
				success: false,
			});
		});

		it("saves an unchanged grant that names a departed employee without a new audit entry", async () => {
			const before = await grantAudits(berlinGrant);
			const again = await saveGrant({
				officerEmployeeId: ids.officer,
				scope: "specific",
				teamIds: [ids.berlin],
				employeeIds: [ids.leaver],
				categories: ["payslip"],
			});
			expect(again).toBe(berlinGrant);
			expect(await grantAudits(berlinGrant)).toHaveLength(before.length);
		});

		it("refuses empty category sets and lets only owners and admins administer grants", async () => {
			signIn("owner");
			expect(
				await officerActions.savePersonnelFileOfficerGrantAction({
					officerEmployeeId: ids.second,
					scope: "all",
					teamIds: [],
					employeeIds: [],
					categories: [],
				}),
			).toMatchObject({ success: false });
			for (const person of ["officer", "payroll"] as const) {
				signIn(person);
				expect(await officerActions.getPersonnelFileOfficerAdminData()).toMatchObject({
					success: false,
				});
				expect(
					await officerActions.savePersonnelFileOfficerGrantAction({
						officerEmployeeId: ids.officer,
						scope: "all",
						teamIds: [],
						employeeIds: [],
						categories: ["contract"],
					}),
				).toMatchObject({ success: false });
				expect(
					await officerActions.revokePersonnelFileOfficerGrantAction({ grantId: berlinGrant }),
				).toMatchObject({ success: false });
			}
			signIn("admin");
			const data = await officerActions.getPersonnelFileOfficerAdminData();
			if (!data.success) throw new Error(data.error);
			expect(data.data.grants.map((grant) => grant.id)).toContain(berlinGrant);
			expect(data.data.departedEmployees.map((person) => person.id)).toEqual([ids.leaver]);
		});
	});

	describe("notification recipients", () => {
		it("names the officers covering the employee and category", async () => {
			expect(
				await listPersonnelFileNotificationRecipients(db, {
					organizationId: ORG,
					employeeId: ids.anna,
					category: "payslip",
				}),
			).toEqual([userOf("officer")]);
		});

		it("falls back to owners and admins when no officer covers the employee or category", async () => {
			const ownersAndAdmins = [userOf("admin"), userOf("owner")].toSorted();
			expect(
				await listPersonnelFileNotificationRecipients(db, {
					organizationId: ORG,
					employeeId: ids.anna,
					category: "contract",
				}),
			).toEqual(ownersAndAdmins);
			expect(
				await listPersonnelFileNotificationRecipients(db, {
					organizationId: ORG,
					employeeId: ids.carla,
					category: "payslip",
				}),
			).toEqual(ownersAndAdmins);
		});

		it("never names the employee themselves", async () => {
			const grantId = await seedPersonnelFileOfficerGrant(admin, {
				organizationId: ORG,
				officerEmployeeId: ids.carla,
				createdBy: userOf("owner"),
				categories: ["certificate"],
			});
			try {
				// Carla covers everyone's certificates, but not as a recipient for her own.
				expect(
					await listPersonnelFileNotificationRecipients(db, {
						organizationId: ORG,
						employeeId: ids.carla,
						category: "certificate",
					}),
				).toEqual([userOf("admin"), userOf("owner")].toSorted());
				expect(
					await listPersonnelFileNotificationRecipients(db, {
						organizationId: ORG,
						employeeId: ids.ben,
						category: "certificate",
					}),
				).toEqual([userOf("carla")]);
				expect(
					await listPersonnelFileNotificationRecipients(db, {
						organizationId: ORG,
						employeeId: ids.owner,
						category: "contract",
					}),
				).toEqual([userOf("admin")]);
			} finally {
				await deactivateSeededPersonnelFileOfficerGrant(admin, grantId);
			}
		});

		it("names nobody while personnel files are off", async () => {
			await admin.query("update organization set personnel_files_enabled = false where id = $1", [
				ORG,
			]);
			expect(
				await listPersonnelFileNotificationRecipients(db, {
					organizationId: ORG,
					employeeId: ids.anna,
					category: "payslip",
				}),
			).toEqual([]);
		});
	});

	describe("test fixture", () => {
		it("seeds a grant the resolver honors, and deactivates it", async () => {
			const grantId = await seedPersonnelFileOfficerGrant(admin, {
				organizationId: ORG,
				officerEmployeeId: ids.payroll,
				createdBy: userOf("owner"),
				teamIds: [ids.munich],
				categories: ["payslip", "contract"],
			});
			const access = await resolvePersonnelFileAccess(db, {
				userId: userOf("payroll"),
				organizationId: ORG,
			});
			expect(access?.grants[0]?.scope).toEqual({
				kind: "specific",
				teamIds: [ids.munich],
				employeeIds: [],
			});
			expect([...(access?.grants[0]?.categories ?? [])]).toEqual(["contract", "payslip"]);
			await deactivateSeededPersonnelFileOfficerGrant(admin, grantId);
			expect(
				(await resolvePersonnelFileAccess(db, { userId: userOf("payroll"), organizationId: ORG }))
					?.grants,
			).toEqual([]);
		});
	});
});
