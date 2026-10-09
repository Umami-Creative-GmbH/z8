/**
 * #870: retention periods, the due-for-deletion list, confirmed purges and the
 * daily reminder against a disposable PostgreSQL database. Settings and purges
 * go through the real server actions; the session, notification delivery and
 * object storage are replaced. Employment periods are seeded as a departure
 * and a rehire leave them (closed at the cutoff, then a new open period).
 */

import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t870-org",
	objects: new Map<string, Buffer>(),
	notifications: [] as Array<{
		userId: string;
		type: string;
		idempotencyKey?: string;
		metadata?: unknown;
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
		idempotencyKey?: string;
		metadata?: unknown;
	}) => {
		harness.notifications.push(params);
		return null;
	},
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	async uploadPrivateObject(_organizationId: string, key: string, data: Uint8Array) {
		harness.objects.set(key, Buffer.from(data));
		return { bucket: "t870-private", versionId: null };
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
const retentionActions = await import("@/app/[locale]/(app)/personnel-files/retention-actions");
const settingsActions = await import(
	"@/app/[locale]/(app)/settings/personnel-files/retention-actions"
);
const { resolvePersonnelFileAccess } = await import("./access-store");
const { listDueDocuments, purgeDueDocuments, loadRetentionPeriods } = await import(
	"./retention-store"
);
const { runPersonnelFileRetentionReminders } = await import("./retention-reminders");
const { seedPersonnelFileOfficerGrant } = await import("./testing/officer-grant.test.fixture");

const ORG = "t870-org";
const BERLIN = "Europe/Berlin";

const ids = {
	owner: "e8700000-0000-4000-8000-000000000001",
	officer: "e8700000-0000-4000-8000-000000000002",
	anna: "e8700000-0000-4000-8000-000000000003",
	ben: "e8700000-0000-4000-8000-000000000004",
	carla: "e8700000-0000-4000-8000-000000000005",
	dora: "e8700000-0000-4000-8000-000000000006",
	berlin: "e8701000-0000-4000-8000-000000000001",
	munich: "e8701000-0000-4000-8000-000000000002",
} as const;
type Person = "owner" | "officer" | "anna" | "ben" | "carla" | "dora";
const userOf = (person: Person) => `t870-${person}`;

const admin = integrationAdminPool();
let documentCounter = 0;

/** An instant at a wall-clock time in Berlin. */
function berlin(dateTime: string) {
	return Temporal.PlainDateTime.from(dateTime).toZonedDateTime(BERLIN).toInstant();
}

async function cleanup() {
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query("delete from personnel_file_upload where organization_id = $1", [ORG]);
	await admin.query('delete from "user" where id like $1', ["t870-%"]);
}

async function seedPerson(name: Person, memberRole: string, teamId: string | null = null) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
		[userOf(name), name, `${userOf(name)}@example.test`],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
		[`t870-member-${name}`, ORG, userOf(name), memberRole],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,team_id,is_active,updated_at) values ($1,$2,$3,'employee',$4,true,now())",
		[ids[name], userOf(name), ORG, teamId],
	);
}

/** A departure ended the employment after `lastDay` (cutoff at the next local midnight). */
async function departed(name: Person, started: string, lastDay: string) {
	const cutoff = Temporal.PlainDate.from(lastDay)
		.add({ days: 1 })
		.toZonedDateTime({ timeZone: BERLIN })
		.toInstant();
	await admin.query(
		`insert into employee_employment_period
		 (organization_id, employee_id, status, started_at, ended_at, start_provenance)
		 values ($1, $2, 'closed', $3, $4, 'recorded')`,
		[ORG, ids[name], berlin(`${started}T00:00`).toString(), cutoff.toString()],
	);
	await admin.query("update employee set is_active = false where id = $1", [ids[name]]);
}

