/**
 * #1062 runtime evidence: the real writers of work, work attribution and absences send a
 * submitted period back, against a disposable PostgreSQL database. The server actions run as
 * they do in production; only the request/session, billing guard, Next cache, the change-policy
 * capability, the CASL preflights and e-mail/notification/calendar delivery are replaced.
 *
 * Local contract: pnpm --filter webapp test:integration
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1062-org",
	isOrgAdmin: false,
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
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
								name: "Actor",
								email: `${harness.userId}@example.test`,
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
vi.mock("@/lib/auth-helpers", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/auth-helpers")>()),
	isOrgAdminCasl: async () => harness.isOrgAdmin,
	canApproveFor: async () => false,
}));
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/app/[locale]/(app)/time-tracking/actions/policy-helpers", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/app/[locale]/(app)/time-tracking/actions/policy-helpers")
	>()),
	getEditCapabilityForPeriod: async () => ({ type: "direct", reason: "no_policy" }),
}));
vi.mock("@/lib/app-url", async (original) => ({
	...(await original<typeof import("@/lib/app-url")>()),
	getOrganizationBaseUrl: async () => "https://t1062.example.test",
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

const { db } = await import("@/db");
const { clockIn, clockOut } = await import("@/app/[locale]/(app)/time-tracking/actions/clocking");
const { updateWorkPeriodTimes } = await import(
	"@/app/[locale]/(app)/time-tracking/actions/work-period-time-edit"
);
const { updateWorkPeriodNotes, updateWorkPeriodProject } = await import(
	"@/app/[locale]/(app)/time-tracking/actions"
);
const { recordAbsenceForEmployee } = await import("@/app/[locale]/(app)/team/absences/actions");
const { decidePeriodSubmission, submitPeriodSubmission } = await import("./submission-service");

const ORG = "t1062-org";
const ids = {
	owner: "e1062000-0000-4000-8000-000000000001",
	manager: "e1062000-0000-4000-8000-000000000002",
	requester: "e1062000-0000-4000-8000-000000000003",
	projectA: "e1062000-0000-4000-8000-000000000021",
	projectB: "e1062000-0000-4000-8000-000000000022",
	vacation: "e1062000-0000-4000-8000-000000000031",
} as const;
type Person = "owner" | "manager" | "requester";
const userOf = (person: Person) => `t1062-${person}`;
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");
// The Monday week 2026-07-20..26 in UTC; work on Wednesday, submitted on Sunday.
const WEEK_START = "2026-07-20";
const WORK_START = parseInstant("2026-07-22T08:00:00Z");
const WORK_END = parseInstant("2026-07-22T12:00:00Z");
const SUBMITTED_AT = parseInstant("2026-07-26T12:00:00Z");

const admin = integrationAdminPool();

function actAs(person: Person, roles: { isOrgAdmin?: boolean } = {}) {
	harness.userId = userOf(person);
	harness.organizationId = ORG;
	harness.isOrgAdmin = roles.isOrgAdmin ?? false;
}

async function cleanup() {
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query('delete from "user" where id like $1', ["t1062-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values ($1, $1, $1, 'UTC', $2)`,
		[ORG, SEEDED_AT],
	);
	const people: [Person, string, string][] = [
		["owner", "owner", "admin"],
		["manager", "member", "manager"],
		["requester", "member", "employee"],
	];
	for (const [person, memberRole, employeeRole] of people) {
		await admin.query(
			'insert into "user" (id, name, email, created_at, updated_at) values ($1, $1, $2, $3, $3)',
			[userOf(person), `${userOf(person)}@example.test`, SEEDED_AT],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ($1, $2, $3, $4, 'approved', $5)`,
			[`t1062-member-${person}`, ORG, userOf(person), memberRole, SEEDED_AT],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at)
			 values ($1, $2, $3, $4, $5)`,
			[ids[person], userOf(person), ORG, employeeRole, SEEDED_AT],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 values ($1, 'en', 'UTC', '24h', $2)`,
			[userOf(person), SEEDED_AT],
		);
	}
	await admin.query(
		`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
		 values ($1, $2, $3, true, $4)`,
		[randomUUID(), ids.requester, ids.manager, userOf("owner")],
	);
	await admin.query(
		`insert into project (id, organization_id, name, status, is_active, created_by, updated_at) values
		 ($1, $3, 'Project A', 'active', true, $4, $5), ($2, $3, 'Project B', 'active', true, $4, $5)`,
		[ids.projectA, ids.projectB, ORG, userOf("owner"), SEEDED_AT],
	);
	await admin.query(
		`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
		 values ($1, $2, $4, 'employee', $5, $6), ($3, $7, $4, 'employee', $5, $6)`,
		[randomUUID(), ids.projectA, randomUUID(), ORG, ids.requester, userOf("owner"), ids.projectB],
	);
	await admin.query(
		`insert into absence_category
		 (id, organization_id, type, name, requires_approval, counts_against_vacation, is_active, updated_at)
		 values ($1, $2, 'vacation', 'Vacation', true, false, true, $3)`,
		[ids.vacation, ORG, SEEDED_AT],
	);
	await admin.query(
		`insert into time_entry_append_control (organization_id, mode) values ($1, 'active')`,
		[ORG],
	);
	await admin.query(
		`insert into period_submission_cadence_change
		 (id, organization_id, cadence, week_start_day, changed_at, changed_by)
		 values ($1, $2, 'weekly', 'monday', '2026-06-01T00:00:00Z', $3)`,
		[randomUUID(), ORG, userOf("owner")],
	);
}

/** Real adopted clock-in and clock-out of the requester. */
async function recordWork(start: Instant, end: Instant, projectId?: string) {
	actAs("requester");
	await expect(
		clockIn("office", { instant: start, browserTimezone: "UTC" }),
	).resolves.toMatchObject({ success: true });
	await expect(
		clockOut(projectId, undefined, {
			submissionId: randomUUID(),
			instant: end,
			browserTimezone: "UTC",
		}),
	).resolves.toMatchObject({ success: true });
	const { rows } = await admin.query<{ id: string }>(
		`select id from work_period
		 where organization_id = $1 and employee_id = $2 and start_time = $3 and deleted_at is null`,
		[ORG, ids.requester, new Date(start.epochMilliseconds)],
	);
	const id = rows[0]?.id;
	if (!id) throw new Error("work not recorded");
	return id;
}

