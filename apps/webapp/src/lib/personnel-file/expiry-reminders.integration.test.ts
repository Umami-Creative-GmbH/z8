/**
 * #869: personnel file expiry reminders against a disposable PostgreSQL
 * database. The daily job runs with a fixed clock; notification delivery is
 * replaced by a recorder, so the assertions read who was told what.
 */

import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { integrationAdminPool } from "@/test/integration-database";

const sent = vi.hoisted(() => [] as CreateNotificationParams[]);
const session = vi.hoisted(() => ({ userId: null as string | null }));

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
				session.userId
					? {
							user: { id: session.userId, role: "user" },
							session: {
								id: `session-${session.userId}`,
								userId: session.userId,
								activeOrganizationId: "t869-org",
							},
						}
					: null,
		},
	},
}));
vi.mock("@/lib/notifications/notification-service", () => ({
	createNotification: async (params: CreateNotificationParams) => {
		sent.push(params);
		return null;
	},
}));

const { db } = await import("@/db");
const { runPersonnelFileExpiryReminders } = await import("./expiry-reminders");
const { listExpiringDocuments, loadExpiryReminderLeadDays, saveExpiryReminderLeadDays } =
	await import("./expiry-store");
const { resolvePersonnelFileAccess } = await import("./access-store");
const { seedPersonnelFileOfficerGrant } = await import("./testing/officer-grant.test.fixture");
const { savePersonnelFileExpiryLeadDaysAction } = await import(
	"@/app/[locale]/(app)/settings/personnel-files/reminder-actions"
);

const ORG = "t869-org";
const OFF_ORG = "t869-off";

const ids = {
	owner: "e8690000-0000-4000-8000-000000000001",
	admin: "e8690000-0000-4000-8000-000000000002",
	officer: "e8690000-0000-4000-8000-000000000003",
	anna: "e8690000-0000-4000-8000-000000000004",
	ben: "e8690000-0000-4000-8000-000000000005",
	leaver: "e8690000-0000-4000-8000-000000000006",
	offOwner: "e8690000-0000-4000-8000-000000000007",
	offAnna: "e8690000-0000-4000-8000-000000000008",
	berlin: "e8691000-0000-4000-8000-000000000001",
} as const;
type Person = Exclude<keyof typeof ids, "berlin">;
const userOf = (person: Person) => `t869-${person}`;

const docs = {
	annaCertificate: "e8692000-0000-4000-8000-000000000001",
	annaHrOnly: "e8692000-0000-4000-8000-000000000002",
	benCertificate: "e8692000-0000-4000-8000-000000000003",
	leaverCertificate: "e8692000-0000-4000-8000-000000000004",
	offCertificate: "e8692000-0000-4000-8000-000000000005",
	annaExpired: "e8692000-0000-4000-8000-000000000006",
	annaContract: "e8692000-0000-4000-8000-000000000007",
} as const;

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from organization where id = any($1)", [[ORG, OFF_ORG]]);
	await admin.query("delete from personnel_file_upload where organization_id = any($1)", [
		[ORG, OFF_ORG],
	]);
	await admin.query('delete from "user" where id like $1', ["t869-%"]);
}

async function seedOrganization(id: string, enabled: boolean) {
	await admin.query(
		`insert into organization (id, name, slug, timezone, personnel_files_enabled, created_at)
		 values ($1, $1, $1, 'Europe/Berlin', $2, now())`,
		[id, enabled],
	);
}

async function seedPerson(
	name: Person,
	organizationId: string,
	memberRole: string,
	options: { teamId?: string | null; isActive?: boolean } = {},
) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
		[userOf(name), name, `${userOf(name)}@example.test`],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
		[`t869-member-${name}`, organizationId, userOf(name), memberRole],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,team_id,is_active,updated_at) values ($1,$2,$3,'employee',$4,$5,now())",
		[ids[name], userOf(name), organizationId, options.teamId ?? null, options.isActive ?? true],
	);
}

