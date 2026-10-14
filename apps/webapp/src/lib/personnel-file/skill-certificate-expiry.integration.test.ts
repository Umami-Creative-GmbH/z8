/**
 * #1145: skill certificates set the skill expiry date (Scheduling ADR 0001),
 * against a disposable PostgreSQL database. Every recompute trigger goes
 * through the real server actions (link, re-date, unlink, delete, purge), and
 * the skill side through the skill service; only the session, billing guard
 * and object storage are replaced.
 */

import { createHash } from "node:crypto";
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/effect/errors";
import { integrationAdminPool } from "@/test/integration-database";

const PDF = Buffer.from("%PDF-1.4\n%%EOF");

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1145-org",
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
		return { bucket: "t1145-private", versionId: null };
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

const personnelFileActions = await import("@/app/[locale]/(app)/personnel-files/actions");
const certificateActions = await import(
	"@/app/[locale]/(app)/personnel-files/skill-certificate-actions"
);
const retentionActions = await import("@/app/[locale]/(app)/personnel-files/retention-actions");
const { SkillService, SkillServiceLive } = await import("@/lib/effect/services/skill.service");
const { DatabaseServiceLive } = await import("@/lib/effect/services/database.service");

const ORG = "t1145-org";

const ids = {
	owner: "e1145000-0000-4000-8000-000000000001",
	anna: "e1145000-0000-4000-8000-000000000002",
	cara: "e1145000-0000-4000-8000-000000000003",
	forklift: "e1145200-0000-4000-8000-000000000001",
	firstAid: "e1145200-0000-4000-8000-000000000002",
	annaForklift: "e1145300-0000-4000-8000-000000000001",
	annaFirstAid: "e1145300-0000-4000-8000-000000000002",
	caraForklift: "e1145300-0000-4000-8000-000000000003",
} as const;
type Person = "owner" | "anna" | "cara";
const userOf = (person: Person) => `t1145-${person}`;
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");

const admin = integrationAdminPool();
const skillLayer = SkillServiceLive.pipe(Layer.provide(DatabaseServiceLive));
const runSkills = <A, E>(program: (service: SkillService["Service"]) => Effect.Effect<A, E>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* program(yield* SkillService);
		}).pipe(Effect.provide(skillLayer)),
	);
const runSkillsResult = <A, E>(
	program: (service: SkillService["Service"]) => Effect.Effect<A, E>,
) => runSkills((service) => Effect.result(program(service)));

async function cleanup() {
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query("delete from personnel_file_upload where organization_id = $1", [ORG]);
	await admin.query('delete from "user" where id like $1', ["t1145-%"]);
}

async function seedPerson(person: Person, input: { memberRole: string; active?: boolean }) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,$4,$4)',
		[userOf(person), person, `${userOf(person)}@example.test`, SEEDED_AT],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',$5)",
		[`t1145-member-${person}`, ORG, userOf(person), input.memberRole, SEEDED_AT],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,is_active,updated_at) values ($1,$2,$3,$4,$5,$6)",
		[
			ids[person],
			userOf(person),
			ORG,
			person === "owner" ? "admin" : "employee",
			input.active ?? true,
			SEEDED_AT,
		],
	);
}

