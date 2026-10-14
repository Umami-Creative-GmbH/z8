/**
 * #304 / T40 runtime evidence: calendar splits through the completed-work split
 * operation.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * Both real calendar entry points (`splitWorkPeriod` in `../actions` and in
 * `./mutations`) and the real `clockIn`/`clockOut` actions run against that
 * database. Only the request/session, external billing provisioning and the Next
 * cache are replaced. Adoption is enabled per test organization by inserting its
 * append control row directly: production has no activation setter.
 *
 * In append admission this suite covers the split's caller policy: its
 * preconditions, receipts and replay, and how refusals reach the user. What the
 * divided work carries is work records' contract (#1218,
 * `lib/time-tracking/work-records/work-records.integration.test.ts`).
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	logs: [] as { context: unknown; message: unknown }[],
}));

// getRequestSession awaits connection(), which throws outside a Next request scope.
vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: { activeOrganizationId: harness.organizationId },
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

vi.mock("./shared", async (importOriginal) => {
	const original = await importOriginal<typeof import("./shared")>();
	const record = (context: unknown, message?: unknown) => {
		harness.logs.push({ context, message });
	};
	return {
		...original,
		logger: {
			...original.logger,
			error: record,
			warn: record,
			info: () => {},
			debug: () => {},
		},
	};
});

const { clockIn, clockOut } = await import("./clocking");
const { splitWorkPeriod: splitFromCalendarActions } = await import("../actions");
const { splitWorkPeriod: splitFromMutations } = await import("./mutations");
const { editSameDayTimeEntry } = await import("./corrections");
const { applyAdminWorkPeriodTimeEdit } = await import(
	"@/lib/time-tracking/admin-work-period-time-edit"
);
const { addWorkPeriodMileage } = await import("@/lib/travel-expenses/work-period-mileage");
const { db } = await import("@/db");
const { expectRecordAgreement } = await import(
	"@/lib/time-tracking/work-records/__tests__/expect-record-agreement"
);

const ids = {
	organization: "t304-split-org",
	requesterUser: "t304-split-requester-user",
	managerUser: "t304-split-manager-user",
	requester: "e3041000-0000-4000-8000-000000000001",
	manager: "e3041000-0000-4000-8000-000000000002",
	project: "e3041000-0000-4000-8000-000000000021",
	assignment: "e3041000-0000-4000-8000-000000000031",
	costCenter: "e3041000-0000-4000-8000-000000000051",
} as const;
const collision =
	"This change conflicts with an earlier request or changed work. Please refresh and try again.";
const failed = "Failed to split work period. Please try again.";
const workStart = parseInstant("2026-07-22T08:00:40Z");
const workEnd = parseInstant("2026-07-22T17:00:31Z");

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

type Split = typeof splitFromCalendarActions;

describe("calendar splits through the completed-work operation on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	/** Real clock-in and clock-out in Berlin: a complete graph (with a receipt when adopted). */
	async function recordWork(start: Instant = workStart, end: Instant = workEnd) {
		actAs(ids.requesterUser);
		await expect(
			clockIn("office", { instant: start, browserTimezone: "Europe/Berlin" }),
		).resolves.toMatchObject({ success: true });
		await expect(
			clockOut(ids.project, undefined, {
				submissionId: randomUUID(),
				instant: end,
				browserTimezone: "Europe/Berlin",
			}),
		).resolves.toMatchObject({ success: true });
		const { rows } = await admin.query<{
			id: string;
			clock_in_id: string;
			clock_out_id: string;
			canonical_record_id: string | null;
			graph_revision: number;
		}>(
			`select id, clock_in_id, clock_out_id, canonical_record_id, graph_revision from work_period
			 where employee_id = $1 and start_time = $2 and deleted_at is null`,
			[ids.requester, new Date(start.epochMilliseconds)],
		);
		return only(rows);
	}

	function split(
		workPeriodId: string,
		values: {
			date?: string;
			time: string;
			before?: string;
			after?: string;
			vehicleKm?: number;
		},
		submissionId?: string,
		via: Split = splitFromCalendarActions,
	) {
		actAs(ids.requesterUser);
		return via(
			workPeriodId,
			values.date ?? "2026-07-22",
			values.time,
			values.before,
			values.after,
			undefined,
			submissionId,
			values.vehicleKm,
		);
	}

	/** Every row a split can write, to prove "no writes" by equality. */
	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.record_id) from time_record_work t where organization_id = $1) as works,
			   (select json_agg(row_to_json(t) order by t.id) from time_record_allocation t where organization_id = $1) as allocations,
			   (select json_agg(row_to_json(t) order by t.employee_id) from time_entry_append_position t where organization_id = $1) as positions,
			   (select json_agg(row_to_json(t) order by t.employee_id) from employee_work_balance t where organization_id = $1) as balances,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts`,
			[ids.organization],
		);
		return only(rows);
	}

	async function segments() {
		const { rows } = await admin.query<{
			id: string;
			clock_in_id: string;
			clock_out_id: string;
			start_time: Date;
			end_time: Date;
			duration_minutes: number;
			approval_status: string;
			project_id: string | null;
			graph_revision: number;
			canonical_record_id: string | null;
			record_start: Date | null;
			record_end: Date | null;
			record_duration: number | null;
			record_state: string | null;
			record_created_by: string | null;
			record_updated_by: string | null;
			detail_location: string | null;
			allocations: string[] | null;
			clock_out_notes: string | null;
		}>(
			`select wp.id, wp.clock_in_id, wp.clock_out_id, wp.start_time, wp.end_time, wp.duration_minutes,
			        wp.approval_status, wp.project_id, wp.graph_revision, wp.canonical_record_id,
			        tr.start_at as record_start, tr.end_at as record_end, tr.duration_minutes as record_duration,
			        tr.approval_state as record_state, tr.created_by as record_created_by,
			        tr.updated_by as record_updated_by, w.work_location_type as detail_location,
			        (select array_agg(a.allocation_kind || ':' || coalesce(a.project_id::text, a.cost_center_id::text)
			           order by a.allocation_kind::text) from time_record_allocation a where a.record_id = tr.id) as allocations,
			        clock_out.notes as clock_out_notes
			 from work_period wp
			 left join time_record tr on tr.id = wp.canonical_record_id
			 left join time_record_work w on w.record_id = tr.id
			 join time_entry clock_out on clock_out.id = wp.clock_out_id
			 where wp.organization_id = $1 and wp.deleted_at is null
			 order by wp.start_time`,
			[ids.organization],
		);
		return rows;
	}

	async function cleanup() {
		await admin.query("drop function if exists t304_split_fail() cascade");
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser],
		]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		const users = [ids.requesterUser, ids.managerUser];
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T304 splits', $1, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't304s-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, users],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $5, 'employee', $6), ($3, $4, $5, 'manager', $6)`,
			[ids.requester, ids.requesterUser, ids.manager, ids.managerUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'Europe/Berlin', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at)
			 values ($1, $2, 'Project', 'active', true, $3, $4)`,
			[ids.project, ids.organization, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
			 values ($1, $2, $3, 'employee', $4, $5)`,
			[ids.assignment, ids.project, ids.organization, ids.requester, ids.managerUser],
		);
		await admin.query(
			`insert into cost_center (id, organization_id, name, updated_at)
			 values ($1, $2, 'Cost center', $3)`,
			[ids.costCenter, ids.organization, timestamp],
		);
		await setAdmission("active");
	}

	beforeEach(async () => {
		harness.logs.length = 0;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("splits adopted work with independent rounding, cloned attribution and exact append linkage", async () => {
		const period = await recordWork();
		// A second allocation kind proves every allocation follows the generated segment.
		await admin.query(
			`insert into time_record_allocation (organization_id, record_id, allocation_kind, cost_center_id, weight_percent)
			 values ($1, $2, 'cost_center', $3, 100)`,
			[ids.organization, period.canonical_record_id, ids.costCenter],
		);
		await admin.query(
			`insert into time_record_approval_decision (organization_id, record_id, actor_employee_id, action)
			 values ($1, $2, $3, 'approved')`,
			[ids.organization, period.canonical_record_id, ids.manager],
		);
		const submissionId = randomUUID();
		const { rows: tipBefore } = await admin.query<{
			tip_entry_id: string;
			version: number;
		}>("select tip_entry_id, version from time_entry_append_position where employee_id = $1", [
			ids.requester,
		]);

		const result = await split(
			period.id,
			{ time: "14:00", before: "Morning", after: "Afternoon" },
			submissionId,
		);

		const [retained, generated] = await segments();
		expect(result).toEqual({
			success: true,
			data: { firstPeriodId: period.id, secondPeriodId: generated?.id },
		});
		// Berlin 14:00 is 12:00 UTC. What each half carries is work records' contract
		// (work-records.integration.test.ts); the split states where and the notes.
		await expectRecordAgreement({ organizationId: ids.organization });
		expect(retained).toMatchObject({
			id: period.id,
			end_time: new Date("2026-07-22T12:00:00Z"),
			clock_out_notes: "Morning",
		});
		expect(generated).toMatchObject({
			clock_out_id: period.clock_out_id,
			start_time: new Date("2026-07-22T12:00:00Z"),
			clock_out_notes: "Afternoon",
		});

		// The split's entries are captured in the requester's zone setting.
		const { rows: splitEntries } = await admin.query<{
			id: string;
			type: string;
			timezone_source: string;
		}>(`select id, type, timezone_source from time_entry where id in ($1, $2) order by type desc`, [
			retained?.clock_out_id,
			generated?.clock_in_id,
		]);
		const [splitClockOut, splitClockIn] = splitEntries;
		expect(splitEntries.map(({ type, timezone_source }) => [type, timezone_source])).toEqual([
			["clock_out", "user_setting"],
			["clock_in", "user_setting"],
		]);
		const { rows: position } = await admin.query(
			`select tip_entry_id, version, last_operation from time_entry_append_position where employee_id = $1`,
			[ids.requester],
		);
		expect(only(position)).toEqual({
			tip_entry_id: splitClockIn?.id,
			version: only(tipBefore).version + 2,
			last_operation: "completed_work_split",
		});

		const { rows: receipts } = await admin.query<{
			kind: string;
			writer: string;
			actor_kind: string;
			actor_user_id: string;
			work_period_id: string;
			command: Record<string, unknown>;
			result: Record<string, unknown>;
		}>("select * from completed_work_operation where id = $1", [submissionId]);
		const receipt = only(receipts);
		expect(receipt).toMatchObject({
			kind: "split_completed_work",
			writer: "work_period_split",
			actor_kind: "human",
			actor_user_id: ids.requesterUser,
			work_period_id: period.id,
			command: {
				version: 1,
				operationId: submissionId,
				request: {
					workPeriodId: period.id,
					splitDate: "2026-07-22",
					splitTime: "14:00",
					disambiguation: null,
					beforeNotes: "Morning",
					afterNotes: "Afternoon",
				},
			},
		});
		// Work without vehicle use keeps the receipt's earlier shape (#1126).
		expect(Object.keys(receipt.command.request as object)).not.toContain("vehicleSplitKm");
		const resultSegments = receipt.result.segments as { attribution: object }[];
		expect(resultSegments.map(({ attribution }) => "vehicleUse" in attribution)).toEqual([
			false,
			false,
		]);
		expect(receipt.result).toMatchObject({
			split: {
				at: "2026-07-22T12:00:00Z",
				utcOffsetMinutes: 120,
				timezone: "Europe/Berlin",
				timezoneSource: "user_setting",
			},
			source: {
				workPeriodId: period.id,
				startAt: "2026-07-22T08:00:40Z",
				endAt: "2026-07-22T17:00:31Z",
				durationMinutes: 540,
				approvalState: "approved",
			},
			segments: [
				{
					role: "retained",
					durationMinutes: 239,
					clockOutEntryId: splitClockOut?.id,
				},
				{
					role: "generated",
					workPeriodId: generated?.id,
					durationMinutes: 301,
					clockInEntryId: splitClockIn?.id,
					clockOutEntryId: period.clock_out_id,
					origin: {
						workPeriodId: period.id,
						canonicalRecordId: period.canonical_record_id,
					},
					approval: {
						state: "approved",
						basis: "split_source",
						sourceDecisionIds: [expect.any(String)],
					},
				},
			],
			notes: { before: "Morning", after: "Afternoon" },
			append: {
				clockOut: { previousEntryId: only(tipBefore).tip_entry_id },
				clockIn: { previousEntryId: splitClockOut?.id },
			},
			revisions: {
				source: {
					source: period.graph_revision,
					result: period.graph_revision + 1,
				},
				generated: { source: null, result: 1 },
			},
		});

		// The other calendar entry point replays the committed split exactly.
		const after = await snapshot();
		await expect(
			split(
				period.id,
				{ time: "14:00", before: "Morning", after: "Afternoon" },
				submissionId,
				splitFromMutations,
			),
		).resolves.toEqual(result);
		expect(await snapshot()).toEqual(after);
		// A changed request under the same identity is a collision, never new work.
		await expect(
			split(period.id, { time: "15:00", before: "Morning" }, submissionId, splitFromMutations),
		).resolves.toMatchObject({ success: false, error: collision });
		expect(await snapshot()).toEqual(after);

		// The second entry point splits the generated segment as fresh work.
		await expect(
			split(generated?.id ?? "", { time: "17:00" }, randomUUID(), splitFromMutations),
		).resolves.toMatchObject({ success: true });
		expect((await segments()).map(({ duration_minutes }) => duration_minutes)).toEqual([
			239, 180, 121,
		]);
		// The first split's committed segments no longer stand as committed.
		const resplit = await snapshot();
		await expect(
			split(period.id, { time: "14:00", before: "Morning", after: "Afternoon" }, submissionId),
		).resolves.toMatchObject({ success: false, error: collision });
		expect(await snapshot()).toEqual(resplit);
	});

	it("resolves the wall-clock split on the date it names, across local midnight", async () => {
		// Berlin 2026-07-10 23:00 to 2026-07-11 02:00.
		const period = await recordWork(
			parseInstant("2026-07-10T21:00:00Z"),
			parseInstant("2026-07-11T00:00:00Z"),
		);

		await expect(
			split(period.id, { date: "2026-07-11", time: "00:30" }, randomUUID()),
		).resolves.toMatchObject({ success: true });

		expect((await segments()).map(({ start_time }) => start_time)).toEqual([
			new Date("2026-07-10T21:00:00Z"),
			new Date("2026-07-10T22:30:00Z"),
		]);
	});

	it.each([
		["adopted", "active"],
		["legacy", "inactive"],
	] as const)(
		"refuses a %s split while the period has an unresolved review",
		async (_name, mode) => {
			await setAdmission(mode);
			const period = await recordWork();
			await admin.query(
				`insert into approval_request
				 (id, organization_id, entity_type, entity_id, requested_by, approver_id, status, reason, created_at, updated_at)
				 values ($1, $2, 'time_entry', $3, $4, $5, 'pending', 'Correction', now(), now())`,
				[randomUUID(), ids.organization, period.id, ids.requester, ids.manager],
			);
			const before = await snapshot();

			await expect(split(period.id, { time: "14:00" }, randomUUID())).resolves.toEqual({
				success: false,
				error: "A time correction approval is already pending for this work period",
				code: "pending_time_correction_approval",
			});
			expect(await snapshot()).toEqual(before);
		},
	);

	it("refuses a split when other work overlaps the resulting segments", async () => {
		const period = await recordWork();
		await admin.query(
			`insert into work_period (organization_id, employee_id, clock_in_id, start_time, end_time,
			  duration_minutes, is_active, approval_status, updated_at)
			 values ($1, $2, $3, $4, $5, 60, false, 'approved', now())`,
			[
				ids.organization,
				ids.requester,
				period.clock_in_id,
				new Date("2026-07-22T16:30:00Z"),
				new Date("2026-07-22T17:30:00Z"),
			],
		);
		const before = await snapshot();

		await expect(split(period.id, { time: "14:00" }, randomUUID())).resolves.toEqual({
			success: false,
			error: "The time range overlaps other recorded work",
			code: "work_interval_occupied",
		});
		expect(await snapshot()).toEqual(before);
	});

	it("refuses a split while any canonical review of the period is pending", async () => {
		const period = await recordWork();
		// An ordinary workflow still pending although the period status says approved.
		await admin.query(`update time_record set approval_state = 'pending' where id = $1`, [
			period.canonical_record_id,
		]);
		const before = await snapshot();

		await expect(split(period.id, { time: "14:00" }, randomUUID())).resolves.toEqual({
			success: false,
			error: "This work period is awaiting approval and cannot be edited",
			code: "work_period_pending_approval",
		});
		expect(await snapshot()).toEqual(before);
	});

	it("holds a split for review when the canonical record diverges", async () => {
		const period = await recordWork();
		await admin.query("delete from time_record_allocation where record_id = $1", [
			period.canonical_record_id,
		]);
		const before = await snapshot();

		await expect(split(period.id, { time: "14:00" }, randomUUID())).resolves.toEqual({
			success: false,
			error: "This work needs review before it can be changed",
			code: "completed_work_review_required",
		});
		expect(await snapshot()).toEqual(before);
	});

	// Work records' own writes are its contract; the split's receipt commits with them.
	it.each([
		["time_record", "insert"],
		["completed_work_operation", "insert"],
	])(
		"rolls every write back when %s %s fails, and the retry commits once",
		async (table, event) => {
			const period = await recordWork();
			const before = await snapshot();
			const submissionId = randomUUID();
			await admin.query(
				`create function t304_split_fail() returns trigger language plpgsql as $$
				 begin raise exception 't304 injected failure'; end $$`,
			);
			await admin.query(
				`create trigger t304_split_fail before ${event} on ${table} for each row execute function t304_split_fail()`,
			);
			try {
				await expect(
					split(period.id, { time: "14:00", before: "Morning", after: "Afternoon" }, submissionId),
				).resolves.toEqual({ success: false, error: failed });
			} finally {
				await admin.query("drop function t304_split_fail() cascade");
			}
			expect(await snapshot()).toEqual(before);

			await expect(
				split(period.id, { time: "14:00", before: "Morning", after: "Afternoon" }, submissionId),
			).resolves.toMatchObject({ success: true });
			await expect(
				split(period.id, { time: "14:00", before: "Morning", after: "Afternoon" }, submissionId),
			).resolves.toMatchObject({ success: true });
			const { rows } = await admin.query(
				`select
				   (select count(*)::int from completed_work_operation where organization_id = $1 and kind = 'split_completed_work') as receipts,
				   (select count(*)::int from work_period where organization_id = $1) as periods`,
				[ids.organization],
			);
			expect(only(rows)).toEqual({ receipts: 1, periods: 2 });
		},
	);

	it.each([
		["active", "self"],
		["inactive", "self"],
		["active", "admin"],
		["inactive", "admin"],
	] as const)(
		"allows changing either split segment's location under %s admission via %s edit",
		async (admission, route) => {
			await setAdmission(admission);
			const period = await recordWork(
				parseInstant("2026-07-22T08:00:00Z"),
				parseInstant("2026-07-22T16:00:00Z"),
			);
			await expect(split(period.id, { time: "14:00" }, randomUUID())).resolves.toMatchObject({
				success: true,
			});
			const parts = await segments();
			expect(parts).toHaveLength(2);
			if (route === "admin") {
				await admin.query(
					"update member set role = 'admin' where organization_id = $1 and user_id = $2",
					[ids.organization, ids.requesterUser],
				);
			}
			for (const [index, part] of [...parts.entries()].reverse()) {
				if (route === "admin") {
					await expect(
						applyAdminWorkPeriodTimeEdit({
							organizationId: ids.organization,
							actorUserId: ids.requesterUser,
							workPeriodId: part.id,
							submissionId: randomUUID(),
							submitted: {
								clockInDate: "2026-07-22",
								clockInTime: index === 0 ? "10:00" : "14:00",
								clockOutDate: "2026-07-22",
								clockOutTime: index === 0 ? "14:00" : "18:00",
								workLocationType: "remote",
							},
							expected: {
								employeeId: ids.requester,
								clockInId: part.clock_in_id,
								clockOutId: part.clock_out_id,
								startTime: part.start_time,
								endTime: part.end_time,
							},
							clockIn: part.start_time,
							clockOut: part.end_time,
							timezone: "Europe/Berlin",
							timezoneSource: "user_setting",
							notes: "Mobil",
							ipAddress: "",
							deviceInfo: "",
						}),
					).resolves.toMatchObject({ workPeriodId: part.id });
					continue;
				}
				await expect(
					editSameDayTimeEntry({
						workPeriodId: part.id,
						newClockInDate: "2026-07-22",
						newClockInTime: index === 0 ? "10:00" : "14:00",
						newClockOutDate: "2026-07-22",
						newClockOutTime: index === 0 ? "14:00" : "18:00",
						workLocationType: "remote",
						workCategoryId: null,
					}),
				).resolves.toEqual({ success: true, data: { workPeriodId: part.id } });
			}
			expect(
				(await segments()).map(({ detail_location, record_duration }) => ({
					detail_location,
					record_duration,
				})),
			).toEqual([
				{ detail_location: "remote", record_duration: 240 },
				{ detail_location: "remote", record_duration: 240 },
			]);
		},
	);
	it.each([
		["time_record", "update"],
		["time_record", "insert"],
		["time_record_work", "insert"],
		["time_record_allocation", "insert"],
	] as const)("rolls back a legacy split when %s %s fails", async (table, event) => {
		await setAdmission("inactive");
		const period = await recordWork();
		const before = await snapshot();
		await admin.query(
			`create function t304_split_fail() returns trigger language plpgsql as $$ begin raise exception 'split canonical write failure'; end $$`,
		);
		await admin.query(
			`create trigger t304_split_fail before ${event} on ${table} for each row execute function t304_split_fail()`,
		);
		try {
			await expect(split(period.id, { time: "14:00" }, randomUUID())).resolves.toMatchObject({
				success: false,
				error: failed,
			});
		} finally {
			await admin.query("drop function t304_split_fail() cascade");
		}
		expect(await snapshot()).toEqual(before);
	});
	it("divides the canonical record and preserves attribution in a legacy organization", async () => {
		await setAdmission("inactive");
		const period = await recordWork();

		await expect(split(period.id, { time: "14:00" }, randomUUID())).resolves.toMatchObject({
			success: true,
		});

		const [retained, generated] = await segments();
		expect(retained).toMatchObject({
			end_time: new Date("2026-07-22T12:00:00Z"),
			// The legacy resolver floors each segment.
			duration_minutes: 239,
			graph_revision: period.graph_revision,
			// The canonical record follows the retained segment.
			record_end: new Date("2026-07-22T12:00:00Z"),
			record_duration: 239,
		});
		expect(generated).toMatchObject({
			duration_minutes: 300,
			record_duration: 300,
			record_start: new Date("2026-07-22T12:00:00Z"),
			record_end: new Date("2026-07-22T17:00:31Z"),
			detail_location: "office",
			allocations: [`project:${ids.project}`],
		});
		expect(generated?.canonical_record_id).toBeTruthy();
		expect(generated?.canonical_record_id).not.toBe(period.canonical_record_id);
		const { rows } = await admin.query(
			"select count(*)::int as receipts from completed_work_operation where organization_id = $1 and kind = 'split_completed_work'",
			[ids.organization],
		);
		expect(only(rows)).toEqual({ receipts: 0 });
	});

	describe("vehicle use (#1126)", () => {
		const van = "e3041000-0000-4000-8000-000000000061";
		type Km = {
			start: number | null;
			end: number | null;
			distance: number | null;
		};

		async function enableVehicleUse(mode: "off" | "asked" | "expected") {
			await admin.query(
				`insert into vehicle_use_setting (organization_id, enabled) values ($1, $2)
				 on conflict (organization_id) do update set enabled = excluded.enabled`,
				[ids.organization, mode !== "off"],
			);
			await admin.query(
				`insert into vehicle_use_assignment (organization_id, assignment_type, priority, mode, created_by)
				 values ($1, 'organization', 0, $2, $3)`,
				[ids.organization, mode, ids.managerUser],
			);
		}

		/** Records vehicle use the way #1120 stores it: on the period and its canonical detail. */
		async function driveVan(period: { id: string; canonical_record_id: string | null }, km: Km) {
			await admin.query(
				`insert into organization_vehicle (id, organization_id, name, licence_plate)
				 values ($1, $2, 'Van', 'B-VN 100') on conflict do nothing`,
				[van, ids.organization],
			);
			for (const [table, key] of [
				["work_period", "id"],
				["time_record_work", "record_id"],
			] as const) {
				await admin.query(
					`update ${table} set vehicle_kind = 'organization', vehicle_id = $2,
					   odometer_start_km = $3, odometer_end_km = $4, driven_distance_km = $5
					 where ${key} = $1`,
					[
						table === "work_period" ? period.id : period.canonical_record_id,
						van,
						km.start,
						km.end,
						km.distance,
					],
				);
			}
		}

		async function vehicleSegments() {
			const { rows } = await admin.query<{
				id: string;
				period: Km & { vehicle: string | null };
				detail: (Km & { vehicle: string | null }) | null;
			}>(
				`select wp.id,
				   json_build_object('vehicle', wp.vehicle_id, 'start', wp.odometer_start_km,
				     'end', wp.odometer_end_km, 'distance', wp.driven_distance_km) as period,
				   case when w.record_id is null then null else json_build_object('vehicle', w.vehicle_id,
				     'start', w.odometer_start_km, 'end', w.odometer_end_km, 'distance', w.driven_distance_km) end as detail
				 from work_period wp
				 left join time_record_work w on w.record_id = wp.canonical_record_id
				 where wp.organization_id = $1 and wp.deleted_at is null
				 order by wp.start_time`,
				[ids.organization],
			);
			return rows;
		}

		const km = (start: number | null, end: number | null, distance: number | null) => ({
			vehicle: van,
			start,
			end,
			distance,
		});

		it("copies the vehicle to both halves and applies the reading at the split as end and start", async () => {
			await enableVehicleUse("asked");
			const period = await recordWork();
			await driveVan(period, { start: 12_000, end: 12_085, distance: 85 });
			const submissionId = randomUUID();

			const result = await split(period.id, { time: "14:00", vehicleKm: 12_040 }, submissionId);

			expect(result).toMatchObject({ success: true });
			const [retained, generated] = await vehicleSegments();
			expect(retained).toEqual({
				id: period.id,
				period: km(12_000, 12_040, 40),
				detail: km(12_000, 12_040, 40),
			});
			expect(generated).toMatchObject({
				period: km(12_040, 12_085, 45),
				detail: km(12_040, 12_085, 45),
			});
			const { rows } = await admin.query<{
				command: { request: Record<string, unknown> };
				result: {
					source: { attribution: object };
					segments: { attribution: object }[];
				};
			}>("select command, result from completed_work_operation where id = $1", [submissionId]);
			const receipt = only(rows);
			expect(receipt.command.request).toMatchObject({ vehicleSplitKm: 12_040 });
			const vanUse = (startKm: number, endKm: number) => ({
				vehicle: { kind: "organization", vehicleId: van },
				startKm,
				endKm,
				distanceKm: endKm - startKm,
			});
			expect(receipt.result.source.attribution).toMatchObject({
				vehicleUse: vanUse(12_000, 12_085),
			});
			expect(receipt.result.segments.map(({ attribution }) => attribution)).toMatchObject([
				{ vehicleUse: vanUse(12_000, 12_040) },
				{ vehicleUse: vanUse(12_040, 12_085) },
			]);

			// The committed split replays exactly, and a different reading is a collision.
			const after = await snapshot();
			await expect(
				split(period.id, { time: "14:00", vehicleKm: 12_040 }, submissionId, splitFromMutations),
			).resolves.toEqual(result);
			await expect(
				split(period.id, { time: "14:00", vehicleKm: 12_041 }, submissionId),
			).resolves.toMatchObject({ success: false, error: collision });
			expect(await snapshot()).toEqual(after);
		});

		it("refuses a reading outside the work's readings without writing", async () => {
			await enableVehicleUse("asked");
			const period = await recordWork();
			await driveVan(period, { start: 12_000, end: 12_085, distance: 85 });
			const before = await snapshot();

			await expect(
				split(period.id, { time: "14:00", vehicleKm: 12_100 }, randomUUID()),
			).resolves.toMatchObject({
				success: false,
				code: "split_value_out_of_range",
			});
			expect(await snapshot()).toEqual(before);
		});

		it("still splits read-only vehicle use while vehicle use is off, but refuses a reading", async () => {
			await enableVehicleUse("off");
			const period = await recordWork();
			await driveVan(period, { start: 12_000, end: 12_085, distance: 85 });
			const before = await snapshot();

			await expect(
				split(period.id, { time: "14:00", vehicleKm: 12_040 }, randomUUID()),
			).resolves.toMatchObject({ success: false, code: "vehicle_use_off" });
			expect(await snapshot()).toEqual(before);

			await expect(split(period.id, { time: "14:00" }, randomUUID())).resolves.toMatchObject({
				success: true,
			});
			expect((await vehicleSegments()).map(({ period }) => period)).toEqual([
				km(12_000, null, null),
				km(null, 12_085, null),
			]);
		});

		it("holds a split for review when the period and its canonical record disagree on vehicle use", async () => {
			await enableVehicleUse("asked");
			const period = await recordWork();
			await driveVan(period, { start: 12_000, end: 12_085, distance: 85 });
			await admin.query(
				"update time_record_work set odometer_end_km = 12_090, driven_distance_km = 90 where record_id = $1",
				[period.canonical_record_id],
			);
			const before = await snapshot();

			await expect(split(period.id, { time: "14:00" }, randomUUID())).resolves.toMatchObject({
				success: false,
				code: "completed_work_review_required",
			});
			expect(await snapshot()).toEqual(before);
		});

		it("divides the vehicle in both legacy work representations", async () => {
			await setAdmission("inactive");
			await enableVehicleUse("asked");
			const period = await recordWork();
			await driveVan(period, { start: 12_000, end: 12_085, distance: 85 });

			await expect(
				split(period.id, { time: "14:00", vehicleKm: 12_040 }, randomUUID()),
			).resolves.toMatchObject({ success: true });

			const [retained, generated] = await vehicleSegments();
			expect(retained?.period).toEqual(km(12_000, 12_040, 40));
			expect(generated?.period).toEqual(km(12_040, 12_085, 45));
			// The canonical record follows the retained segment.
			expect(retained?.detail).toEqual(km(12_000, 12_040, 40));
			expect(generated?.detail).toEqual(km(12_040, 12_085, 45));
		});

		describe("work whose distance is claimed on an expense item (#1131)", () => {
			/** Own-vehicle work with 120 km, added as a mileage item to a new report. */
			async function claimOwnVehicleWork(period: {
				id: string;
				canonical_record_id: string | null;
			}) {
				for (const [table, key, id] of [
					["work_period", "id", period.id],
					["time_record_work", "record_id", period.canonical_record_id],
				] as const) {
					await admin.query(
						`update ${table} set vehicle_kind = 'own', vehicle_id = null, odometer_start_km = null,
						   odometer_end_km = null, driven_distance_km = 120
						 where ${key} = $1`,
						[id],
					);
				}
				const added = await addWorkPeriodMileage(
					db,
					{
						organizationId: ids.organization,
						employeeId: ids.requester,
						userId: ids.requesterUser,
					},
					{ workPeriodId: period.id, reportId: null },
				);
				expect(added).toMatchObject({ kind: "added" });
				return added.kind === "added" ? added.itemId : "";
			}

			it.each([
				["an adopted", "active"],
				["a legacy", "inactive"],
			] as const)(
				"refuses splitting %s organization's claimed work until the item is removed",
				async (_label, admission) => {
					await setAdmission(admission);
					await enableVehicleUse("asked");
					const period = await recordWork();
					const itemId = await claimOwnVehicleWork(period);
					const before = await snapshot();

					await expect(
						split(period.id, { time: "14:00", vehicleKm: 70 }, randomUUID()),
					).resolves.toMatchObject({
						success: false,
						code: "work_period_distance_claimed",
					});
					await expect(
						split(period.id, { time: "14:00" }, randomUUID(), splitFromMutations),
					).resolves.toMatchObject({
						success: false,
						code: "work_period_distance_claimed",
					});
					expect(await snapshot()).toEqual(before);

					await admin.query("delete from travel_expense_report_item where id = $1", [itemId]);
					await expect(
						split(period.id, { time: "14:00", vehicleKm: 70 }, randomUUID()),
					).resolves.toMatchObject({ success: true });
				},
			);
		});
	});
});