async function employed(name: Person, started: string) {
	await admin.query(
		`insert into employee_employment_period
		 (organization_id, employee_id, status, started_at, start_provenance)
		 values ($1, $2, 'open', $3, 'recorded')`,
		[ORG, ids[name], berlin(`${started}T00:00`).toString()],
	);
}

async function seedDocument(
	name: Person,
	input: { category: string; title: string; documentDate: string },
): Promise<string> {
	documentCounter += 1;
	const id = `e8702000-0000-4000-8000-${documentCounter.toString().padStart(12, "0")}`;
	const key = `personnel-files/${ORG}/${ids[name]}/${id}-document.pdf`;
	const payPeriod =
		input.category === "payslip"
			? [Number(input.documentDate.slice(0, 4)), Number(input.documentDate.slice(5, 7))]
			: [null, null];
	await admin.query(
		`insert into employee_document
		 (id, organization_id, employee_id, category, title, document_date, pay_period_year, pay_period_month,
		  visibility, storage_provider, storage_bucket, storage_key, file_name, mime_type, size_bytes,
		  checksum_sha256, uploaded_by)
		 values ($1,$2,$3,$4,$5,$6,$7,$8,'hr_only','s3-private','t870-private',$9,'document.pdf',
		  'application/pdf',10,'x',$10)`,
		[
			id,
			ORG,
			ids[name],
			input.category,
			input.title,
			input.documentDate,
			payPeriod[0],
			payPeriod[1],
			key,
			userOf("owner"),
		],
	);
	harness.objects.set(key, Buffer.from("%PDF-1.4"));
	return id;
}

async function setPeriods(periods: Record<string, number | null>) {
	signIn("owner");
	const result = await settingsActions.savePersonnelFileRetentionSettingsAction({ periods });
	if (!result.success) throw new Error(result.error);
}

async function accessOf(name: Person, now: Temporal.Instant) {
	const access = await resolvePersonnelFileAccess(db, {
		userId: userOf(name),
		organizationId: ORG,
		now,
	});
	if (!access) throw new Error(`${name} has no personnel file access`);
	return access;
}

function signIn(name: Person) {
	harness.userId = userOf(name);
	harness.organizationId = ORG;
}

const docs = {} as Record<string, string>;

async function seed() {
	await cleanup();
	harness.objects.clear();
	await admin.query(
		`insert into organization (id, name, slug, timezone, personnel_files_enabled, created_at)
		 values ($1, $1, $1, $2, true, now())`,
		[ORG, BERLIN],
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
	await seedPerson("officer", "member");
	await seedPerson("anna", "member", ids.berlin);
	await seedPerson("ben", "member", ids.munich);
	await seedPerson("carla", "member", ids.berlin);
	await seedPerson("dora", "member", ids.berlin);
	await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.officer,
		createdBy: userOf("owner"),
		categories: ["payslip"],
		teamIds: [ids.berlin],
	});

	await departed("anna", "2020-01-01", "2027-06-30");
	await departed("ben", "2020-01-01", "2027-06-30");
	await employed("carla", "2015-01-01");
	await departed("dora", "2010-01-01", "2019-03-31");

	docs.anna2026 = await seedDocument("anna", {
		category: "payslip",
		title: "Payslip 2026-05",
		documentDate: "2026-05-31",
	});
	docs.anna2027 = await seedDocument("anna", {
		category: "payslip",
		title: "Payslip 2027-06",
		documentDate: "2027-06-30",
	});
	docs.annaContract = await seedDocument("anna", {
		category: "contract",
		title: "Contract",
		documentDate: "2020-01-01",
	});
	docs.annaSickNote = await seedDocument("anna", {
		category: "sick_note",
		title: "Sick note",
		documentDate: "2026-02-01",
	});
	docs.ben2026 = await seedDocument("ben", {
		category: "payslip",
		title: "Payslip 2026-05",
		documentDate: "2026-05-31",
	});
	docs.benContract = await seedDocument("ben", {
		category: "contract",
		title: "Contract",
		documentDate: "2020-01-01",
	});
	docs.benOther = await seedDocument("ben", {
		category: "other",
		title: "Other",
		documentDate: "2026-01-01",
	});
	docs.benCertificate = await seedDocument("ben", {
		category: "certificate",
		title: "Certificate",
		documentDate: "2026-01-01",
	});
	docs.carla2010 = await seedDocument("carla", {
		category: "payslip",
		title: "Payslip 2010-01",
		documentDate: "2010-01-31",
	});
	docs.dora2018 = await seedDocument("dora", {
		category: "payslip",
		title: "Payslip 2018-12 Dora",
		documentDate: "2018-12-31",
	});
	await setPeriods({ payslip: 6, sick_note: 2, contract: null });
	harness.notifications.length = 0;
}

