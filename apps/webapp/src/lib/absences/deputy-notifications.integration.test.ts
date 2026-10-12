/**
 * #1013: the deputy is told when an absence names them, when the deputy or
 * the dates change, when the absence is cancelled or overridden, and the day
 * before the cover starts (spec #802). Driven through the real absence
 * actions against a disposable PostgreSQL database, in the legacy and the
 * canonical absence-approval lifecycle mode. Notification delivery is
 * replaced by a recorder, so the assertions read who was told what.
 */

import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1013-org",
	sent: [] as CreateNotificationParams[],
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
							user: { id: harness.userId, role: "user", email: `${harness.userId}@example.test` },
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
vi.mock("@/lib/app-url", async (original) => ({
	...(await original<typeof import("@/lib/app-url")>()),
	getOrganizationBaseUrl: async () => "https://t1013.example.test",
}));
vi.mock("@/lib/email/email-service", async () =>
	(await import("@/test/integration-harness")).emailService(),
);
vi.mock("@/lib/email/render", async (original) =>
	(await import("@/test/integration-harness")).absenceEmailRender(original),
);
vi.mock("@/lib/notifications/triggers", async (original) =>
	(await import("@/test/integration-harness")).notificationTriggers(original),
);
vi.mock("@/lib/queue", async (original) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(original),
);
vi.mock("@/lib/work-balance/service", async (original) => ({
	...(await original<typeof import("@/lib/work-balance/service")>()),
	markEmployeeWorkBalanceDirty: async () => undefined,
}));
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/notifications/notification-service", () => ({
	createNotification: async (params: CreateNotificationParams) => {
		harness.sent.push(params);
		return null;
	},
}));

const { db } = await import("@/db");
const { requestAbsenceEffect } = await import(
	"@/app/[locale]/(app)/absences/request-absence-effect"
);
const { cancelAbsenceRequest } = await import("@/app/[locale]/(app)/absences/mutations");
const { recordAbsenceForEmployee } = await import("@/app/[locale]/(app)/team/absences/actions");
const deputyActions = await import("@/app/[locale]/(app)/absences/deputy-actions");
const { approveAbsenceEffect } = await import("@/lib/approvals/server/absence-approvals");
const { runAbsenceDeputyReminders } = await import("./deputy-notifier");

const ORG = "t1013-org";

const ids = {
	owner: "e1013000-0000-4000-8000-000000000001",
	manager: "e1013000-0000-4000-8000-000000000002",
	anna: "e1013000-0000-4000-8000-000000000003",
	ben: "e1013000-0000-4000-8000-000000000004",
	carla: "e1013000-0000-4000-8000-000000000005",
	leaver: "e1013000-0000-4000-8000-000000000006",
	vacation: "e1013100-0000-4000-8000-000000000001",
	noApproval: "e1013100-0000-4000-8000-000000000002",
	sick: "e1013100-0000-4000-8000-000000000003",
} as const;
type Person = "owner" | "manager" | "anna" | "ben" | "carla" | "leaver";
const userOf = (person: Person) => `t1013-${person}`;
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query('delete from "user" where id like $1', ["t1013-%"]);
}

async function seedPerson(
	person: Person,
	input: {
		name: string;
		memberRole: string;
		employeeRole?: string;
		isActive?: boolean;
		timezone?: string;
	},
) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,$4,$4)',
		[userOf(person), input.name, `${userOf(person)}@example.test`, SEEDED_AT],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',$5)",
		[`t1013-member-${person}`, ORG, userOf(person), input.memberRole, SEEDED_AT],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,is_active,updated_at) values ($1,$2,$3,$4,$5,$6)",
		[
			ids[person],
			userOf(person),
			ORG,
			input.employeeRole ?? "employee",
			input.isActive ?? true,
			SEEDED_AT,
		],
	);
	await admin.query(
		"insert into user_settings (user_id, locale, timezone, time_format, updated_at) values ($1, 'en', $2, '24h', $3)",
		[userOf(person), input.timezone ?? "Europe/Berlin", SEEDED_AT],
	);
}