async function seedDocument(input: {
	id: string;
	organizationId?: string;
	employee: Person;
	category?: "certificate" | "other" | "contract";
	visibility?: "shared" | "hr_only";
	expiryDate: string | null;
	title?: string;
}) {
	const organizationId = input.organizationId ?? ORG;
	await admin.query(
		`insert into employee_document (id, organization_id, employee_id, category, title, document_date,
		 visibility, expiry_date, storage_provider, storage_key, file_name, mime_type, size_bytes, checksum_sha256)
		 values ($1, $2, $3, $4, $5, '2026-01-15', $6, $7, 's3-private', $8, 'document.pdf',
		 'application/pdf', 10, 'sha')`,
		[
			input.id,
			organizationId,
			ids[input.employee],
			input.category ?? "certificate",
			input.title ?? `Document ${input.id.slice(-2)}`,
			input.visibility ?? "shared",
			input.expiryDate,
			`personnel-files/${organizationId}/${ids[input.employee]}/${input.id}-document.pdf`,
		],
	);
}

async function seed() {
	await cleanup();
	await seedOrganization(ORG, true);
	await seedOrganization(OFF_ORG, false);
	await admin.query(
		"insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Berlin', now())",
		[ids.berlin, ORG],
	);
	await seedPerson("owner", ORG, "owner");
	await seedPerson("admin", ORG, "admin");
	await seedPerson("officer", ORG, "member");
	await seedPerson("anna", ORG, "member", { teamId: ids.berlin });
	await seedPerson("ben", ORG, "member");
	await seedPerson("leaver", ORG, "member", { teamId: ids.berlin, isActive: false });
	await seedPerson("offOwner", OFF_ORG, "owner");
	await seedPerson("offAnna", OFF_ORG, "member");
	// The officer covers the Berlin team for certificates and other documents.
	await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.officer,
		createdBy: userOf("owner"),
		categories: ["certificate", "other"],
		teamIds: [ids.berlin],
	});
	await seedDocument({ id: docs.annaCertificate, employee: "anna", expiryDate: "2026-11-30" });
	await seedDocument({
		id: docs.annaHrOnly,
		employee: "anna",
		category: "other",
		visibility: "hr_only",
		expiryDate: "2026-11-20",
	});
	await seedDocument({ id: docs.benCertificate, employee: "ben", expiryDate: "2026-11-25" });
	await seedDocument({ id: docs.leaverCertificate, employee: "leaver", expiryDate: "2026-11-30" });
	await seedDocument({
		id: docs.offCertificate,
		organizationId: OFF_ORG,
		employee: "offAnna",
		expiryDate: "2026-11-30",
	});
	await seedDocument({ id: docs.annaExpired, employee: "anna", expiryDate: "2026-09-01" });
	await seedDocument({
		id: docs.annaContract,
		employee: "anna",
		category: "contract",
		expiryDate: null,
	});
}

const at = (value: string) => Temporal.Instant.from(value);

/** Notifications about one document, as `user:type` pairs. */
function toldAbout(documentId: string): string[] {
	return sent
		.filter((notification) => notification.entityId === documentId)
		.map((notification) => `${notification.userId}:${notification.type}`)
		.toSorted();
}

async function run(instant: string) {
	return runPersonnelFileExpiryReminders(db, { now: at(instant) });
}

