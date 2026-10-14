/**
 * #1146: an employee is reminded once for a skill certificate, against a
 * disposable PostgreSQL database. A shared skill certificate and its employee
 * skill share one expiry date, so the personnel file job and the skill job are
 * both due: officers keep the certificate reminder, managers and the employee
 * get the skill reminder, and the employee never gets the certificate reminder
 * as well. Both hourly jobs run with a fixed clock; notification delivery is
 * replaced by a recorder.
 */

import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { integrationAdminPool } from "@/test/integration-database";

const sent = vi.hoisted(() => [] as CreateNotificationParams[]);

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/notifications/notification-service", () => ({
	createNotification: async (params: CreateNotificationParams) => {
		sent.push(params);
		return null;
	},
}));

const { db } = await import("@/db");
const { runPersonnelFileExpiryReminders } = await import("./expiry-reminders");
const { runSkillExpiryReminders } = await import("@/lib/scheduling/skill-expiry-reminders");
const { seedPersonnelFileOfficerGrant } = await import("./testing/officer-grant.test.fixture");

const ORG = "t1146-org";

const ids = {
	owner: "e1146000-0000-4000-8000-000000000001",
	officer: "e1146000-0000-4000-8000-000000000002",
	manager: "e1146000-0000-4000-8000-000000000003",
	anna: "e1146000-0000-4000-8000-000000000004",
	kim: "e1146000-0000-4000-8000-000000000005",
	leaver: "e1146000-0000-4000-8000-000000000006",
	berlin: "e1146100-0000-4000-8000-000000000001",
	forklift: "e1146200-0000-4000-8000-000000000001",
	retired: "e1146200-0000-4000-8000-000000000002",
	firstAid: "e1146200-0000-4000-8000-000000000003",
} as const;
type Person = "owner" | "officer" | "manager" | "anna" | "kim" | "leaver";
const userOf = (person: Person) => `t1146-${person}`;

const employeeSkills = {
	annaForklift: "e1146300-0000-4000-8000-000000000001",
	annaRetired: "e1146300-0000-4000-8000-000000000002",
	annaFirstAid: "e1146300-0000-4000-8000-000000000003",
	kimForklift: "e1146300-0000-4000-8000-000000000004",
	leaverForklift: "e1146300-0000-4000-8000-000000000005",
} as const;

const docs = {
	/** Shared, names Anna's forklift skill, same date as the skill. */
	annaForklift: "e1146400-0000-4000-8000-000000000001",
	/** Shared, names no skill. */
	annaPlain: "e1146400-0000-4000-8000-000000000002",
	/** Shared, names an employee skill whose skill is inactive. */
	annaRetired: "e1146400-0000-4000-8000-000000000003",
	/** Shared, names Anna's forklift skill, but an earlier date than the skill's. */
	annaOlderForklift: "e1146400-0000-4000-8000-000000000004",
	/** Shared, names the forklift skill of a kiosk-only employee. */
	kimForklift: "e1146400-0000-4000-8000-000000000005",
	/** Shared, names Anna's first aid skill; unlinked before its reminders are due. */
	annaFirstAid: "e1146400-0000-4000-8000-000000000006",
	/** Shared, names a former employee's skill. */
	leaverForklift: "e1146400-0000-4000-8000-000000000007",
} as const;

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query('delete from "user" where id like $1', ["t1146-%"]);
}

async function seedPerson(
	person: Person,
	input: { memberRole: string; email?: string; teamId?: string; isActive?: boolean },
) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
		[userOf(person), person, input.email ?? `${userOf(person)}@example.test`],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
		[`t1146-member-${person}`, ORG, userOf(person), input.memberRole],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,team_id,is_active,updated_at) values ($1,$2,$3,$4,$5,$6,now())",
		[
			ids[person],
			userOf(person),
			ORG,
			person === "manager" ? "manager" : "employee",
			input.teamId ?? null,
			input.isActive ?? true,
		],
	);
}

async function seedSkill(id: string, name: string, isActive = true) {
	await admin.query(
		`insert into skill (id, organization_id, name, category, requires_expiry, is_active, created_by, updated_at)
		 values ($1, $2, $3, 'certification', true, $4, $5, now())`,
		[id, ORG, name, isActive, userOf("owner")],
	);
}

async function assign(id: string, person: Person, skillId: string, expiresAt: string) {
	await admin.query(
		`insert into employee_skill (id, employee_id, skill_id, expires_at, assigned_by)
		 values ($1, $2, $3, $4, $5)`,
		[id, ids[person], skillId, expiresAt, userOf("owner")],
	);
}