async function submit() {
	const result = await submitPeriodSubmission(
		{ organizationId: ORG, userId: userOf("requester"), periodStartDate: WEEK_START },
		{ database: db, clock: { nowInstant: () => SUBMITTED_AT } },
	);
	if (result.kind !== "submitted") throw new Error(`not submitted: ${result.reason}`);
	return result;
}

async function approve(workflowId: string) {
	const { rows } = await admin.query<{ id: string }>(
		`select id from approval_stage_assignment
		 where organization_id = $1 and workflow_id = $2 and status = 'pending'`,
		[ORG, workflowId],
	);
	const assignmentId = rows[0]?.id;
	if (!assignmentId) throw new Error("no assignment");
	await decidePeriodSubmission(
		{ organizationId: ORG, actorEmployeeId: ids.manager, assignmentId, action: "approve" },
		{ database: db, clock: { nowInstant: () => SUBMITTED_AT.add({ hours: 1 }) } },
	);
}

async function submission(id: string) {
	const { rows } = await admin.query<{
		status: string;
		closed_cause: string | null;
		workflow: string;
	}>(
		`select s.status, s.closed_cause, w.status as workflow
		 from period_submission s
		 join approval_workflow w on w.organization_id = s.organization_id and w.id = s.approval_workflow_id
		 where s.organization_id = $1 and s.id = $2`,
		[ORG, id],
	);
	return rows[0];
}

