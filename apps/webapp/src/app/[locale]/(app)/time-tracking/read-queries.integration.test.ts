import { randomUUID } from "node:crypto";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import {
	getActiveWorkPeriod,
	getTimeSummary,
	getWorkPeriods,
} from "./actions/queries";
import {
	readActiveWorkPeriod,
	readTimeSummary,
	readWorkPeriods,
} from "./read-queries";

const actor = vi.hoisted(() => ({
	userId: "render-read-user",
	organizationId: "render-read-org",
}));
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: actor.userId },
				session: { activeOrganizationId: actor.organizationId },
			}),
		},
	},
}));
vi.mock("./actions/entry-helpers", () => ({
	getAssignedProjectsWithHours: vi.fn(),
}));
vi.mock("./actions/shared", () => ({
	DEFAULT_TIMEZONE: "UTC",
	logger: { error: vi.fn() },
}));
vi.mock("@/lib/effect/services/change-policy.service", () => ({
	ChangePolicyService: {},
	ChangePolicyServiceLive: {},
}));
vi.mock("@/lib/effect/services/database.service", () => ({
	DatabaseServiceLive: {},
}));

describe("scoped rendering reads on disposable PostgreSQL", () => {
	const admin = integrationAdminPool();
	const org = "render-read-org";
	const foreignOrg = "render-read-foreign-org";
	const user = "render-read-user";
	const employeeId = "f5580000-0000-4000-8000-000000000001";
	const scope = { employeeId, organizationId: org };
	const start = new Date("2026-03-01T00:00:00Z");
	const end = new Date("2026-03-31T23:59:59Z");

	async function cleanup() {
		await admin.query(
			"delete from approval_request where organization_id = any($1)",
			[[org, foreignOrg]],
		);
		await admin.query(
			"delete from approval_workflow where organization_id = any($1)",
			[[org, foreignOrg]],
		);
		await admin.query(
			"delete from work_period where organization_id = any($1)",
			[[org, foreignOrg]],
		);
		await admin.query("delete from organization where id = any($1)", [
			[org, foreignOrg],
		]);
		await admin.query('delete from "user" where id = $1', [user]);
	}

	async function period(options: {
		organizationId?: string;
		at: string;
		end?: string;
		minutes?: number;
		surcharge?: number;
		deleted?: boolean;
		pending?: boolean;
	}) {
		const id = randomUUID();
		const clockInId = randomUUID();
		const clockOutId = options.end ? randomUUID() : null;
		const periodOrg = options.organizationId ?? org;
		// Same employee in the other organization deliberately exercises the org predicate.
		for (const [entryId, type, timestamp, offset] of [
			[
				clockInId,
				"clock_in",
				options.at,
				options.at < "2026-03-29T01:00:00Z" ? 60 : 120,
			],
			...(clockOutId ? [[clockOutId, "clock_out", options.end, 120]] : []),
		]) {
			await admin.query(
				`insert into time_entry
			 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone, timezone_source, hash, created_by)
			 values ($1, $2, $3, $4, $5, $6, 'Europe/Berlin', 'user_setting', $8, $7)`,
				[
					entryId,
					employeeId,
					periodOrg,
					type,
					timestamp,
					offset,
					user,
					entryId,
				],
			);
		}
		await admin.query(
			`insert into work_period
		 (id, employee_id, organization_id, clock_in_id, clock_out_id, start_time, end_time, duration_minutes,
		 deleted_at, approval_status, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`,
			[
				id,
				employeeId,
				periodOrg,
				clockInId,
				clockOutId,
				options.at,
				options.end ?? null,
				options.minutes ?? null,
				options.deleted ? options.at : null,
				options.pending ? "pending" : "approved",
			],
		);
		if (options.surcharge) {
			await admin.query(
				`insert into surcharge_calculation
			 (employee_id, organization_id, work_period_id, calculation_date, base_minutes, qualifying_minutes, surcharge_minutes, applied_percentage)
			 values ($1,$2,$3,$4,$5,$5,$6,0.2500)`,
				[
					employeeId,
					periodOrg,
					id,
					options.at,
					options.minutes,
					options.surcharge,
				],
			);
		}
		return { id, clockInId, clockOutId };
	}

	beforeEach(async () => {
		await cleanup();
		actor.organizationId = org;
		await admin.query(
			"insert into organization (id, name, slug, created_at) select id, id, id, now() from unnest($1::text[]) id",
			[[org, foreignOrg]],
		);
		await admin.query(
			'insert into "user" (id, name, email, created_at, updated_at) values ($1, $1, $2, now(), now())',
			[user, "render-read@example.test"],
		);
		await admin.query(
			"insert into member (id, organization_id, user_id, role, status, created_at) values ('render-read-member',$1,$2,'member','approved',now())",
			[org, user],
		);
		await admin.query(
			"insert into employee (id, user_id, organization_id, role, updated_at) values ($1,$2,$3,'employee',now())",
			[employeeId, user, org],
		);
	});
	afterEach(() => vi.useRealTimers());
	afterAll(cleanup);

	it("isolates active/history rows by organization and excludes deleted history", async () => {
		await period({ organizationId: foreignOrg, at: "2026-03-30T07:00:00Z" });
		const own = await period({ at: "2026-03-30T08:00:00Z" });
		await period({
			at: "2026-03-29T00:30:00Z",
			end: "2026-03-29T02:30:00Z",
			minutes: 120,
			deleted: true,
		});
		await expect(readActiveWorkPeriod(scope)).resolves.toMatchObject({
			id: own.id,
			organizationId: org,
			clockOut: undefined,
		});
		const history = await readWorkPeriods(scope, start, end);
		expect(history.map(({ id }) => id)).toEqual([own.id]);
		expect(history[0].clockIn).toMatchObject({
			id: own.clockInId,
			utcOffsetMinutes: 120,
			timezone: "Europe/Berlin",
		});
		await admin.query("delete from work_period where id = $1", [own.id]);
		await expect(readActiveWorkPeriod(scope)).resolves.toBeNull();
	});

	it("preserves newest-first history and ordinary request/current-stage assignment targets", async () => {
		const legacy = await period({
			at: "2026-03-27T08:00:00Z",
			end: "2026-03-27T09:00:00Z",
			minutes: 60,
			pending: true,
		});
		const workflow = await period({
			at: "2026-03-28T08:00:00Z",
			end: "2026-03-28T09:00:00Z",
			minutes: 60,
			pending: true,
		});
		const correction = await period({
			at: "2026-03-29T00:30:00Z",
			end: "2026-03-29T02:30:00Z",
			minutes: 120,
			pending: true,
		});
		const ordinaryId = randomUUID();
		for (const [id, entityId, organizationId, kind] of [
			[ordinaryId, legacy.id, org, "manual_time_submission"],
			[randomUUID(), correction.id, org, "time_correction"],
			[randomUUID(), workflow.id, foreignOrg, "policy_clock_out"],
		]) {
			await admin.query(
				`insert into approval_request (id, organization_id, entity_type, entity_id, requested_by, approver_id, metadata, updated_at)
			 values ($1,$2,'time_entry',$3,$4,$4,$5,now())`,
				[
					id,
					organizationId,
					entityId,
					employeeId,
					{
						timeRequest: { kind },
						...(kind === "manual_time_submission"
							? {
									surchargeSnapshot: {
										version: 1,
										evaluatedAt: "2026-03-29T08:01:00Z",
										resolution: { kind: "none" },
									},
								}
							: {}),
					},
				],
			);
		}
		const workflowId = randomUUID();
		await admin.query(
			`insert into approval_workflow (id, organization_id, workflow_type, source_type, source_id, requester_employee_id,
		 current_stage_order, policy_snapshot, context_snapshot, display_snapshot, updated_at)
		 values ($1,$2,'policy_clock_out','time_entry',$3,$4,2,'{}','{}','{}',now())`,
			[workflowId, org, workflow.id, employeeId],
		);
		const target = randomUUID();
		for (const sequence of [1, 2]) {
			const stageId = randomUUID();
			await admin.query(
				`insert into approval_workflow_stage (id, organization_id, workflow_id, stage_order, label, resolver_snapshot, activation_mode, status, updated_at)
			 values ($1,$2,$3,$4,'stage','{}','immediate','pending',now())`,
				[stageId, org, workflowId, sequence],
			);
			await admin.query(
				`insert into approval_stage_assignment (id, organization_id, workflow_id, stage_id, assignment_sequence, approver_employee_id, updated_at)
			 values ($1,$2,$3,$4,1,$5,now())`,
				[
					sequence === 2 ? target : randomUUID(),
					org,
					workflowId,
					stageId,
					employeeId,
				],
			);
		}
		const history = await readWorkPeriods(scope, start, end);
		expect(
			history.map(({ id, approvalRequestId }) => ({ id, approvalRequestId })),
		).toEqual([
			{ id: correction.id, approvalRequestId: null },
			{ id: workflow.id, approvalRequestId: target },
			{ id: legacy.id, approvalRequestId: ordinaryId },
		]);
		expect(history[0]).toMatchObject({
			durationMinutes: 120,
			startTime: new Date("2026-03-29T00:30:00Z"),
			endTime: new Date("2026-03-29T02:30:00Z"),
		});
		expect(history[0].clockIn.utcOffsetMinutes).toBe(60);
		expect(history[0].clockOut?.utcOffsetMinutes).toBe(120);
	});

	it.each(["sunday", "monday"] as const)(
		"keeps Berlin DST %s totals and surcharges isolated",
		async (weekStart) => {
			await period({
				at: "2026-03-29T00:30:00Z",
				end: "2026-03-29T02:30:00Z",
				minutes: 120,
				surcharge: 30,
			});
			await period({
				at: "2026-03-29T22:30:00Z",
				end: "2026-03-29T23:30:00Z",
				minutes: 60,
				surcharge: 15,
			});
			await period({
				at: "2026-03-01T08:00:00Z",
				end: "2026-03-01T08:20:00Z",
				minutes: 20,
			});
			await period({
				organizationId: foreignOrg,
				at: "2026-03-30T08:00:00Z",
				end: "2026-03-30T09:00:00Z",
				minutes: 60,
				surcharge: 15,
			});
			await period({
				at: "2026-03-30T08:00:00Z",
				end: "2026-03-30T09:00:00Z",
				minutes: 60,
				surcharge: 15,
				deleted: true,
			});
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date("2026-03-30T10:00:00Z"));
			await expect(
				readTimeSummary(scope, "Europe/Berlin", weekStart),
			).resolves.toEqual({
				todayMinutes: 60,
				weekMinutes: weekStart === "sunday" ? 180 : 60,
				monthMinutes: 200,
				todaySurchargeMinutes: 15,
				weekSurchargeMinutes: weekStart === "sunday" ? 45 : 15,
				monthSurchargeMinutes: 45,
			});
		},
	);

	it("fresh guarded wrappers deny revoked membership and an organization switch", async () => {
		const own = await period({ at: "2026-03-30T08:00:00Z" });
		await expect(getActiveWorkPeriod(employeeId)).resolves.toMatchObject({
			id: own.id,
		});
		await expect(getWorkPeriods(employeeId, start, end)).resolves.toHaveLength(
			1,
		);
		await admin.query(
			"delete from member where organization_id = $1 and user_id = $2",
			[org, user],
		);
		await expect(getActiveWorkPeriod(employeeId)).resolves.toBeNull();
		await expect(getWorkPeriods(employeeId, start, end)).resolves.toEqual([]);
		await expect(getTimeSummary(employeeId)).resolves.toEqual({
			todayMinutes: 0,
			weekMinutes: 0,
			monthMinutes: 0,
		});
		// Employee rows survive revocation; trusted read scope is not action authorization.
		await expect(readActiveWorkPeriod(scope)).resolves.toMatchObject({
			id: own.id,
		});
		actor.organizationId = foreignOrg;
		await expect(getActiveWorkPeriod(employeeId)).resolves.toBeNull();
		await expect(getWorkPeriods(employeeId, start, end)).resolves.toEqual([]);
	});
});