async function seedCertificate(
	id: string,
	person: Person,
	input: { expiryDate: string; employeeSkillId: string | null },
) {
	await admin.query(
		`insert into employee_document (id, organization_id, employee_id, category, title, document_date,
		 visibility, expiry_date, employee_skill_id, storage_provider, storage_key, file_name, mime_type,
		 size_bytes, checksum_sha256)
		 values ($1, $2, $3, 'certificate', $4, '2026-01-15', 'shared', $5, $6, 's3-private', $7,
		 'certificate.pdf', 'application/pdf', 10, 'sha')`,
		[
			id,
			ORG,
			ids[person],
			`Certificate ${id.slice(-2)}`,
			input.expiryDate,
			input.employeeSkillId,
			`personnel-files/${ORG}/${ids[person]}/${id}-certificate.pdf`,
		],
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
	await seedPerson("owner", { memberRole: "owner" });
	await seedPerson("officer", { memberRole: "member" });
	await seedPerson("manager", { memberRole: "member" });
	await seedPerson("anna", { memberRole: "member", teamId: ids.berlin });
	// A kiosk-only employee cannot read notifications, so the skill job never tells her.
	await seedPerson("kim", {
		memberRole: "member",
		teamId: ids.berlin,
		email: "kiosk-t1146kim@kiosk.invalid",
	});
	await seedPerson("leaver", { memberRole: "member", teamId: ids.berlin, isActive: false });
	await admin.query(
		`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
		 values ($1, $2, true, $3)`,
		[ids.anna, ids.manager, userOf("owner")],
	);
	// The officer covers the Berlin team's certificates.
	await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.officer,
		createdBy: userOf("owner"),
		categories: ["certificate"],
		teamIds: [ids.berlin],
	});

	await seedSkill(ids.forklift, "Forklift licence");
	await seedSkill(ids.retired, "Retired licence", false);
	await seedSkill(ids.firstAid, "First aid");
	// Skill certificates set the employee skill's date to their latest one (#1145).
	await assign(employeeSkills.annaForklift, "anna", ids.forklift, "2026-11-30");
	await assign(employeeSkills.annaRetired, "anna", ids.retired, "2026-11-30");
	await assign(employeeSkills.annaFirstAid, "anna", ids.firstAid, "2027-02-28");
	await assign(employeeSkills.kimForklift, "kim", ids.forklift, "2026-11-30");
	await assign(employeeSkills.leaverForklift, "leaver", ids.forklift, "2026-11-30");

	await seedCertificate(docs.annaForklift, "anna", {
		expiryDate: "2026-11-30",
		employeeSkillId: employeeSkills.annaForklift,
	});
	await seedCertificate(docs.annaPlain, "anna", {
		expiryDate: "2026-11-30",
		employeeSkillId: null,
	});
	await seedCertificate(docs.annaRetired, "anna", {
		expiryDate: "2026-11-30",
		employeeSkillId: employeeSkills.annaRetired,
	});
	await seedCertificate(docs.annaOlderForklift, "anna", {
		expiryDate: "2026-11-15",
		employeeSkillId: employeeSkills.annaForklift,
	});
	await seedCertificate(docs.kimForklift, "kim", {
		expiryDate: "2026-11-30",
		employeeSkillId: employeeSkills.kimForklift,
	});
	await seedCertificate(docs.annaFirstAid, "anna", {
		expiryDate: "2027-02-28",
		employeeSkillId: employeeSkills.annaFirstAid,
	});
	await seedCertificate(docs.leaverForklift, "leaver", {
		expiryDate: "2026-11-30",
		employeeSkillId: employeeSkills.leaverForklift,
	});
}

/** Runs both hourly reminder jobs at one instant. */
async function runBoth(instant: string) {
	const now = Temporal.Instant.from(instant);
	const certificates = await runPersonnelFileExpiryReminders(db, { now });
	const skills = await runSkillExpiryReminders(db, { now });
	expect(certificates.success).toBe(true);
	expect(skills.success).toBe(true);
}

/** Notifications about one document or employee skill, as sorted `person:type` pairs. */
function toldAbout(entityId: string): string[] {
	return sent
		.filter((notification) => notification.entityId === entityId)
		.map((notification) => `${notification.userId.replace("t1146-", "")}:${notification.type}`)
		.toSorted();
}

