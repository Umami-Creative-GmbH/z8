/**
 * #1144: a certificate in the personnel file names the employee skill it
 * proves (Scheduling ADR 0001), against a disposable PostgreSQL database. The
 * link goes through the real server actions and the skill service; only the
 * session, billing guard and object storage are replaced.
 */

import { createHash } from "node:crypto";
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const PDF = Buffer.from("%PDF-1.4\n%%EOF");

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1144-org",
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
							user: {
								id: harness.userId,
								role: "user",
								email: `${harness.userId}@example.test`,
								name: harness.userId,
							},
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
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/storage/export-s3-client", () => ({
	async uploadPrivateObject() {
		return { bucket: "t1144-private", versionId: null };
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

const { GET: serveDocument } = await import(
	"@/app/api/personnel-files/documents/[documentId]/route"
);
const personnelFileActions = await import("@/app/[locale]/(app)/personnel-files/actions");
const certificateActions = await import(
	"@/app/[locale]/(app)/personnel-files/skill-certificate-actions"
);
const { seedPersonnelFileOfficerGrant } = await import("./testing/officer-grant.test.fixture");
const { SkillService, SkillServiceLive } = await import("@/lib/effect/services/skill.service");
const { DatabaseServiceLive } = await import("@/lib/effect/services/database.service");

const ORG = "t1144-org";
const OTHER_ORG = "t1144-other-org";

const ids = {
	owner: "e1144000-0000-4000-8000-000000000001",
	certOfficer: "e1144000-0000-4000-8000-000000000002",
	sickOfficer: "e1144000-0000-4000-8000-000000000003",
	manager: "e1144000-0000-4000-8000-000000000004",
	anna: "e1144000-0000-4000-8000-000000000005",
	ben: "e1144000-0000-4000-8000-000000000006",
	outsider: "e1144000-0000-4000-8000-000000000007",
	berlin: "e1144100-0000-4000-8000-000000000001",
	forklift: "e1144200-0000-4000-8000-000000000001",
	firstAid: "e1144200-0000-4000-8000-000000000002",
	foreignSkill: "e1144200-0000-4000-8000-000000000003",
	annaForklift: "e1144300-0000-4000-8000-000000000001",
	annaFirstAid: "e1144300-0000-4000-8000-000000000002",
	benForklift: "e1144300-0000-4000-8000-000000000003",
	outsiderSkill: "e1144300-0000-4000-8000-000000000004",
} as const;
type Person = "owner" | "certOfficer" | "sickOfficer" | "manager" | "anna" | "ben" | "outsider";
const userOf = (person: Person) => `t1144-${person}`;
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");

const admin = integrationAdminPool();
const skillLayer = SkillServiceLive.pipe(Layer.provide(DatabaseServiceLive));
const runSkills = <A, E>(program: (service: SkillService["Service"]) => Effect.Effect<A, E>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* program(yield* SkillService);
		}).pipe(Effect.provide(skillLayer)),
	);

async function cleanup() {
	await admin.query("delete from organization where id = any($1::text[])", [[ORG, OTHER_ORG]]);
	await admin.query("delete from personnel_file_upload where organization_id = any($1::text[])", [
		[ORG, OTHER_ORG],
	]);
	await admin.query('delete from "user" where id like $1', ["t1144-%"]);
}

async function seedPerson(
	person: Person,
	input: {
		memberRole: string;
		employeeRole?: string;
		organizationId?: string;
		teamId?: string | null;
	},
) {
	const organizationId = input.organizationId ?? ORG;
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,$4,$4)',
		[userOf(person), person, `${userOf(person)}@example.test`, SEEDED_AT],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',$5)",
		[`t1144-member-${person}`, organizationId, userOf(person), input.memberRole, SEEDED_AT],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,team_id,is_active,updated_at) values ($1,$2,$3,$4,$5,true,$6)",
		[
			ids[person],
			userOf(person),
			organizationId,
			input.employeeRole ?? "employee",
			input.teamId ?? null,
			SEEDED_AT,
		],
	);
	if (input.teamId) {
		await admin.query(
			"insert into team_membership (organization_id, team_id, employee_id) values ($1, $2, $3)",
			[organizationId, input.teamId, ids[person]],
		);
	}
}