beforeAll(async () => {
	await seed();
});

beforeEach(() => {
	harness.notifications.length = 0;
});

afterAll(async () => {
	await cleanup();
});

describe("retention settings", () => {
	it("owners and admins set a period per category; empty means none", async () => {
		expect(await loadRetentionPeriods(db, ORG)).toEqual({ payslip: 6, sick_note: 2 });
		signIn("owner");
		const settings = await settingsActions.getPersonnelFileRetentionSettingsAction();
		expect(settings.success && settings.data.periods).toEqual({
			contract: null,
			payslip: 6,
			certificate: null,
			sick_note: 2,
			other: null,
		});
		expect(settings.success && settings.data.suggestions.payslip.years).toBeGreaterThan(0);
	});

	it("refuses periods that are not whole years and refuses officers", async () => {
		signIn("owner");
		const invalid = await settingsActions.savePersonnelFileRetentionSettingsAction({
			periods: { payslip: 2.5 },
		});
		expect(invalid.success).toBe(false);
		signIn("officer");
		const officer = await settingsActions.savePersonnelFileRetentionSettingsAction({
			periods: { payslip: 1 },
		});
		expect(officer.success).toBe(false);
		expect(await loadRetentionPeriods(db, ORG)).toEqual({ payslip: 6, sick_note: 2 });
	});

	it("audits a change of a period", async () => {
		const { rows } = await admin.query(
			`select changes from audit_log where organization_id = $1 and action = 'personnel_file.retention_changed'`,
			[ORG],
		);
		const changes = rows.map((row) => JSON.parse(row.changes));
		expect(changes).toContainEqual({ category: "payslip", from: null, to: 6 });
	});
});

describe("due for deletion", () => {
	it("Anna's 2026 and 2027 payslips become due on 2034-01-01", async () => {
		const owner = await accessOf("owner", berlin("2033-12-31T23:30"));
		const before = await listDueDocuments(db, owner, berlin("2033-12-31T23:30"));
		expect(before.map((document) => document.id)).not.toContain(docs.anna2026);
		const after = await listDueDocuments(db, owner, berlin("2034-01-01T00:30"));
		const anna = after.filter((document) => document.employeeId === ids.anna);
		expect(anna.filter((document) => document.category === "payslip")).toEqual([
			expect.objectContaining({
				id: docs.anna2026,
				dueOn: "2034-01-01",
				retentionStart: "2028-01-01",
			}),
			expect.objectContaining({
				id: docs.anna2027,
				dueOn: "2034-01-01",
				retentionStart: "2028-01-01",
			}),
		]);
	});

	it("a category without a period never has due documents", async () => {
		const now = berlin("2100-01-01T12:00");
		const due = await listDueDocuments(db, await accessOf("owner", now), now);
		expect(due.map((document) => document.id)).not.toContain(docs.annaContract);
		expect(due.map((document) => document.id)).toContain(docs.annaSickNote);
	});

	it("current employees' documents are never due", async () => {
		const now = berlin("2100-01-01T12:00");
		const due = await listDueDocuments(db, await accessOf("owner", now), now);
		expect(due.map((document) => document.id)).not.toContain(docs.carla2010);
	});

	it("an officer sees only due documents of their scope and categories", async () => {
		const now = berlin("2034-06-01T12:00");
		const due = await listDueDocuments(db, await accessOf("officer", now), now);
		expect(due.map((document) => document.id).toSorted()).toEqual(
			[docs.anna2026, docs.anna2027, docs.dora2018].toSorted(),
		);
	});

	it("an officer cannot purge documents outside their scope or categories", async () => {
		const now = berlin("2034-06-01T12:00");
		const result = await purgeDueDocuments(
			db,
			await accessOf("officer", now),
			{ documentIds: [docs.ben2026, docs.annaSickNote], reason: null },
			now,
		);
		expect(result).toEqual({ purged: [], skipped: [docs.ben2026, docs.annaSickNote] });
		const { rows } = await admin.query("select id from employee_document where id = any($1)", [
			[docs.ben2026, docs.annaSickNote],
		]);
		expect(rows).toHaveLength(2);
	});

	it("a document that is not due is never purged", async () => {
		const now = berlin("2030-06-01T12:00");
		const result = await purgeDueDocuments(
			db,
			await accessOf("owner", now),
			{ documentIds: [docs.anna2026, docs.carla2010], reason: "too early" },
			now,
		);
		expect(result.purged).toEqual([]);
		const { rows } = await admin.query("select id from employee_document where id = any($1)", [
			[docs.anna2026, docs.carla2010],
		]);
		expect(rows).toHaveLength(2);
	});
});