describe("employee reminded once for a skill certificate (#1146)", () => {
	beforeAll(seed);
	afterAll(cleanup);
	beforeEach(() => {
		sent.length = 0;
	});

	it("expires soon: the employee gets the skill reminder only, officers the certificate reminder", async () => {
		await runBoth("2026-10-31T09:00:00Z");
		expect(toldAbout(docs.annaForklift)).toEqual(["officer:personnel_file_expiry_upcoming"]);
		expect(toldAbout(employeeSkills.annaForklift)).toEqual([
			"anna:skill_expiry_upcoming",
			"manager:skill_expiry_upcoming",
		]);
	});

	it("expires today: the employee gets the skill reminder only, officers the certificate reminder", async () => {
		await runBoth("2026-11-30T09:00:00Z");
		expect(toldAbout(docs.annaForklift)).toEqual(["officer:personnel_file_expired_today"]);
		expect(toldAbout(employeeSkills.annaForklift)).toEqual([
			"anna:skill_expired_today",
			"manager:skill_expired_today",
		]);
	});

	it("still reminds the employee about a shared certificate that names no skill", async () => {
		// Both kinds went out with the previous two runs; re-arm by moving the date.
		await admin.query("update employee_document set expiry_date = '2027-01-20' where id = $1", [
			docs.annaPlain,
		]);
		await runBoth("2027-01-10T09:00:00Z");
		expect(toldAbout(docs.annaPlain)).toEqual([
			"anna:personnel_file_expiry_upcoming",
			"officer:personnel_file_expiry_upcoming",
		]);
		sent.length = 0;
		await runBoth("2027-01-20T09:00:00Z");
		expect(toldAbout(docs.annaPlain)).toEqual([
			"anna:personnel_file_expired_today",
			"officer:personnel_file_expired_today",
		]);
	});

	it("restores the employee's certificate reminder when the certificate is unlinked before it is due", async () => {
		// Linked: the expires-soon reminder is the officer's only.
		await runBoth("2027-02-01T09:00:00Z");
		expect(toldAbout(docs.annaFirstAid)).toEqual(["officer:personnel_file_expiry_upcoming"]);
		// Unlinked before the expires-today reminder is due: the employee gets it again.
		await admin.query("update employee_document set employee_skill_id = null where id = $1", [
			docs.annaFirstAid,
		]);
		sent.length = 0;
		await runBoth("2027-02-28T09:00:00Z");
		expect(toldAbout(docs.annaFirstAid)).toEqual([
			"anna:personnel_file_expired_today",
			"officer:personnel_file_expired_today",
		]);
	});

	describe("when no skill reminder reaches the employee for the certificate's date, the certificate reminder does", () => {
		beforeAll(async () => {
			await cleanup();
			await seed();
		});

		it("covers an inactive linked skill, an earlier-dated certificate and a kiosk-only employee", async () => {
			await runBoth("2026-10-31T09:00:00Z");
			// Inactive skills get no skill reminder.
			expect(toldAbout(employeeSkills.annaRetired)).toEqual([]);
			expect(toldAbout(docs.annaRetired)).toEqual([
				"anna:personnel_file_expiry_upcoming",
				"officer:personnel_file_expiry_upcoming",
			]);
			// The skill's date is the latest certificate's; the earlier one has its own date.
			expect(toldAbout(docs.annaOlderForklift)).toEqual([
				"anna:personnel_file_expiry_upcoming",
				"officer:personnel_file_expiry_upcoming",
			]);
			// The skill job skips kiosk-only employees, so the certificate job keeps telling them.
			expect(toldAbout(employeeSkills.kimForklift)).not.toContain("kim:skill_expiry_upcoming");
			expect(toldAbout(docs.kimForklift)).toEqual([
				"kim:personnel_file_expiry_upcoming",
				"officer:personnel_file_expiry_upcoming",
			]);

			sent.length = 0;
			await runBoth("2026-11-30T09:00:00Z");
			expect(toldAbout(docs.annaRetired)).toEqual([
				"anna:personnel_file_expired_today",
				"officer:personnel_file_expired_today",
			]);
			expect(toldAbout(docs.kimForklift)).toEqual([
				"kim:personnel_file_expired_today",
				"officer:personnel_file_expired_today",
			]);
		});

		it("reminds nobody about a former employee, as both jobs already rule", async () => {
			for (const instant of ["2026-10-31T09:00:00Z", "2026-11-30T09:00:00Z"]) {
				await runBoth(instant);
			}
			expect(toldAbout(docs.leaverForklift)).toEqual([]);
			expect(toldAbout(employeeSkills.leaverForklift)).toEqual([]);
		});
	});
});
