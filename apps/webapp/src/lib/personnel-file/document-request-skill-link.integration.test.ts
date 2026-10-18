/**
 * #1405 (spec #1307): accepting a renewal of a skill certificate links the
 * accepted submission's certificates to the same employee skill, in the
 * accept's transaction, against a disposable PostgreSQL database. The skill
 * expiry date then follows the existing skill-certificate rules (#1145). Only
 * the session and notification delivery are replaced; documents are seeded as
 * if uploaded from the request.
 */

import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1405-org",
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
vi.mock("@/lib/storage/export-s3-client", () => ({
	async uploadPrivateObject() {
		return { bucket: "t1405-private", versionId: null };
	},
	async readPrivateObject() {
		return new Uint8Array(Buffer.from("%PDF-1.4\n%%EOF"));
	},
	async deletePrivateObject() {},
	async deletePrivateObjectVersions() {},
	async privateObjectExists() {
		return true;
	},
}));

vi.setConfig({ testTimeout: 60_000 });

const requestActions = await import(
	"@/app/[locale]/(app)/personnel-files/document-request-actions"
);
const { db } = await import("@/db");
const { resolvePersonnelFileAccess } = await import("./access-store");
const store = await import("./document-request-store");
const { updateDocumentMetadata } = await import("./document-store");
const { seedPersonnelFileOfficerGrant } = await import("./testing/officer-grant.test.fixture");

const ORG = "t1405-org";
const PDF = Buffer.from("%PDF-1.4\n%%EOF");

const ids = {
	owner: "e1405000-0000-4000-8000-000000000001",
	officer: "e1405000-0000-4000-8000-000000000002",
	anna: "e1405000-0000-4000-8000-000000000003",
	forklift: "e1405200-0000-4000-8000-000000000001",
	firstAid: "e1405200-0000-4000-8000-000000000002",
	annaForklift: "e1405300-0000-4000-8000-000000000001",
	annaFirstAid: "e1405300-0000-4000-8000-000000000002",
} as const;
type Person = "owner" | "officer" | "anna";
const userOf = (person: Person) => `t1405-${person}`;

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query("delete from personnel_file_upload where organization_id = $1", [ORG]);
	await admin.query('delete from "user" where id like $1', ["t1405-%"]);
}

async function seedPerson(person: Person, displayName: string, memberRole: string) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
		[userOf(person), displayName, `${userOf(person)}@example.test`],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
		[`t1405-member-${person}`, ORG, userOf(person), memberRole],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,is_active,updated_at) values ($1,$2,$3,'employee',true,now())",
		[ids[person], userOf(person), ORG],
	);
}