describe("personnel file expiry reminders", () => {
	beforeAll(seed);
	afterAll(cleanup);
	beforeEach(() => {
		sent.length = 0;
	});

	it("sends nothing before the lead time starts in the organization's timezone", async () => {
		// 30 October 23:30 in Berlin: one day before the 30-day lead time.
		await run("2026-10-30T22:30:00Z");
		expect(toldAbout(docs.annaCertificate)).toEqual([]);
		// Documents expiring earlier are already within it: the HR-only one never
		// reaches the employee, and owners and admins step in where no officer covers.
		expect(toldAbout(docs.annaHrOnly)).toEqual(["t869-officer:personnel_file_expiry_upcoming"]);
		expect(toldAbout(docs.benCertificate)).toEqual([
			"t869-admin:personnel_file_expiry_upcoming",
			"t869-ben:personnel_file_expiry_upcoming",
			"t869-owner:personnel_file_expiry_upcoming",
		]);
	});

	it("sends the upcoming reminder once the organization's day is within the lead time", async () => {
		// 30 October 23:30 UTC is already 31 October in Berlin.
		await run("2026-10-30T23:30:00Z");
		expect(toldAbout(docs.annaCertificate)).toEqual([
			"t869-anna:personnel_file_expiry_upcoming",
			"t869-officer:personnel_file_expiry_upcoming",
		]);
		const employeeNotice = sent.find(
			(notification) =>
				notification.entityId === docs.annaCertificate && notification.userId === "t869-anna",
		);
		expect(employeeNotice).toMatchObject({
			organizationId: ORG,
			actionUrl: "/my-documents",
			metadata: expect.objectContaining({
				expiryDate: "2026-11-30",
				i18n: expect.objectContaining({
					titleKey: "common:notifications.content.personnelFileExpiryUpcoming.title",
				}),
			}),
		});
		const officerNotice = sent.find(
			(notification) =>
				notification.entityId === docs.annaCertificate && notification.userId === "t869-officer",
		);
		expect(officerNotice?.actionUrl).toBe(`/personnel-files/${ids.anna}`);
	});

	it("sends nothing new when the job runs again the same day", async () => {
		await run("2026-10-31T09:00:00Z");
		await run("2026-10-31T10:00:00Z");
		expect(sent).toEqual([]);
	});

	it("never tells the employee about an HR-only document on its expiry date", async () => {
		await run("2026-11-20T08:00:00Z");
		expect(toldAbout(docs.annaHrOnly)).toEqual(["t869-officer:personnel_file_expired_today"]);
	});

	it("skips former employees, organizations with personnel files off, and documents without an expiry date", async () => {
		await run("2026-11-30T08:00:00Z");
		expect(toldAbout(docs.leaverCertificate)).toEqual([]);
		expect(toldAbout(docs.offCertificate)).toEqual([]);
		expect(toldAbout(docs.annaContract)).toEqual([]);
		expect(toldAbout(docs.annaExpired)).toEqual([]);
	});

	it("sends the expired-today reminder on the expiry date, once", async () => {
		// The previous test already ran on 30 November.
		expect(
			(
				await admin.query(
					"select kind from personnel_file_expiry_reminder where document_id = $1 order by kind",
					[docs.annaCertificate],
				)
			).rows,
		).toEqual([{ kind: "expired_today" }, { kind: "upcoming" }]);
		sent.length = 0;
		await run("2026-11-30T12:00:00Z");
		expect(toldAbout(docs.annaCertificate)).toEqual([]);
	});

	it("re-arms both reminders when the expiry date moves", async () => {
		await admin.query("update employee_document set expiry_date = '2027-03-31' where id = $1", [
			docs.annaCertificate,
		]);
		await run("2027-03-01T08:00:00Z");
		expect(toldAbout(docs.annaCertificate)).toEqual([
			"t869-anna:personnel_file_expiry_upcoming",
			"t869-officer:personnel_file_expiry_upcoming",
		]);
		sent.length = 0;
		await run("2027-03-31T08:00:00Z");
		expect(toldAbout(docs.annaCertificate)).toEqual([
			"t869-anna:personnel_file_expired_today",
			"t869-officer:personnel_file_expired_today",
		]);
	});

	it("uses the organization's lead time", async () => {
		await seedDocument({
			id: "e8692000-0000-4000-8000-000000000010",
			employee: "anna",
			expiryDate: "2027-06-30",
		});
		await saveExpiryReminderLeadDays(db, { organizationId: ORG, leadDays: 7 });
		expect(await loadExpiryReminderLeadDays(db, ORG)).toBe(7);
		await run("2027-06-22T08:00:00Z");
		expect(toldAbout("e8692000-0000-4000-8000-000000000010")).toEqual([]);
		await run("2027-06-23T08:00:00Z");
		expect(toldAbout("e8692000-0000-4000-8000-000000000010")).toHaveLength(2);
		await saveExpiryReminderLeadDays(db, { organizationId: ORG, leadDays: 30 });
	});

	it("defaults the lead time to 30 days", async () => {
		expect(await loadExpiryReminderLeadDays(db, OFF_ORG)).toBe(30);
	});
});

