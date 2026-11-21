/**
 * #1922: Work policy create, update, and duplicate run atomically on PostgreSQL
 * and preserve/persist all 7 ArbZG compliance regulation columns.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

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

vi.mock("@/lib/organization-mfa/organization-access", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/organization-mfa/organization-access")>()),
	canAccessOrganization: async () => true,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => ({
			error: () => {},
			warn: () => {},
			info: () => {},
			debug: () => {},
		}),
	}),
}));

const { createWorkPolicy, duplicateWorkPolicy, getWorkPolicy, updateWorkPolicy } =
	await import("./actions");

const ids = {
	organization: "t1922-org",
	adminUser: "t1922-admin-user",
} as const;

const INITIAL_ARBZG = {
	minRestPeriodMinutes: 690, // 11.5h (non-default)
	restPeriodEnforcement: "block" as const, // non-default (default is "warn")
	overtimeDailyThresholdMinutes: 510, // 8.5h
	overtimeWeeklyThresholdMinutes: 2310, // 38.5h
	overtimeMonthlyThresholdMinutes: 10200, // 170h
	alertBeforeLimitMinutes: 45, // non-default (default is 30)
	alertThresholdPercent: 90, // non-default (default is 80)
};

const UPDATED_ARBZG = {
	minRestPeriodMinutes: 600, // 10h
	restPeriodEnforcement: "none" as const,
	overtimeDailyThresholdMinutes: 540, // 9h
	overtimeWeeklyThresholdMinutes: 2520, // 42h
	overtimeMonthlyThresholdMinutes: 11100, // 185h
	alertBeforeLimitMinutes: 15,
	alertThresholdPercent: 75,
};

describe("work policy ArbZG regulation persistence & transaction atomicity (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let locationId: string;

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = $1', [ids.adminUser]);
	}

	async function seedPolicyWithAllArbzgFields(name = "ArbZG Full Policy") {
		const {
			rows: [policyRow],
		} = await admin.query<{ id: string }>(
			`insert into work_policy
			 (organization_id, name, description, schedule_enabled, regulation_enabled, presence_enabled, is_default, created_by, updated_at)
			 values ($1, $2, 'Initial description', true, true, true, true, $3, now())
			 returning id`,
			[ids.organization, name, ids.adminUser],
		);
		const policyId = policyRow.id;

		const {
			rows: [versionRow],
		} = await admin.query<{ id: string }>(
			`insert into work_policy_version
			 (organization_id, policy_id, version_number, effective_from_date, schedule_enabled, regulation_enabled, presence_enabled, is_legacy_baseline, sealed_at, created_by)
			 values ($1, $2, 1, '1970-01-01', true, true, true, true, NULL, $3)
			 returning id`,
			[ids.organization, policyId, ids.adminUser],
		);
		const versionId = versionRow.id;

		const {
			rows: [scheduleRow],
		} = await admin.query<{ id: string }>(
			`insert into work_policy_schedule
			 (policy_id, policy_version_id, schedule_cycle, schedule_type, working_days_preset, hours_per_cycle, home_office_days_per_cycle, updated_at)
			 values ($1, $2, 'weekly', 'detailed', 'custom', null, 1, now())
			 returning id`,
			[policyId, versionId],
		);

		await admin.query(
			`insert into work_policy_schedule_day
			 (schedule_id, policy_version_id, day_of_week, hours_per_day, is_work_day, cycle_week, latest_clock_in)
			 values
			 ($1, $2, 'monday', '8.00', true, 1, '09:00'),
			 ($1, $2, 'tuesday', '8.00', true, 1, '09:30'),
			 ($1, $2, 'saturday', '0.00', false, 1, null)`,
			[scheduleRow.id, versionId],
		);

		const {
			rows: [regulationRow],
		} = await admin.query<{ id: string }>(
			`insert into work_policy_regulation
			 (policy_id, policy_version_id, max_daily_minutes, max_weekly_minutes, max_uninterrupted_minutes,
			  min_rest_period_minutes, rest_period_enforcement,
			  overtime_daily_threshold_minutes, overtime_weekly_threshold_minutes, overtime_monthly_threshold_minutes,
			  alert_before_limit_minutes, alert_threshold_percent, updated_at)
			 values ($1, $2, 600, 2880, 360, $3, $4, $5, $6, $7, $8, $9, now())
			 returning id`,
			[
				policyId,
				versionId,
				INITIAL_ARBZG.minRestPeriodMinutes,
				INITIAL_ARBZG.restPeriodEnforcement,
				INITIAL_ARBZG.overtimeDailyThresholdMinutes,
				INITIAL_ARBZG.overtimeWeeklyThresholdMinutes,
				INITIAL_ARBZG.overtimeMonthlyThresholdMinutes,
				INITIAL_ARBZG.alertBeforeLimitMinutes,
				INITIAL_ARBZG.alertThresholdPercent,
			],
		);

		const {
			rows: [ruleRow],
		} = await admin.query<{ id: string }>(
			`insert into work_policy_break_rule
			 (regulation_id, policy_version_id, working_minutes_threshold, required_break_minutes, sort_order, updated_at)
			 values ($1, $2, 360, 30, 0, now())
			 returning id`,
			[regulationRow.id, versionId],
		);

		await admin.query(
			`insert into work_policy_break_option
			 (break_rule_id, policy_version_id, split_count, minimum_split_minutes, minimum_longest_split_minutes, sort_order)
			 values
			 ($1, $2, 1, null, null, 0),
			 ($1, $2, 2, 15, null, 1)`,
			[ruleRow.id, versionId],
		);

		await admin.query(
			`insert into work_policy_presence
			 (policy_id, policy_version_id, presence_mode, required_onsite_days, location_id, evaluation_period, enforcement, updated_at)
			 values ($1, $2, 'minimum_count', 3, $3, 'weekly', 'warn', now())`,
			[policyId, versionId, locationId],
		);

		await admin.query(`update work_policy_version set sealed_at = now() where id = $1`, [
			versionId,
		]);

		return { policyId, regulationId: regulationRow.id };
	}

	async function readRegulationRow(policyId: string) {
		const { rows } = await admin.query<{
			id: string;
			max_daily_minutes: number | null;
			max_weekly_minutes: number | null;
			max_uninterrupted_minutes: number | null;
			min_rest_period_minutes: number | null;
			rest_period_enforcement: string | null;
			overtime_daily_threshold_minutes: number | null;
			overtime_weekly_threshold_minutes: number | null;
			overtime_monthly_threshold_minutes: number | null;
			alert_before_limit_minutes: number | null;
			alert_threshold_percent: number | null;
		}>(
			`select r.id, r.max_daily_minutes, r.max_weekly_minutes, r.max_uninterrupted_minutes,
			        r.min_rest_period_minutes, r.rest_period_enforcement,
			        r.overtime_daily_threshold_minutes, r.overtime_weekly_threshold_minutes, r.overtime_monthly_threshold_minutes,
			        r.alert_before_limit_minutes, r.alert_threshold_percent
			 from work_policy_regulation r
			 join work_policy_version v on v.id = r.policy_version_id
			 where r.policy_id = $1
			 order by v.effective_from_date desc, v.version_number desc
			 limit 1`,
			[policyId],
		);
		return rows[0] ?? null;
	}

	beforeEach(async () => {
		await cleanup();
		const timestamp = new Date("2026-10-01T08:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T1922', $1, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, 'Admin', 't1922-admin@example.test', $2, $2)`,
			[ids.adminUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('t1922-m-admin', $1, $2, 'admin', 'approved', $3)`,
			[ids.organization, ids.adminUser, timestamp],
		);
		await admin.query(
			`insert into employee (user_id, organization_id, first_name, last_name, role, updated_at)
			 values ($1, $2, 'Ada', 'Admin', 'admin', $3)`,
			[ids.adminUser, ids.organization, timestamp],
		);
		const {
			rows: [loc],
		} = await admin.query<{ id: string }>(
			`insert into location (organization_id, name, is_active, created_by, updated_at)
			 values ($1, 'Berlin HQ', true, $2, now())
			 returning id`,
			[ids.organization, ids.adminUser],
		);
		locationId = loc.id;
		harness.userId = ids.adminUser;
		harness.organizationId = ids.organization;
	});

	afterAll(cleanup);

	it("preserves all 7 ArbZG regulation columns when editing an unrelated field or saving regulation without re-specifying them", async () => {
		const { policyId } = await seedPolicyWithAllArbzgFields();

		// 1) Edit name + schedule only (omits regulation completely)
		const renameResult = await updateWorkPolicy({
			policyId,
			data: {
				name: "ArbZG Renamed Policy",
				schedule: {
					scheduleCycle: "weekly",
					scheduleType: "simple",
					workingDaysPreset: "weekdays",
					hoursPerCycle: "38",
					homeOfficeDaysPerCycle: 2,
				},
			},
		});
		expect(renameResult.success).toBe(true);

		const afterUnrelated = await readRegulationRow(policyId);
		expect(afterUnrelated).toMatchObject({
			min_rest_period_minutes: INITIAL_ARBZG.minRestPeriodMinutes,
			rest_period_enforcement: INITIAL_ARBZG.restPeriodEnforcement,
			overtime_daily_threshold_minutes: INITIAL_ARBZG.overtimeDailyThresholdMinutes,
			overtime_weekly_threshold_minutes: INITIAL_ARBZG.overtimeWeeklyThresholdMinutes,
			overtime_monthly_threshold_minutes: INITIAL_ARBZG.overtimeMonthlyThresholdMinutes,
			alert_before_limit_minutes: INITIAL_ARBZG.alertBeforeLimitMinutes,
			alert_threshold_percent: INITIAL_ARBZG.alertThresholdPercent,
		});

		// 2) Edit an unrelated field while submitting a regulation object that omits the 7 ArbZG keys
		// (guards against partial callers wiping existing ArbZG columns)
		const partialRegulationResult = await updateWorkPolicy({
			policyId,
			data: {
				description: "Updated description",
				regulation: {
					maxDailyMinutes: 540,
					maxWeeklyMinutes: 2700,
					maxUninterruptedMinutes: 360,
					breakRules: [
						{
							workingMinutesThreshold: 360,
							requiredBreakMinutes: 30,
							options: [
								{ splitCount: 1, minimumSplitMinutes: null, minimumLongestSplitMinutes: null },
							],
						},
					],
				},
			},
		});
		expect(partialRegulationResult.success).toBe(true);

		const afterPartialReg = await readRegulationRow(policyId);
		expect(afterPartialReg).toMatchObject({
			max_daily_minutes: 540,
			max_weekly_minutes: 2700,
			min_rest_period_minutes: INITIAL_ARBZG.minRestPeriodMinutes,
			rest_period_enforcement: INITIAL_ARBZG.restPeriodEnforcement,
			overtime_daily_threshold_minutes: INITIAL_ARBZG.overtimeDailyThresholdMinutes,
			overtime_weekly_threshold_minutes: INITIAL_ARBZG.overtimeWeeklyThresholdMinutes,
			overtime_monthly_threshold_minutes: INITIAL_ARBZG.overtimeMonthlyThresholdMinutes,
			alert_before_limit_minutes: INITIAL_ARBZG.alertBeforeLimitMinutes,
			alert_threshold_percent: INITIAL_ARBZG.alertThresholdPercent,
		});
	});

	it("creates and updates all 7 ArbZG regulation columns and allows explicitly clearing nullable fields", async () => {
		const createResult = await createWorkPolicy({
			name: "Created With ArbZG",
			scheduleEnabled: false,
			regulationEnabled: true,
			presenceEnabled: false,
			regulation: {
				maxDailyMinutes: 600,
				maxWeeklyMinutes: 2880,
				maxUninterruptedMinutes: 360,
				...INITIAL_ARBZG,
				breakRules: [],
			},
		});
		expect(createResult.success).toBe(true);
		if (!createResult.success) return;

		expect(createResult.data.regulation).toMatchObject(INITIAL_ARBZG);

		const updateResult = await updateWorkPolicy({
			policyId: createResult.data.id,
			data: {
				regulation: {
					maxDailyMinutes: 600,
					maxWeeklyMinutes: 2880,
					maxUninterruptedMinutes: 360,
					...UPDATED_ARBZG,
					breakRules: [],
				},
			},
		});
		expect(updateResult.success).toBe(true);
		if (!updateResult.success) return;

		expect(updateResult.data.regulation).toMatchObject(UPDATED_ARBZG);

		const clearedResult = await updateWorkPolicy({
			policyId: createResult.data.id,
			data: {
				regulation: {
					maxDailyMinutes: 600,
					maxWeeklyMinutes: 2880,
					maxUninterruptedMinutes: 360,
					minRestPeriodMinutes: null,
					restPeriodEnforcement: "warn",
					overtimeDailyThresholdMinutes: null,
					overtimeWeeklyThresholdMinutes: null,
					overtimeMonthlyThresholdMinutes: null,
					alertBeforeLimitMinutes: 0,
					alertThresholdPercent: 100,
					breakRules: [],
				},
			},
		});
		expect(clearedResult.success).toBe(true);
		if (!clearedResult.success) return;

		expect(clearedResult.data.regulation).toMatchObject({
			minRestPeriodMinutes: null,
			restPeriodEnforcement: "warn",
			overtimeDailyThresholdMinutes: null,
			overtimeWeeklyThresholdMinutes: null,
			overtimeMonthlyThresholdMinutes: null,
			alertBeforeLimitMinutes: 0,
			alertThresholdPercent: 100,
		});
	});

	it("rolls back the entire transaction when a child write fails during update or create", async () => {
		const { policyId } = await seedPolicyWithAllArbzgFields("Rollback Target");
		const nonexistentLocationId = "00000000-0000-4000-8000-000000000999";

		// Trigger failure on presence location validation AFTER policy, schedule, and regulation checks
		const failedUpdate = await updateWorkPolicy({
			policyId,
			data: {
				name: "Should Never Commit",
				schedule: {
					scheduleCycle: "monthly",
					scheduleType: "simple",
					workingDaysPreset: "all_days",
					hoursPerCycle: "160",
					homeOfficeDaysPerCycle: 5,
				},
				regulation: {
					maxDailyMinutes: 480,
					maxWeeklyMinutes: 2400,
					maxUninterruptedMinutes: 240,
					...UPDATED_ARBZG,
					breakRules: [],
				},
				presenceEnabled: true,
				presence: {
					presenceMode: "minimum_count",
					requiredOnsiteDays: 4,
					locationId: nonexistentLocationId,
					evaluationPeriod: "monthly",
					enforcement: "block",
				},
			},
		});

		expect(failedUpdate).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "location_inactive",
		});

		// Verify original policy, schedule, schedule days, regulation + 7 ArbZG cols, break rules/options, and presence are intact
		const fetched = await getWorkPolicy(policyId);
		expect(fetched.success).toBe(true);
		if (!fetched.success || !fetched.data) return;

		expect(fetched.data.name).toBe("Rollback Target");
		expect(fetched.data.schedule).toMatchObject({
			scheduleCycle: "weekly",
			scheduleType: "detailed",
			homeOfficeDaysPerCycle: 1,
		});
		expect(fetched.data.schedule?.days).toHaveLength(3);
		expect(fetched.data.regulation).toMatchObject({
			maxDailyMinutes: 600,
			maxWeeklyMinutes: 2880,
			maxUninterruptedMinutes: 360,
			...INITIAL_ARBZG,
		});
		expect(fetched.data.regulation?.breakRules).toHaveLength(1);
		expect(fetched.data.regulation?.breakRules[0]?.options).toHaveLength(2);
		expect(fetched.data.presence).toMatchObject({
			presenceMode: "minimum_count",
			requiredOnsiteDays: 3,
			locationId,
		});

		// Create rollback: failing mid-transaction on duplicate schedule day unique constraint leaves zero rows in work_policy
		const failedCreate = await createWorkPolicy({
			name: "Failed Create Policy",
			scheduleEnabled: true,
			regulationEnabled: true,
			presenceEnabled: false,
			schedule: {
				scheduleCycle: "weekly",
				scheduleType: "detailed",
				workingDaysPreset: "custom",
				days: [
					{ dayOfWeek: "monday", hoursPerDay: "8", isWorkDay: true },
					{ dayOfWeek: "monday", hoursPerDay: "4", isWorkDay: true },
				],
			},
			regulation: {
				maxDailyMinutes: 600,
				...INITIAL_ARBZG,
				breakRules: [],
			},
		});
		expect(failedCreate).toMatchObject({ success: false, code: "DatabaseError" });

		const { rows: orphanRows } = await admin.query(
			"select id from work_policy where organization_id = $1 and name = 'Failed Create Policy'",
			[ids.organization],
		);
		expect(orphanRows).toHaveLength(0);
	});

	it("duplicates a work policy atomically copying all 7 ArbZG columns, schedule days, break rules/options, and presence", async () => {
		const { policyId } = await seedPolicyWithAllArbzgFields("Source Policy");

		const duplicateResult = await duplicateWorkPolicy(policyId);
		expect(duplicateResult.success).toBe(true);
		if (!duplicateResult.success) return;

		const copy = duplicateResult.data;
		expect(copy.id).not.toBe(policyId);
		expect(copy.name).toBe("Source Policy (Copy)");
		expect(copy.isDefault).toBe(false);
		expect(copy.scheduleEnabled).toBe(true);
		expect(copy.regulationEnabled).toBe(true);
		expect(copy.presenceEnabled).toBe(true);

		expect(copy.schedule).toMatchObject({
			scheduleCycle: "weekly",
			scheduleType: "detailed",
			workingDaysPreset: "custom",
			homeOfficeDaysPerCycle: 1,
		});
		expect(copy.schedule?.days).toHaveLength(3);
		expect(
			Object.fromEntries((copy.schedule?.days ?? []).map((d) => [d.dayOfWeek, d.latestClockIn])),
		).toEqual({
			monday: "09:00",
			tuesday: "09:30",
			saturday: null,
		});

		expect(copy.regulation).toMatchObject({
			maxDailyMinutes: 600,
			maxWeeklyMinutes: 2880,
			maxUninterruptedMinutes: 360,
			...INITIAL_ARBZG,
		});
		expect(copy.regulation?.breakRules).toHaveLength(1);
		expect(copy.regulation?.breakRules[0]).toMatchObject({
			workingMinutesThreshold: 360,
			requiredBreakMinutes: 30,
		});
		expect(copy.regulation?.breakRules[0]?.options).toHaveLength(2);
		expect(copy.regulation?.breakRules[0]?.options[1]).toMatchObject({
			splitCount: 2,
			minimumSplitMinutes: 15,
		});

		expect(copy.presence).toMatchObject({
			presenceMode: "minimum_count",
			requiredOnsiteDays: 3,
			locationId,
			evaluationPeriod: "weekly",
			enforcement: "warn",
		});
	});
});