async function seedSkill(id: string, input: { name: string; requiresExpiry: boolean }) {
	await admin.query(
		`insert into skill (id, organization_id, name, category, requires_expiry, created_by, updated_at)
		 values ($1, $2, $3, 'certification', $4, $5, now())`,
		[id, ORG, input.name, input.requiresExpiry, userOf("owner")],
	);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, personnel_files_enabled, created_at)
		 values ($1, $1, $1, 'Europe/Berlin', true, now())`,
		[ORG],
	);
	await seedPerson("owner", "Olga Owner", "owner");
	await seedPerson("officer", "Otto Officer", "member");
	await seedPerson("anna", "Anna Example", "member");
	await seedSkill(ids.forklift, { name: "Forklift licence", requiresExpiry: true });
	await seedSkill(ids.firstAid, { name: "First aid", requiresExpiry: false });
	for (const [id, skillId] of [
		[ids.annaForklift, ids.forklift],
		[ids.annaFirstAid, ids.firstAid],
	] as const) {
		await admin.query(
			`insert into employee_skill (id, employee_id, skill_id, expires_at, assigned_by)
			 values ($1, $2, $3, null, $4)`,
			[id, ids.anna, skillId, userOf("owner")],
		);
	}
	// Otto covers Anna's certificates only.
	await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.officer,
		createdBy: userOf("owner"),
		employeeIds: [ids.anna],
		categories: ["certificate"],
	});
}

async function accessOf(person: Person) {
	const access = await resolvePersonnelFileAccess(db, {
		userId: userOf(person),
		organizationId: ORG,
	});
	if (!access) throw new Error(`no access for ${person}`);
	return access;
}

let documentCounter = 0;
async function seedDocument(
	input: {
		category?: "certificate" | "other";
		expiryDate?: string | null;
		employeeSkillId?: string | null;
	} = {},
): Promise<string> {
	documentCounter += 1;
	const id = `e1405500-0000-4000-8000-${String(documentCounter).padStart(12, "0")}`;
	await admin.query(
		`insert into employee_document
		 (id, organization_id, employee_id, category, title, document_date, visibility, expiry_date,
		  employee_skill_id, storage_provider, storage_bucket, storage_key, file_name, mime_type,
		  size_bytes, checksum_sha256)
		 values ($1, $2, $3, $4, $5, '2026-09-01', 'shared', $6, $7,
		  's3-private', 't1405-private', $8, 'certificate.pdf', 'application/pdf', $9, $10)`,
		[
			id,
			ORG,
			ids.anna,
			input.category ?? "certificate",
			`Document ${documentCounter}`,
			input.expiryDate === undefined ? "2028-09-30" : input.expiryDate,
			input.employeeSkillId ?? null,
			`personnel-files/${ORG}/${ids.anna}/${id}-certificate.pdf`,
			PDF.length,
			createHash("sha256").update(PDF).digest("hex"),
		],
	);
	return id;
}

async function createRequest(input: {
	renewedDocumentId?: string | null;
	category?: "certificate" | "other";
	creator?: Person;
}): Promise<string> {
	const created = await store.createDocumentRequest(
		db,
		await accessOf(input.creator ?? "officer"),
		{
			employeeId: ids.anna,
			category: input.category ?? "certificate",
			title: "Forklift licence renewal",
			note: null,
			deadline: "2099-11-30",
			renewedDocumentId: input.renewedDocumentId ?? null,
		},
	);
	if (created.kind !== "created") throw new Error(`create failed: ${JSON.stringify(created)}`);
	return created.request.id;
}

/** Anna hands in the given documents as if uploaded from the request. */
async function submit(requestId: string, documentIds: readonly string[]): Promise<number> {
	for (const documentId of documentIds) {
		await admin.query(
			`insert into employee_document_request_document (document_id, organization_id, request_id)
			 values ($1, $2, $3)`,
			[documentId, ORG, requestId],
		);
	}
	const submitted = await store.submitDocumentRequest(db, await accessOf("anna"), {
		requestId,
		note: null,
	});
	if (submitted.kind !== "submitted")
		throw new Error(`submit failed: ${JSON.stringify(submitted)}`);
	return submitted.request.version;
}

async function accept(requestId: string, person: Person = "officer") {
	return store.acceptDocumentRequest(db, await accessOf(person), { requestId });
}

async function skillOf(documentId: string): Promise<string | null | undefined> {
	const { rows } = await admin.query<{ employee_skill_id: string | null }>(
		"select employee_skill_id from employee_document where id = $1",
		[documentId],
	);
	return rows[0] ? rows[0].employee_skill_id : undefined;
}

async function expiryOf(employeeSkillId: string): Promise<string | null | undefined> {
	const { rows } = await admin.query<{ expires_at: string | null }>(
		"select expires_at::text as expires_at from employee_skill where id = $1",
		[employeeSkillId],
	);
	return rows[0] ? rows[0].expires_at : undefined;
}

async function statusOf(requestId: string) {
	const { rows } = await admin.query<{ status: string }>(
		"select status from employee_document_request where id = $1",
		[requestId],
	);
	return rows[0]?.status;
}

async function linkAudits() {
	const { rows } = await admin.query<{
		entity_id: string;
		performed_by: string;
		changes: string;
		metadata: string;
	}>(
		`select entity_id, performed_by, changes, metadata from audit_log
		 where organization_id = $1 and action = 'personnel_file.skill_certificate_linked'
		 order by entity_id`,
		[ORG],
	);
	return rows.map((row) => ({
		documentId: row.entity_id,
		performedBy: row.performed_by,
		changes: JSON.parse(row.changes) as unknown,
		metadata: JSON.parse(row.metadata) as Record<string, unknown>,
	}));
}

describe("document requests: skill link on accept (#1405)", () => {
	beforeAll(seed);
	afterAll(async () => {
		await cleanup();
		await admin.end();
	});
	beforeEach(async () => {
		await admin.query("delete from employee_document_request where organization_id = $1", [ORG]);
		await admin.query("delete from employee_document where organization_id = $1", [ORG]);
		await admin.query(
			"delete from audit_log where organization_id = $1 and action like 'personnel_file.skill_certificate_%'",
			[ORG],
		);
		await admin.query("update employee_skill set expires_at = $2 where id = any($1)", [
			[ids.annaForklift, ids.annaFirstAid],
			"2026-09-30",
		]);
	});

	describe("linking", () => {
		it("links every dated submitted certificate to the renewed certificate's skill and moves its expiry date, atomically with the accept", async () => {
			const renewed = await seedDocument({
				expiryDate: "2026-09-30",
				employeeSkillId: ids.annaForklift,
			});
			const requestId = await createRequest({ renewedDocumentId: renewed });
			const front = await seedDocument({ expiryDate: "2029-09-30" });
			const back = await seedDocument({ expiryDate: "2029-03-31" });
			await submit(requestId, [front, back]);

			// Handing in alone never moves the skill expiry date.
			expect(await skillOf(front)).toBeNull();
			expect(await expiryOf(ids.annaForklift)).toBe("2026-09-30");

			expect(await accept(requestId)).toMatchObject({ kind: "accepted" });
			expect(await statusOf(requestId)).toBe("accepted");
			expect(await skillOf(front)).toBe(ids.annaForklift);
			expect(await skillOf(back)).toBe(ids.annaForklift);
			expect(await skillOf(renewed)).toBe(ids.annaForklift);
			expect(await expiryOf(ids.annaForklift)).toBe("2029-09-30");

			// Audited as skill-certificate links by the deciding officer, naming the request.
			expect(await linkAudits()).toEqual(
				[front, back].toSorted().map((documentId) => ({
					documentId,
					performedBy: userOf("officer"),
					changes: { employeeSkillId: { from: null, to: ids.annaForklift } },
					metadata: expect.objectContaining({ documentRequestId: requestId }),
				})),
			);
			// The accept's own audit record names what it linked.
			const { rows } = await admin.query<{ metadata: string }>(
				`select metadata from audit_log
				 where organization_id = $1 and entity_id = $2
				   and action = 'personnel_file.document_request_accepted'`,
				[ORG, requestId],
			);
			expect(rows.map((row) => JSON.parse(row.metadata).skillLink)).toEqual([
				{ employeeSkillId: ids.annaForklift, documentIds: [front, back].toSorted() },
			]);
		});

		it("links only the certificates of the accepted submission, not the returned ones", async () => {
			const renewed = await seedDocument({ employeeSkillId: ids.annaFirstAid });
			const requestId = await createRequest({ renewedDocumentId: renewed });
			const returned = await seedDocument({ expiryDate: "2030-01-31" });
			await submit(requestId, [returned]);
			const returnedResult = await store.returnDocumentRequest(db, await accessOf("officer"), {
				requestId,
				reason: "Wrong card.",
			});
			expect(returnedResult.kind).toBe("returned");
			const resubmitted = await seedDocument({ expiryDate: "2028-12-31" });
			await submit(requestId, [resubmitted]);

			expect(await accept(requestId)).toMatchObject({ kind: "accepted" });
			expect(await skillOf(resubmitted)).toBe(ids.annaFirstAid);
			expect(await skillOf(returned)).toBeNull();
			expect(await expiryOf(ids.annaFirstAid)).toBe("2028-12-31");
		});

		it("moves a submitted certificate off another skill and recomputes both skills", async () => {
			const renewed = await seedDocument({
				expiryDate: "2026-09-30",
				employeeSkillId: ids.annaForklift,
			});
			// Anna's first aid date comes from a certificate that is handed in as the forklift renewal.
			const misfiled = await seedDocument({
				expiryDate: "2029-06-30",
				employeeSkillId: ids.annaFirstAid,
			});
			await admin.query("update employee_skill set expires_at = '2029-06-30' where id = $1", [
				ids.annaFirstAid,
			]);
			const requestId = await createRequest({ renewedDocumentId: renewed });
			await submit(requestId, [misfiled]);

			expect(await accept(requestId)).toMatchObject({ kind: "accepted" });
			expect(await skillOf(misfiled)).toBe(ids.annaForklift);
			expect(await expiryOf(ids.annaForklift)).toBe("2029-06-30");
			// No dated certificate names first aid any more: it keeps its date.
			expect(await expiryOf(ids.annaFirstAid)).toBe("2029-06-30");
		});

		it("links undated certificates too when the skill does not require an expiry date", async () => {
			const renewed = await seedDocument({ expiryDate: null, employeeSkillId: ids.annaFirstAid });
			const requestId = await createRequest({ renewedDocumentId: renewed });
			const undated = await seedDocument({ expiryDate: null });
			await submit(requestId, [undated]);

			expect(await accept(requestId)).toMatchObject({ kind: "accepted" });
			expect(await skillOf(undated)).toBe(ids.annaFirstAid);
			// No dated certificate names the skill: it keeps its date.
			expect(await expiryOf(ids.annaFirstAid)).toBe("2026-09-30");
		});

		it("links only the dated certificates when the skill requires an expiry date; undated ones stay unlinked", async () => {
			const renewed = await seedDocument({
				expiryDate: "2026-09-30",
				employeeSkillId: ids.annaForklift,
			});
			const requestId = await createRequest({ renewedDocumentId: renewed });
			const dated = await seedDocument({ expiryDate: "2029-09-30" });
			const undated = await seedDocument({ expiryDate: null });
			await submit(requestId, [dated, undated]);

			expect(await accept(requestId)).toMatchObject({ kind: "accepted" });
			expect(await skillOf(dated)).toBe(ids.annaForklift);
			expect(await skillOf(undated)).toBeNull();
			expect(await expiryOf(ids.annaForklift)).toBe("2029-09-30");
		});

		it("of two concurrent accepts, one links and the other conflicts", async () => {
			const renewed = await seedDocument({
				expiryDate: "2026-09-30",
				employeeSkillId: ids.annaForklift,
			});
			const requestId = await createRequest({ renewedDocumentId: renewed });
			const certificate = await seedDocument({ expiryDate: "2029-09-30" });
			await submit(requestId, [certificate]);

			const results = await Promise.all([accept(requestId, "officer"), accept(requestId, "owner")]);
			expect(results.map((result) => result.kind).toSorted()).toEqual(["accepted", "conflict"]);
			expect(await linkAudits()).toHaveLength(1);
			expect(await expiryOf(ids.annaForklift)).toBe("2029-09-30");
		});
	});

	describe("refusal", () => {
		it("refuses the accept when the skill requires an expiry date and no submitted certificate has one; nothing changes", async () => {
			const renewed = await seedDocument({
				expiryDate: "2026-09-30",
				employeeSkillId: ids.annaForklift,
			});
			const requestId = await createRequest({ renewedDocumentId: renewed });
			const undated = await seedDocument({ expiryDate: null });
			const version = await submit(requestId, [undated]);

			harness.userId = userOf("officer");
			harness.organizationId = ORG;
			expect(await requestActions.acceptDocumentRequestAction({ requestId })).toMatchObject({
				success: false,
				code: "renewal_expiry_date_required",
			});
			expect(await statusOf(requestId)).toBe("submitted");
			expect(await skillOf(undated)).toBeNull();
			expect(await expiryOf(ids.annaForklift)).toBe("2026-09-30");
			expect(await linkAudits()).toEqual([]);
			const { rows } = await admin.query<{ version: number; events: string }>(
				`select r.version, (select count(*) from employee_document_request_event e
				  where e.request_id = r.id and e.kind = 'accepted') as events
				 from employee_document_request r where r.id = $1`,
				[requestId],
			);
			expect(rows[0]).toEqual({ version, events: "0" });

			// The officer dates the certificate with the metadata edit, then accepts.
			const edited = await updateDocumentMetadata(db, await accessOf("officer"), {
				documentId: undated,
				metadata: {
					category: "certificate",
					title: "Forklift licence 2026",
					documentDate: "2026-09-01",
					payPeriod: null,
					visibility: "shared",
					expiryDate: "2029-09-30",
				},
			});
			expect(edited.kind).toBe("updated");
			expect(await accept(requestId)).toMatchObject({ kind: "accepted" });
			expect(await skillOf(undated)).toBe(ids.annaForklift);
			expect(await expiryOf(ids.annaForklift)).toBe("2029-09-30");
		});
	});

	describe("no other side effects", () => {
		it("links nothing when the request names no renewed document", async () => {
			const requestId = await createRequest({});
			const certificate = await seedDocument({ expiryDate: "2029-09-30" });
			await submit(requestId, [certificate]);

			expect(await accept(requestId)).toMatchObject({ kind: "accepted" });
			expect(await skillOf(certificate)).toBeNull();
			expect(await linkAudits()).toEqual([]);
		});

		it("links nothing when the renewed certificate names no employee skill", async () => {
			const renewed = await seedDocument({ expiryDate: "2026-09-30" });
			const requestId = await createRequest({ renewedDocumentId: renewed });
			const undated = await seedDocument({ expiryDate: null });
			await submit(requestId, [undated]);

			expect(await accept(requestId)).toMatchObject({ kind: "accepted" });
			expect(await skillOf(undated)).toBeNull();
			expect(await linkAudits()).toEqual([]);
		});

		it("links nothing when the renewed document is not a certificate", async () => {
			const renewed = await seedDocument({ category: "other", expiryDate: "2026-09-30" });
			const requestId = await createRequest({
				renewedDocumentId: renewed,
				category: "other",
				creator: "owner",
			});
			const replacement = await seedDocument({ category: "other", expiryDate: "2029-09-30" });
			await submit(requestId, [replacement]);

			expect(await accept(requestId, "owner")).toMatchObject({ kind: "accepted" });
			expect(await skillOf(replacement)).toBeNull();
			expect(await expiryOf(ids.annaForklift)).toBe("2026-09-30");
			expect(await linkAudits()).toEqual([]);
		});
	});
});