async function auditActions(id: string) {
	const { rows } = await admin.query<{ action: string }>(
		`select action from audit_log
		 where organization_id = $1 and entity_type = 'period_submission' and entity_id = $2
		 order by timestamp, action`,
		[ORG, id],
	);
	return rows.map((row) => row.action);
}

describe("writers send a submitted period back on PostgreSQL (#1062)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	beforeEach(async () => {
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("a work change withdraws the pending submission and cancels its approval", async () => {
		const workPeriodId = await recordWork(WORK_START, WORK_END);
		const submitted = await submit();

		actAs("requester");
		await expect(
			updateWorkPeriodTimes({
				workPeriodId,
				submissionId: randomUUID(),
				clockInDate: "2026-07-22",
				clockInTime: "08:00",
				clockOutDate: "2026-07-22",
				clockOutTime: "11:00",
				reason: "Left earlier",
			}),
		).resolves.toMatchObject({ success: true, data: { status: "applied" } });

		expect(await submission(submitted.submissionId)).toEqual({
			status: "withdrawn",
			closed_cause: "change",
			workflow: "cancelled",
		});
		expect(await auditActions(submitted.submissionId)).toEqual([
			"period_submission.submitted",
			"period_submission.withdrawn",
		]);
	});

	it.each(["active", "inactive"] as const)(
		"an attribution change puts the approved period back to awaiting submission (%s admission)",
		async (admission) => {
			const workPeriodId = await recordWork(WORK_START, WORK_END, ids.projectA);
			const submitted = await submit();
			await approve(submitted.workflowId);
			// Inactive admission takes the legacy attribution writer.
			await admin.query(
				"update time_entry_append_control set mode = $2 where organization_id = $1",
				[ORG, admission],
			);

			actAs("requester");
			await expect(updateWorkPeriodProject(workPeriodId, ids.projectB)).resolves.toMatchObject({
				success: true,
			});

			// The approval stays approved as history; the submission is out of date.
			expect(await submission(submitted.submissionId)).toEqual({
				status: "outdated",
				closed_cause: "change",
				workflow: "approved",
			});
			expect(await auditActions(submitted.submissionId)).toEqual([
				"period_submission.submitted",
				"period_submission.approved",
				"period_submission.outdated",
			]);
		},
	);

	it("an absence touching the period only in part withdraws the pending submission", async () => {
		await recordWork(WORK_START, WORK_END);
		const submitted = await submit();

		actAs("manager");
		const recorded = await recordAbsenceForEmployee({
			employeeId: ids.requester,
			categoryId: ids.vacation,
			startDate: "2026-07-26",
			endDate: "2026-07-28",
			startPeriod: "full_day",
			endPeriod: "full_day",
			durationKind: "full_day",
		});
		if (!recorded.success) throw new Error(recorded.error);

		expect(await submission(submitted.submissionId)).toMatchObject({
			status: "withdrawn",
			workflow: "cancelled",
		});
	});

	it("neither a note nor a change outside the period sends it back", async () => {
		const workPeriodId = await recordWork(WORK_START, WORK_END);
		const submitted = await submit();

		actAs("requester");
		await expect(updateWorkPeriodNotes(workPeriodId, "Workshop")).resolves.toMatchObject({
			success: true,
		});
		// Work the next Monday lies outside the submitted week.
		await recordWork(parseInstant("2026-07-27T08:00:00Z"), parseInstant("2026-07-27T12:00:00Z"));
		actAs("manager");
		const recorded = await recordAbsenceForEmployee({
			employeeId: ids.requester,
			categoryId: ids.vacation,
			startDate: "2026-07-28",
			endDate: "2026-07-29",
			startPeriod: "full_day",
			endPeriod: "full_day",
			durationKind: "full_day",
		});
		if (!recorded.success) throw new Error(recorded.error);

		expect(await submission(submitted.submissionId)).toEqual({
			status: "pending",
			closed_cause: null,
			workflow: "pending",
		});
	});
});
