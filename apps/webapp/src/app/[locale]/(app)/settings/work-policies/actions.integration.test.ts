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

const {
	createWorkPolicy,
	createWorkPolicyAssignment,
	deleteWorkPolicyAssignment,
	duplicateWorkPolicy,
	getWorkPolicy,
	setDefaultWorkPolicy,
	updateWorkPolicy,
} = await import("./actions");

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

	it("routes createWorkPolicyAssignment and deleteWorkPolicyAssignment through dated canonical commands without 23P01 or history loss (F3)", async () => {
		const { policyId: policyA } = await seedPolicyWithAllArbzgFields("Assign Policy A");
		const { policyId: policyB } = await seedPolicyWithAllArbzgFields("Assign Policy B");

		const {
			rows: [teamRow],
		} = await admin.query<{ id: string }>(
			`INSERT INTO team (organization_id, name, created_at, updated_at)
			 VALUES ($1, 'Ops Team', now(), now()) RETURNING id`,
			[ids.organization],
		);
		const {
			rows: [empRow],
		} = await admin.query<{ id: string }>(
			`SELECT id FROM employee WHERE organization_id = $1 AND user_id = $2 LIMIT 1`,
			[ids.organization, ids.adminUser],
		);

		// 1) Org assignment routes through scheduleContractDefault (source_kind = 'contract_default') and reassigns cleanly without 23P01
		const orgAssign1 = await createWorkPolicyAssignment({
			policyId: policyA,
			assignmentType: "organization",
		});
		expect(orgAssign1.success).toBe(true);
		const orgAssign2 = await createWorkPolicyAssignment({
			policyId: policyB,
			assignmentType: "organization",
		});
		expect(orgAssign2.success).toBe(true);
		if (!orgAssign2.success) return;

		const { rows: orgAssignRows } = await admin.query<{
			id: string;
			source_kind: string;
			source_contract_default_id: string | null;
			policy_id: string;
		}>(
			`SELECT id, source_kind, source_contract_default_id, policy_id
			 FROM work_policy_assignment
			 WHERE organization_id = $1 AND assignment_type = 'organization' AND is_active = true`,
			[ids.organization],
		);
		expect(orgAssignRows).toHaveLength(1);
		expect(orgAssignRows[0]).toMatchObject({
			policy_id: policyB,
			source_kind: "contract_default",
		});
		expect(orgAssignRows[0]?.source_contract_default_id).not.toBeNull();

		// Deleting a contract_default projection row is refused even for an org admin!
		const deleteOrgDefault = await deleteWorkPolicyAssignment(orgAssignRows[0]!.id);
		expect(deleteOrgDefault).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "contract_default_assignment_protected",
		});

		// 2) Team assignment also routes through scheduleContractDefault cleanly without 23P01
		const teamAssign1 = await createWorkPolicyAssignment({
			policyId: policyA,
			assignmentType: "team",
			teamId: teamRow.id,
		});
		expect(teamAssign1.success).toBe(true);
		const teamAssign2 = await createWorkPolicyAssignment({
			policyId: policyB,
			assignmentType: "team",
			teamId: teamRow.id,
		});
		expect(teamAssign2.success).toBe(true);

		// 3) Employee assignment preserves historical assignment before today and closes cleanly on delete!
		await admin.query(
			`INSERT INTO work_policy_assignment (
				policy_id, organization_id, assignment_type, employee_id, priority,
				effective_from, effective_from_date, source_kind, is_active, created_by, updated_at
			) VALUES (
				$1, $2, 'employee', $3, 2,
				'2025-01-01T00:00:00Z', '2025-01-01', 'manager_assignment', true, $4, now()
			)`,
			[policyA, ids.organization, empRow.id, ids.adminUser],
		);

		const empAssign = await createWorkPolicyAssignment({
			policyId: policyB,
			assignmentType: "employee",
			employeeId: empRow.id,
		});
		expect(empAssign.success).toBe(true);
		if (!empAssign.success) return;

		const { rows: empHistoryRows } = await admin.query<{
			policy_id: string;
			effective_from_date: string;
			effective_until_date: string | null;
			is_active: boolean;
		}>(
			`SELECT policy_id, effective_from_date::text, effective_until_date::text, is_active
			 FROM work_policy_assignment
			 WHERE employee_id = $1 AND is_active = true
			 ORDER BY effective_from_date`,
			[empRow.id],
		);
		expect(empHistoryRows).toHaveLength(2);
		expect(empHistoryRows[0]?.policy_id).toBe(policyA);
		expect(empHistoryRows[0]?.effective_from_date).toBe("2025-01-01");
		expect(empHistoryRows[0]?.effective_until_date).toBe(empHistoryRows[1]?.effective_from_date);
		expect(empHistoryRows[1]?.policy_id).toBe(policyB);
		expect(empHistoryRows[1]?.effective_until_date).toBeNull();

		// Deleting today's manual assignment closes from today onward while preserving the historical 2025 row!
		const deleteEmpAssign = await deleteWorkPolicyAssignment(empAssign.data.id);
		expect(deleteEmpAssign.success).toBe(true);
		const { rows: afterDeleteRows } = await admin.query<{
			policy_id: string;
			effective_from_date: string;
			effective_until_date: string | null;
		}>(
			`SELECT policy_id, effective_from_date::text, effective_until_date::text
			 FROM work_policy_assignment
			 WHERE employee_id = $1 AND is_active = true
			 ORDER BY effective_from_date`,
			[empRow.id],
		);
		expect(afterDeleteRows).toHaveLength(1);
		expect(afterDeleteRows[0]?.policy_id).toBe(policyA);
		expect(afterDeleteRows[0]?.effective_from_date).toBe("2025-01-01");
	});

	it("preserves existing contract default operational settings & custom days when changing only workPolicyId (N1)", async () => {
		const { policyId: policyA } = await seedPolicyWithAllArbzgFields("Rich Default Policy A");
		const { policyId: policyB } = await seedPolicyWithAllArbzgFields("Rich Default Policy B");
		const { policyId: policyC } = await seedPolicyWithAllArbzgFields("Rich Default Policy C");

		const { db } = await import("@/db");
		const { scheduleContractDefault } = await import("@/lib/contracts");

		// Seed a rich organization contract default with custom weekly hours, custom days, hybrid model,
		// explicit presence override, and trust_based balance mode
		await scheduleContractDefault(db, {
			organizationId: ids.organization,
			actorUserId: ids.adminUser,
			scope: "organization",
			effectiveFromDate: "2025-01-01",
			workPolicyId: policyA,
			weeklyContractMinutes: 2100,
			workModel: "hybrid",
			presenceOverride: "exempt",
			balanceMode: "trust_based",
			scheduleMode: "custom_days",
			scheduleSource: "policy",
			customDays: [
				{ dayOfWeek: "monday", minutesPerDay: 480, isWorkDay: true, latestClockIn: "09:30" },
				{ dayOfWeek: "tuesday", minutesPerDay: 480, isWorkDay: true, latestClockIn: null },
				{ dayOfWeek: "wednesday", minutesPerDay: 480, isWorkDay: true, latestClockIn: null },
				{ dayOfWeek: "thursday", minutesPerDay: 480, isWorkDay: true, latestClockIn: null },
				{ dayOfWeek: "friday", minutesPerDay: 180, isWorkDay: true, latestClockIn: null },
				{ dayOfWeek: "saturday", minutesPerDay: 0, isWorkDay: false, latestClockIn: null },
				{ dayOfWeek: "sunday", minutesPerDay: 0, isWorkDay: false, latestClockIn: null },
			],
		});

		// 1) Reassign org work policy via createWorkPolicyAssignment
		const assignRes = await createWorkPolicyAssignment({
			policyId: policyB,
			assignmentType: "organization",
		});
		expect(assignRes.success).toBe(true);

		// 2) Reassign org default work policy via setDefaultWorkPolicy
		const setDefaultRes = await setDefaultWorkPolicy(policyC);
		expect(setDefaultRes.success).toBe(true);

		const {
			rows: [activeOrgDefault],
		} = await admin.query<{
			template_version_id: string;
			work_policy_id: string | null;
			weekly_contract_minutes: number | null;
			work_model: string | null;
			presence_override: string;
			balance_mode: string;
			schedule_mode: string;
			schedule_source: string;
		}>(
			`SELECT cd.template_version_id,
			        v.work_policy_id,
			        v.weekly_contract_minutes,
			        v.work_model,
			        v.presence_override,
			        v.balance_mode,
			        v.schedule_mode,
			        v.schedule_source
			 FROM contract_default cd
			 JOIN contract_template_version v ON v.id = cd.template_version_id
			 WHERE cd.organization_id = $1
			   AND cd.scope = 'organization'
			   AND cd.is_active = true
			   AND cd.effective_until_date IS NULL
			 ORDER BY cd.effective_from_date DESC
			 LIMIT 1`,
			[ids.organization],
		);
		expect(activeOrgDefault).toMatchObject({
			work_policy_id: policyC,
			weekly_contract_minutes: 2100,
			work_model: "hybrid",
			presence_override: "exempt",
			balance_mode: "trust_based",
			schedule_mode: "custom_days",
			schedule_source: "policy",
		});

		const { rows: customDays } = await admin.query<{
			day_of_week: string;
			minutes_per_day: number;
			is_work_day: boolean;
			latest_clock_in: string | null;
		}>(
			`SELECT day_of_week, minutes_per_day, is_work_day, latest_clock_in
			 FROM contract_template_version_day
			 WHERE template_version_id = $1`,
			[activeOrgDefault.template_version_id],
		);
		expect(customDays).toHaveLength(7);
		expect(customDays.find((d) => d.day_of_week === "monday")).toMatchObject({
			minutes_per_day: 480,
			latest_clock_in: "09:30",
		});
		expect(customDays.find((d) => d.day_of_week === "friday")).toMatchObject({
			minutes_per_day: 180,
		});

		// P3-1: Assigning a team work policy when NO team default exists yet must inherit the active
		// organization default's operational fields (trust_based, custom_days + 7 days, hybrid, exempt)
		// instead of overwriting them with hard-coded fallbacks (tracked / policy)!
		const { policyId: teamPolicy } = await seedPolicyWithAllArbzgFields("Team Specific Policy");
		const {
			rows: [teamRow],
		} = await admin.query<{ id: string }>(
			`INSERT INTO team (organization_id, name, created_at, updated_at)
			 VALUES ($1, 'Inherited Team', now(), now()) RETURNING id`,
			[ids.organization],
		);
		const {
			rows: [memberRow],
		} = await admin.query<{ id: string }>(
			`SELECT id FROM employee WHERE organization_id = $1 AND user_id = $2 LIMIT 1`,
			[ids.organization, ids.adminUser],
		);
		await admin.query(`UPDATE employee SET team_id = $1 WHERE id = $2`, [teamRow.id, memberRow.id]);
		await admin.query(
			`UPDATE employee_team_history SET effective_from = '2025-01-01T00:00:00Z'::timestamptz WHERE employee_id = $1`,
			[memberRow.id],
		);

		const teamAssignRes = await createWorkPolicyAssignment({
			policyId: teamPolicy,
			assignmentType: "team",
			teamId: teamRow.id,
		});
		expect(teamAssignRes.success).toBe(true);

		const { resolveEffectiveContractOnDay } = await import("@/lib/contracts");
		const { plainDateAt, systemClock } = await import("@/lib/datetime/temporal-core");
		const orgTodayPlain = plainDateAt(systemClock.nowInstant(), "UTC");
		const orgToday = orgTodayPlain.toString();
		const futureOrgDate = orgTodayPlain.add({ months: 1 }).toString();

		const effective = await resolveEffectiveContractOnDay(db, {
			organizationId: ids.organization,
			employeeId: memberRow.id,
			date: orgToday,
		});
		expect(effective).not.toBeNull();
		expect(effective?.primaryTeamId).toBe(teamRow.id);
		expect(effective?.contractDefaultScope).toBe("team");
		expect(effective?.workPolicy?.policyId).toBe(teamPolicy);
		expect(effective?.balanceMode).toBe("trust_based");
		expect(effective?.scheduleMode).toBe("custom_days");
		expect(effective?.weeklyContractMinutes).toBe(2100);
		expect(effective?.weeklyContractMinutesSource).toBe("org_default");
		expect(effective?.workModel).toBe("hybrid");
		expect(effective?.workModelSource).toBe("org_default");
		expect(effective?.presenceOverride).toBe("exempt");
		expect(effective?.presenceOverrideSource).toBe("org_default");
		expect(effective?.weeklyScheduleDays).toHaveLength(7);
		expect(effective?.weeklyScheduleDays.find((d) => d.dayOfWeek === "monday")).toMatchObject({
			minutesPerDay: 480,
			latestClockIn: "09:30",
		});
		expect(effective?.weeklyScheduleDays.find((d) => d.dayOfWeek === "friday")).toMatchObject({
			minutesPerDay: 180,
		});

		// P4-1: Future org-default changes to nullable/inheritable fields (weeklyContractMinutes,
		// workModel, presenceOverride) must still flow through automatically to team members!
		await scheduleContractDefault(db, {
			organizationId: ids.organization,
			actorUserId: ids.adminUser,
			scope: "organization",
			effectiveFromDate: futureOrgDate,
			workPolicyId: policyC,
			weeklyContractMinutes: 2280,
			workModel: "remote",
			presenceOverride: "exempt",
			balanceMode: "trust_based",
			scheduleMode: "policy",
			scheduleSource: "policy",
		});

		const effectiveFuture = await resolveEffectiveContractOnDay(db, {
			organizationId: ids.organization,
			employeeId: memberRow.id,
			date: futureOrgDate,
		});
		expect(effectiveFuture?.workPolicy?.policyId).toBe(teamPolicy);
		expect(effectiveFuture?.weeklyContractMinutes).toBe(2280);
		expect(effectiveFuture?.weeklyContractMinutesSource).toBe("org_default");
		expect(effectiveFuture?.workModel).toBe("remote");
		expect(effectiveFuture?.workModelSource).toBe("org_default");
		expect(effectiveFuture?.presenceOverride).toBe("exempt");
		expect(effectiveFuture?.presenceOverrideSource).toBe("org_default");
	});

	it("deletes only the targeted manual assignment without capping/deactivating sibling or future employment_terms rows (N2)", async () => {
		const { policyId: policyA } = await seedPolicyWithAllArbzgFields("Single-Row Policy A");
		const { policyId: policyB } = await seedPolicyWithAllArbzgFields("Single-Row Policy B");

		const {
			rows: [empRow],
		} = await admin.query<{ id: string }>(
			`SELECT id FROM employee WHERE organization_id = $1 AND user_id = $2 LIMIT 1`,
			[ids.organization, ids.adminUser],
		);

		// Case 1: Manual row A [2025-01-01, 2099-12-01) + future manual row B [2099-12-01, null).
		// Deleting future row B must NOT cap row A at today!
		const {
			rows: [rowA],
		} = await admin.query<{ id: string }>(
			`INSERT INTO work_policy_assignment (
				policy_id, organization_id, assignment_type, employee_id, priority,
				effective_from, effective_until, effective_from_date, effective_until_date,
				source_kind, is_active, created_by, updated_at
			) VALUES (
				$1, $2, 'employee', $3, 2,
				'2025-01-01T00:00:00Z', '2099-12-01T00:00:00Z', '2025-01-01', '2099-12-01',
				'manager_assignment', true, $4, now()
			) RETURNING id`,
			[policyA, ids.organization, empRow.id, ids.adminUser],
		);
		const {
			rows: [rowB],
		} = await admin.query<{ id: string }>(
			`INSERT INTO work_policy_assignment (
				policy_id, organization_id, assignment_type, employee_id, priority,
				effective_from, effective_from_date, source_kind, is_active, created_by, updated_at
			) VALUES (
				$1, $2, 'employee', $3, 2,
				'2099-12-01T00:00:00Z', '2099-12-01', 'manager_assignment', true, $4, now()
			) RETURNING id`,
			[policyB, ids.organization, empRow.id, ids.adminUser],
		);

		const delFutureManual = await deleteWorkPolicyAssignment(rowB.id);
		expect(delFutureManual.success).toBe(true);

		const { rows: afterCase1 } = await admin.query<{
			id: string;
			effective_from_date: string;
			effective_until_date: string | null;
			is_active: boolean;
		}>(
			`SELECT id, effective_from_date::text, effective_until_date::text, is_active
			 FROM work_policy_assignment
			 WHERE id IN ($1, $2)
			 ORDER BY effective_from_date`,
			[rowA.id, rowB.id],
		);
		expect(afterCase1).toEqual([
			{
				id: rowA.id,
				effective_from_date: "2025-01-01",
				effective_until_date: "2099-12-01",
				is_active: true,
			},
			{
				id: rowB.id,
				effective_from_date: "2099-12-01",
				effective_until_date: null,
				is_active: false,
			},
		]);

		// Case 2: Future employment_terms row C [2099-12-01, null) coexists with manual row A [2025-01-01, 2099-12-01).
		// Deleting manual row A must cap ONLY row A at today and leave future employment_terms row C active & untouched!
		const {
			rows: [histRow],
		} = await admin.query<{ id: string }>(
			`INSERT INTO employee_employment_history (
				organization_id, employee_id, valid_from, valid_from_date, contract_type, review_state, created_by, updated_at
			) VALUES (
				$1, $2, '2099-12-01T00:00:00Z', '2099-12-01', 'fixed', 'confirmed', $3, now()
			) RETURNING id`,
			[ids.organization, empRow.id, ids.adminUser],
		);
		const {
			rows: [rowC],
		} = await admin.query<{ id: string }>(
			`INSERT INTO work_policy_assignment (
				policy_id, organization_id, assignment_type, employee_id, priority,
				effective_from, effective_from_date, source_kind, source_employment_history_id,
				is_active, created_by, updated_at
			) VALUES (
				$1, $2, 'employee', $3, 2,
				'2099-12-01T00:00:00Z', '2099-12-01', 'employment_terms', $4,
				true, $5, now()
			) RETURNING id`,
			[policyB, ids.organization, empRow.id, histRow.id, ids.adminUser],
		);

		const delManualA = await deleteWorkPolicyAssignment(rowA.id);
		expect(delManualA.success).toBe(true);

		const { rows: afterCase2 } = await admin.query<{
			id: string;
			source_kind: string;
			effective_from_date: string;
			effective_until_date: string | null;
			is_active: boolean;
		}>(
			`SELECT id, source_kind, effective_from_date::text, effective_until_date::text, is_active
			 FROM work_policy_assignment
			 WHERE id IN ($1, $2)
			 ORDER BY effective_from_date`,
			[rowA.id, rowC.id],
		);
		expect(afterCase2[0]).toMatchObject({
			id: rowA.id,
			source_kind: "manager_assignment",
			effective_from_date: "2025-01-01",
			is_active: true,
		});
		expect(afterCase2[0]?.effective_until_date).not.toBe("2099-12-01");
		expect(afterCase2[0]?.effective_until_date).not.toBeNull();
		expect(afterCase2[1]).toEqual({
			id: rowC.id,
			source_kind: "employment_terms",
			effective_from_date: "2099-12-01",
			effective_until_date: null,
			is_active: true,
		});
	});
});