describe("purge", () => {
	it("deletes the file and the document after confirmation and keeps the audit record", async () => {
		signIn("officer");
		const list = await retentionActions.getDueForDeletionAction();
		expect(list.success && list.data.documents.map((document) => document.id)).toEqual([
			docs.dora2018,
		]);
		const key = `personnel-files/${ORG}/${ids.dora}/${docs.dora2018}-document.pdf`;
		expect(harness.objects.has(key)).toBe(true);

		const result = await retentionActions.purgeDueDocumentsAction({
			documentIds: [docs.dora2018],
			reason: "Retention period passed",
		});
		expect(result).toEqual({ success: true, data: { purged: [docs.dora2018], skipped: [] } });

		expect(harness.objects.has(key)).toBe(false);
		const { rows: remaining } = await admin.query(
			"select id from employee_document where id = $1",
			[docs.dora2018],
		);
		expect(remaining).toHaveLength(0);
		const { rows: ledger } = await admin.query(
			"select id from personnel_file_upload where id = $1",
			[docs.dora2018],
		);
		expect(ledger).toHaveLength(0);

		const { rows: audit } = await admin.query(
			`select performed_by, employee_id, metadata from audit_log
			 where organization_id = $1 and entity_id = $2 and action = 'personnel_file.document_purged'`,
			[ORG, docs.dora2018],
		);
		expect(audit).toHaveLength(1);
		expect(audit[0].performed_by).toBe(userOf("officer"));
		expect(audit[0].employee_id).toBe(ids.dora);
		const metadata = JSON.parse(audit[0].metadata);
		expect(metadata).toMatchObject({
			document: {
				category: "payslip",
				documentDate: "2018-12-31",
				payPeriod: { year: 2018, month: 12 },
			},
			reason: "Retention period passed",
		});
		expect(JSON.stringify(metadata)).not.toContain("Payslip 2018-12 Dora");
		expect(JSON.stringify(metadata)).not.toContain("document.pdf");
	});

	it("refuses the purge action for people without personnel file access", async () => {
		signIn("anna");
		const result = await retentionActions.purgeDueDocumentsAction({
			documentIds: [docs.anna2026],
			reason: null,
		});
		expect(result.success).toBe(false);
	});
});

