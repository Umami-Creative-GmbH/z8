/**
 * #1925: Real-PostgreSQL cross-consumer parity integration suite.
 *
 * Seeds a multi-version work policy (including a future-dated `schedule_enabled: true -> false`
 * toggle, midweek `remote` work model switch, and `tracked -> trust_based` balance switch) and
 * verifies zero-divergence parity across:
 *   1. Preview (`resolveEffectiveContractOnDay` / `loadEffectiveContractsBatch`)
 *   2. Work Balance (`computeEmployeePeriodBalance` — exact 0 delta on `trust_based` days,
 *      preserving prior accrued balance, while BAG/ArbZG compliance stays enforced)
 *   3. Absences (`getAbsenceDays` / `loadWorkingWeekPeriodsForEmployees` — future-dated
 *      `schedule_enabled` toggle updates future absence day counts without altering history)
 *   4. Presence Status & Requirements (`loadPresenceStatusForSubject` & `PresenceRequirementRule`
 *      — midweek `remote` exemption parity and v2 `presence_enabled = false`)
 *   5. Payroll / Hourly Earnings (`loadDailyWorkRequirementsForEmployees` + `calculateHourlyEarningsFromTerms`)
 *   6. Staffing (`loadStaffingRankingFacts` — single active version per date, zero duplicates)
 *   7. Exports (`loadWorkPoliciesForExport` — single active version per policy, zero duplicates)
 */

