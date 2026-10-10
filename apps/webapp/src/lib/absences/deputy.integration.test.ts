/**
 * #1011: an absence names a deputy (spec #802, Absences context). Requested,
 * recorded and changed through the real absence actions against a disposable
 * PostgreSQL database, in the legacy and the canonical absence-approval
 * lifecycle mode. Only the session, billing guard, e-mail and notification
 * delivery, calendar queue and work balance marking are replaced.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1011-org",
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
	getOrganizationBaseUrl: async () => "https://t1011.example.test",
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
	createNotification: async () => null,
}));

const { requestAbsenceEffect } = await import(
	"@/app/[locale]/(app)/absences/request-absence-effect"
);
const { recordAbsenceForEmployee } = await import("@/app/[locale]/(app)/team/absences/actions");
const deputyActions = await import("@/app/[locale]/(app)/absences/deputy-actions");
const { getPendingApprovals } = await import("@/lib/approvals/server/queries");

const ORG = "t1011-org";
const OTHER_ORG = "t1011-other-org";

const ids = {
	owner: "e1011000-0000-4000-8000-000000000001",
	manager: "e1011000-0000-4000-8000-000000000002",
	otherManager: "e1011000-0000-4000-8000-000000000003",
	anna: "e1011000-0000-4000-8000-000000000004",
	ben: "e1011000-0000-4000-8000-000000000005",
	carla: "e1011000-0000-4000-8000-000000000006",
	leaver: "e1011000-0000-4000-8000-000000000007",
	outsider: "e1011000-0000-4000-8000-000000000008",
	vacation: "e1011100-0000-4000-8000-000000000001",
	onCall: "e1011100-0000-4000-8000-000000000002",
} as const;
type Person =
	| "owner"
	| "manager"
	| "otherManager"
	| "anna"
	| "ben"
	| "carla"
	| "leaver"
	| "outsider";
const userOf = (person: Person) => `t1011-${person}`;
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from organization where id = any($1::text[])", [[ORG, OTHER_ORG]]);
	await admin.query('delete from "user" where id like $1', ["t1011-%"]);
}

async function seedPerson(
	person: Person,
	input: {
		name: string;
		memberRole: string;
		employeeRole?: string;
		organizationId?: string;
		isActive?: boolean;
	},
) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,$4,$4)',
		[userOf(person), input.name, `${userOf(person)}@example.test`, SEEDED_AT],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',$5)",
		[
			`t1011-member-${person}`,
			input.organizationId ?? ORG,
			userOf(person),
			input.memberRole,
			SEEDED_AT,
		],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,is_active,updated_at) values ($1,$2,$3,$4,$5,$6)",
		[
			ids[person],
			userOf(person),
			input.organizationId ?? ORG,
			input.employeeRole ?? "employee",
			input.isActive ?? true,
			SEEDED_AT,
		],
	);
	await admin.query(
		"insert into user_settings (user_id, locale, timezone, time_format, updated_at) values ($1, 'en', 'UTC', '24h', $2)",
		[userOf(person), SEEDED_AT],
	);
}

async function seed(mode: "legacy" | "canonical") {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at)
		 values ($1, $1, $1, 'UTC', $3), ($2, $2, $2, 'UTC', $3)`,
		[ORG, OTHER_ORG, SEEDED_AT],
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
	await seedPerson("otherManager", {
		name: "Max Manager",
		memberRole: "member",
		employeeRole: "manager",
	});
	await seedPerson("anna", { name: "Anna Example", memberRole: "member" });
	await seedPerson("ben", { name: "Ben Example", memberRole: "member" });
	await seedPerson("carla", { name: "Carla Example", memberRole: "member" });
	await seedPerson("leaver", { name: "Lea Leaver", memberRole: "member", isActive: false });
	await seedPerson("outsider", {
		name: "Oscar Outsider",
		memberRole: "member",
		organizationId: OTHER_ORG,
	});
	for (const employee of [ids.anna, ids.ben, ids.carla]) {
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, $3, $4, $4)`,
			[employee, ids.manager, userOf("owner"), SEEDED_AT],
		);
	}
	await admin.query(
		`insert into absence_category
		 (id, organization_id, type, name, requires_approval, counts_against_vacation, deputy_required, is_active, updated_at)
		 values ($1, $3, 'vacation', 'Vacation', true, false, false, true, $4),
		        ($2, $3, 'custom', 'On-call leave', true, false, true, true, $4)`,
		[ids.vacation, ids.onCall, ORG, SEEDED_AT],
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

function request(
	person: Person,
	input: { category?: string; deputyEmployeeId?: string; range?: ReturnType<typeof nextRange> },
) {
	signIn(person);
	return requestAbsenceEffect({
		categoryId: input.category ?? ids.vacation,
		...(input.range ?? nextRange()),
		startPeriod: "full_day",
		endPeriod: "full_day",
		durationKind: "full_day",
		...(input.deputyEmployeeId ? { deputyEmployeeId: input.deputyEmployeeId } : {}),
	});
}

async function deputyOf(absenceId: string): Promise<string | null> {
	const { rows } = await admin.query<{ deputy_employee_id: string | null }>(
		"select deputy_employee_id from absence_entry where id = $1",
		[absenceId],
	);
	return rows[0]?.deputy_employee_id ?? null;
}

async function deputyAudit(absenceId: string) {
	const { rows } = await admin.query<{
		performed_by: string;
		employee_id: string | null;
		changes: string;
	}>(
		"select performed_by, employee_id, changes from audit_log where entity_id = $1 and action = 'absence.deputy_changed' order by timestamp, id",
		[absenceId],
	);
	return rows.map((row) => ({ ...row, changes: JSON.parse(row.changes) }));
}

async function absenceCount(employeeId: string) {
	const { rows } = await admin.query<{ count: string }>(
		"select count(*) from absence_entry where employee_id = $1",
		[employeeId],
	);
	return Number(rows[0]?.count);
}

async function insertAbsence(input: {
	employeeId: string;
	category?: string;
	startDate: string;
	endDate: string;
	status?: "pending" | "approved" | "rejected";
	deputyEmployeeId?: string | null;
}): Promise<string> {
	const { rows } = await admin.query<{ id: string }>(
		`insert into absence_entry
		 (employee_id, category_id, start_date, end_date, status, organization_id, deputy_employee_id, updated_at)
		 values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
		[
			input.employeeId,
			input.category ?? ids.vacation,
			input.startDate,
			input.endDate,
			input.status ?? "approved",
			ORG,
			input.deputyEmployeeId ?? null,
			SEEDED_AT,
		],
	);
	const id = rows[0]?.id;
	if (!id) throw new Error("absence not inserted");
	return id;
}

describe.each(["legacy", "canonical"] as const)("deputy on an absence (#1011, %s)", (mode) => {
	beforeAll(() => seed(mode));
	afterAll(cleanup);

	it("stores the deputy named on a request and audits the naming", async () => {
		const result = await request("anna", { deputyEmployeeId: ids.ben });
		if (!result.success) throw new Error(result.error);

		expect(await deputyOf(result.data.absenceId)).toBe(ids.ben);
		expect(await deputyAudit(result.data.absenceId)).toEqual([
			{
				performed_by: userOf("anna"),
				employee_id: ids.anna,
				changes: { deputyEmployeeId: { from: null, to: ids.ben } },
			},
		]);
	});

	it("requests without a deputy unless the category requires one", async () => {
		const without = await request("anna", {});
		if (!without.success) throw new Error(without.error);
		expect(await deputyOf(without.data.absenceId)).toBeNull();
		expect(await deputyAudit(without.data.absenceId)).toEqual([]);

		const before = await absenceCount(ids.anna);
		const refused = await request("anna", { category: ids.onCall });
		expect(refused).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Choose a deputy: this absence type requires one.",
		});
		expect(await absenceCount(ids.anna)).toBe(before);
	});

	it("refuses the absent employee, an inactive employee and another organization's employee", async () => {
		const before = await absenceCount(ids.anna);
		for (const [deputyEmployeeId, error] of [
			[ids.anna, "An employee cannot be their own deputy."],
			[ids.leaver, "The deputy must be an active employee of this organization."],
			[ids.outsider, "The deputy must be an active employee of this organization."],
		] as const) {
			expect(await request("anna", { deputyEmployeeId, category: ids.onCall })).toMatchObject({
				success: false,
				code: "ValidationError",
				error,
			});
		}
		expect(await absenceCount(ids.anna)).toBe(before);
	});

	it("shows the deputy on the approver's pending absence", async () => {
		const result = await request("carla", { deputyEmployeeId: ids.manager });
		if (!result.success) throw new Error(result.error);
		if (mode === "canonical") return; // The legacy approvals list reads legacy requests only.

		signIn("manager");
		const pending = await getPendingApprovals();
		const approval = pending.absenceApprovals.find(
			(candidate) => candidate.absence.id === result.data.absenceId,
		);
		expect(approval?.absence.deputy).toEqual({
			id: ids.manager,
			name: "Mia Manager",
			canDecideApprovals: true,
		});
	});

	it("records an absence for an employee with a deputy under the same rules", async () => {
		signIn("manager");
		const recorded = await recordAbsenceForEmployee({
			employeeId: ids.ben,
			categoryId: ids.onCall,
			...nextRange(),
			startPeriod: "full_day",
			endPeriod: "full_day",
			durationKind: "full_day",
			deputyEmployeeId: ids.carla,
		});
		if (!recorded.success) throw new Error(recorded.error);
		expect(await deputyOf(recorded.data.absenceId)).toBe(ids.carla);
		expect(await deputyAudit(recorded.data.absenceId)).toEqual([
			{
				performed_by: userOf("manager"),
				employee_id: ids.ben,
				changes: { deputyEmployeeId: { from: null, to: ids.carla } },
			},
		]);

		for (const [deputyEmployeeId, error] of [
			[undefined, "Choose a deputy: this absence type requires one."],
			[ids.ben, "An employee cannot be their own deputy."],
			[ids.outsider, "The deputy must be an active employee of this organization."],
		] as const) {
			expect(
				await recordAbsenceForEmployee({
					employeeId: ids.ben,
					categoryId: ids.onCall,
					...nextRange(),
					startPeriod: "full_day",
					endPeriod: "full_day",
					durationKind: "full_day",
					...(deputyEmployeeId ? { deputyEmployeeId } : {}),
				}),
			).toMatchObject({ success: false, code: "ValidationError", error });
		}
	});

	it("lets the employee, their manager and admins change the deputy, and nobody else", async () => {
		const absenceId = await insertAbsence({
			employeeId: ids.anna,
			...nextRange(),
			status: "pending",
			deputyEmployeeId: null,
		});

		signIn("anna");
		expect(
			await deputyActions.changeAbsenceDeputy({ absenceId, deputyEmployeeId: ids.ben }),
		).toEqual({ success: true, data: { deputyEmployeeId: ids.ben } });
		signIn("manager");
		expect(
			await deputyActions.changeAbsenceDeputy({ absenceId, deputyEmployeeId: ids.carla }),
		).toEqual({ success: true, data: { deputyEmployeeId: ids.carla } });
		signIn("owner");
		expect(await deputyActions.changeAbsenceDeputy({ absenceId, deputyEmployeeId: null })).toEqual({
			success: true,
			data: { deputyEmployeeId: null },
		});

		for (const person of ["ben", "otherManager"] as const) {
			signIn(person);
			expect(
				await deputyActions.changeAbsenceDeputy({ absenceId, deputyEmployeeId: ids.ben }),
			).toMatchObject({ success: false, code: "NotFoundError" });
		}

		expect(await deputyOf(absenceId)).toBeNull();
		expect(await deputyAudit(absenceId)).toEqual([
			{
				performed_by: userOf("anna"),
				employee_id: ids.anna,
				changes: { deputyEmployeeId: { from: null, to: ids.ben } },
			},
			{
				performed_by: userOf("manager"),
				employee_id: ids.anna,
				changes: { deputyEmployeeId: { from: ids.ben, to: ids.carla } },
			},
			{
				performed_by: userOf("owner"),
				employee_id: ids.anna,
				changes: { deputyEmployeeId: { from: ids.carla, to: null } },
			},
		]);
	});

	it("changes the deputy of an approved absence created before deputies existed, never after it ended", async () => {
		const running = await insertAbsence({
			employeeId: ids.anna,
			startDate: "2026-10-01",
			endDate: "2027-12-31",
		});
		signIn("anna");
		expect(
			await deputyActions.changeAbsenceDeputy({ absenceId: running, deputyEmployeeId: ids.ben }),
		).toEqual({ success: true, data: { deputyEmployeeId: ids.ben } });

		const ended = await insertAbsence({
			employeeId: ids.anna,
			startDate: "2026-09-01",
			endDate: "2026-09-03",
			deputyEmployeeId: ids.carla,
		});
		expect(
			await deputyActions.changeAbsenceDeputy({ absenceId: ended, deputyEmployeeId: ids.ben }),
		).toMatchObject({ success: false, code: "ConflictError" });
		expect(await deputyOf(ended)).toBe(ids.carla);
		expect(await deputyAudit(ended)).toEqual([]);
	});

	it("swaps but never removes a required deputy, and refuses invalid deputies", async () => {
		const absenceId = await insertAbsence({
			employeeId: ids.anna,
			category: ids.onCall,
			...nextRange(),
			deputyEmployeeId: ids.ben,
		});
		signIn("anna");
		expect(
			await deputyActions.changeAbsenceDeputy({ absenceId, deputyEmployeeId: ids.carla }),
		).toEqual({ success: true, data: { deputyEmployeeId: ids.carla } });
		for (const [deputyEmployeeId, error] of [
			[null, "Choose a deputy: this absence type requires one."],
			[ids.anna, "An employee cannot be their own deputy."],
			[ids.leaver, "The deputy must be an active employee of this organization."],
		] as const) {
			expect(
				await deputyActions.changeAbsenceDeputy({ absenceId, deputyEmployeeId }),
			).toMatchObject({ success: false, code: "ValidationError", error });
		}
		expect(await deputyOf(absenceId)).toBe(ids.carla);
		expect(await deputyAudit(absenceId)).toHaveLength(1);
	});

	it("lists colleagues for the picker with when they are away, and whether they can decide approvals", async () => {
		const range = nextRange(5);
		await insertAbsence({
			employeeId: ids.ben,
			startDate: range.startDate,
			endDate: range.startDate,
			status: "pending",
		});
		signIn("anna");
		const listed = await deputyActions.getDeputyCandidates(range);
		if (!listed.success) throw new Error(listed.error);
		expect(listed.data.map((candidate) => candidate.name)).toEqual([
			"Ben Example",
			"Carla Example",
			"Max Manager",
			"Mia Manager",
			"Olga Owner",
		]);
		expect(listed.data.find((candidate) => candidate.id === ids.ben)?.awayPeriods).toEqual([
			{ startDate: range.startDate, endDate: range.startDate },
		]);
		expect(listed.data.find((candidate) => candidate.id === ids.carla)?.awayPeriods).toEqual([]);

		// A manager recording for Ben sees Anna, not Ben.
		signIn("manager");
		const forBen = await deputyActions.getDeputyCandidates({ ...range, employeeId: ids.ben });
		if (!forBen.success) throw new Error(forBen.error);
		expect(forBen.data.map((candidate) => candidate.id)).toContain(ids.anna);
		expect(forBen.data.map((candidate) => candidate.id)).not.toContain(ids.ben);
		// Ben cannot list for Anna.
		signIn("ben");
		expect(
			await deputyActions.getDeputyCandidates({ ...range, employeeId: ids.anna }),
		).toMatchObject({ success: false, code: "NotFoundError" });

		signIn("anna");
		expect(await deputyActions.getDeputyDecisionCapability(ids.ben)).toEqual({
			success: true,
			data: { canDecideApprovals: false },
		});
		expect(await deputyActions.getDeputyDecisionCapability(ids.manager)).toEqual({
			success: true,
			data: { canDecideApprovals: true },
		});
	});
});
