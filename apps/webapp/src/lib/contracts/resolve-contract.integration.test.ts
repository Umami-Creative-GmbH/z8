/**
 * #1924: Real-PostgreSQL integration suite for:
 * - Strictly read-only unified contract resolver (`resolveEffectiveContractOnDay`,
 *   `loadEffectiveContractsBatch`) with zero DB writes even on mismatch scaling.
 * - Strict precedence (`unwrapInherit`, Employee confirmed terms/policy -> Primary Team Default
 *   -> Org Default -> null), versioned enablement flags, `trust_based`, `remote` presence
 *   exemption, custom working days, and § 12 TzBfG on-call terms.
 * - Team-history 0120 non-inference invariant (zero backward extrapolation, between-0120-and-0132
 *   foreign-org team isolation, multi-employee same-transaction moves, employeeTz midnight).
 * - Same-day departure + rehire and cross-timezone (`employeeTz != orgTz`) parity.
 * - Transactional instant clock-out break snapshot v2 (`policyVersionId`, `employmentPeriodId`,
 *   `effectiveFromDate`) + v1 replay compatibility.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as authSchema from "@/db/auth-schema";
import * as schema from "@/db/schema";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	parsePolicyClockOutBreakSnapshot,
	regulationFromSnapshot,
	resolvePolicyClockOutBreakSnapshotInTransaction,
} from "@/lib/time-tracking/policy-clock-out-break-snapshot";
import { integrationAdminPool } from "@/test/integration-database";
import { loadEffectiveContractsBatch, resolveEffectiveContractOnDay } from "./resolve-contract";

const fullSchema = { ...authSchema, ...schema };

const ORG_ID = "t1924-contracts-org";
const FOREIGN_ORG_ID = "t1924-contracts-foreign-org";
const ADMIN_USER_ID = "t1924-contracts-admin";

describe("unified read-only contract resolver & clock-out snapshot v2 (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const db = drizzle({ client: admin, schema: fullSchema });

	async function cleanup() {
		await admin.query("DELETE FROM organization WHERE id = ANY($1::text[])", [
			[ORG_ID, FOREIGN_ORG_ID],
		]);
		await admin.query(`DELETE FROM "user" WHERE id LIKE 't1924-contracts-%'`);
	}

	async function seedUserAndEmployee(opts: {
		userKey: string;
		orgId?: string;
		userTimezone?: string | null;
		teamId?: string | null;
		contractType?: "fixed" | "hourly";
	}) {
		const orgId = opts.orgId ?? ORG_ID;
		const userId = `t1924-contracts-${opts.userKey}`;
		const now = new Date("2026-01-01T00:00:00.000Z");
		await admin.query(
			`INSERT INTO "user" (id, name, email, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $4)`,
			[userId, opts.userKey, `${userId}@example.test`, now],
		);
		if (opts.userTimezone) {
			await admin.query(
				`INSERT INTO user_settings (user_id, timezone, updated_at)
				 VALUES ($1, $2, $3)`,
				[userId, opts.userTimezone, now],
			);
		}
		const {
			rows: [emp],
		} = await admin.query<{ id: string }>(
			`INSERT INTO employee (user_id, organization_id, team_id, first_name, last_name, role, contract_type, updated_at)
			 VALUES ($1, $2, $3, $4, 'Test', 'employee', $5, $6)
			 RETURNING id`,
			[userId, orgId, opts.teamId ?? null, opts.userKey, opts.contractType ?? "fixed", now],
		);
		return { userId, employeeId: emp.id };
	}

	async function seedTeam(name: string, orgId = ORG_ID) {
		const {
			rows: [row],
		} = await admin.query<{ id: string }>(
			`INSERT INTO team (organization_id, name, created_at, updated_at)
			 VALUES ($1, $2, now(), now())
			 RETURNING id`,
			[orgId, name],
		);
		return row.id;
	}

	async function seedLocation(name: string) {
		const {
			rows: [row],
		} = await admin.query<{ id: string }>(
			`INSERT INTO location (organization_id, name, is_active, created_by, updated_at)
			 VALUES ($1, $2, true, $3, now())
			 RETURNING id`,
			[ORG_ID, name, ADMIN_USER_ID],
		);
		return row.id;
	}

	async function seedDefaultContract(opts: {
		name: string;
		scope: "organization" | "team";
		teamId?: string | null;
		effectiveFromDate: string;
		workPolicyId?: string | null;
		weeklyContractMinutes?: number | null;
		scheduleMode?: "policy" | "hours_only" | "custom_days";
		workModel?: "onsite" | "hybrid" | "remote" | "flexible" | null;
		presenceOverride?: "inherit" | "exempt" | "require_onsite";
		balanceMode?: "tracked" | "trust_based";
		scheduleSource?: "policy" | "published_shifts";
		customDays?: {
			dayOfWeek: string;
			minutesPerDay: number;
			isWorkDay: boolean;
			latestClockIn?: string | null;
		}[];
	}) {
		const {
			rows: [tpl],
		} = await admin.query<{ id: string }>(
			`INSERT INTO contract_template (organization_id, name, kind, created_by)
			 VALUES ($1, $2, 'default_backing', $3)
			 RETURNING id`,
			[ORG_ID, opts.name, ADMIN_USER_ID],
		);
		const {
			rows: [ver],
		} = await admin.query<{ id: string }>(
			`INSERT INTO contract_template_version (
				organization_id, template_id, version_number, work_policy_id,
				weekly_contract_minutes, schedule_mode, work_model, presence_override,
				balance_mode, schedule_source, created_by
			)
			VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10)
			RETURNING id`,
			[
				ORG_ID,
				tpl.id,
				opts.workPolicyId ?? null,
				opts.weeklyContractMinutes ?? null,
				opts.scheduleMode ?? "policy",
				opts.workModel ?? null,
				opts.presenceOverride ?? "inherit",
				opts.balanceMode ?? "tracked",
				opts.scheduleSource ?? "policy",
				ADMIN_USER_ID,
			],
		);
		for (const day of opts.customDays ?? []) {
			await admin.query(
				`INSERT INTO contract_template_version_day (
					organization_id, template_version_id, day_of_week, minutes_per_day, is_work_day, latest_clock_in
				) VALUES ($1, $2, $3, $4, $5, $6)`,
				[
					ORG_ID,
					ver.id,
					day.dayOfWeek,
					day.minutesPerDay,
					day.isWorkDay,
					day.latestClockIn ?? null,
				],
			);
		}
		const {
			rows: [def],
		} = await admin.query<{ id: string }>(
			`INSERT INTO contract_default (
				organization_id, scope, team_id, template_version_id, effective_from_date, created_by
			) VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id`,
			[ORG_ID, opts.scope, opts.teamId ?? null, ver.id, opts.effectiveFromDate, ADMIN_USER_ID],
		);
		return { defaultId: def.id, templateVersionId: ver.id };
	}

	beforeEach(async () => {
		await cleanup();
		const now = new Date("2026-01-01T00:00:00.000Z");
		await admin.query(
			`INSERT INTO organization (id, name, slug, timezone, created_at)
			 VALUES ($1, 'Contracts Org', $1, 'Europe/Berlin', $3),
			        ($2, 'Foreign Org', $2, 'Europe/Berlin', $3)`,
			[ORG_ID, FOREIGN_ORG_ID, now],
		);
		await admin.query(
			`INSERT INTO "user" (id, name, email, created_at, updated_at)
			 VALUES ($1, 'Admin', 't1924-contracts-admin@example.test', $2, $2)`,
			[ADMIN_USER_ID, now],
		);
	});

	afterAll(cleanup);

	it("enforces strict precedence, unwrapInherit, versioned enablement flags, remote presence exemption, trust_based, and zero-write mismatch scaling", async () => {
		const locId = await seedLocation("HQ");
		const teamId = await seedTeam("Engineering");

		// Create detailed policy (Mon-Thu 9h + Fri 4h = 2400m) with presence + regulation
		const {
			rows: [policyRow],
		} = await admin.query<{ id: string }>(
			`INSERT INTO work_policy (
				organization_id, name, schedule_enabled, regulation_enabled, presence_enabled, created_by, updated_at
			) VALUES ($1, 'Detailed HQ', true, true, true, $2, now())
			RETURNING id`,
			[ORG_ID, ADMIN_USER_ID],
		);
		const {
			rows: [v1Row],
		} = await admin.query<{ id: string }>(
			`INSERT INTO work_policy_version (
				organization_id, policy_id, version_number, effective_from_date,
				schedule_enabled, regulation_enabled, presence_enabled, is_legacy_baseline, sealed_at, created_by
			) VALUES ($1, $2, 1, '1970-01-01', true, true, true, true, NULL, $3)
			RETURNING id`,
			[ORG_ID, policyRow.id, ADMIN_USER_ID],
		);
		const {
			rows: [schedRow],
		} = await admin.query<{ id: string }>(
			`INSERT INTO work_policy_schedule (
				policy_id, policy_version_id, schedule_cycle, schedule_type, working_days_preset, updated_at
			) VALUES ($1, $2, 'weekly', 'detailed', 'custom', now())
			RETURNING id`,
			[policyRow.id, v1Row.id],
		);
		await admin.query(
			`INSERT INTO work_policy_schedule_day (schedule_id, policy_version_id, day_of_week, hours_per_day, is_work_day, cycle_week, latest_clock_in)
			 VALUES
			 ($1, $2, 'monday', '9.00', true, 1, '09:00'),
			 ($1, $2, 'tuesday', '9.00', true, 1, '09:00'),
			 ($1, $2, 'wednesday', '9.00', true, 1, '09:00'),
			 ($1, $2, 'thursday', '9.00', true, 1, '09:00'),
			 ($1, $2, 'friday', '4.00', true, 1, '09:30')`,
			[schedRow.id, v1Row.id],
		);
		await admin.query(
			`INSERT INTO work_policy_presence (
				policy_id, policy_version_id, presence_mode, required_onsite_days, location_id, evaluation_period, enforcement, updated_at
			) VALUES ($1, $2, 'minimum_count', 3, $3, 'weekly', 'warn', now())`,
			[policyRow.id, v1Row.id, locId],
		);

		// Add future v2 (2026-07-01) disabling schedule_enabled on the version while keeping policy row schedule_enabled = true!
		await admin.query(
			`INSERT INTO work_policy_version (
				organization_id, policy_id, version_number, effective_from_date,
				schedule_enabled, regulation_enabled, presence_enabled, is_legacy_baseline, sealed_at, created_by
			) VALUES ($1, $2, 2, '2026-07-01', false, true, false, false, now(), $3)`,
			[ORG_ID, policyRow.id, ADMIN_USER_ID],
		);

		// Org default: Detailed HQ, 40h, remote (defaults presence exempt), trust_based
		await seedDefaultContract({
			name: "Org Default",
			scope: "organization",
			effectiveFromDate: "2026-01-01",
			workPolicyId: policyRow.id,
			weeklyContractMinutes: 2400,
			workModel: "remote",
			presenceOverride: "inherit",
			balanceMode: "trust_based",
		});

		// Team default: hybrid, require_onsite, tracked
		await seedDefaultContract({
			name: "Engineering Default",
			scope: "team",
			teamId,
			effectiveFromDate: "2026-01-01",
			workPolicyId: policyRow.id,
			weeklyContractMinutes: 2400,
			workModel: "hybrid",
			presenceOverride: "require_onsite",
			balanceMode: "tracked",
		});

		// Employee A: no team, no terms -> inherits Org Default (remote -> exempt, trust_based -> zero delta)
		const empA = await seedUserAndEmployee({ userKey: "emp-a" });
		// Employee B: in team from 2026-06-01, with explicit weekly_contract_minutes = 1900 (disagrees with 2400 detailed sum) + schedule_mode = 'inherit'
		const empB = await seedUserAndEmployee({ userKey: "emp-b", teamId });
		await admin.query(
			`UPDATE employee_team_history SET effective_from = '2026-06-01T00:00:00Z' WHERE employee_id = $1`,
			[empB.employeeId],
		);
		await admin.query(
			`INSERT INTO employee_employment_history (
				employee_id, organization_id, valid_from, valid_from_date,
				contract_type, weekly_contract_minutes, work_model, schedule_mode,
				presence_override, review_state, created_by, updated_at
			) VALUES ($1, $2, '2026-01-01', '2026-01-01', 'fixed', 1900, 'hybrid', 'inherit', 'inherit', 'confirmed', $3, now())`,
			[empB.employeeId, ORG_ID, ADMIN_USER_ID],
		);

		// Verify strict read-only guarantee by executing inside a PostgreSQL READ ONLY transaction!
		const roClient = await admin.connect();
		try {
			await roClient.query("BEGIN READ ONLY");
			const roDb = drizzle({ client: roClient, schema: fullSchema });

			const batch = await loadEffectiveContractsBatch(roDb, {
				organizationId: ORG_ID,
				employeeIds: [empA.employeeId, empB.employeeId],
				dates: ["2026-06-15", "2026-07-06"], // Both Mondays
			});

			// Employee A on 2026-06-15 (v1 active)
			const aJune = batch.get(empA.employeeId)?.get("2026-06-15");
			expect(aJune).toBeDefined();
			expect(aJune?.workModel).toBe("remote");
			expect(aJune?.presenceStatus).toBe("exempt");
			expect(aJune?.effectivePresence).toBeNull();
			expect(aJune?.balanceMode).toBe("trust_based");
			expect(aJune?.contributesZeroBalanceDelta).toBe(true);
			expect(aJune?.requiredMinutes).toBe(540);
			expect(aJune?.workPolicy?.versionNumber).toBe(1);

			// Employee A on 2026-07-06 (v2 active: schedule_enabled = false & presence_enabled = false on version!)
			const aJuly = batch.get(empA.employeeId)?.get("2026-07-06");
			expect(aJuly?.workPolicy?.versionNumber).toBe(2);
			expect(aJuly?.workPolicy?.scheduleEnabled).toBe(false);
			expect(aJuly?.requiredMinutes).toBe(0);
			expect(aJuly?.isWorkDay).toBe(false);
			expect(aJuly?.presenceStatus).toBe("not_configured");

			// Employee B on 2026-06-15: unwrapInherit falls back to Team Default -> require_onsite + tracked,
			// AND explicit 1900m scales detailed policy proportionally with read-only mismatchWarning!
			const bJune = batch.get(empB.employeeId)?.get("2026-06-15");
			expect(bJune?.primaryTeamId).toBe(teamId);
			expect(bJune?.presenceStatus).toBe("required");
			expect(bJune?.effectivePresence?.locationId).toBe(locId);
			expect(bJune?.balanceMode).toBe("tracked");
			expect(bJune?.requiredMinutes).toBe(428);
			expect(bJune?.weeklyScheduleDays.reduce((sum, d) => sum + d.minutesPerDay, 0)).toBe(1900);
			expect(bJune?.mismatchWarning).toEqual({
				kind: "weekly_hours_policy_day_sum_mismatch",
				employeeWeeklyMinutes: 1900,
				policyDetailedDaySumMinutes: 2400,
				policyId: policyRow.id,
				policyVersionId: v1Row.id,
			});

			await roClient.query("COMMIT");
		} finally {
			roClient.release();
		}

		// Zero rows written to contract_migration_conflict during read-only resolution!
		const { rows: conflicts } = await admin.query(
			"SELECT id FROM contract_migration_conflict WHERE organization_id = $1",
			[ORG_ID],
		);
		expect(conflicts).toHaveLength(0);
	});

	it("resolves an External Contractor period without Org or Primary Team defaults and with balance excluded (#1996)", async () => {
		const teamId = await seedTeam("Delivery");
		await seedDefaultContract({
			name: "Org default",
			scope: "organization",
			effectiveFromDate: "2026-01-01",
			weeklyContractMinutes: 2400,
			scheduleMode: "hours_only",
			workModel: "onsite",
			presenceOverride: "require_onsite",
		});
		const teamDefault = await seedDefaultContract({
			name: "Team default",
			scope: "team",
			teamId,
			effectiveFromDate: "2026-01-01",
			weeklyContractMinutes: 2000,
			scheduleMode: "hours_only",
		});
		const employeeRow = await seedUserAndEmployee({ userKey: "t1996-employee", teamId });
		const contractor = await seedUserAndEmployee({ userKey: "t1996-contractor", teamId });
		await admin.query(
			`UPDATE employee_team_history SET effective_from = '2026-01-01T00:00:00Z'
			 WHERE employee_id = ANY($1::uuid[])`,
			[[employeeRow.employeeId, contractor.employeeId]],
		);
		await admin.query(
			`INSERT INTO employee_employment_period
			 (organization_id, employee_id, status, started_at, start_provenance, engagement_kind)
			 VALUES ($1, $2, 'open', '2026-01-01T00:00:00Z', 'recorded', 'employee'),
			        ($1, $3, 'open', '2026-01-01T00:00:00Z', 'recorded', 'contractor')`,
			[ORG_ID, employeeRow.employeeId, contractor.employeeId],
		);
		await admin.query("UPDATE employee SET engagement_kind = 'contractor' WHERE id = $1", [
			contractor.employeeId,
		]);

		const resolved = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: contractor.employeeId,
			date: "2026-06-15",
		});
		expect(resolved).toMatchObject({
			engagementKind: "contractor",
			isEmployedOnDay: true,
			primaryTeamId: teamId,
			contractDefaultId: null,
			contractDefaultScope: null,
			workPolicy: null,
			weeklyContractMinutes: null,
			presenceStatus: "not_configured",
			balanceMode: "excluded",
			requiredMinutes: 0,
			contributesZeroBalanceDelta: true,
			employmentProfile: null,
		});

		const batch = await loadEffectiveContractsBatch(db, {
			organizationId: ORG_ID,
			employeeIds: [employeeRow.employeeId, contractor.employeeId],
			dates: ["2026-06-15"],
		});
		expect(batch.get(contractor.employeeId)?.get("2026-06-15")).toEqual(resolved);
		// The control: the employee of the same team inherits the Primary Team default.
		expect(batch.get(employeeRow.employeeId)?.get("2026-06-15")).toMatchObject({
			engagementKind: "employee",
			contractDefaultId: teamDefault.defaultId,
			balanceMode: "tracked",
			requiredMinutes: 400,
			employmentProfile: "regular",
		});
	});

	it("gives statutory monitors no profile, on-call terms or wage on a converted person's contractor days, though the employee terms never ended (#1997)", async () => {
		const person = await seedUserAndEmployee({ userKey: "t1997-converted" });
		const {
			rows: [employeeStint],
		} = await admin.query<{ id: string }>(
			`INSERT INTO employee_employment_period
			 (organization_id, employee_id, status, started_at, start_provenance, ended_at, engagement_kind)
			 VALUES ($1, $2, 'closed', '2026-01-01T00:00:00Z', 'recorded', '2026-06-10T00:00:00Z', 'employee')
			 RETURNING id`,
			[ORG_ID, person.employeeId],
		);
		await admin.query(
			`INSERT INTO employee_employment_period
			 (organization_id, employee_id, status, started_at, start_provenance, engagement_kind)
			 VALUES ($1, $2, 'open', '2026-06-10T00:00:00Z', 'recorded', 'contractor')`,
			[ORG_ID, person.employeeId],
		);
		await admin.query("UPDATE employee SET engagement_kind = 'contractor' WHERE id = $1", [
			person.employeeId,
		]);
		// Minijob on call (§ 12 TzBfG), terms open-ended: nothing ended them at the conversion.
		await admin.query(
			`INSERT INTO employee_employment_history (
				employee_id, organization_id, employment_period_id, valid_from, valid_from_date,
				contract_type, hourly_rate, weekly_contract_minutes, employment_profile, schedule_source,
				on_call_hours_kind, on_call_weekly_minutes, review_state, created_by, updated_at
			) VALUES (
				$1, $2, $3, '2026-01-01', '2026-01-01', 'hourly', '13.50', 600, 'minijob', 'on_call',
				'exact', 600, 'confirmed', $4, now()
			)`,
			[person.employeeId, ORG_ID, employeeStint.id, ADMIN_USER_ID],
		);

		const batch = await loadEffectiveContractsBatch(db, {
			organizationId: ORG_ID,
			employeeIds: [person.employeeId],
			dates: ["2026-06-05", "2026-06-15"],
		});

		// The control: an employee day carries the statutory profile the monitors key on.
		expect(batch.get(person.employeeId)?.get("2026-06-05")).toMatchObject({
			engagementKind: "employee",
			employmentProfile: "minijob",
			hourlyRate: 13.5,
			onCallTerms: expect.objectContaining({ hoursKind: "exact" }),
		});
		expect(batch.get(person.employeeId)?.get("2026-06-15")).toMatchObject({
			engagementKind: "contractor",
			employmentHistoryId: null,
			employmentProfile: null,
			hourlyRate: null,
			onCallTerms: null,
		});
	});

	it("honors 0120 team-history non-inference (no backward extrapolation, between-0120-and-0132 foreign-org team isolation, multi-employee same-transaction moves)", async () => {
		const orgTeam = await seedTeam("Home Team", ORG_ID);
		const orgTeam2 = await seedTeam("Second Team", ORG_ID);
		const foreignTeam = await seedTeam("Foreign Team", FOREIGN_ORG_ID);

		await seedDefaultContract({
			name: "Org 40h",
			scope: "organization",
			effectiveFromDate: "2026-01-01",
			scheduleMode: "hours_only",
			weeklyContractMinutes: 2400, // 480m/day
		});
		await seedDefaultContract({
			name: "Home Team 30h",
			scope: "team",
			teamId: orgTeam,
			effectiveFromDate: "2026-01-01",
			scheduleMode: "hours_only",
			weeklyContractMinutes: 1800, // 360m/day
		});
		await seedDefaultContract({
			name: "Second Team 20h",
			scope: "team",
			teamId: orgTeam2,
			effectiveFromDate: "2026-01-01",
			scheduleMode: "hours_only",
			weeklyContractMinutes: 1200, // 240m/day
		});

		const emp1 = await seedUserAndEmployee({ userKey: "th-1", userTimezone: "UTC" });
		const emp2 = await seedUserAndEmployee({ userKey: "th-2", userTimezone: "UTC" });

		// Simulate multi-employee same-transaction move (producing a zero-length interval [T, T) followed by [T, NULL))
		const txClient = await admin.connect();
		try {
			await txClient.query("BEGIN");
			await txClient.query(`UPDATE employee SET team_id = $1 WHERE id = ANY($2::uuid[])`, [
				orgTeam,
				[emp1.employeeId, emp2.employeeId],
			]);
			await txClient.query(`UPDATE employee SET team_id = $1 WHERE id = ANY($2::uuid[])`, [
				orgTeam2,
				[emp1.employeeId, emp2.employeeId],
			]);
			await txClient.query("COMMIT");
		} finally {
			txClient.release();
		}

		// Pin effective_from/effective_to to deterministic 2026-06-15T00:00:00Z for emp1 & emp2
		await admin.query(
			`UPDATE employee_team_history
			 SET effective_from = '2026-06-15T00:00:00Z'::timestamptz,
			     effective_to = CASE WHEN effective_to IS NOT NULL THEN '2026-06-15T00:00:00Z'::timestamptz ELSE NULL END
			 WHERE employee_id = ANY($1::uuid[])`,
			[[emp1.employeeId, emp2.employeeId]],
		);

		// Simulate between-0120-and-0132 foreign-org team row for emp3
		const emp3 = await seedUserAndEmployee({ userKey: "th-3", userTimezone: "UTC" });
		await admin.query(
			`INSERT INTO employee_team_history (organization_id, employee_id, team_id, effective_from, effective_to)
			 VALUES ($1, $2, $3, '2026-01-01T00:00:00Z', NULL)`,
			[ORG_ID, emp3.employeeId, foreignTeam],
		);

		const batch = await loadEffectiveContractsBatch(db, {
			organizationId: ORG_ID,
			employeeIds: [emp1.employeeId, emp2.employeeId, emp3.employeeId],
			dates: ["2026-06-12", "2026-06-15"], // Friday before capture & Monday at capture
		});

		// Before effective_from (2026-06-12): ZERO backward inference -> primaryTeamId = null -> Org Default 480m
		expect(batch.get(emp1.employeeId)?.get("2026-06-12")?.primaryTeamId).toBeNull();
		expect(batch.get(emp1.employeeId)?.get("2026-06-12")?.requiredMinutes).toBe(480);

		// At 2026-06-15 00:00 UTC: zero-length orgTeam interval ignored -> resolves orgTeam2 (240m) for BOTH employees
		expect(batch.get(emp1.employeeId)?.get("2026-06-15")?.primaryTeamId).toBe(orgTeam2);
		expect(batch.get(emp1.employeeId)?.get("2026-06-15")?.requiredMinutes).toBe(240);
		expect(batch.get(emp2.employeeId)?.get("2026-06-15")?.primaryTeamId).toBe(orgTeam2);
		expect(batch.get(emp2.employeeId)?.get("2026-06-15")?.requiredMinutes).toBe(240);

		// Foreign-org team row from between 0120 and 0132 is ignored -> falls back to Org Default (480m)
		expect(batch.get(emp3.employeeId)?.get("2026-06-15")?.primaryTeamId).toBeNull();
		expect(batch.get(emp3.employeeId)?.get("2026-06-15")?.requiredMinutes).toBe(480);

		// Each employee on its own dates only, with the same terms as the full batch.
		const own = await loadEffectiveContractsBatch(db, {
			organizationId: ORG_ID,
			employeeIds: [emp1.employeeId, emp2.employeeId],
			dates: ["2026-06-12", "2026-06-15"],
			datesByEmployee: new Map([
				[emp1.employeeId, ["2026-06-12"]],
				[emp2.employeeId, ["2026-06-15"]],
			]),
		});
		expect([...(own.get(emp1.employeeId)?.keys() ?? [])]).toEqual(["2026-06-12"]);
		expect([...(own.get(emp2.employeeId)?.keys() ?? [])]).toEqual(["2026-06-15"]);
		expect(own.get(emp1.employeeId)?.get("2026-06-12")).toEqual(
			batch.get(emp1.employeeId)?.get("2026-06-12"),
		);
		expect(own.get(emp2.employeeId)?.get("2026-06-15")).toEqual(
			batch.get(emp2.employeeId)?.get("2026-06-15"),
		);
	});

	it("handles same-day departure + rehire, cross-timezone (employeeTz != orgTz), and clock-out break snapshot v2 + v1 replay", async () => {
		// Employee in America/New_York (UTC-4 in June) inside a Europe/Berlin (UTC+2) org!
		const emp = await seedUserAndEmployee({
			userKey: "rehire-tz",
			userTimezone: "America/New_York",
		});

		// Policy with v1 (30m break after 6h) and v2 effective 2026-07-01 (45m break after 6h)
		const {
			rows: [policyRow],
		} = await admin.query<{ id: string }>(
			`INSERT INTO work_policy (
				organization_id, name, schedule_enabled, regulation_enabled, presence_enabled, created_by, updated_at
			) VALUES ($1, 'Break Policy', true, true, false, $2, now())
			RETURNING id`,
			[ORG_ID, ADMIN_USER_ID],
		);
		const {
			rows: [v1],
		} = await admin.query<{ id: string }>(
			`INSERT INTO work_policy_version (
				organization_id, policy_id, version_number, effective_from_date,
				schedule_enabled, regulation_enabled, presence_enabled, is_legacy_baseline, sealed_at, created_by
			) VALUES ($1, $2, 1, '1970-01-01', true, true, false, true, NULL, $3)
			RETURNING id`,
			[ORG_ID, policyRow.id, ADMIN_USER_ID],
		);
		const {
			rows: [reg1],
		} = await admin.query<{ id: string }>(
			`INSERT INTO work_policy_regulation (
				policy_id, policy_version_id, max_daily_minutes, max_uninterrupted_minutes, updated_at
			) VALUES ($1, $2, 600, 360, now())
			RETURNING id`,
			[policyRow.id, v1.id],
		);
		await admin.query(
			`INSERT INTO work_policy_break_rule (
				regulation_id, policy_version_id, working_minutes_threshold, required_break_minutes, sort_order, updated_at
			) VALUES ($1, $2, 360, 30, 0, now())`,
			[reg1.id, v1.id],
		);
		await admin.query(
			`INSERT INTO work_policy_assignment (
				policy_id, organization_id, assignment_type, employee_id, priority, is_active, created_by, updated_at
			) VALUES ($1, $2, 'employee', $3, 2, true, $4, now())`,
			[policyRow.id, ORG_ID, emp.employeeId, ADMIN_USER_ID],
		);

		// Same-day departure + rehire in America/New_York on 2026-06-15 (Monday):
		// Stint 1: [2026-01-01T00:00Z, 2026-06-15T14:00Z) -> ends 10:00 AM NY time
		// Stint 2: [2026-06-15T18:00Z, NULL)              -> starts 2:00 PM NY time
		const {
			rows: [period1],
		} = await admin.query<{ id: string }>(
			`INSERT INTO employee_employment_period (
				organization_id, employee_id, status, started_at, start_provenance, ended_at
			) VALUES ($1, $2, 'closed', '2026-01-01T00:00:00Z', 'recorded', '2026-06-15T14:00:00Z')
			RETURNING id`,
			[ORG_ID, emp.employeeId],
		);
		const {
			rows: [period2],
		} = await admin.query<{ id: string }>(
			`INSERT INTO employee_employment_period (
				organization_id, employee_id, status, started_at, start_provenance, ended_at
			) VALUES ($1, $2, 'open', '2026-06-15T18:00:00Z', 'recorded', NULL)
			RETURNING id`,
			[ORG_ID, emp.employeeId],
		);

		// Stint 1 terms: 40h (2400m = 480m/day)
		await admin.query(
			`INSERT INTO employee_employment_history (
				employee_id, organization_id, employment_period_id, valid_from, valid_until,
				valid_from_date, valid_until_date, contract_type, weekly_contract_minutes,
				work_model, schedule_mode, review_state, created_by, updated_at
			) VALUES (
				$1, $2, $3, '2026-01-01', '2026-06-15', '2026-01-01', '2026-06-15',
				'fixed', 2400, 'onsite', 'hours_only', 'confirmed', $4, now()
			)`,
			[emp.employeeId, ORG_ID, period1.id, ADMIN_USER_ID],
		);
		// Stint 2 rehire terms: 20h (1200m = 240m/day)
		await admin.query(
			`INSERT INTO employee_employment_history (
				employee_id, organization_id, employment_period_id, valid_from,
				valid_from_date, contract_type, weekly_contract_minutes,
				work_model, schedule_mode, review_state, created_by, updated_at
			) VALUES (
				$1, $2, $3, '2026-06-15', '2026-06-15',
				'fixed', 1200, 'remote', 'hours_only', 'confirmed', $4, now()
			)`,
			[emp.employeeId, ORG_ID, period2.id, ADMIN_USER_ID],
		);

		// Calendar day resolution on shared date 2026-06-15 deduplicates to rehire stint (period2 -> 240m)!
		const onRehireDay = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			date: "2026-06-15",
		});
		expect(onRehireDay?.calendarTimezone).toBe("America/New_York");
		expect(onRehireDay?.employmentPeriodId).toBe(period2.id);
		expect(onRehireDay?.requiredMinutes).toBe(240);
		expect(onRehireDay?.workModel).toBe("remote");

		// Day before (2026-06-12, Friday) resolves period1 (480m)
		const beforeDay = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			date: "2026-06-12",
		});
		expect(beforeDay?.employmentPeriodId).toBe(period1.id);
		expect(beforeDay?.requiredMinutes).toBe(480);

		// Transactional instant clock-out break snapshot v2:
		// 1) Clock-out during stint 1 (13:00Z = 9:00 AM NY) captures period1 + v1 policyVersionId + effectiveFromDate!
		const snapClient = await admin.connect();
		try {
			await snapClient.query("BEGIN");
			const snapDb = drizzle({ client: snapClient, schema: fullSchema });
			const snap1 = await resolvePolicyClockOutBreakSnapshotInTransaction({
				dbService: { db: snapDb },
				organizationId: ORG_ID,
				employeeId: emp.employeeId,
				endTime: parseInstant("2026-06-15T13:00:00Z"),
			});
			expect(snap1.version).toBe(2);
			expect(snap1.resolution).toBe("work_policy");
			if (snap1.version === 2 && snap1.resolution === "work_policy") {
				expect(snap1.employmentPeriodId).toBe(period1.id);
				expect(snap1.policyVersionId).toBe(v1.id);
				expect(snap1.effectiveFromDate).toBe("1970-01-01");
				expect(snap1.breakRules).toHaveLength(1);
				expect(snap1.breakRules[0]?.requiredBreakMinutes).toBe(30);
			}
			expect(regulationFromSnapshot(snap1)).toMatchObject({
				id: reg1.id,
				breakRules: [{ workingMinutesThreshold: 360, requiredBreakMinutes: 30 }],
			});

			// 2) Clock-out during stint 2 (21:00Z = 5:00 PM NY) captures period2!
			const snap2 = await resolvePolicyClockOutBreakSnapshotInTransaction({
				dbService: { db: snapDb },
				organizationId: ORG_ID,
				employeeId: emp.employeeId,
				endTime: parseInstant("2026-06-15T21:00:00Z"),
			});
			expect(snap2.version).toBe(2);
			if (snap2.version === 2 && snap2.resolution === "work_policy") {
				expect(snap2.employmentPeriodId).toBe(period2.id);
				expect(snap2.policyVersionId).toBe(v1.id);
			}
			await snapClient.query("COMMIT");
		} finally {
			snapClient.release();
		}

		// 3) Historical v1 snapshot replay compatibility
		const v1Replay = parsePolicyClockOutBreakSnapshot(
			{
				version: 1,
				evaluatedAt: "2026-03-01T17:00:00Z",
				resolution: "work_policy",
				teamId: null,
				assignment: { id: "20000000-0000-4000-8000-000000000001", type: "employee" },
				policy: { id: policyRow.id, name: "Break Policy" },
				regulationEnabled: true,
				regulation: { id: reg1.id, name: "Break Policy", maxUninterruptedMinutes: 360 },
				breakRules: [
					{
						id: "50000000-0000-4000-8000-000000000001",
						workingMinutesThreshold: 360,
						requiredBreakMinutes: 30,
					},
				],
			},
			"2026-03-01T17:00:00Z",
		);
		expect(v1Replay.version).toBe(1);
		expect(regulationFromSnapshot(v1Replay)).toMatchObject({
			id: reg1.id,
			breakRules: [{ workingMinutesThreshold: 360, requiredBreakMinutes: 30 }],
		});
	});
});