async function seed(mode: "legacy" | "canonical") {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at)
		 values ($1, $1, $1, 'Europe/Berlin', $2)`,
		[ORG, SEEDED_AT],
	);
	await admin.query(
		`insert into approval_workflow_rollout
		 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
		 values ($1, 'absence', $2, $3, $4, $4)`,
		[ORG, mode, mode, SEEDED_AT],
	);
	await seedPerson("owner", { name: "Olga Owner", memberRole: "owner", employeeRole: "admin" });
	await seedPerson("manager", {
		name: "Mia Manager",
		memberRole: "member",
		employeeRole: "manager",
	});
	// Anna's own zone is far ahead of the organization's.
	await seedPerson("anna", {
		name: "Anna Example",
		memberRole: "member",
		timezone: "Pacific/Kiritimati",
	});
	await seedPerson("ben", { name: "Ben Example", memberRole: "member" });
	await seedPerson("carla", { name: "Carla Example", memberRole: "member" });
	await seedPerson("leaver", { name: "Lea Leaver", memberRole: "member" });
	for (const employee of [ids.anna, ids.ben, ids.carla, ids.leaver]) {
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, $3, $4, $4)`,
			[employee, ids.manager, userOf("owner"), SEEDED_AT],
		);
	}
	await admin.query(
		`insert into absence_category
		 (id, organization_id, type, name, requires_approval, counts_against_vacation, is_active, updated_at)
		 values ($1, $4, 'vacation', 'Vacation', true, true, true, $5),
		        ($2, $4, 'custom', 'Training', false, false, true, $5),
		        ($3, $4, 'sick', 'Sick leave', false, false, true, $5)`,
		[ids.vacation, ids.noApproval, ids.sick, ORG, SEEDED_AT],
	);
}

function signIn(person: Person) {
	harness.userId = userOf(person);
	harness.organizationId = ORG;
}

let nextStart = 0;
/** A fresh future date range per absence, so absences never overlap. */
function nextRange(days = 3): { startDate: string; endDate: string } {
	const start = new Date(Date.UTC(2027, 0, 4 + nextStart * 7));
	nextStart += 1;
	const end = new Date(start.getTime() + (days - 1) * 86_400_000);
	return {
		startDate: start.toISOString().slice(0, 10),
		endDate: end.toISOString().slice(0, 10),
	};
}

async function request(
	person: Person,
	input: { category?: string; deputyEmployeeId?: string; range?: ReturnType<typeof nextRange> },
): Promise<string> {
	signIn(person);
	const result = await requestAbsenceEffect({
		categoryId: input.category ?? ids.vacation,
		...(input.range ?? nextRange()),
		startPeriod: "full_day",
		endPeriod: "full_day",
		durationKind: "full_day",
		...(input.deputyEmployeeId ? { deputyEmployeeId: input.deputyEmployeeId } : {}),
	});
	if (!result.success) throw new Error(result.error);
	return result.data.absenceId;
}

async function approve(absenceId: string) {
	const { rows } = await admin.query<{ id: string }>(
		"select id from approval_request where organization_id = $1 and entity_id = $2 and status = 'pending'",
		[ORG, absenceId],
	);
	signIn("manager");
	const result = await approveAbsenceEffect(absenceId, { approvalRequestId: rows[0]?.id });
	if (!result.success) throw new Error(result.error);
}