async function seedSkill(id: string, input: { name: string; requiresExpiry: boolean }) {
	await admin.query(
		`insert into skill (id, organization_id, name, category, requires_expiry, created_by, updated_at)
		 values ($1, $2, $3, 'certification', $4, $5, $6)`,
		[id, ORG, input.name, input.requiresExpiry, userOf("owner"), SEEDED_AT],
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
	await admin.query(
		`insert into organization (id, name, slug, timezone, personnel_files_enabled, created_at)
		 values ($1, $1, $1, 'Europe/Berlin', true, $2)`,
		[ORG, SEEDED_AT],
	);
	await seedPerson("owner", { memberRole: "owner" });
	await seedPerson("anna", { memberRole: "member" });
	// A former employee without a known employment end: her documents can be purged by hand.
	await seedPerson("cara", { memberRole: "member", active: false });
	await seedSkill(ids.forklift, { name: "Forklift licence", requiresExpiry: true });
	await seedSkill(ids.firstAid, { name: "First aid", requiresExpiry: false });
	await seedEmployeeSkill(ids.annaForklift, "anna", ids.forklift);
	await seedEmployeeSkill(ids.annaFirstAid, "anna", ids.firstAid);
	await seedEmployeeSkill(ids.caraForklift, "cara", ids.forklift);
	await admin.query(
		`insert into personnel_file_retention_period
		 (id, organization_id, category, retention_years, updated_by, created_at, updated_at)
		 values (gen_random_uuid(), $1, 'certificate', 1, $2, $3, $3)`,
		[ORG, userOf("owner"), SEEDED_AT],
	);
}

/** Every test starts from no certificates and the given skill expiry dates. */
type EmployeeSkillKey = "annaForklift" | "annaFirstAid" | "caraForklift";
async function reset(dates: Partial<Record<EmployeeSkillKey, string>> = {}) {
	await admin.query("delete from employee_document where organization_id = $1", [ORG]);
	await admin.query("update organization set personnel_files_enabled = true where id = $1", [ORG]);
	for (const key of ["annaForklift", "annaFirstAid", "caraForklift"] as const) {
		await admin.query("update employee_skill set expires_at = $2 where id = $1", [
			ids[key],
			dates[key] ?? null,
		]);
	}
}

function signIn(person: Person) {
	harness.userId = userOf(person);
	harness.organizationId = ORG;
}

let documentCounter = 0;
async function seedCertificate(
	employee: Person,
	input: { expiryDate?: string | null; employeeSkillId?: string | null } = {},
): Promise<string> {
	documentCounter += 1;
	const id = `e1145500-0000-4000-8000-${String(documentCounter).padStart(12, "0")}`;
	await admin.query(
		`insert into employee_document
		 (id, organization_id, employee_id, category, title, document_date, visibility, expiry_date,
		  employee_skill_id, storage_provider, storage_bucket, storage_key, file_name, mime_type,
		  size_bytes, checksum_sha256)
		 values ($1, $2, $3, 'certificate', $4, '2020-09-01', 'hr_only', $5, $6,
		  's3-private', 't1145-private', $7, 'certificate.pdf', 'application/pdf', $8, $9)`,
		[
			id,
			ORG,
			ids[employee],
			`Certificate ${documentCounter}`,
			input.expiryDate === undefined ? "2027-03-31" : input.expiryDate,
			input.employeeSkillId ?? null,
			`personnel-files/${ORG}/${ids[employee]}/${id}-certificate.pdf`,
			PDF.length,
			createHash("sha256").update(PDF).digest("hex"),
		],
	);
	return id;
}

async function expiryOf(employeeSkillId: string): Promise<string | null | undefined> {
	const { rows } = await admin.query<{ expires_at: string | null }>(
		"select expires_at::text as expires_at from employee_skill where id = $1",
		[employeeSkillId],
	);
	return rows[0] ? rows[0].expires_at : undefined;
}

async function link(documentId: string, employeeSkillId: string | null) {
	signIn("owner");
	const result = await certificateActions.setCertificateSkillAction({
		documentId,
		employeeSkillId,
	});
	if (!result.success) throw new Error(result.error);
}

async function redate(documentId: string, expiryDate: string | null) {
	signIn("owner");
	const result = await personnelFileActions.updateEmployeeDocumentAction({
		documentId,
		metadata: {
			category: "certificate",
			title: "Forklift licence",
			documentDate: "2020-09-01",
			payPeriod: null,
			visibility: "hr_only",
			expiryDate,
		},
	});
	if (!result.success) throw new Error(result.error);
}

function editOnSkillSide(employeeSkill: "annaForklift" | "annaFirstAid", expiresAt: string | null) {
	return runSkillsResult((service) =>
		service.updateEmployeeSkillExpiry({
			organizationId: ORG,
			employeeId: ids.anna,
			skillId: employeeSkill === "annaForklift" ? ids.forklift : ids.firstAid,
			expiresAt,
		}),
	);
}

const rejected = { _tag: "Failure", failure: expect.any(ValidationError) };

describe("skill certificates set the skill expiry date (#1145)", () => {
	beforeAll(seed);
	afterAll(cleanup);
	beforeEach(() => reset({ annaForklift: "2026-10-31" }));

	describe("linking", () => {
		it("sets the latest expiry date among the dated skill certificates", async () => {
			const earlier = await seedCertificate("anna", { expiryDate: "2027-03-31" });
			const later = await seedCertificate("anna", { expiryDate: "2028-03-31" });

			await link(earlier, ids.annaForklift);
			expect(await expiryOf(ids.annaForklift)).toBe("2027-03-31");

			await link(later, ids.annaForklift);
			expect(await expiryOf(ids.annaForklift)).toBe("2028-03-31");
		});

		it("leaves a never-expiring skill's date alone for an undated skill certificate", async () => {
			const undated = await seedCertificate("anna", { expiryDate: null });

			await link(undated, ids.annaFirstAid);

			expect(await expiryOf(ids.annaFirstAid)).toBeNull();
			// Undated certificates do not control the date: the skill side still edits it.
			expect(await editOnSkillSide("annaFirstAid", "2029-01-31")).toMatchObject({
				_tag: "Success",
			});
			expect(await expiryOf(ids.annaFirstAid)).toBe("2029-01-31");
		});
	});

	describe("re-dating", () => {
		it("moves the date to the latest one left when the later certificate is re-dated earlier", async () => {
			const earlier = await seedCertificate("anna", { expiryDate: "2027-03-31" });
			const later = await seedCertificate("anna", { expiryDate: "2028-03-31" });
			await link(earlier, ids.annaForklift);
			await link(later, ids.annaForklift);

			await redate(later, "2026-12-31");

			expect(await expiryOf(ids.annaForklift)).toBe("2027-03-31");
		});

		it("keeps the date it had when the last dated skill certificate is re-dated to no date", async () => {
			const certificate = await seedCertificate("anna", { expiryDate: "2027-03-31" });
			await link(certificate, ids.annaFirstAid);
			expect(await expiryOf(ids.annaFirstAid)).toBe("2027-03-31");

			await redate(certificate, null);

			expect(await expiryOf(ids.annaFirstAid)).toBe("2027-03-31");
			expect(await editOnSkillSide("annaFirstAid", "2030-01-31")).toMatchObject({
				_tag: "Success",
			});
			expect(await expiryOf(ids.annaFirstAid)).toBe("2030-01-31");
		});
	});

	describe("the skill side while certificates set the date", () => {
		it("rejects editing the date and shows that a certificate sets it", async () => {
			const certificate = await seedCertificate("anna", { expiryDate: "2028-03-31" });
			await link(certificate, ids.annaForklift);

			// A stable refusal the skills card maps to its own copy.
			expect(await editOnSkillSide("annaForklift", "2030-01-31")).toMatchObject({
				_tag: "Failure",
				failure: expect.objectContaining({ refusal: "expiry_date_set_by_certificate" }),
			});
			expect(await expiryOf(ids.annaForklift)).toBe("2028-03-31");

			const skills = await runSkills((service) => service.getEmployeeSkills(ORG, ids.anna));
			expect(skills.map((row) => [row.id, row.expiresAt, row.expiryDateFromCertificate])).toEqual(
				expect.arrayContaining([
					[ids.annaForklift, "2028-03-31", true],
					[ids.annaFirstAid, null, false],
				]),
			);
		});

		it("rejects re-assigning the skill with another date", async () => {
			const certificate = await seedCertificate("anna", { expiryDate: "2028-03-31" });
			await link(certificate, ids.annaForklift);

			const result = await runSkillsResult((service) =>
				service.assignSkillToEmployee({
					organizationId: ORG,
					employeeId: ids.anna,
					skillId: ids.forklift,
					expiresAt: "2030-01-31",
					assignedBy: userOf("owner"),
				}),
			);

			expect(result).toMatchObject(rejected);
			expect(await expiryOf(ids.annaForklift)).toBe("2028-03-31");
		});

		it("lets the skill side edit the date while personnel files are disabled", async () => {
			const certificate = await seedCertificate("anna", { expiryDate: "2028-03-31" });
			await link(certificate, ids.annaForklift);
			await admin.query("update organization set personnel_files_enabled = false where id = $1", [
				ORG,
			]);

			expect(await editOnSkillSide("annaForklift", "2030-01-31")).toMatchObject({
				_tag: "Success",
			});
			expect(await expiryOf(ids.annaForklift)).toBe("2030-01-31");
			const skills = await runSkills((service) => service.getEmployeeSkills(ORG, ids.anna));
			expect(skills.find((row) => row.id === ids.annaForklift)).toMatchObject({
				expiryDateFromCertificate: false,
			});
		});
	});

	describe("when the last dated skill certificate goes", () => {
		it("keeps the date and lets the skill side edit it after unlinking", async () => {
			const earlier = await seedCertificate("anna", { expiryDate: "2027-03-31" });
			const later = await seedCertificate("anna", { expiryDate: "2028-03-31" });
			await link(earlier, ids.annaForklift);
			await link(later, ids.annaForklift);

			await link(later, null);
			expect(await expiryOf(ids.annaForklift)).toBe("2027-03-31");
			expect(await editOnSkillSide("annaForklift", "2030-01-31")).toMatchObject(rejected);

			await link(earlier, null);
			expect(await expiryOf(ids.annaForklift)).toBe("2027-03-31");
			expect(await editOnSkillSide("annaForklift", "2030-01-31")).toMatchObject({
				_tag: "Success",
			});
			expect(await expiryOf(ids.annaForklift)).toBe("2030-01-31");
		});

		it("keeps the date after the certificates are deleted", async () => {
			const earlier = await seedCertificate("anna", { expiryDate: "2027-03-31" });
			const later = await seedCertificate("anna", { expiryDate: "2028-03-31" });
			await link(earlier, ids.annaForklift);
			await link(later, ids.annaForklift);

			signIn("owner");
			expect(
				await personnelFileActions.deleteEmployeeDocumentAction({
					documentId: later,
					reason: null,
				}),
			).toMatchObject({ success: true });
			expect(await expiryOf(ids.annaForklift)).toBe("2027-03-31");

			expect(
				await personnelFileActions.deleteEmployeeDocumentAction({
					documentId: earlier,
					reason: null,
				}),
			).toMatchObject({ success: true });
			expect(await expiryOf(ids.annaForklift)).toBe("2027-03-31");
			expect(await editOnSkillSide("annaForklift", "2030-01-31")).toMatchObject({
				_tag: "Success",
			});
		});

		it("keeps the date after the certificates are purged", async () => {
			const earlier = await seedCertificate("cara", { expiryDate: "2027-03-31" });
			const later = await seedCertificate("cara", { expiryDate: "2028-03-31" });
			await link(earlier, ids.caraForklift);
			await link(later, ids.caraForklift);
			expect(await expiryOf(ids.caraForklift)).toBe("2028-03-31");

			signIn("owner");
			expect(
				await retentionActions.purgeDueDocumentsAction({ documentIds: [later], reason: null }),
			).toMatchObject({ success: true, data: { purged: [later] } });
			expect(await expiryOf(ids.caraForklift)).toBe("2027-03-31");

			expect(
				await retentionActions.purgeDueDocumentsAction({ documentIds: [earlier], reason: null }),
			).toMatchObject({ success: true, data: { purged: [earlier] } });
			expect(await expiryOf(ids.caraForklift)).toBe("2027-03-31");
		});
	});
});