describe("rehire", () => {
	it("rehiring Anna in 2029 removes her documents from the due list", async () => {
		const now = berlin("2034-06-01T12:00");
		const owner = await accessOf("owner", now);
		expect((await listDueDocuments(db, owner, now)).map((document) => document.id)).toContain(
			docs.anna2026,
		);
		await employed("anna", "2029-03-01");
		const due = await listDueDocuments(db, owner, now);
		expect(due.filter((document) => document.employeeId === ids.anna)).toEqual([]);
		const purge = await purgeDueDocuments(
			db,
			owner,
			{ documentIds: [docs.anna2026], reason: null },
			now,
		);
		expect(purge.purged).toEqual([]);
	});
});

describe("daily reminder", () => {
	it("tells covering officers once per day about newly due documents", async () => {
		// Ben's payslip (Munich) is outside the officer's scope: owners hear about it.
		const first = berlin("2034-01-01T01:00");
		await runPersonnelFileRetentionReminders(db, { now: first, organizationIds: [ORG] });
		const recipients = harness.notifications.map((notification) => notification.userId).toSorted();
		expect(recipients).toEqual([userOf("owner")]);
		expect(harness.notifications[0]).toMatchObject({
			type: "personnel_file_due_for_deletion",
			idempotencyKey: `personnel-file-due:${ORG}:2034-01-01:${userOf("owner")}`,
		});

		harness.notifications.length = 0;
		await runPersonnelFileRetentionReminders(db, {
			now: berlin("2034-01-01T15:00"),
			organizationIds: [ORG],
		});
		await runPersonnelFileRetentionReminders(db, {
			now: berlin("2034-01-02T01:00"),
			organizationIds: [ORG],
		});
		expect(harness.notifications).toEqual([]);
	});

	it("reports documents a shorter period newly makes due, at most once a day", async () => {
		// Ben's contract becomes due (a period for contracts is set); only owners cover it.
		await setPeriods({ payslip: 6, sick_note: 2, contract: 1 });
		harness.notifications.length = 0;
		await runPersonnelFileRetentionReminders(db, {
			now: berlin("2034-01-02T02:00"),
			organizationIds: [ORG],
		});
		expect(harness.notifications.map((notification) => notification.userId)).toEqual([
			userOf("owner"),
		]);
		expect(harness.notifications[0]?.metadata).toMatchObject({ documentCount: 1 });

		// Later that day another document becomes due: the owner was already told today.
		harness.notifications.length = 0;
		await setPeriods({ payslip: 6, sick_note: 2, contract: 1, other: 1 });
		await runPersonnelFileRetentionReminders(db, {
			now: berlin("2034-01-02T03:00"),
			organizationIds: [ORG],
		});
		expect(harness.notifications).toEqual([]);

		// The next day it is reported.
		await runPersonnelFileRetentionReminders(db, {
			now: berlin("2034-01-03T01:00"),
			organizationIds: [ORG],
		});
		expect(harness.notifications.map((notification) => notification.userId)).toEqual([
			userOf("owner"),
		]);
		expect(harness.notifications[0]?.metadata).toMatchObject({ documentCount: 1 });
	});

	it("does nothing while personnel files are off", async () => {
		await setPeriods({ payslip: 6, sick_note: 2, contract: 1, other: 1, certificate: 1 });
		harness.notifications.length = 0;
		await admin.query("update organization set personnel_files_enabled = false where id = $1", [
			ORG,
		]);
		try {
			await runPersonnelFileRetentionReminders(db, {
				now: berlin("2034-01-05T01:00"),
				organizationIds: [ORG],
			});
			expect(harness.notifications).toEqual([]);
			signIn("owner");
			const list = await retentionActions.getDueForDeletionAction();
			expect(list.success).toBe(false);
		} finally {
			await admin.query("update organization set personnel_files_enabled = true where id = $1", [
				ORG,
			]);
		}
		// Turned on again, the certificate that became due meanwhile is reported.
		await runPersonnelFileRetentionReminders(db, {
			now: berlin("2034-01-05T02:00"),
			organizationIds: [ORG],
		});
		expect(harness.notifications.map((notification) => notification.userId)).toEqual([
			userOf("owner"),
		]);
	});
});