async function seedSkill(
	id: string,
	input: { organizationId: string; name: string; requiresExpiry: boolean; createdBy: string },
) {
	await admin.query(
		`insert into skill (id, organization_id, name, category, requires_expiry, created_by, updated_at)
		 values ($1, $2, $3, 'certification', $4, $5, $6)`,
		[id, input.organizationId, input.name, input.requiresExpiry, input.createdBy, SEEDED_AT],
	);
}

async function seedEmployeeSkill(id: string, employee: Person, skillId: string) {
	await admin.query(
		`insert into employee_skill (id, employee_id, skill_id, expires_at, assigned_by)
		 values ($1, $2, $3, null, $4)`,
		[id, ids[employee], skillId, userOf("owner")],
	);
}

async function seed() {
	await cleanup();
	for (const organizationId of [ORG, OTHER_ORG]) {
		await admin.query(
			`insert into organization (id, name, slug, timezone, personnel_files_enabled, created_at)
			 values ($1, $1, $1, 'UTC', true, $2)`,
			[organizationId, SEEDED_AT],
		);
	}
	await admin.query(
		"insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Berlin', $3)",
		[ids.berlin, ORG, SEEDED_AT],
	);
	await seedPerson("owner", { memberRole: "owner", employeeRole: "admin" });
	await seedPerson("certOfficer", { memberRole: "member" });
	await seedPerson("sickOfficer", { memberRole: "member" });
	await seedPerson("manager", { memberRole: "member", employeeRole: "manager" });
	await seedPerson("anna", { memberRole: "member", teamId: ids.berlin });
	await seedPerson("ben", { memberRole: "member" });
	await seedPerson("outsider", { memberRole: "member", organizationId: OTHER_ORG });
	await admin.query(
		`insert into employee_managers
		 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
		 values (gen_random_uuid(), $1, $2, true, $3, $4, $4)`,
		[ids.anna, ids.manager, userOf("owner"), SEEDED_AT],
	);
	// Carl covers Berlin's certificates; Sid covers Berlin's sick notes only.
	await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.certOfficer,
		createdBy: userOf("owner"),
		teamIds: [ids.berlin],
		categories: ["certificate"],
	});
	await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.sickOfficer,
		createdBy: userOf("owner"),
		teamIds: [ids.berlin],
		categories: ["sick_note"],
	});
	await seedSkill(ids.forklift, {
		organizationId: ORG,
		name: "Forklift licence",
		requiresExpiry: true,
		createdBy: userOf("owner"),
	});
	await seedSkill(ids.firstAid, {
		organizationId: ORG,
		name: "First aid",
		requiresExpiry: false,
		createdBy: userOf("owner"),
	});
	await seedSkill(ids.foreignSkill, {
		organizationId: OTHER_ORG,
		name: "Crane",
		requiresExpiry: false,
		createdBy: userOf("outsider"),
	});
	await seedEmployeeSkill(ids.annaForklift, "anna", ids.forklift);
	await seedEmployeeSkill(ids.annaFirstAid, "anna", ids.firstAid);
	await seedEmployeeSkill(ids.benForklift, "ben", ids.forklift);
	await seedEmployeeSkill(ids.outsiderSkill, "outsider", ids.foreignSkill);
}

function signIn(person: Person) {
	harness.userId = userOf(person);
	harness.organizationId = person === "outsider" ? OTHER_ORG : ORG;
}

let documentCounter = 0;
async function seedDocument(
	employee: Person,
	input: {
		category?: string;
		expiryDate?: string | null;
		organizationId?: string;
		employeeSkillId?: string | null;
		visibility?: "shared" | "hr_only";
	} = {},
): Promise<string> {
	documentCounter += 1;
	const id = `e1144500-0000-4000-8000-${String(documentCounter).padStart(12, "0")}`;
	const organizationId = input.organizationId ?? ORG;
	await admin.query(
		`insert into employee_document
		 (id, organization_id, employee_id, category, title, document_date, visibility, expiry_date,
		  employee_skill_id, storage_provider, storage_bucket, storage_key, file_name, mime_type,
		  size_bytes, checksum_sha256)
		 values ($1, $2, $3, $4, $5, '2026-09-01', $6, $7, $8,
		  's3-private', 't1144-private', $9, 'certificate.pdf', 'application/pdf', $10, $11)`,
		[
			id,
			organizationId,
			ids[employee],
			input.category ?? "certificate",
			`Certificate ${documentCounter}`,
			input.visibility ?? "hr_only",
			input.expiryDate === undefined ? "2027-03-31" : input.expiryDate,
			input.employeeSkillId ?? null,
			`personnel-files/${organizationId}/${ids[employee]}/${id}-certificate.pdf`,
			PDF.length,
			createHash("sha256").update(PDF).digest("hex"),
		],
	);
	return id;
}