import { randomBytes } from "node:crypto";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect } from "effect";
import { DateTime } from "luxon";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPresenceStatusForSubject } from "@/app/[locale]/(app)/time-tracking/actions/presence-status-read";
import * as authSchema from "@/db/auth-schema";
import * as schema from "@/db/schema";
import {
	getAbsenceDays,
	loadWorkingWeekPeriodsForEmployees,
} from "@/lib/absences/absence-days-resolver";
import { loadDailyWorkRequirementsForEmployees } from "@/lib/calendar/work-policy-range-requirements";
import {
	buildPresenceExemptDaysFromContracts,
	PresenceRequirementRule,
} from "@/lib/compliance/rules/presence-requirement-rule";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	type DatabaseClient,
	DatabaseService,
	makeDatabaseService,
} from "@/lib/effect/services/database.service";
import {
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "@/lib/effect/services/work-policy.service";
import { loadConfirmedTermsSpans } from "@/lib/employment-history/load-terms-in-force";
import { calculateHourlyEarningsFromTerms } from "@/lib/reports/hourly-earnings";
import { loadStaffingRankingFacts } from "@/lib/scheduling/staffing/load-staffing-facts";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import { computeEmployeePeriodBalance } from "@/lib/work-balance/period-aggregation";
import { loadWorkPoliciesForExport } from "@/lib/work-policy/policy-queries";
import {
	createVersionedWorkPolicy,
	updateOrPublishWorkPolicy,
} from "@/lib/work-policy/versioned-policy-writer";
import { integrationAdminPool, openIntegrationPool } from "@/test/integration-database";
import { loadEffectiveContractsBatch, resolveEffectiveContractOnDay } from "./resolve-contract";

const fullSchema = { ...authSchema, ...schema };

const ORG_ID = "t1925-parity-org";
const ADMIN_USER_ID = "t1925-parity-admin";

describe("cross-consumer contract reader parity (PostgreSQL, #1925)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
	const sharedAdmin = integrationAdminPool();
	const siblingDbName = `approval_workflow_repository_test_1925_${randomBytes(4).toString("hex")}`;
	let admin: Pool;
	let db: DatabaseClient;

	beforeAll(async () => {
		// Use an isolated sibling database to test post-0327 sealed multi-version policies
		// without mutating the shared integration database's triggers or unique constraints.
		await sharedAdmin.query(`CREATE DATABASE "${siblingDbName}"`);
		admin = openIntegrationPool({ databaseName: siblingDbName, max: 8 });
		db = drizzle({ client: admin, schema: fullSchema }) as unknown as DatabaseClient;

		const engineModule = await import("../../../scripts/boundary-migration-engine.js");
		const migrationsFolder = path.resolve(process.cwd(), "drizzle");
		await engineModule.runBoundaryAwareMigrations({
			pool: admin,
			migrationsFolder,
			allowContractConstraints: true,
			allowPolicyV1Seal: true,
			lockRetries: 5,
			logger: { log: () => {}, warn: () => {}, error: () => {} },
		});

		// Simulate post-0327 DDL state so multi-version policies publish distinct immutable child rows.
		await admin.query(`
			DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_sync_v1" ON "work_policy";
			DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_schedule_version" ON "work_policy_schedule";
			DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_presence_version" ON "work_policy_presence";
			DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_regulation_version" ON "work_policy_regulation";
			DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_schedule_day_version" ON "work_policy_schedule_day";
			DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_break_rule_version" ON "work_policy_break_rule";
			DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_break_option_version" ON "work_policy_break_option";
			ALTER TABLE "work_policy_schedule" DROP CONSTRAINT IF EXISTS "work_policy_schedule_policy_id_unique";
			ALTER TABLE "work_policy_regulation" DROP CONSTRAINT IF EXISTS "work_policy_regulation_policy_id_unique";
			ALTER TABLE "work_policy_presence" DROP CONSTRAINT IF EXISTS "work_policy_presence_policy_id_unique";
			UPDATE "work_policy_version" SET "sealed_at" = now() WHERE "sealed_at" IS NULL;
			INSERT INTO "work_policy_versioning_state" ("singleton", "sealed_cutover_at")
			VALUES (true, now())
			ON CONFLICT ("singleton") DO UPDATE SET "sealed_cutover_at" = now();
		`);
	});

	async function cleanup() {
		if (!admin) return;
		await admin.query("DELETE FROM organization WHERE id = $1", [ORG_ID]);
		await admin.query(`DELETE FROM "user" WHERE id LIKE 't1925-parity-%'`);
	}

	afterAll(async () => {
		if (admin) {
			await admin.end();
		}
		await sharedAdmin.query(
			`SELECT pg_terminate_backend(pid)
			 FROM pg_stat_activity
			 WHERE datname = $1 AND pid <> pg_backend_pid()`,
			[siblingDbName],
		);
		await sharedAdmin.query(`DROP DATABASE IF EXISTS "${siblingDbName}"`);
	});

	async function seedEmployee(opts: {
		key: string;
		contractType?: "fixed" | "hourly";
		timezone?: string;
	}) {
		const userId = `t1925-parity-${opts.key}`;
		const created = new Date("2026-01-01T00:00:00.000Z");
		await admin.query(
			`INSERT INTO "user" (id, name, email, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $4)`,
			[userId, opts.key, `${userId}@example.test`, created],
		);
		await admin.query(
			`INSERT INTO user_settings (user_id, timezone, week_start_day, updated_at)
			 VALUES ($1, $2, 'monday', $3)`,
			[userId, opts.timezone ?? "UTC", created],
		);
		const {
			rows: [emp],
		} = await admin.query<{ id: string }>(
			`INSERT INTO employee (
				user_id, organization_id, first_name, last_name, role, contract_type,
				start_date, is_active, updated_at
			) VALUES ($1, $2, $3, 'Parity', 'employee', $4, $5, true, $5)
			RETURNING id`,
			[userId, ORG_ID, opts.key, opts.contractType ?? "fixed", created],
		);
		return { userId, employeeId: emp.id };
	}

	async function seedCompletedWorkPeriod(opts: {
		employeeId: string;
		startIso: string;
		endIso: string;
		durationMinutes: number;
		workLocationType?: "office" | "home" | "field" | "other";
	}) {
		const start = new Date(opts.startIso);
		const end = new Date(opts.endIso);
		return withCanonicalRecords(admin, async (client) => {
			const {
				rows: [clockIn],
			} = await client.query<{ id: string }>(
				`INSERT INTO time_entry (
					employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone, timezone_source, hash, created_by
				) VALUES ($1, $2, 'clock_in', $3, 0, 'UTC', 'server', $4, $5)
				RETURNING id`,
				[opts.employeeId, ORG_ID, start, `in-${crypto.randomUUID()}`, ADMIN_USER_ID],
			);
			const {
				rows: [clockOut],
			} = await client.query<{ id: string }>(
				`INSERT INTO time_entry (
					employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone, timezone_source, hash, created_by
				) VALUES ($1, $2, 'clock_out', $3, 0, 'UTC', 'server', $4, $5)
				RETURNING id`,
				[opts.employeeId, ORG_ID, end, `out-${crypto.randomUUID()}`, ADMIN_USER_ID],
			);
			const {
				rows: [wp],
			} = await client.query<{ id: string }>(
				`INSERT INTO work_period (
					employee_id, organization_id, clock_in_id, clock_out_id,
					start_time, end_time, duration_minutes, is_active, work_location_type, updated_at
				) VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, now())
				RETURNING id`,
				[
					opts.employeeId,
					ORG_ID,
					clockIn.id,
					clockOut.id,
					start,
					end,
					opts.durationMinutes,
					opts.workLocationType ?? "office",
				],
			);
			return wp.id;
		});
	}

	beforeEach(async () => {
		await cleanup();
		const now = new Date("2026-01-01T00:00:00.000Z");
		await admin.query(
			`INSERT INTO organization (id, name, slug, timezone, created_at)
			 VALUES ($1, 'Parity Org', $1, 'UTC', $2)`,
			[ORG_ID, now],
		);
		await admin.query(
			`INSERT INTO "user" (id, name, email, created_at, updated_at)
			 VALUES ($1, 'Admin', 't1925-parity-admin@example.test', $2, $2)`,
			[ADMIN_USER_ID, now],
		);
	});

	it("maintains zero-divergence parity across Preview, Work Balance (trust_based 0-delta), Absences (future schedule_enabled toggle), Presence (midweek remote exemption), Payroll/Earnings, Staffing, and Exports", async () => {
		const {
			rows: [hqLocation],
		} = await admin.query<{ id: string }>(
			`INSERT INTO location (organization_id, name, is_active, created_by, updated_at)
			 VALUES ($1, 'Berlin HQ', true, $2, now())
			 RETURNING id`,
			[ORG_ID, ADMIN_USER_ID],
		);

		// 1. Create a real multi-version work policy:
		//    - v1 (effective 2026-01-01): Mon-Thu 8h (4 working days = 1920m/wk),
		//      regulation maxDaily=480m + 30m break after 360m, presence=3 onsite days/week at HQ.
		//    - v2 (effective 2026-07-01): schedule_enabled=false, presence_enabled=false,
		//      regulation_enabled=true (maxDaily=600m).
		const created = await createVersionedWorkPolicy(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			data: {
				name: "Four-Day Hybrid Policy",
				effectiveFromDate: "2026-01-01",
				scheduleEnabled: true,
				regulationEnabled: true,
				presenceEnabled: true,
				schedule: {
					scheduleCycle: "weekly",
					scheduleType: "detailed",
					workingDaysPreset: "custom",
					homeOfficeDaysPerCycle: 1,
					days: [
						{ dayOfWeek: "monday", hoursPerDay: "8.00", isWorkDay: true, latestClockIn: "09:30" },
						{ dayOfWeek: "tuesday", hoursPerDay: "8.00", isWorkDay: true, latestClockIn: "09:30" },
						{
							dayOfWeek: "wednesday",
							hoursPerDay: "8.00",
							isWorkDay: true,
							latestClockIn: "09:30",
						},
						{ dayOfWeek: "thursday", hoursPerDay: "8.00", isWorkDay: true, latestClockIn: "09:30" },
						{ dayOfWeek: "friday", hoursPerDay: "0.00", isWorkDay: false },
						{ dayOfWeek: "saturday", hoursPerDay: "0.00", isWorkDay: false },
						{ dayOfWeek: "sunday", hoursPerDay: "0.00", isWorkDay: false },
					],
				},
				regulation: {
					maxDailyMinutes: 480,
					maxWeeklyMinutes: 2400,
					maxUninterruptedMinutes: 360,
					minRestPeriodMinutes: 660,
					restPeriodEnforcement: "warn",
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
				presence: {
					presenceMode: "minimum_count",
					requiredOnsiteDays: 3,
					locationId: hqLocation.id,
					evaluationPeriod: "weekly",
					enforcement: "warn",
				},
			},
		});
		const policyId = created.policy.id;

		const publishedV2 = await updateOrPublishWorkPolicy(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			policyId,
			forceNewVersion: true,
			now: new Date("2026-06-01T08:00:00.000Z"),
			data: {
				effectiveFromDate: "2026-07-01",
				scheduleEnabled: false,
				regulationEnabled: true,
				presenceEnabled: false,
				regulation: {
					maxDailyMinutes: 600,
					maxWeeklyMinutes: 2880,
					breakRules: [],
				},
			},
		});
		expect(publishedV2.version.versionNumber).toBe(2);

		// Assign policy at organization level so org default flows cleanly.
		await admin.query(
			`INSERT INTO work_policy_assignment (
				policy_id, organization_id, assignment_type, priority, is_active, created_by, updated_at
			) VALUES ($1, $2, 'organization', 0, true, $3, now())`,
			[policyId, ORG_ID, ADMIN_USER_ID],
		);

		// 2. Seed primary fixed employee:
		//    - 2026-06-01..2026-06-16 (Mon Jun 15): tracked, hybrid (presence required)
		//    - 2026-06-16..2026-06-17 (Tue Jun 16): trust_based, hybrid (presence required)
		//    - 2026-06-17..open (Wed Jun 17 onward): trust_based, remote (midweek remote presence exemption!)
		const fixedEmp = await seedEmployee({ key: "fixed-parity", contractType: "fixed" });
		await admin.query(
			`INSERT INTO employee_employment_history (
				employee_id, organization_id, valid_from, valid_until, valid_from_date, valid_until_date,
				contract_type, weekly_contract_minutes, work_model, work_policy_id,
				schedule_mode, presence_override, balance_mode, schedule_source,
				review_state, created_by, updated_at
			) VALUES
			($1, $2, '2026-06-01T00:00:00Z', '2026-06-16T00:00:00Z', '2026-06-01', '2026-06-16',
				'fixed', 1920, 'hybrid', $3, 'policy', 'inherit', 'tracked', 'policy', 'confirmed', $4, now()),
			($1, $2, '2026-06-16T00:00:00Z', '2026-06-17T00:00:00Z', '2026-06-16', '2026-06-17',
				'fixed', 1920, 'hybrid', $3, 'policy', 'inherit', 'trust_based', 'policy', 'confirmed', $4, now()),
			($1, $2, '2026-06-17T00:00:00Z', NULL, '2026-06-17', NULL,
				'fixed', 1920, 'remote', $3, 'policy', 'inherit', 'trust_based', 'policy', 'confirmed', $4, now())`,
			[fixedEmp.employeeId, ORG_ID, policyId, ADMIN_USER_ID],
		);

		// Seed completed office work on Mon Jun 15 (510m -> +30m tracked) and Tue Jun 16 (600m -> trust_based 0 delta!)
		const monWpId = await seedCompletedWorkPeriod({
			employeeId: fixedEmp.employeeId,
			startIso: "2026-06-15T08:00:00.000Z",
			endIso: "2026-06-15T16:30:00.000Z",
			durationMinutes: 510,
			workLocationType: "office",
		});
		const tueWpId = await seedCompletedWorkPeriod({
			employeeId: fixedEmp.employeeId,
			startIso: "2026-06-16T08:00:00.000Z",
			endIso: "2026-06-16T18:00:00.000Z",
			durationMinutes: 600,
			workLocationType: "office",
		});

		// ================================================================
		// 1. PREVIEW PARITY (`resolveEffectiveContractOnDay`)
		// ================================================================
		const monPreview = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: fixedEmp.employeeId,
			date: "2026-06-15",
		});
		const tuePreview = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: fixedEmp.employeeId,
			date: "2026-06-16",
		});
		const wedPreview = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: fixedEmp.employeeId,
			date: "2026-06-17",
		});
		const julyPreview = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: fixedEmp.employeeId,
			date: "2026-07-06", // Monday after v2 effective date
		});

		expect(monPreview?.workPolicy?.versionNumber).toBe(1);
		expect(monPreview?.requiredMinutes).toBe(480);
		expect(monPreview?.balanceMode).toBe("tracked");
		expect(monPreview?.contributesZeroBalanceDelta).toBe(false);
		expect(monPreview?.presenceStatus).toBe("required");

		expect(tuePreview?.balanceMode).toBe("trust_based");
		expect(tuePreview?.contributesZeroBalanceDelta).toBe(true);
		expect(tuePreview?.requiredMinutes).toBe(480);
		expect(tuePreview?.presenceStatus).toBe("required");

		expect(wedPreview?.workModel).toBe("remote");
		expect(wedPreview?.presenceStatus).toBe("exempt");
		expect(wedPreview?.effectivePresence).toBeNull();

		expect(julyPreview?.workPolicy?.versionNumber).toBe(2);
		expect(julyPreview?.workPolicy?.scheduleEnabled).toBe(false);
		expect(julyPreview?.requiredMinutes).toBe(0);
		expect(julyPreview?.presenceStatus).toBe("not_configured");

		// ================================================================
		// 2. WORK BALANCE PARITY (trust_based = exact 0 delta + BAG/ArbZG compliance retained)
		// ================================================================
		const periodBalance = await computeEmployeePeriodBalance({
			employeeId: fixedEmp.employeeId,
			organizationId: ORG_ID,
			dbClient: db as never,
			periodType: "month",
			periodStart: "2026-06-15",
			periodEnd: "2026-06-18", // Mon (tracked +30m), Tue-Thu (trust_based -> exact 0 delta!)
			calculationStartDate: "2026-06-15",
			timezone: "UTC",
			isClosed: false,
			now: new Date("2026-06-19T00:00:00.000Z"),
		});
		expect(periodBalance.actualMinutes).toBe(510);
		expect(periodBalance.requiredMinutes).toBe(480);
		expect(periodBalance.balanceMinutes).toBe(30); // Exact +30m from Monday; Tue 600m & Wed/Thu 0m emit exact 0 delta!

		// BAG/ArbZG compliance still enforces v1 maxDaily (480m) on trust_based Tuesday (600m worked)
		const complianceTue = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* WorkPolicyService;
				return yield* service.checkCompliance({
					employeeId: fixedEmp.employeeId,
					organizationId: ORG_ID,
					policyAt: parseInstant("2026-06-16T18:00:00Z"),
					currentSessionMinutes: 600,
					totalDailyMinutes: 600,
					totalWeeklyMinutes: 1110,
					breaksTakenMinutes: 0,
				});
			}).pipe(
				Effect.provide(WorkPolicyServiceLive),
				Effect.provideService(DatabaseService, makeDatabaseService(db)),
			),
		);
		expect(complianceTue.isCompliant).toBe(false);
		expect(complianceTue.policyId).toBe(policyId);
		expect(complianceTue.policyVersionId).toBe(created.version.id);
		expect(complianceTue.warnings).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: "max_daily", limitValue: 480 })]),
		);

		// ================================================================
		// 3. ABSENCES PARITY (future-dated schedule_enabled toggle + schedule counting on trust_based)
		// ================================================================
		// Mon 2026-06-15 .. Fri 2026-06-19 (v1 schedule_enabled=true, Mon-Thu 4 days — includes trust_based Tue-Thu!)
		const juneAbsenceDays = await getAbsenceDays(db as never, {
			organizationId: ORG_ID,
			employeeId: fixedEmp.employeeId,
			absence: {
				startDate: "2026-06-15",
				endDate: "2026-06-19",
				startPeriod: "full_day",
				endPeriod: "full_day",
			},
		});
		expect(juneAbsenceDays).toBe(4);

		// Mon 2026-07-06 .. Fri 2026-07-10 (v2 schedule_enabled=false -> falls back to Mon-Fri 5 days!)
		const julyAbsenceDays = await getAbsenceDays(db as never, {
			organizationId: ORG_ID,
			employeeId: fixedEmp.employeeId,
			absence: {
				startDate: "2026-07-06",
				endDate: "2026-07-10",
				startPeriod: "full_day",
				endPeriod: "full_day",
			},
		});
		expect(julyAbsenceDays).toBe(5);

		// Working-week periods span the version boundary cleanly (4 days/week in June -> 5 days/week in July)
		const weekPeriods = await loadWorkingWeekPeriodsForEmployees(db as never, {
			organizationId: ORG_ID,
			employeeIds: [fixedEmp.employeeId],
			startDate: "2026-06-29",
			endDate: "2026-07-03",
		});
		expect(weekPeriods.get(fixedEmp.employeeId)).toEqual([
			{
				startDate: "2026-06-29",
				endDate: "2026-06-30",
				workingDaysPerWeek: 4,
				workPolicyId: policyId,
			},
			{
				startDate: "2026-07-01",
				endDate: "2026-07-03",
				workingDaysPerWeek: 5,
				workPolicyId: policyId,
			},
		]);

		// ================================================================
		// 4. PRESENCE STATUS & REQUIREMENT RULE PARITY (midweek remote exemption)
		// ================================================================
		const presenceWeekSummary = await Effect.runPromise(
			loadPresenceStatusForSubject({
				userId: fixedEmp.userId,
				organizationId: ORG_ID,
				employeeId: fixedEmp.employeeId,
				preferences: { weekStartDay: "monday", timezone: "UTC" },
				now: DateTime.fromISO("2026-06-16T12:00:00.000Z", { zone: "UTC" }),
			}).pipe(Effect.provideService(DatabaseService, makeDatabaseService(db))),
		);
		// v1 requires 3 onsite days, but Wed-Fri are remote (exempt), leaving only 2 non-exempt work days (Mon & Tue).
		// Employee worked office on Mon & Tue -> requiredOfficeDays=2, officeDaysCompleted=2, officeDaysRequiredLeft=0!
		expect(presenceWeekSummary.presenceEnabled).toBe(true);
		expect(presenceWeekSummary.requiredOfficeDays).toBe(2);
		expect(presenceWeekSummary.officeDaysCompleted).toBe(2);
		expect(presenceWeekSummary.officeDaysRequiredLeft).toBe(0);

		// PresenceRequirementRule with exempt days from unified resolver agrees: 0 violations!
		const weekDates = [
			"2026-06-15",
			"2026-06-16",
			"2026-06-17",
			"2026-06-18",
			"2026-06-19",
			"2026-06-20",
			"2026-06-21",
		];
		const weekContracts = (
			await loadEffectiveContractsBatch(db, {
				organizationId: ORG_ID,
				employeeIds: [fixedEmp.employeeId],
				dates: weekDates,
				timezoneOverride: "UTC",
			})
		).get(fixedEmp.employeeId)!;
		const presenceRule = new PresenceRequirementRule();
		const presenceFindings = await presenceRule.detectViolations({
			organizationId: ORG_ID,
			employee: {
				id: fixedEmp.employeeId,
				timezone: "UTC",
				policy: {
					policyId,
					policyName: "Four-Day Hybrid Policy",
					schedule: null,
					regulation: null,
					assignmentType: "organization",
					assignedVia: "Organization Default",
				},
			},
			dateRange: {
				start: parseInstant("2026-06-15T00:00:00.000Z"),
				end: parseInstant("2026-06-21T23:59:59.999Z"),
			},
			workPeriods: [
				{
					id: monWpId,
					employeeId: fixedEmp.employeeId,
					startTime: new Date("2026-06-15T08:00:00.000Z"),
					endTime: new Date("2026-06-15T16:30:00.000Z"),
					durationMinutes: 510,
					isActive: false,
					workLocationType: "office",
				},
				{
					id: tueWpId,
					employeeId: fixedEmp.employeeId,
					startTime: new Date("2026-06-16T08:00:00.000Z"),
					endTime: new Date("2026-06-16T18:00:00.000Z"),
					durationMinutes: 600,
					isActive: false,
					workLocationType: "office",
				},
			],
			presenceConfig: {
				presenceMode: "minimum_count",
				requiredOnsiteDays: 3,
				requiredOnsiteFixedDays: [],
				locationId: hqLocation.id,
				evaluationPeriod: "week",
				enforcement: "soft",
			},
			absenceDays: [],
			holidayDays: [],
			exemptDays: buildPresenceExemptDaysFromContracts(weekContracts),
		} as never);
		expect(presenceFindings).toEqual([]);

		// July (v2 presence_enabled=false): presence status is disabled
		const presenceJulySummary = await Effect.runPromise(
			loadPresenceStatusForSubject({
				userId: fixedEmp.userId,
				organizationId: ORG_ID,
				employeeId: fixedEmp.employeeId,
				preferences: { weekStartDay: "monday", timezone: "UTC" },
				now: DateTime.fromISO("2026-07-06T12:00:00.000Z", { zone: "UTC" }),
			}).pipe(Effect.provideService(DatabaseService, makeDatabaseService(db))),
		);
		expect(presenceJulySummary.presenceEnabled).toBe(false);

		// ================================================================
		// 5. PAYROLL WORKSPACE REQUIREMENTS & HOURLY EARNINGS PARITY
		// ================================================================
		const rangeReqs = await Effect.runPromise(
			loadDailyWorkRequirementsForEmployees({
				organizationId: ORG_ID,
				employees: [
					{
						id: fixedEmp.employeeId,
						organizationId: ORG_ID,
						teamId: null,
						startDate: new Date("2026-01-01T00:00:00.000Z"),
						contractType: "fixed",
						user: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
						userSettings: { timezone: "UTC" },
						organization: { timezone: "UTC" },
					},
				],
				startDate: new Date("2026-06-15T00:00:00.000Z"),
				endDate: new Date("2026-07-07T23:59:59.999Z"),
				trackingByEmployee: new Map([
					[fixedEmp.employeeId, { startDate: "2026-01-01", timezone: "UTC" }],
				]),
			}).pipe(Effect.provideService(DatabaseService, makeDatabaseService(db))),
		);
		const empRangeReqs = rangeReqs.requirements.get(fixedEmp.employeeId)!;
		expect(empRangeReqs["2026-06-15"]?.requiredMinutes).toBe(monPreview?.requiredMinutes);
		expect(empRangeReqs["2026-06-19"]).toBeUndefined(); // Friday off under v1
		expect(empRangeReqs["2026-07-06"]).toBeUndefined(); // schedule_enabled=false under v2

		// Hourly employee wage earnings parity
		const hourlyEmp = await seedEmployee({ key: "hourly-parity", contractType: "hourly" });
		await admin.query(
			`INSERT INTO employee_employment_history (
				employee_id, organization_id, valid_from, valid_from_date,
				contract_type, weekly_contract_minutes, work_model, hourly_rate, currency,
				review_state, created_by, updated_at
			) VALUES ($1, $2, '2026-06-01T00:00:00Z', '2026-06-01', 'hourly', 1200, 'onsite', 25, 'EUR', 'confirmed', $3, now())`,
			[hourlyEmp.employeeId, ORG_ID, ADMIN_USER_ID],
		);
		const hourlyPreview = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: hourlyEmp.employeeId,
			date: "2026-06-15",
		});
		const spans = await loadConfirmedTermsSpans(db as never, {
			organizationId: ORG_ID,
			employeeId: hourlyEmp.employeeId,
			range: { from: parsePlainDate("2026-06-15"), toExclusive: parsePlainDate("2026-06-16") },
			timezone: "UTC",
		});
		const earnings = calculateHourlyEarningsFromTerms({
			spans,
			workPeriods: [
				{
					start: parseInstant("2026-06-15T08:00:00Z"),
					end: parseInstant("2026-06-15T12:00:00Z"),
					durationMinutes: 240,
					clockInOffsetMinutes: 0,
					clockOutOffsetMinutes: 0,
				},
			],
			range: {
				start: parseInstant("2026-06-15T00:00:00Z"),
				endExclusive: parseInstant("2026-06-16T00:00:00Z"),
				startDate: "2026-06-15",
				endDate: "2026-06-15",
			},
		});
		expect(hourlyPreview?.hourlyRate).toBe(25);
		expect(earnings?.totalEarnings).toBe(100);

		// ================================================================
		// 6. STAFFING PARITY (single active version per date, zero duplicates)
		// ================================================================
		const juneStaffing = await loadStaffingRankingFacts(db, {
			organizationId: ORG_ID,
			employeeIds: [fixedEmp.employeeId],
			shiftDate: parsePlainDate("2026-06-15"),
			shiftsFrom: parsePlainDate("2026-06-15"),
			until: parsePlainDate("2026-06-16"),
			excludeShiftId: null,
			timezone: "UTC",
		});
		const julyStaffing = await loadStaffingRankingFacts(db, {
			organizationId: ORG_ID,
			employeeIds: [fixedEmp.employeeId],
			shiftDate: parsePlainDate("2026-07-06"),
			shiftsFrom: parsePlainDate("2026-07-06"),
			until: parsePlainDate("2026-07-07"),
			excludeShiftId: null,
			timezone: "UTC",
		});
		expect(juneStaffing.get(fixedEmp.employeeId)?.contract.termsScheduleCycle).toEqual({
			cycle: "weekly",
		});
		expect(julyStaffing.get(fixedEmp.employeeId)?.contract.termsScheduleCycle).toEqual({
			cycle: null,
		});

		// ================================================================
		// 7. EXPORTS PARITY (single active version per policy, zero duplicate rows!)
		// ================================================================
		const juneExport = await loadWorkPoliciesForExport(db, ORG_ID, "2026-06-15");
		const julyExport = await loadWorkPoliciesForExport(db, ORG_ID, "2026-07-06");

		expect(juneExport.policies).toHaveLength(1);
		expect(juneExport.policies[0]).toMatchObject({
			id: policyId,
			scheduleEnabled: true,
			regulationEnabled: true,
			presenceEnabled: true,
			activeVersionNumber: 1,
			isDefault: true,
		});
		expect(juneExport.schedules).toHaveLength(1);
		expect(juneExport.regulations).toHaveLength(1);
		expect(juneExport.regulations[0]?.maxDailyMinutes).toBe(480);

		expect(julyExport.policies).toHaveLength(1);
		expect(julyExport.policies[0]).toMatchObject({
			id: policyId,
			scheduleEnabled: false,
			regulationEnabled: true,
			presenceEnabled: false,
			activeVersionNumber: 2,
			isDefault: true,
		});
		expect(julyExport.schedules).toHaveLength(0);
		expect(julyExport.regulations).toHaveLength(1);
		expect(julyExport.regulations[0]?.maxDailyMinutes).toBe(600);
	});
});