async function insertApprovedAbsence(input: {
	employeeId: string;
	startDate: string;
	endDate: string;
	deputyEmployeeId: string | null;
	status?: "pending" | "approved";
}): Promise<string> {
	const { rows } = await admin.query<{ id: string }>(
		`insert into absence_entry
		 (employee_id, category_id, start_date, end_date, status, organization_id, deputy_employee_id, updated_at)
		 values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
		[
			input.employeeId,
			ids.vacation,
			input.startDate,
			input.endDate,
			input.status ?? "approved",
			ORG,
			input.deputyEmployeeId,
			SEEDED_AT,
		],
	);
	const id = rows[0]?.id;
	if (!id) throw new Error("absence not inserted");
	return id;
}

/** What each deputy was told, as [recipient, type, message]. */
function told() {
	return harness.sent
		.filter((params) => params.organizationId === ORG && params.type.startsWith("absence_deputy_"))
		.map((params) => [params.userId, params.type, params.message]);
}

beforeEach(() => {
	harness.sent.length = 0;
});

describe.each(["legacy", "canonical"] as const)("deputy notifications (#1013, %s)", (mode) => {
	beforeAll(() => seed(mode));
	afterAll(cleanup);

	it("tells the deputy once when the absence is approved, and nobody while it is pending", async () => {
		const absenceId = await request("anna", { deputyEmployeeId: ids.ben });
		expect(told()).toEqual([]);

		await approve(absenceId);
		expect(told()).toEqual([
			[userOf("ben"), "absence_deputy_assigned", expect.stringContaining("Anna Example")],
		]);
		// Absent person and dates only; never the category.
		expect(JSON.stringify(harness.sent)).not.toMatch(/Vacation/);
	});

	it("tells the deputy once when an absence needing no approval is created", async () => {
		await request("anna", { category: ids.noApproval, deputyEmployeeId: ids.carla });
		expect(told()).toEqual([
			[userOf("carla"), "absence_deputy_assigned", expect.stringContaining("Anna Example")],
		]);
		expect(JSON.stringify(harness.sent)).not.toMatch(/Training/);
	});

	it("tells the deputy of an absence a manager records", async () => {
		signIn("manager");
		const recorded = await recordAbsenceForEmployee({
			employeeId: ids.ben,
			categoryId: ids.vacation,
			...nextRange(),
			startPeriod: "full_day",
			endPeriod: "full_day",
			durationKind: "full_day",
			deputyEmployeeId: ids.anna,
		});
		if (!recorded.success) throw new Error(recorded.error);
		expect(told()).toEqual([
			[userOf("anna"), "absence_deputy_assigned", expect.stringContaining("Ben Example")],
		]);
	});

	it("tells the old and the new deputy when an approved absence's deputy is swapped", async () => {
		const approved = await insertApprovedAbsence({
			employeeId: ids.anna,
			...nextRange(),
			deputyEmployeeId: ids.ben,
		});
		signIn("anna");
		expect(
			await deputyActions.changeAbsenceDeputy({ absenceId: approved, deputyEmployeeId: ids.carla }),
		).toMatchObject({ success: true });
		expect(told()).toEqual([
			[userOf("ben"), "absence_deputy_removed", expect.stringContaining("Anna Example")],
			[userOf("carla"), "absence_deputy_assigned", expect.stringContaining("Anna Example")],
		]);

		// Named again later: told again.
		harness.sent.length = 0;
		await deputyActions.changeAbsenceDeputy({ absenceId: approved, deputyEmployeeId: ids.ben });
		expect(told().map(([user, type]) => [user, type])).toEqual([
			[userOf("carla"), "absence_deputy_removed"],
			[userOf("ben"), "absence_deputy_assigned"],
		]);

		harness.sent.length = 0;
		const pending = await insertApprovedAbsence({
			employeeId: ids.anna,
			...nextRange(),
			deputyEmployeeId: ids.ben,
			status: "pending",
		});
		await deputyActions.changeAbsenceDeputy({ absenceId: pending, deputyEmployeeId: ids.carla });
		expect(told()).toEqual([]);
	});

	it("tells the deputy when an approved absence is cancelled", async () => {
		const absenceId = await request("anna", { deputyEmployeeId: ids.carla });
		await approve(absenceId);
		harness.sent.length = 0;

		signIn("anna");
		expect(await cancelAbsenceRequest(absenceId)).toMatchObject({ success: true });
		expect(told()).toEqual([
			[userOf("carla"), "absence_deputy_removed", expect.stringContaining("Anna Example")],
		]);
	});

	it("tells the deputy of an approved vacation that a sick absence shortens, splits or overrides", async () => {
		await insertApprovedAbsence({
			employeeId: ids.carla,
			startDate: "2027-09-06",
			endDate: "2027-09-10",
			deputyEmployeeId: ids.ben,
		});
		await insertApprovedAbsence({
			employeeId: ids.carla,
			startDate: "2027-09-13",
			endDate: "2027-09-14",
			deputyEmployeeId: ids.anna,
		});
		signIn("manager");
		const sickness = await recordAbsenceForEmployee({
			employeeId: ids.carla,
			categoryId: ids.sick,
			sickDetail: "without_certificate",
			startDate: "2027-09-08",
			endDate: "2027-09-14",
			startPeriod: "full_day",
			endPeriod: "full_day",
			durationKind: "full_day",
		});
		if (!sickness.success) throw new Error(sickness.error);
		expect(told()).toEqual([
			[userOf("ben"), "absence_deputy_dates_changed", expect.stringContaining("Carla Example")],
			[userOf("anna"), "absence_deputy_removed", expect.stringContaining("Carla Example")],
		]);
		expect(JSON.stringify(harness.sent)).not.toMatch(/sick/i);

		// The vacation's split-off part keeps its deputy.
		harness.sent.length = 0;
		await insertApprovedAbsence({
			employeeId: ids.carla,
			startDate: "2027-10-04",
			endDate: "2027-10-08",
			deputyEmployeeId: ids.ben,
		});
		const split = await recordAbsenceForEmployee({
			employeeId: ids.carla,
			categoryId: ids.sick,
			sickDetail: "without_certificate",
			startDate: "2027-10-06",
			endDate: "2027-10-06",
			startPeriod: "full_day",
			endPeriod: "full_day",
			durationKind: "full_day",
		});
		if (!split.success) throw new Error(split.error);
		const { rows } = await admin.query<{ start_date: string; deputy_employee_id: string }>(
			"select to_char(start_date, 'YYYY-MM-DD') as start_date, deputy_employee_id from absence_entry where employee_id = $1 and category_id = $2 and start_date >= '2027-10-01' order by start_date",
			[ids.carla, ids.vacation],
		);
		expect(rows).toEqual([
			{ start_date: "2027-10-04", deputy_employee_id: ids.ben },
			{ start_date: "2027-10-07", deputy_employee_id: ids.ben },
		]);
		expect(told().map(([user, type]) => [user, type])).toEqual([
			[userOf("ben"), "absence_deputy_dates_changed"],
			[userOf("ben"), "absence_deputy_assigned"],
		]);
	});
});

describe("deputy day-before reminder (#1013)", () => {
	beforeAll(() => seed("legacy"));
	afterAll(cleanup);

	// 10:30 UTC: 12 Oct in Berlin (the organization), already 13 Oct in Kiritimati (Anna).
	const now = Temporal.Instant.from("2026-10-12T10:30:00Z");

	it("reminds the deputy once, on the day before in the absent employee's zone", async () => {
		const annaTomorrow = await insertApprovedAbsence({
			employeeId: ids.anna,
			startDate: "2026-10-14",
			endDate: "2026-10-16",
			deputyEmployeeId: ids.ben,
		});
		// Starts tomorrow in Berlin, but today in Anna's zone: too late for a reminder.
		await insertApprovedAbsence({
			employeeId: ids.anna,
			startDate: "2026-10-13",
			endDate: "2026-10-13",
			deputyEmployeeId: ids.carla,
		});
		await insertApprovedAbsence({
			employeeId: ids.ben,
			startDate: "2026-10-13",
			endDate: "2026-10-20",
			deputyEmployeeId: ids.carla,
		});
		// Pending, without a deputy, or covered by a former employee: no reminder.
		await insertApprovedAbsence({
			employeeId: ids.carla,
			startDate: "2026-10-13",
			endDate: "2026-10-13",
			deputyEmployeeId: ids.anna,
			status: "pending",
		});
		await insertApprovedAbsence({
			employeeId: ids.carla,
			startDate: "2026-10-26",
			endDate: "2026-10-26",
			deputyEmployeeId: null,
		});
		await insertApprovedAbsence({
			employeeId: ids.manager,
			startDate: "2026-10-13",
			endDate: "2026-10-13",
			deputyEmployeeId: ids.leaver,
		});
		await admin.query("update employee set is_active = false where id = $1", [ids.leaver]);

		await runAbsenceDeputyReminders(db, { now });
		await runAbsenceDeputyReminders(db, { now: now.add({ hours: 1 }) });

		expect(told().sort()).toEqual([
			[
				userOf("ben"),
				"absence_deputy_reminder",
				"From tomorrow you're covering for Anna Example until 16 Oct 2026.",
			],
			[
				userOf("carla"),
				"absence_deputy_reminder",
				"From tomorrow you're covering for Ben Example until 20 Oct 2026.",
			],
		]);
		const reminder = harness.sent.find((params) => params.type === "absence_deputy_reminder");
		expect(reminder?.idempotencyKey).toBe(
			`absence-deputy-reminder:${annaTomorrow}:${ids.ben}:2026-10-14`,
		);
	});
});