describe("expiring documents list", () => {
	beforeAll(seed);
	afterAll(cleanup);

	async function listFor(person: Person, instant: string) {
		const access = await resolvePersonnelFileAccess(db, {
			userId: userOf(person),
			organizationId: ORG,
		});
		if (!access) throw new Error(`${person} has no access`);
		return listExpiringDocuments(db, access, { now: at(instant) });
	}

	it("lists documents expiring within the lead time and expired ones, for the viewer's access", async () => {
		const forAdmin = await listFor("admin", "2026-11-01T08:00:00Z");
		expect(forAdmin.map((row) => row.documentId)).toEqual([
			docs.annaExpired,
			docs.annaHrOnly,
			docs.benCertificate,
			docs.annaCertificate,
		]);
		expect(forAdmin[0]).toMatchObject({
			employeeId: ids.anna,
			employeeName: "anna",
			category: "certificate",
			expiryDate: "2026-09-01",
			expiry: { status: "expired", days: 61 },
		});

		const forOfficer = await listFor("officer", "2026-11-01T08:00:00Z");
		expect(forOfficer.map((row) => row.documentId)).toEqual([
			docs.annaExpired,
			docs.annaHrOnly,
			docs.annaCertificate,
		]);
	});

	it("leaves out documents beyond the lead time and former employees' documents", async () => {
		const early = await listFor("admin", "2026-10-01T08:00:00Z");
		expect(early.map((row) => row.documentId)).toEqual([docs.annaExpired]);
	});

	it("shows an employee without a grant nothing", async () => {
		const access = await resolvePersonnelFileAccess(db, {
			userId: userOf("anna"),
			organizationId: ORG,
		});
		if (!access) throw new Error("anna has no access");
		expect(await listExpiringDocuments(db, access, { now: at("2026-11-01T08:00:00Z") })).toEqual(
			[],
		);
	});
});

describe("reminder lead time setting", () => {
	beforeAll(seed);
	afterAll(async () => {
		session.userId = null;
		await cleanup();
	});

	it("lets owners and admins change the lead time", async () => {
		session.userId = userOf("admin");
		expect(await savePersonnelFileExpiryLeadDaysAction({ leadDays: "14" })).toEqual({
			success: true,
			data: { leadDays: 14 },
		});
		expect(await loadExpiryReminderLeadDays(db, ORG)).toBe(14);
	});

	it("refuses officers and employees", async () => {
		for (const person of ["officer", "anna"] as const) {
			session.userId = userOf(person);
			expect(await savePersonnelFileExpiryLeadDaysAction({ leadDays: 60 })).toMatchObject({
				success: false,
			});
		}
		expect(await loadExpiryReminderLeadDays(db, ORG)).toBe(14);
	});

	it("refuses a lead time outside 1 to 365 days", async () => {
		session.userId = userOf("owner");
		expect(await savePersonnelFileExpiryLeadDaysAction({ leadDays: 0 })).toEqual({
			success: false,
			error: "Enter a lead time between 1 and 365 days.",
		});
		expect(await loadExpiryReminderLeadDays(db, ORG)).toBe(14);
	});
});