async function linkOf(documentId: string): Promise<string | null | undefined> {
	const { rows } = await admin.query<{ employee_skill_id: string | null }>(
		"select employee_skill_id from employee_document where id = $1",
		[documentId],
	);
	return rows[0] ? rows[0].employee_skill_id : undefined;
}

async function auditOf(documentId: string, action: string) {
	const { rows } = await admin.query<{ performed_by: string; metadata: string; changes: string }>(
		"select performed_by, metadata, changes from audit_log where entity_id = $1 and action = $2",
		[documentId, action],
	);
	return rows.map((row) => ({
		performedBy: row.performed_by,
		metadata: JSON.parse(row.metadata) as Record<string, unknown>,
		changes: row.changes ? (JSON.parse(row.changes) as Record<string, unknown>) : null,
	}));
}

function serve(documentId: string) {
	return serveDocument(
		new Request(`http://localhost/api/personnel-files/documents/${documentId}`) as never,
		{ params: Promise.resolve({ documentId }) },
	);
}

describe("skill certificates (#1144)", () => {
	beforeAll(seed);
	afterAll(cleanup);

	describe("naming, changing and clearing the employee skill", () => {
		it("lets an officer covering certificates name, change and clear it, audited", async () => {
			const documentId = await seedDocument("anna");
			signIn("certOfficer");

			const named = await certificateActions.setCertificateSkillAction({
				documentId,
				employeeSkillId: ids.annaForklift,
			});
			expect(named).toMatchObject({
				success: true,
				data: {
					id: documentId,
					skill: { employeeSkillId: ids.annaForklift, name: "Forklift licence" },
				},
			});
			expect(await linkOf(documentId)).toBe(ids.annaForklift);

			const changed = await certificateActions.setCertificateSkillAction({
				documentId,
				employeeSkillId: ids.annaFirstAid,
			});
			expect(changed).toMatchObject({
				success: true,
				data: { skill: { employeeSkillId: ids.annaFirstAid, name: "First aid" } },
			});

			const cleared = await certificateActions.setCertificateSkillAction({
				documentId,
				employeeSkillId: null,
			});
			expect(cleared).toMatchObject({ success: true, data: { id: documentId, skill: null } });
			expect(await linkOf(documentId)).toBeNull();

			expect(
				(await auditOf(documentId, "personnel_file.skill_certificate_linked")).map(
					(entry) => entry.changes,
				),
			).toEqual([
				{ employeeSkillId: { from: null, to: ids.annaForklift } },
				{ employeeSkillId: { from: ids.annaForklift, to: ids.annaFirstAid } },
			]);
			expect(await auditOf(documentId, "personnel_file.skill_certificate_unlinked")).toEqual([
				expect.objectContaining({
					performedBy: userOf("certOfficer"),
					changes: { employeeSkillId: { from: ids.annaFirstAid, to: null } },
				}),
			]);
		});

		it("lists only the employee's own skills to pick from, for whoever manages certificates", async () => {
			signIn("certOfficer");
			const options = await certificateActions.listCertificateSkillOptionsAction(ids.anna);
			if (!options.success) throw new Error(options.error);
			expect(options.data).toEqual([
				{ employeeSkillId: ids.annaFirstAid, name: "First aid", requiresExpiry: false },
				{ employeeSkillId: ids.annaForklift, name: "Forklift licence", requiresExpiry: true },
			]);

			for (const person of ["sickOfficer", "manager", "anna"] as const) {
				signIn(person);
				expect(await certificateActions.listCertificateSkillOptionsAction(ids.anna)).toMatchObject({
					success: false,
				});
			}
		});

		it("lets an owner name a skill for an employee no officer covers", async () => {
			const documentId = await seedDocument("ben");
			signIn("owner");
			expect(
				await certificateActions.setCertificateSkillAction({
					documentId,
					employeeSkillId: ids.benForklift,
				}),
			).toMatchObject({ success: true });
			expect(await linkOf(documentId)).toBe(ids.benForklift);
		});
	});

	describe("refusals", () => {
		it("refuses a skill of another employee or another organization", async () => {
			const documentId = await seedDocument("anna");
			signIn("owner");
			for (const employeeSkillId of [ids.benForklift, ids.outsiderSkill]) {
				expect(
					await certificateActions.setCertificateSkillAction({ documentId, employeeSkillId }),
				).toEqual({
					success: false,
					error: "Choose one of this employee's skills.",
					code: "not_employee_skill",
				});
			}
			expect(await linkOf(documentId)).toBeNull();
		});

		it("refuses a document that is no certificate", async () => {
			const documentId = await seedDocument("anna", { category: "other" });
			signIn("owner");
			expect(
				await certificateActions.setCertificateSkillAction({
					documentId,
					employeeSkillId: ids.annaFirstAid,
				}),
			).toMatchObject({ success: false, code: "not_certificate" });
			expect(await linkOf(documentId)).toBeNull();
		});

		it("refuses a document of another organization as not found", async () => {
			const documentId = await seedDocument("outsider", { organizationId: OTHER_ORG });
			signIn("owner");
			expect(
				await certificateActions.setCertificateSkillAction({
					documentId,
					employeeSkillId: ids.outsiderSkill,
				}),
			).toEqual({ success: false, error: "Not found" });
			expect(await linkOf(documentId)).toBeNull();
		});

		it("refuses the employee on their own upload, a manager and a sick-note officer", async () => {
			const documentId = await seedDocument("anna", { visibility: "shared" });
			for (const person of ["anna", "manager", "sickOfficer"] as const) {
				signIn(person);
				expect(
					await certificateActions.setCertificateSkillAction({
						documentId,
						employeeSkillId: ids.annaFirstAid,
					}),
				).toEqual({ success: false, error: "Not found" });
			}
			expect(await linkOf(documentId)).toBeNull();
		});

		it("refuses an undated certificate for a skill that requires an expiry date", async () => {
			const undated = await seedDocument("anna", { expiryDate: null });
			signIn("certOfficer");
			expect(
				await certificateActions.setCertificateSkillAction({
					documentId: undated,
					employeeSkillId: ids.annaForklift,
				}),
			).toMatchObject({ success: false, code: "undated_requires_expiry" });
			expect(await linkOf(undated)).toBeNull();

			// A skill that never expires takes an undated certificate.
			expect(
				await certificateActions.setCertificateSkillAction({
					documentId: undated,
					employeeSkillId: ids.annaFirstAid,
				}),
			).toMatchObject({ success: true });
		});
	});

	describe("editing a skill certificate's metadata", () => {
		const metadata = (category: string, expiryDate: string | null) => ({
			category: category as "certificate",
			title: "Forklift licence",
			documentDate: "2026-09-01",
			payPeriod: null,
			visibility: "hr_only" as const,
			expiryDate,
		});

		it("refuses removing the expiry date while it names a skill that requires one", async () => {
			const documentId = await seedDocument("anna", { employeeSkillId: ids.annaForklift });
			signIn("certOfficer");
			expect(
				await personnelFileActions.updateEmployeeDocumentAction({
					documentId,
					metadata: metadata("certificate", null),
				}),
			).toMatchObject({ success: false, code: "invalid_expiryDate" });
			expect(await linkOf(documentId)).toBe(ids.annaForklift);
		});

		it("clears the link when the document stops being a certificate", async () => {
			const documentId = await seedDocument("anna", { employeeSkillId: ids.annaFirstAid });
			signIn("owner");
			expect(
				await personnelFileActions.updateEmployeeDocumentAction({
					documentId,
					metadata: metadata("other", "2027-03-31"),
				}),
			).toMatchObject({ success: true, data: { category: "other", skill: null } });
			expect(await linkOf(documentId)).toBeNull();
			const [updated] = await auditOf(documentId, "personnel_file.document_updated");
			expect(updated?.changes).toMatchObject({
				employeeSkillId: { from: ids.annaFirstAid, to: null },
			});
		});
	});

	describe("what scheduling and the skills card learn", () => {
		it("shows a manager that a certificate is on file without letting them open it", async () => {
			const documentId = await seedDocument("anna", { employeeSkillId: ids.annaForklift });

			const skills = await runSkills((service) => service.getEmployeeSkills(ORG, ids.anna));
			const onFile = new Map(skills.map((row) => [row.id, row.certificateOnFile]));
			expect(onFile.get(ids.annaForklift)).toBe(true);

			signIn("manager");
			expect((await serve(documentId)).status).toBe(404);
			expect(
				await personnelFileActions.getPersonnelFileAction({ employeeId: ids.anna }),
			).toMatchObject({ success: false });

			signIn("certOfficer");
			expect((await serve(documentId)).status).toBe(200);
		});

		it("marks an expired required skill in the scheduling check as having a certificate on file", async () => {
			const locationId = "e1144400-0000-4000-8000-000000000001";
			const subareaId = "e1144400-0000-4000-8000-000000000002";
			await admin.query(
				`insert into location (id, organization_id, name, created_by, updated_at)
				 values ($1, $2, 'Warehouse', $3, now())`,
				[locationId, ORG, userOf("owner")],
			);
			await admin.query(
				`insert into location_subarea (id, location_id, name, created_by, updated_at)
				 values ($1, $2, 'Dock', $3, now())`,
				[subareaId, locationId, userOf("owner")],
			);
			await admin.query(
				`insert into subarea_skill_requirement (subarea_id, skill_id, is_required, created_by)
				 values ($1, $2, true, $3)`,
				[subareaId, ids.forklift, userOf("owner")],
			);
			await admin.query("update employee_skill set expires_at = '2026-01-31' where id = $1", [
				ids.annaForklift,
			]);
			await seedDocument("anna", { employeeSkillId: ids.annaForklift });

			const result = await runSkills((service) =>
				service.validateEmployeeForSubarea(ORG, ids.anna, subareaId),
			);

			expect(result.expiredSkills).toEqual([
				expect.objectContaining({ id: ids.forklift, certificateOnFile: true }),
			]);
		});

		it("shows no certificate on file for a skill no certificate names", async () => {
			const skills = await runSkills((service) =>
				service.getEmployeeSkills(OTHER_ORG, ids.outsider),
			);
			expect(skills.map((row) => [row.id, row.certificateOnFile])).toEqual([
				[ids.outsiderSkill, false],
			]);
		});
	});

	describe("the database", () => {
		it("clears the link and keeps the certificate when the employee skill is removed", async () => {
			await seedSkill("e1144200-0000-4000-8000-000000000009", {
				organizationId: ORG,
				name: "Welding",
				requiresExpiry: false,
				createdBy: userOf("owner"),
			});
			const employeeSkillId = "e1144300-0000-4000-8000-000000000009";
			await seedEmployeeSkill(employeeSkillId, "anna", "e1144200-0000-4000-8000-000000000009");
			const documentId = await seedDocument("anna", { employeeSkillId });

			await runSkills((service) =>
				service.removeSkillFromEmployee(ORG, ids.anna, "e1144200-0000-4000-8000-000000000009"),
			);

			expect(await linkOf(documentId)).toBeNull();
		});

		it("refuses a link on another category or to another employee's skill", async () => {
			const sickNote = await seedDocument("anna", { category: "sick_note", expiryDate: null });
			await expect(
				admin.query("update employee_document set employee_skill_id = $1 where id = $2", [
					ids.annaFirstAid,
					sickNote,
				]),
			).rejects.toThrow(/employee_document_employee_skill_check/u);

			const certificate = await seedDocument("anna");
			await expect(
				admin.query("update employee_document set employee_skill_id = $1 where id = $2", [
					ids.benForklift,
					certificate,
				]),
			).rejects.toThrow(/employee_document_employee_skill_fk/u);
		});
	});
});
