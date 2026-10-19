/**
 * #1406 (spec #1307): document request deadline reminders against a
 * disposable PostgreSQL database. The hourly job runs with a fixed clock in an
 * organization on Europe/Berlin (UTC+1 in November); notification delivery is
 * replaced by a recorder, so the assertions read who was told what.
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

vi.setConfig({ testTimeout: 60_000 });

const { db } = await import("@/db");
const { runDocumentRequestReminders } = await import("./document-request-reminders");
const { seedPersonnelFileOfficerGrant } = await import("./testing/officer-grant.test.fixture");

const ORG = "t1406-org";
const OFF_ORG = "t1406-off";

const ids = {
	owner: "e1406000-0000-4000-8000-000000000001",
	admin: "e1406000-0000-4000-8000-000000000002",
	officer: "e1406000-0000-4000-8000-000000000003",
	anna: "e1406000-0000-4000-8000-000000000004",
	ben: "e1406000-0000-4000-8000-000000000005",
	leaver: "e1406000-0000-4000-8000-000000000006",
	offOwner: "e1406000-0000-4000-8000-000000000007",
	offAnna: "e1406000-0000-4000-8000-000000000008",
	berlin: "e1406100-0000-4000-8000-000000000001",
} as const;
type Person = Exclude<keyof typeof ids, "berlin">;
const userOf = (person: Person) => `t1406-${person}`;

const requests = {
	anna: "e1406200-0000-4000-8000-000000000001",
	ben: "e1406200-0000-4000-8000-000000000002",
	annaOther: "e1406200-0000-4000-8000-000000000003",
	createdOnReminderDay: "e1406200-0000-4000-8000-000000000004",
	submitted: "e1406200-0000-4000-8000-000000000005",
	returnedOnDeadline: "e1406200-0000-4000-8000-000000000006",
	returnedLate: "e1406200-0000-4000-8000-000000000007",
	cancelled: "e1406200-0000-4000-8000-000000000008",
	leaver: "e1406200-0000-4000-8000-000000000009",
	off: "e1406200-0000-4000-8000-000000000010",
} as const;

const DEADLINE = "2026-11-10";

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from organization where id = any($1)", [[ORG, OFF_ORG]]);
	await admin.query('delete from "user" where id like $1', ["t1406-%"]);
}

async function seedOrganization(id: string, enabled: boolean) {
	await admin.query(
		`insert into organization (id, name, slug, timezone, personnel_files_enabled, created_at)
		 values ($1, $1, $1, 'Europe/Berlin', $2, now())`,
		[id, enabled],
	);
}

async function seedPerson(
	person: Person,
	displayName: string,
	organizationId: string,
	memberRole: string,
	options: { teamId?: string | null; isActive?: boolean } = {},
) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
		[userOf(person), displayName, `${userOf(person)}@example.test`],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
		[`t1406-member-${person}`, organizationId, userOf(person), memberRole],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,team_id,is_active,updated_at) values ($1,$2,$3,'employee',$4,$5,now())",
		[ids[person], userOf(person), organizationId, options.teamId ?? null, options.isActive ?? true],
	);
}

async function seedRequest(input: {
	id: string;
	employee: Person;
	organizationId?: string;
	category?: "certificate" | "other";
	status?: "open" | "submitted" | "cancelled";
	/** When the request was created (its `created` history event). */
	createdAt?: string;
}) {
	const organizationId = input.organizationId ?? ORG;
	const createdAt = input.createdAt ?? "2026-11-01T09:00:00Z";
	await admin.query(
		`insert into employee_document_request
		 (id, organization_id, employee_id, category, title, deadline, status, created_by, created_at, updated_at)
		 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
		[
			input.id,
			organizationId,
			ids[input.employee],
			input.category ?? "certificate",
			`Request ${input.id.slice(-2)}`,
			DEADLINE,
			input.status ?? "open",
			organizationId === ORG ? userOf("owner") : userOf("offOwner"),
			createdAt,
		],
	);
	await admin.query(
		`insert into employee_document_request_event (organization_id, request_id, kind, occurred_at)
		 values ($1, $2, 'created', $3)`,
		[organizationId, input.id, createdAt],
	);
}

/** An officer returns a submitted request: it is open again from `at` on. */
async function returnRequest(requestId: string, at: string) {
	await admin.query(
		"update employee_document_request set status = 'open', version = version + 1 where id = $1",
		[requestId],
	);
	await admin.query(
		`insert into employee_document_request_event (organization_id, request_id, kind, reason, occurred_at)
		 values ($1, $2, 'returned', 'Unreadable scan', $3)`,
		[ORG, requestId, at],
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
	await seedPerson("owner", "Olga Owner", ORG, "owner");
	await seedPerson("admin", "Adam Admin", ORG, "admin");
	await seedPerson("officer", "Otto Officer", ORG, "member");
	await seedPerson("anna", "Anna Example", ORG, "member", { teamId: ids.berlin });
	await seedPerson("ben", "Ben Example", ORG, "member");
	await seedPerson("leaver", "Lea Leaver", ORG, "member", { teamId: ids.berlin, isActive: false });
	await seedPerson("offOwner", "Off Owner", OFF_ORG, "owner");
	await seedPerson("offAnna", "Off Anna", OFF_ORG, "member");
	// Otto covers Berlin's certificates only: nobody covers Ben, nor Anna's other documents.
	await seedPersonnelFileOfficerGrant(admin, {
		organizationId: ORG,
		officerEmployeeId: ids.officer,
		createdBy: userOf("owner"),
		categories: ["certificate"],
		teamIds: [ids.berlin],
	});
	await seedRequest({ id: requests.anna, employee: "anna" });
	await seedRequest({ id: requests.ben, employee: "ben" });
	await seedRequest({ id: requests.annaOther, employee: "anna", category: "other" });
	// Created 00:10 on 7 November in Berlin, the day of the 3-days-before reminder.
	await seedRequest({
		id: requests.createdOnReminderDay,
		employee: "anna",
		createdAt: "2026-11-06T23:10:00Z",
	});
	await seedRequest({ id: requests.submitted, employee: "anna", status: "submitted" });
	await seedRequest({ id: requests.returnedOnDeadline, employee: "anna", status: "submitted" });
	await seedRequest({ id: requests.returnedLate, employee: "anna", status: "submitted" });
	await seedRequest({ id: requests.cancelled, employee: "anna", status: "cancelled" });
	await seedRequest({ id: requests.leaver, employee: "leaver" });
	await seedRequest({ id: requests.off, employee: "offAnna", organizationId: OFF_ORG });
}

const at = (value: string) => Temporal.Instant.from(value);

async function run(instant: string) {
	return runDocumentRequestReminders(db, { now: at(instant) });
}

/** Notifications of this suite's organizations (other suites may share the database). */
function ours(): CreateNotificationParams[] {
	return sent.filter(
		(notification) =>
			notification.organizationId === ORG || notification.organizationId === OFF_ORG,
	);
}

/** Notifications about one request, as `user:type:reminder` triples. */
function toldAbout(requestId: string): string[] {
	return sent
		.filter((notification) => notification.entityId === requestId)
		.map(
			(notification) =>
				`${notification.userId}:${notification.type}:${String(notification.metadata?.reminder)}`,
		)
		.toSorted();
}

async function markers(requestId: string) {
	const { rows } = await admin.query<{ kind: string; deadline: string }>(
		`select kind, to_char(deadline, 'YYYY-MM-DD') as deadline
		 from employee_document_request_reminder where request_id = $1 order by deadline, kind`,
		[requestId],
	);
	return rows;
}

const ANNA_SOON = "t1406-anna:personnel_file_document_request_reminder:three_days_before";
const ANNA_TODAY = "t1406-anna:personnel_file_document_request_reminder:deadline_day";
const ANNA_OVERDUE = "t1406-anna:personnel_file_document_request_overdue:overdue";
const OFFICER_OVERDUE = "t1406-officer:personnel_file_document_request_overdue:overdue";
const OWNER_OVERDUE = "t1406-owner:personnel_file_document_request_overdue:overdue";
const ADMIN_OVERDUE = "t1406-admin:personnel_file_document_request_overdue:overdue";

describe("document request deadline reminders", () => {
	beforeAll(seed);
	afterAll(cleanup);
	beforeEach(() => {
		sent.length = 0;
	});

	it("sends nothing 4 days before the deadline in the organization's timezone", async () => {
		// 6 November 23:30 in Berlin.
		const result = await run("2026-11-06T22:30:00Z");
		expect(result.success).toBe(true);
		expect(ours()).toEqual([]);
	});

	it("reminds the employee of open requests 3 days before the deadline", async () => {
		// 6 November 23:30 UTC is already 7 November in Berlin.
		await run("2026-11-06T23:30:00Z");
		expect(ours()).toHaveLength(3);
		expect(toldAbout(requests.anna)).toEqual([ANNA_SOON]);
		expect(toldAbout(requests.annaOther)).toEqual([ANNA_SOON]);
		expect(toldAbout(requests.ben)).toEqual([
			"t1406-ben:personnel_file_document_request_reminder:three_days_before",
		]);
		// Created this very day: the creation notification already named the deadline.
		expect(toldAbout(requests.createdOnReminderDay)).toEqual([]);
		// Submitted and cancelled requests, former employees and organizations with personnel files off.
		for (const requestId of [
			requests.submitted,
			requests.returnedOnDeadline,
			requests.returnedLate,
			requests.cancelled,
			requests.leaver,
			requests.off,
		]) {
			expect(toldAbout(requestId)).toEqual([]);
		}
		expect(sent.find((notification) => notification.entityId === requests.anna)).toMatchObject({
			organizationId: ORG,
			title: "Document due soon",
			message: 'Please upload "Request 01" by Nov 10, 2026.',
			actionUrl: "/my-documents",
		});
	});

	it("never sends a reminder twice for an unchanged deadline, across reruns", async () => {
		await run("2026-11-07T09:00:00Z");
		await run("2026-11-07T10:00:00Z");
		await run("2026-11-08T10:00:00Z");
		expect(ours()).toEqual([]);
	});

	it("reminds the employee on the deadline day, from the organization's midnight", async () => {
		// 9 November 23:59 in Berlin.
		await run("2026-11-09T22:59:00Z");
		expect(ours()).toEqual([]);
		// Midnight of 10 November in Berlin.
		await run("2026-11-09T23:00:00Z");
		expect(toldAbout(requests.anna)).toEqual([ANNA_TODAY]);
		expect(toldAbout(requests.annaOther)).toEqual([ANNA_TODAY]);
		expect(toldAbout(requests.createdOnReminderDay)).toEqual([ANNA_TODAY]);
		expect(toldAbout(requests.submitted)).toEqual([]);
		expect(toldAbout(requests.returnedOnDeadline)).toEqual([]);
	});

	it("sends nothing when a request is returned on its deadline day", async () => {
		await returnRequest(requests.returnedOnDeadline, "2026-11-10T09:00:00Z");
		await run("2026-11-10T10:00:00Z");
		expect(ours()).toEqual([]);
	});

	it("tells the employee and the covering officers on the first overdue day", async () => {
		// 10 November 23:59 in Berlin: the deadline day is not over yet.
		await run("2026-11-10T22:59:00Z");
		expect(ours()).toEqual([]);
		await run("2026-11-10T23:00:00Z");
		expect(toldAbout(requests.anna)).toEqual([ANNA_OVERDUE, OFFICER_OVERDUE]);
		expect(toldAbout(requests.createdOnReminderDay)).toEqual([ANNA_OVERDUE, OFFICER_OVERDUE]);
		expect(toldAbout(requests.returnedOnDeadline)).toEqual([ANNA_OVERDUE, OFFICER_OVERDUE]);
		// Nobody covers Ben, nor Anna's other documents: owners and admins are told instead.
		expect(toldAbout(requests.ben)).toEqual([
			ADMIN_OVERDUE,
			"t1406-ben:personnel_file_document_request_overdue:overdue",
			OWNER_OVERDUE,
		]);
		expect(toldAbout(requests.annaOther)).toEqual([ADMIN_OVERDUE, ANNA_OVERDUE, OWNER_OVERDUE]);
		// A submitted request is never overdue.
		expect(toldAbout(requests.submitted)).toEqual([]);
		expect(toldAbout(requests.returnedLate)).toEqual([]);

		const officerNotice = sent.find(
			(notification) =>
				notification.entityId === requests.anna && notification.userId === "t1406-officer",
		);
		expect(officerNotice).toMatchObject({
			title: "Requested document overdue",
			message: 'Anna Example has not handed in "Request 01", due on Nov 10, 2026.',
			actionUrl: `/personnel-files/${ids.anna}`,
		});
		expect(await markers(requests.anna)).toEqual([
			{ kind: "deadline_day", deadline: DEADLINE },
			{ kind: "overdue", deadline: DEADLINE },
			{ kind: "three_days_before", deadline: DEADLINE },
		]);
	});

	it("sends the overdue reminder only once while the request stays overdue", async () => {
		await run("2026-11-11T12:00:00Z");
		await run("2026-11-12T12:00:00Z");
		expect(ours()).toEqual([]);
	});

	it("tells a request returned after its deadline that it is overdue, and nothing else", async () => {
		await returnRequest(requests.returnedLate, "2026-11-13T10:00:00Z");
		await run("2026-11-13T11:00:00Z");
		expect(ours().map((notification) => notification.entityId)).toEqual([
			requests.returnedLate,
			requests.returnedLate,
		]);
		expect(toldAbout(requests.returnedLate)).toEqual([ANNA_OVERDUE, OFFICER_OVERDUE]);
	});

	it("re-arms every reminder when the deadline moves", async () => {
		await admin.query(
			"update employee_document_request set deadline = '2026-11-20', version = version + 1 where id = $1",
			[requests.anna],
		);
		await run("2026-11-17T08:00:00Z");
		expect(toldAbout(requests.anna)).toEqual([ANNA_SOON]);
		// The markers of the old deadline are gone.
		expect(await markers(requests.anna)).toEqual([
			{ kind: "three_days_before", deadline: "2026-11-20" },
		]);
		sent.length = 0;
		await run("2026-11-20T08:00:00Z");
		expect(toldAbout(requests.anna)).toEqual([ANNA_TODAY]);
		sent.length = 0;
		await run("2026-11-21T08:00:00Z");
		expect(toldAbout(requests.anna)).toEqual([ANNA_OVERDUE, OFFICER_OVERDUE]);
		sent.length = 0;
		await run("2026-11-21T09:00:00Z");
		expect(ours()).toEqual([]);
	});

	it("delivers a reminder again when the deadline moves away and back (a new notification key per arming)", async () => {
		const moveBen = (deadline: string) =>
			admin.query(
				"update employee_document_request set deadline = $2, version = version + 1 where id = $1",
				[requests.ben, deadline],
			);
		const keys = () =>
			sent
				.filter((notification) => notification.entityId === requests.ben)
				.map((notification) => notification.idempotencyKey);

		await moveBen("2026-12-10");
		await run("2026-12-07T08:00:00Z");
		const [first] = keys();
		expect(toldAbout(requests.ben)).toEqual([
			"t1406-ben:personnel_file_document_request_reminder:three_days_before",
		]);

		// Away and back on the same day: the reminder is armed again and must reach Ben again.
		await moveBen("2026-12-20");
		await run("2026-12-07T09:00:00Z");
		await moveBen("2026-12-10");
		sent.length = 0;
		await run("2026-12-07T10:00:00Z");
		expect(toldAbout(requests.ben)).toEqual([
			"t1406-ben:personnel_file_document_request_reminder:three_days_before",
		]);
		const [second] = keys();
		expect(second).toBeTruthy();
		expect(second).not.toBe(first);
	});
});
