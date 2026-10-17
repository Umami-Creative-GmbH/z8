import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dateFromInstant, parseInstant } from "@/lib/datetime/temporal-core";
import { runtime } from "@/lib/effect/runtime";
import { WorkPolicyService } from "@/lib/effect/services/work-policy.service";
import { integrationAdminPool } from "@/test/integration-database";
import { checkComplianceAfterClockOut } from "./clock-out-effects";
import { readComplianceTotals } from "./compliance-totals";

// Run the real work-policy service over the disposable database, without unrelated AppLayer services.
vi.mock("@/lib/effect/runtime", async () => {
	const { Layer } = await import("effect");
	const { DatabaseServiceLive } = await import("@/lib/effect/services/database.service");
	const { WorkPolicyServiceLive } = await import("@/lib/effect/services/work-policy.service");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		WorkPolicyServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
	);
});

describe("Monday compliance weeks on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const organizationId = "compliance-week-994";
	const foreignOrganizationId = "compliance-week-foreign-994";
	const userId = "compliance-week-user-994";
	const otherUserId = "compliance-week-other-994";
	const employeeId = "f9940000-0000-4000-8000-000000000001";
	const otherEmployeeId = "f9940000-0000-4000-8000-000000000002";
	const scope = { organizationId, employeeId };

	async function cleanup() {
		await admin.query("delete from organization where id = any($1)", [
			[organizationId, foreignOrganizationId],
		]);
		await admin.query('delete from "user" where id = any($1)', [[userId, otherUserId]]);
	}

	async function period(
		start: string,
		minutes = 480,
		options: {
			organizationId?: string;
			employeeId?: string;
			timezone?: string;
			deleted?: boolean;
		} = {},
	) {
		const id = randomUUID();
		const clockInId = randomUUID();
		const clockOutId = randomUUID();
		const instant = parseInstant(start);
		const end = instant.add({ minutes });
		const periodOrganization = options.organizationId ?? organizationId;
		const periodEmployee = options.employeeId ?? employeeId;
		const timezone = options.timezone ?? "UTC";
		for (const [entryId, type, at] of [
			[clockInId, "clock_in", instant],
			[clockOutId, "clock_out", end],
		] as const) {
			await admin.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
				 timezone, timezone_source, hash, created_by)
				 values ($1,$2,$3,$4,$5,$6,$7,'user_setting',$8,$9)`,
				[
					entryId,
					periodEmployee,
					periodOrganization,
					type,
					dateFromInstant(at),
					at.toZonedDateTimeISO(timezone).offsetNanoseconds / 60_000_000_000,
					timezone,
					entryId,
					userId,
				],
			);
		}
		await admin.query(
			`insert into work_period
			 (id, employee_id, organization_id, clock_in_id, clock_out_id, start_time,
			 end_time, duration_minutes, deleted_at, updated_at)
			 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
			[
				id,
				periodEmployee,
				periodOrganization,
				clockInId,
				clockOutId,
				dateFromInstant(instant),
				dateFromInstant(end),
				minutes,
				options.deleted ? dateFromInstant(instant) : null,
			],
		);
		return { id, start: instant, end, durationMinutes: minutes };
	}

	async function policy(maxWeeklyMinutes: number, employeeUntil?: string) {
		const id = randomUUID();
		await admin.query(
			`insert into work_policy
			 (id,organization_id,name,schedule_enabled,created_by,updated_at)
			 values ($1,$2,$4,false,$3,now())`,
			[id, organizationId, userId, id],
		);
		await admin.query(
			`insert into work_policy_regulation (policy_id,max_weekly_minutes,updated_at)
			 values ($1,$2,now())`,
			[id, maxWeeklyMinutes],
		);
		await admin.query(
			`insert into work_policy_assignment
			 (policy_id,organization_id,assignment_type,employee_id,effective_until,created_by,updated_at)
			 values ($1,$2,$3,$4,$5,$6,now())`,
			[
				id,
				organizationId,
				employeeUntil ? "employee" : "organization",
				employeeUntil ? employeeId : null,
				employeeUntil ?? null,
				userId,
			],
		);
		return id;
	}

	const violations = () =>
		runtime.runPromise(
			Effect.gen(function* () {
				const service = yield* WorkPolicyService;
				return yield* service.getViolations({
					...scope,
					startDate: dateFromInstant(parseInstant("2026-07-01T00:00:00Z")),
					endDate: dateFromInstant(parseInstant("2026-08-01T00:00:00Z")),
				});
			}),
		);

	beforeEach(async () => {
		await cleanup();
		await admin.query(
			"insert into organization (id,name,slug,created_at) select id,id,id,now() from unnest($1::text[]) id",
			[[organizationId, foreignOrganizationId]],
		);
		for (const [id, employee] of [
			[userId, employeeId],
			[otherUserId, otherEmployeeId],
		]) {
			await admin.query(
				'insert into "user" (id,name,email,created_at,updated_at) values ($1,$1,$2,now(),now())',
				[id, `${id}@example.test`],
			);
			await admin.query(
				"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,'employee',now())",
				[employee, id, organizationId],
			);
		}
	});
	afterAll(async () => {
		try {
			await cleanup();
		} finally {
			await runtime.dispose();
		}
	});

	it("counts Monday through Sunday and excludes the next Monday without a week-start option", async () => {
		for (const date of ["06", "07", "08", "09", "10", "11", "12", "13"]) {
			await period(`2026-07-${date}T08:00:00Z`);
		}
		await expect(
			readComplianceTotals({
				...scope,
				workStart: parseInstant("2026-07-12T08:00:00Z"),
				timezone: "UTC",
			}),
		).resolves.toEqual({
			dailyMinutes: 480,
			weeklyMinutes: 3360,
			breakMinutes: 0,
		});
	});

	it("resets at Monday midnight in the work's zone and counts whole periods by their start", async () => {
		const timezone = "America/New_York";
		await period("2026-07-13T03:00:00Z", 60, { timezone }); // Previous Sunday.
		await period("2026-07-13T04:00:00Z", 60, { timezone }); // Monday midnight.
		await period("2026-07-20T02:30:00Z", 120, { timezone }); // Sunday, ending Monday.
		await period("2026-07-20T05:00:00Z", 30, { timezone }); // Next Monday.
		await expect(
			readComplianceTotals({
				...scope,
				workStart: parseInstant("2026-07-13T04:00:00Z"),
				timezone,
			}),
		).resolves.toEqual({
			dailyMinutes: 60,
			weeklyMinutes: 180,
			breakMinutes: 0,
		});
	});

	it.each([
		[
			"spring",
			"2026-03-22T22:59:00Z",
			"2026-03-22T23:00:00Z",
			"2026-03-29T21:00:00Z",
			"2026-03-29T22:00:00Z",
		],
		[
			"fall",
			"2026-10-18T21:59:00Z",
			"2026-10-18T22:00:00Z",
			"2026-10-25T22:00:00Z",
			"2026-10-25T23:00:00Z",
		],
	])(
		"uses both local Monday midnights across Berlin's %s DST transition",
		async (_season, before, monday, sunday, nextMonday) => {
			const timezone = "Europe/Berlin";
			await period(before, 1, { timezone });
			await period(monday, 30, { timezone });
			await period(sunday, 60, { timezone });
			await period(nextMonday, 120, { timezone });
			await expect(
				readComplianceTotals({
					...scope,
					workStart: parseInstant(sunday),
					timezone,
				}),
			).resolves.toEqual({
				dailyMinutes: 60,
				weeklyMinutes: 90,
				breakMinutes: 0,
			});
		},
	);

	it("keeps deleted work, other employees and other organizations out of the week", async () => {
		await period("2026-07-12T08:00:00Z", 60);
		await period("2026-07-12T10:00:00Z", 120, { deleted: true });
		await period("2026-07-12T08:00:00Z", 240, { employeeId: otherEmployeeId });
		// Deliberately use the same employee ID in another organization to exercise both predicates.
		await period("2026-07-12T08:00:00Z", 480, {
			organizationId: foreignOrganizationId,
		});
		await expect(
			readComplianceTotals({
				...scope,
				workStart: parseInstant("2026-07-12T08:00:00Z"),
				timezone: "UTC",
			}),
		).resolves.toEqual({
			dailyMinutes: 60,
			weeklyMinutes: 60,
			breakMinutes: 0,
		});
	});

	it("is independent of personal display preferences and all submission cadence kinds", async () => {
		await period("2026-07-06T08:00:00Z", 480);
		await period("2026-07-12T08:00:00Z", 480);
		for (const weekStart of ["sunday", "monday"]) {
			await admin.query(
				`insert into user_settings (user_id,week_start_day,updated_at) values ($1,$2,now())
				 on conflict (user_id) do update set week_start_day = excluded.week_start_day`,
				[userId, weekStart],
			);
			for (const cadence of ["off", "weekly", "monthly"]) {
				await admin.query(
					"delete from period_submission_cadence_change where organization_id = $1",
					[organizationId],
				);
				await admin.query(
					`insert into period_submission_cadence_change
					 (organization_id,cadence,week_start_day,changed_at,changed_by)
					 values ($1,$2,$3,'2026-01-01T00:00:00Z',$4)`,
					[organizationId, cadence, cadence === "weekly" ? "wednesday" : null, userId],
				);
				await expect(
					readComplianceTotals({
						...scope,
						workStart: parseInstant("2026-07-12T08:00:00Z"),
						timezone: "UTC",
					}),
				).resolves.toEqual({
					dailyMinutes: 480,
					weeklyMinutes: 960,
					breakMinutes: 0,
				});
			}
		}
	});

	it("records a delayed Sunday's weekly violation using the policy at work end and preserves older evidence", async () => {
		const policyId = await policy(2880);
		await policy(60, "2026-07-12T12:00:00Z"); // Stricter employee policy expired during Sunday's work.
		await runtime.runPromise(
			Effect.gen(function* () {
				const service = yield* WorkPolicyService;
				yield* service.logViolation({
					...scope,
					policyId,
					violationAt: parseInstant("2026-07-05T08:00:00Z"),
					violationType: "max_weekly",
					details: { actualMinutes: 120, limitMinutes: 60 },
				});
			}),
		);
		const historical = await violations();
		for (const date of ["06", "07", "08", "09", "10", "11"]) {
			await period(`2026-07-${date}T08:00:00Z`);
		}
		const sunday = await period("2026-07-12T08:00:00Z");
		// Evaluation happens long after July: the checked work selects its week and policy.
		await expect(
			checkComplianceAfterClockOut(
				{
					...scope,
					workPeriodId: sunday.id,
					work: sunday,
					timezone: "UTC",
				},
				{ throwOnError: true },
			),
		).resolves.toEqual([
			expect.objectContaining({
				type: "max_weekly",
				severity: "violation",
				actualValue: 3360,
				limitValue: 2880,
			}),
		]);
		const recorded = await violations();
		expect(recorded).toHaveLength(2);
		expect(recorded).toContainEqual(historical[0]);
		expect(recorded).toContainEqual(
			expect.objectContaining({
				policyId,
				workPeriodId: sunday.id,
				violationDate: dateFromInstant(sunday.start),
				violationType: "max_weekly",
			}),
		);
		const monday = await period("2026-07-13T08:00:00Z");
		await expect(
			checkComplianceAfterClockOut(
				{
					...scope,
					workPeriodId: monday.id,
					work: monday,
					timezone: "UTC",
				},
				{ throwOnError: true },
			),
		).resolves.toEqual([]);
		await expect(violations()).resolves.toEqual(recorded);
	});
});
