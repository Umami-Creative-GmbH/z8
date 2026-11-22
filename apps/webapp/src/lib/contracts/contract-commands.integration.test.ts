/**
 * #1927: Real-PostgreSQL integration suite for:
 * - Organization & Primary Team default contracts (`scheduleContractDefault`,
 *   `previewContractDefaultChange`, `getContractDefaults`), write-through
 *   `work_policy_assignment` intervals honoring 0322 `btree_gist`, `on_call` default
 *   prohibition (`is_default_eligible`), and write-only mismatch conflict recording.
 * - Immutable stamping contract templates (`createContractTemplate`,
 *   `publishContractTemplateVersion`, `previewTemplateApplication`) with normalized
 *   custom working days and non-mutation of existing employees.
 * - Sparse employee divergence (`commitContractChange`, `commitContractChangeInTx`),
 *   remote `presence_override = 'exempt'` default, 4-kind § 12 TzBfG on-call terms
 *   (and 0323 3VL-safe `IS TRUE` check), 1-click Reset to default, `migrated_legacy_terms`
 *   adoption, and `sourceBatchItemId` atomic per-employee deduplication.
 * - Linear fixed-term agreement chains (`createInitialEmploymentAgreement`,
 *   `recordFixedTermExtension`, `listEmploymentTermAgreements`) and all 3 departure-sync
 *   choices (`update_leaving_date`, `cancel_departure`, `leave_unchanged`).
 * - A1 scoped-manager RBAC & `contract_terms` pin refusal (`assignEmployeeWorkPolicy`).
 * - Primary-team move operational preview parity (`previewPrimaryTeamMove`) with zero
 *   mutation of employee-owned terms or personal divergences.
 */

import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as authSchema from "@/db/auth-schema";
import * as schema from "@/db/schema";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { changeHourlyWage } from "@/lib/employment-history/write-terms";
import { createVersionedWorkPolicy } from "@/lib/work-policy/versioned-policy-writer";
import { integrationAdminPool } from "@/test/integration-database";
import {
	adoptContractDefault,
	assignEmployeeWorkPolicy,
	commitContractChange,
	commitContractChangeInTx,
	createContractTemplate,
	createInitialEmploymentAgreement,
	getContractDefaults,
	getContractTemplate,
	listContractMigrationConflicts,
	listEmploymentTermAgreements,
	previewContractDefaultChange,
	previewEmployeeContractChange,
	previewPrimaryTeamMove,
	previewTemplateApplication,
	publishContractTemplateVersion,
	recordFixedTermExtension,
	recordFixedTermExtensionInTx,
	resetEmployeeContractDivergences,
	resolveEffectiveContractOnDay,
	STATUTORY_ON_CALL_DAILY_PREVIEW_NOTE,
	scheduleContractDefault,
} from "./index";

const fullSchema = { ...authSchema, ...schema };

const ORG_ID = "t1927-commands-org";
const ADMIN_USER_ID = "t1927-commands-admin";
const MANAGER_USER_ID = "t1927-commands-manager";

describe("contract defaults, templates, employee divergence & fixed-term commands (PostgreSQL, #1927)", () => {
	vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const db = drizzle({ client: admin, schema: fullSchema }) as unknown as DatabaseClient;

	async function cleanup() {
		await admin.query("DELETE FROM organization WHERE id = $1", [ORG_ID]);
		await admin.query(`DELETE FROM "user" WHERE id LIKE 't1927-commands-%'`);
	}

	async function seedTeam(name: string) {
		const {
			rows: [row],
		} = await admin.query<{ id: string }>(
			`INSERT INTO team (organization_id, name, created_at, updated_at)
			 VALUES ($1, $2, now(), now())
			 RETURNING id`,
			[ORG_ID, name],
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

	async function seedEmployee(opts: {
		key: string;
		teamId?: string | null;
		contractType?: "fixed" | "hourly";
		startedAt?: string;
		teamEffectiveFrom?: string;
	}) {
		const userId = `t1927-commands-${opts.key}`;
		const now = new Date("2026-01-01T00:00:00.000Z");
		await admin.query(
			`INSERT INTO "user" (id, name, email, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $4)`,
			[userId, opts.key, `${userId}@example.test`, now],
		);
		const {
			rows: [emp],
		} = await admin.query<{ id: string }>(
			`INSERT INTO employee (
				user_id, organization_id, team_id, first_name, last_name, role, contract_type, is_active, updated_at
			) VALUES ($1, $2, $3, $4, 'Tester', 'employee', $5, true, $6)
			RETURNING id`,
			[userId, ORG_ID, opts.teamId ?? null, opts.key, opts.contractType ?? "fixed", now],
		);
		const {
			rows: [period],
		} = await admin.query<{ id: string }>(
			`INSERT INTO employee_employment_period (
				organization_id, employee_id, status, started_at, start_provenance
			) VALUES ($1, $2, 'open', $3::timestamptz, 'recorded')
			RETURNING id`,
			[ORG_ID, emp.id, opts.startedAt ?? "2026-01-01T00:00:00Z"],
		);
		if (opts.teamId) {
			await admin.query(
				`UPDATE employee_team_history
				 SET effective_from = $2::timestamptz
				 WHERE employee_id = $1`,
				[emp.id, opts.teamEffectiveFrom ?? "2026-01-01T00:00:00Z"],
			);
		}
		return { userId, employeeId: emp.id, employmentPeriodId: period.id };
	}

	async function seedDetailedPolicy(name: string, locationId?: string) {
		const created = await createVersionedWorkPolicy(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			data: {
				name,
				scheduleEnabled: true,
				regulationEnabled: true,
				presenceEnabled: Boolean(locationId),
				schedule: {
					scheduleCycle: "weekly",
					scheduleType: "detailed",
					workingDaysPreset: "custom",
					days: [
						{ dayOfWeek: "monday", hoursPerDay: "9.00", isWorkDay: true, latestClockIn: "09:00" },
						{ dayOfWeek: "tuesday", hoursPerDay: "9.00", isWorkDay: true, latestClockIn: "09:00" },
						{
							dayOfWeek: "wednesday",
							hoursPerDay: "9.00",
							isWorkDay: true,
							latestClockIn: "09:00",
						},
						{ dayOfWeek: "thursday", hoursPerDay: "9.00", isWorkDay: true, latestClockIn: "09:00" },
						{ dayOfWeek: "friday", hoursPerDay: "4.00", isWorkDay: true, latestClockIn: "09:30" },
					],
				},
				regulation: {
					maxDailyMinutes: 600,
					maxWeeklyMinutes: 2880,
					minRestPeriodMinutes: 660,
					restPeriodEnforcement: "block",
					breakRules: [],
				},
				...(locationId
					? {
							presence: {
								presenceMode: "minimum_count" as const,
								requiredOnsiteDays: 3,
								locationId,
								evaluationPeriod: "weekly" as const,
								enforcement: "warn" as const,
							},
						}
					: {}),
			},
		});
		return created.policy.id;
	}

	async function seedSimplePolicy(name: string, hoursPerCycle: string) {
		const created = await createVersionedWorkPolicy(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			data: {
				name,
				scheduleEnabled: true,
				regulationEnabled: false,
				presenceEnabled: false,
				schedule: {
					scheduleCycle: "weekly",
					scheduleType: "simple",
					workingDaysPreset: "weekdays",
					hoursPerCycle,
				},
			},
		});
		return created.policy.id;
	}

	beforeEach(async () => {
		await cleanup();
		const now = new Date("2026-01-01T00:00:00.000Z");
		await admin.query(
			`INSERT INTO organization (id, name, slug, timezone, created_at)
			 VALUES ($1, 'Commands Org', $1, 'Europe/Berlin', $2)`,
			[ORG_ID, now],
		);
		await admin.query(
			`INSERT INTO "user" (id, name, email, created_at, updated_at)
			 VALUES
			 ($1, 'Admin', 't1927-commands-admin@example.test', $3, $3),
			 ($2, 'Manager', 't1927-commands-manager@example.test', $3, $3)`,
			[ADMIN_USER_ID, MANAGER_USER_ID, now],
		);
	});

	afterAll(cleanup);

	it("schedules org & team defaults with read-only preview, write-through work_policy_assignment, on_call refusal, and write-only mismatch conflicts", async () => {
		const locId = await seedLocation("Berlin HQ");
		const detailed40hId = await seedDetailedPolicy("Detailed 40h", locId);
		const simple35hId = await seedSimplePolicy("Simple 35h", "35");
		const shiftTeamId = await seedTeam("Retail Shifts");

		// Refuse on_call at org & team default levels while allowing published_shifts
		await expect(
			scheduleContractDefault(db, {
				organizationId: ORG_ID,
				actorUserId: ADMIN_USER_ID,
				scope: "organization",
				effectiveFromDate: "2026-01-01",
				scheduleSource: "on_call",
			}),
		).rejects.toMatchObject({ _tag: "ValidationError", refusal: "on_call_default_forbidden" });

		// Also verify DB composite FK (`is_default_eligible`) directly rejects an on_call template version
		const onCallTpl = await createContractTemplate(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			name: "On-Call Stamping Only",
			scheduleSource: "on_call",
			defaultOnCallHoursKind: "minimum",
			defaultOnCallWeeklyMinutes: 600,
		});
		expect(onCallTpl.isDefaultEligible).toBe(false);
		await expect(
			admin.query(
				`INSERT INTO contract_default (
					organization_id, scope, team_id, template_version_id, effective_from_date, created_by
				) VALUES ($1, 'organization', NULL, $2, '2026-01-01', $3)`,
				[ORG_ID, onCallTpl.templateVersionId, ADMIN_USER_ID],
			),
		).rejects.toThrow();

		// Published shifts team default IS allowed
		const retailDefault = await scheduleContractDefault(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			scope: "team",
			teamId: shiftTeamId,
			effectiveFromDate: "2026-01-01",
			scheduleSource: "published_shifts",
			workModel: "onsite",
		});
		expect(retailDefault.scope).toBe("team");

		// Schedule initial Org Default (Simple 35h, onsite)
		const orgV1 = await scheduleContractDefault(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			scope: "organization",
			effectiveFromDate: "2026-01-01",
			workPolicyId: simple35hId,
			weeklyContractMinutes: 2100,
			workModel: "onsite",
			balanceMode: "tracked",
		});
		expect(orgV1.workPolicyAssignmentId).not.toBeNull();

		// Seed 2 employees:
		// - empInherit: inherits org default cleanly
		// - empDiverged: has explicit weeklyContractMinutes = 1900 (will disagree with Detailed 40h = 2400m!) + remote override
		const empInherit = await seedEmployee({ key: "def-inherit" });
		const empDiverged = await seedEmployee({ key: "def-diverged" });
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: empDiverged.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-01-01",
			weeklyContractMinutes: 1900,
			workModel: "remote",
		});

		// Preview upgrading Org Default to Detailed 40h + trust_based on 2026-06-01 inside READ ONLY check!
		const preview = await previewContractDefaultChange(db, {
			organizationId: ORG_ID,
			scope: "organization",
			effectiveFromDate: "2026-06-01",
			workPolicyId: detailed40hId,
			weeklyContractMinutes: 2400,
			workModel: "hybrid",
			balanceMode: "trust_based",
		});

		expect(preview.inheritingCount).toBe(2); // Both get new policy + trust_based
		const inheritRow = preview.inheritingEmployees.find(
			(e) => e.employeeId === empInherit.employeeId,
		);
		const divergedRow = preview.inheritingEmployees.find(
			(e) => e.employeeId === empDiverged.employeeId,
		);
		expect(inheritRow?.changes.map((c) => c.field)).toEqual(
			expect.arrayContaining(["workPolicy", "weeklyContractMinutes", "workModel", "balanceMode"]),
		);
		expect(divergedRow?.preservedDivergenceFields).toEqual(
			expect.arrayContaining(["weeklyContractMinutes", "workModel"]),
		);
		expect(preview.mismatchWarningCount).toBe(1);
		expect(preview.mismatchWarnings[0]?.employeeId).toBe(empDiverged.employeeId);

		// Preview wrote ZERO conflict rows!
		const conflictsBefore = await listContractMigrationConflicts(db, ORG_ID);
		expect(conflictsBefore).toHaveLength(0);

		// Now commit the future Org Default change on 2026-06-01
		const orgV2 = await scheduleContractDefault(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			scope: "organization",
			effectiveFromDate: "2026-06-01",
			workPolicyId: detailed40hId,
			weeklyContractMinutes: 2400,
			workModel: "hybrid",
			balanceMode: "trust_based",
		});
		expect(orgV2.recordedConflictsCount).toBe(1);
		expect(orgV2.workPolicyAssignmentId).not.toBeNull();

		// Verify write-through work_policy_assignment intervals are non-overlapping & contiguous
		const { rows: orgAssignments } = await admin.query<{
			policy_id: string;
			effective_from_date: string;
			effective_until_date: string | null;
			source_kind: string;
			source_contract_default_id: string;
		}>(
			`SELECT policy_id, effective_from_date::text, effective_until_date::text, source_kind, source_contract_default_id
			 FROM work_policy_assignment
			 WHERE organization_id = $1 AND assignment_type = 'organization' AND is_active = true
			 ORDER BY effective_from_date ASC`,
			[ORG_ID],
		);
		expect(orgAssignments).toEqual([
			{
				policy_id: simple35hId,
				effective_from_date: "2026-01-01",
				effective_until_date: "2026-06-01",
				source_kind: "contract_default",
				source_contract_default_id: orgV1.contractDefaultId,
			},
			{
				policy_id: detailed40hId,
				effective_from_date: "2026-06-01",
				effective_until_date: null,
				source_kind: "contract_default",
				source_contract_default_id: orgV2.contractDefaultId,
			},
		]);

		// Verify mismatch conflict WAS recorded on mutating write path
		const conflictsAfter = await listContractMigrationConflicts(db, ORG_ID, { status: "open" });
		expect(conflictsAfter).toHaveLength(1);
		expect(conflictsAfter[0]).toMatchObject({
			employeeId: empDiverged.employeeId,
			workPolicyId: detailed40hId,
			conflictKind: "weekly_hours_policy_day_sum_mismatch",
		});

		// Re-scheduling same-day Org Default replaces cleanly and stays idempotent on dedupeKey
		await scheduleContractDefault(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			scope: "organization",
			effectiveFromDate: "2026-06-01",
			workPolicyId: detailed40hId,
			weeklyContractMinutes: 2400,
			workModel: "hybrid",
			balanceMode: "trust_based",
		});
		const defaults = await getContractDefaults(db, ORG_ID, { scope: "organization" });
		expect(defaults).toHaveLength(2);
		expect(defaults.map((d) => d.effectiveFromDate)).toEqual(["2026-01-01", "2026-06-01"]);
	});

	it("creates and versions stamping contract templates without silently mutating existing employees", async () => {
		const emp = await seedEmployee({ key: "tpl-emp" });

		// Create v1 template with custom working days + employee-owned defaults
		const tplV1 = await createContractTemplate(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			name: "Working Student 20h",
			description: "Mon-Wed custom hours",
			scheduleMode: "custom_days",
			weeklyContractMinutes: 1200,
			workModel: "remote",
			balanceMode: "tracked",
			scheduleSource: "policy",
			customDays: [
				{ dayOfWeek: "monday", minutesPerDay: 480, isWorkDay: true, latestClockIn: "09:30" },
				{ dayOfWeek: "tuesday", minutesPerDay: 480, isWorkDay: true, latestClockIn: "09:30" },
				{ dayOfWeek: "wednesday", minutesPerDay: 240, isWorkDay: true, latestClockIn: null },
			],
			defaultContractType: "hourly",
			defaultHourlyRate: 18.5,
			defaultCurrency: "EUR",
			defaultEmploymentProfile: "working_student",
			defaultArbzgScope: "standard",
		});

		const preview = await previewTemplateApplication(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			templateVersionId: tplV1.templateVersionId,
			effectiveFromDate: "2026-03-01",
		});
		expect(preview.remoteExemptDefaultApplied).toBe(true);
		expect(preview.employeeOwnedPrefill).toMatchObject({
			contractType: "hourly",
			hourlyRate: 18.5,
			employmentProfile: "working_student",
		});
		expect(preview.operationalOverridesToWrite.customDays).toHaveLength(3);

		// Stamp v1 onto employee
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-03-01",
			...preview.operationalOverridesToWrite,
			...preview.employeeOwnedPrefill,
			sourceTemplateVersionId: tplV1.templateVersionId,
		});

		// Publish immutable v2 with totally different hours & hourly rate
		const tplV2 = await publishContractTemplateVersion(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			templateId: tplV1.templateId,
			scheduleMode: "hours_only",
			weeklyContractMinutes: 900,
			workModel: "onsite",
			defaultContractType: "hourly",
			defaultHourlyRate: 22.0,
			defaultEmploymentProfile: "working_student",
		});
		expect(tplV2.versionNumber).toBe(2);

		const detail = await getContractTemplate(db, ORG_ID, tplV1.templateId);
		expect(detail?.versions.map((v) => v.versionNumber)).toEqual([2, 1]);
		expect(detail?.versions[1]?.weeklyContractMinutes).toBe(1200);
		expect(detail?.versions[0]?.weeklyContractMinutes).toBe(900);

		// Existing employee stamped with v1 MUST remain untouched!
		const resolvedMonday = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			date: "2026-03-02", // Monday
		});
		expect(resolvedMonday?.requiredMinutes).toBe(480);
		expect(resolvedMonday?.hourlyRate).toBe(18.5);
		expect(resolvedMonday?.workModel).toBe("remote");
		expect(resolvedMonday?.employmentProfile).toBe("working_student");
	});

	it("handles sparse divergence, remote exempt default, 4-kind on-call validation, reset to default, migrated_legacy_terms adoption, and batch deduplication", async () => {
		const locId = await seedLocation("Munich Office");
		const policyId = await seedDetailedPolicy("Office 40h", locId);
		await scheduleContractDefault(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			scope: "organization",
			effectiveFromDate: "2026-01-01",
			workPolicyId: policyId,
			weeklyContractMinutes: 2400,
			workModel: "onsite",
			balanceMode: "tracked",
		});

		const emp = await seedEmployee({ key: "div-emp" });

		// 1. Remote defaults presenceOverride = 'exempt', while explicit 'require_onsite' overrides it
		const remotePreview = await previewEmployeeContractChange(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			validFromDate: "2026-02-01",
			workModel: "remote",
		});
		expect(remotePreview.remoteExemptDefaultApplied).toBe(true);
		expect(remotePreview.resolvedPresenceOverride).toBe("exempt");

		const committedRemote = await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-02-01",
			workModel: "remote",
			contractType: "hourly",
			hourlyRate: 30,
			employmentProfile: "minijob",
			arbzgScope: "executive_exempt",
		});
		expect(committedRemote.remoteExemptDefaultApplied).toBe(true);
		expect(committedRemote.employmentHistory.presenceOverride).toBe("exempt");

		const resolvedRemote = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			date: "2026-02-02",
		});
		expect(resolvedRemote?.presenceStatus).toBe("exempt");
		expect(resolvedRemote?.employmentProfile).toBe("minijob");
		expect(resolvedRemote?.arbzgScope).toBe("executive_exempt");

		// 2. 4-kind § 12 TzBfG on-call terms + statutory daily preview text + invalid combinations rejected
		const onCallUnspecifiedPreview = await previewEmployeeContractChange(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			validFromDate: "2026-03-01",
			scheduleSource: "on_call",
			onCallHoursKind: "unspecified",
			onCallWeeklyMinutes: null,
			onCallDailyMinutes: null,
		});
		expect(onCallUnspecifiedPreview.onCallPreview.effectiveWeeklyMinutes).toBe(1200);
		expect(onCallUnspecifiedPreview.onCallPreview.dailyDurationPreview).toBe(
			STATUTORY_ON_CALL_DAILY_PREVIEW_NOTE,
		);

		// Invalid: unspecified with weekly minutes -> refused
		await expect(
			commitContractChange(db, {
				organizationId: ORG_ID,
				employeeId: emp.employeeId,
				actorUserId: ADMIN_USER_ID,
				validFromDate: "2026-03-01",
				scheduleSource: "on_call",
				onCallHoursKind: "unspecified",
				onCallWeeklyMinutes: 600,
			}),
		).rejects.toMatchObject({
			_tag: "ValidationError",
			refusal: "on_call_unspecified_forbids_weekly_minutes",
		});

		// Invalid: non-on_call with onCallHoursKind -> refused (also blocked by DB IS TRUE check!)
		await expect(
			commitContractChange(db, {
				organizationId: ORG_ID,
				employeeId: emp.employeeId,
				actorUserId: ADMIN_USER_ID,
				validFromDate: "2026-03-01",
				scheduleSource: null,
				onCallHoursKind: "exact",
				onCallWeeklyMinutes: 600,
			}),
		).rejects.toMatchObject({
			_tag: "ValidationError",
			refusal: "on_call_fields_require_on_call_source",
		});

		// Commit all 4 valid on-call kinds sequentially on distinct dates
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-03-01",
			scheduleSource: "on_call",
			onCallHoursKind: "exact",
			onCallWeeklyMinutes: 900,
			onCallDailyMinutes: 240,
		});
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-04-01",
			scheduleSource: "on_call",
			onCallHoursKind: "minimum",
			onCallWeeklyMinutes: 600,
			onCallDailyMinutes: null,
		});
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-05-01",
			scheduleSource: "on_call",
			onCallHoursKind: "maximum",
			onCallWeeklyMinutes: 1000,
			onCallDailyMinutes: 180,
		});
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-06-01",
			scheduleSource: "on_call",
			onCallHoursKind: "unspecified",
			onCallWeeklyMinutes: null,
			onCallDailyMinutes: null,
		});

		const minResolved = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			date: "2026-04-06",
		});
		expect(minResolved?.onCallTerms).toMatchObject({
			hoursKind: "minimum",
			weeklyMinutes: 600,
			callInMinBandMinutes: 600,
			callInMaxBandMinutes: 750,
			dailyMinutes: null,
			statutoryMinDailyMinutes: 180,
		});

		const maxResolved = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			date: "2026-05-04",
		});
		expect(maxResolved?.onCallTerms).toMatchObject({
			hoursKind: "maximum",
			callInMinBandMinutes: 800,
			callInMaxBandMinutes: 1000,
		});

		// 3. 1-click Reset to default clears operational divergences while preserving employee-owned
		// terms including § 12 TzBfG on-call statutory agreements (A1-6).
		await resetEmployeeContractDivergences(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			actorUserId: ADMIN_USER_ID,
			effectiveFromDate: "2026-07-01",
		});
		const afterReset = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			date: "2026-07-06", // Monday
		});
		expect(afterReset?.workModel).toBe("onsite");
		expect(afterReset?.workModelSource).toBe("org_default");
		expect(afterReset?.scheduleSource).toBe("on_call");
		expect(afterReset?.onCallTerms).toMatchObject({
			hoursKind: "unspecified",
			statutoryFallbackWeeklyMinutes: 1200,
		});
		expect(afterReset?.contractType).toBe("hourly");
		expect(afterReset?.hourlyRate).toBe(30);
		expect(afterReset?.employmentProfile).toBe("minijob");
		expect(afterReset?.arbzgScope).toBe("executive_exempt");

		// 4. Explicit adoption of migrated_legacy_terms = true row
		const legacyEmp = await seedEmployee({ key: "legacy-emp", contractType: "hourly" });
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: legacyEmp.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-01-01",
			weeklyContractMinutes: 1800,
			workModel: "flexible",
			contractType: "hourly",
			hourlyRate: 25,
			migratedLegacyTerms: true,
		});
		const beforeAdopt = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: legacyEmp.employeeId,
			date: "2026-03-02",
		});
		expect(beforeAdopt?.migratedLegacyTerms).toBe(true);
		expect(beforeAdopt?.weeklyContractMinutes).toBe(1800);
		expect(beforeAdopt?.weeklyContractMinutesSource).toBe("employee_override");

		await adoptContractDefault(db, {
			organizationId: ORG_ID,
			employeeId: legacyEmp.employeeId,
			actorUserId: ADMIN_USER_ID,
			effectiveFromDate: "2026-04-01",
		});
		const afterAdopt = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: legacyEmp.employeeId,
			date: "2026-04-06",
		});
		expect(afterAdopt?.migratedLegacyTerms).toBe(false);
		expect(afterAdopt?.weeklyContractMinutes).toBe(2400);
		expect(afterAdopt?.weeklyContractMinutesSource).toBe("org_default");
		expect(afterAdopt?.workModel).toBe("onsite");
		expect(afterAdopt?.hourlyRate).toBe(25); // Employee-owned wage preserved!

		// 5. Atomic per-employee sourceBatchItemId deduplication (#1928 contract)
		const {
			rows: [batchRow],
		} = await admin.query<{ id: string }>(
			`INSERT INTO contract_change_batch (
				organization_id, request_id, request_fingerprint, operation_kind, execution_mode, total_items, created_by
			) VALUES ($1, $2, 'fp-1927', 'bulk_terms_update', 'inline', 1, $3)
			RETURNING id`,
			[ORG_ID, randomUUID(), ADMIN_USER_ID],
		);
		const {
			rows: [itemRow],
		} = await admin.query<{ id: string }>(
			`INSERT INTO contract_change_batch_item (
				organization_id, batch_id, employee_id, item_index, operation_dedupe_key
			) VALUES ($1, $2, $3, 0, 'dedupe-item-1')
			RETURNING id`,
			[ORG_ID, batchRow.id, legacyEmp.employeeId],
		);

		const firstRun = await db.transaction((tx) =>
			commitContractChangeInTx(tx, {
				organizationId: ORG_ID,
				employeeId: legacyEmp.employeeId,
				actorUserId: ADMIN_USER_ID,
				validFromDate: "2026-05-01",
				balanceMode: "trust_based",
				sourceBatchItemId: itemRow.id,
			}),
		);
		expect(firstRun.deduplicated).toBe(false);

		const replayRun = await db.transaction((tx) =>
			commitContractChangeInTx(tx, {
				organizationId: ORG_ID,
				employeeId: legacyEmp.employeeId,
				actorUserId: ADMIN_USER_ID,
				validFromDate: "2026-05-01",
				balanceMode: "trust_based",
				sourceBatchItemId: itemRow.id,
			}),
		);
		expect(replayRun.deduplicated).toBe(true);
		expect(replayRun.employmentHistory.id).toBe(firstRun.employmentHistory.id);
	});

	it("maintains linear fixed-term agreement chains and executes all 3 departure synchronization choices", async () => {
		const emp = await seedEmployee({ key: "ft-emp" });
		const now = parseInstant("2026-06-01T10:00:00Z");

		// Seed a pending scheduled departure matching initial fixed-term end date (2026-12-31)
		const {
			rows: [dep],
		} = await admin.query<{ id: string }>(
			`INSERT INTO employee_departure (
				organization_id, employee_id, employment_period_id, mode, last_working_day,
				timezone, cutoff_at, status, revision, created_by, request_id, request_fingerprint
			) VALUES (
				$1, $2, $3, 'scheduled', '2026-12-31',
				'Europe/Berlin', '2026-12-31T23:00:00Z', 'pending', 1, $4, $5, 'fp-init'
			)
			RETURNING id`,
			[ORG_ID, emp.employeeId, emp.employmentPeriodId, ADMIN_USER_ID, randomUUID()],
		);

		// Sequence 1: Initial fixed-term agreement
		const root = await createInitialEmploymentAgreement(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			actorUserId: ADMIN_USER_ID,
			kind: "fixed_term",
			startsOn: "2026-01-01",
			endsOn: "2026-12-31",
			reason: "Initial project funding",
		});
		expect(root.sequenceNumber).toBe(1);
		expect(root.supersedesId).toBeNull();

		// Sequence 2: Extension with `update_leaving_date` -> reschedules pending departure to 2027-06-30
		const ext1 = await recordFixedTermExtension(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			actorUserId: ADMIN_USER_ID,
			kind: "fixed_term",
			startsOn: "2027-01-01",
			endsOn: "2027-06-30",
			reason: "Phase 2 extension",
			departureSyncAction: "update_leaving_date",
			now,
		});
		expect(ext1.agreement.sequenceNumber).toBe(2);
		expect(ext1.agreement.supersedesId).toBe(root.id);
		expect(ext1.departureSync).toMatchObject({
			status: "updated",
			departureId: dep.id,
			previousLastWorkingDay: "2026-12-31",
			newLastWorkingDay: "2027-06-30",
			newRevision: 2,
		});

		const {
			rows: [depAfterUpdate],
		} = await admin.query<{ last_working_day: string; status: string; revision: number }>(
			`SELECT last_working_day::text, status, revision FROM employee_departure WHERE id = $1`,
			[dep.id],
		);
		expect(depAfterUpdate).toEqual({
			last_working_day: "2027-06-30",
			status: "pending",
			revision: 2,
		});

		// Sequence 3: Extension with `leave_unchanged` -> leaves departure at 2027-06-30 and flags review
		const ext2 = await recordFixedTermExtension(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			actorUserId: ADMIN_USER_ID,
			kind: "fixed_term",
			startsOn: "2027-07-01",
			endsOn: "2027-12-31",
			reason: "Phase 3 extension",
			departureSyncAction: "leave_unchanged",
			now,
		});
		expect(ext2.agreement.sequenceNumber).toBe(3);
		expect(ext2.agreement.supersedesId).toBe(ext1.agreement.id);
		expect(ext2.departureSync).toMatchObject({
			status: "left_unchanged",
			flaggedForReview: true,
			departureId: dep.id,
			pendingLastWorkingDay: "2027-06-30",
		});

		// Sequence 4: Convert to permanent with `cancel_departure` -> cancels pending departure
		const ext3 = await recordFixedTermExtension(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			actorUserId: ADMIN_USER_ID,
			kind: "permanent",
			startsOn: "2028-01-01",
			endsOn: null,
			reason: null,
			departureSyncAction: "cancel_departure",
			now,
		});
		expect(ext3.agreement.sequenceNumber).toBe(4);
		expect(ext3.agreement.supersedesId).toBe(ext2.agreement.id);
		expect(ext3.departureSync).toMatchObject({
			status: "canceled",
			departureId: dep.id,
			newRevision: 3,
		});

		const {
			rows: [depAfterCancel],
		} = await admin.query<{ status: string; revision: number }>(
			`SELECT status, revision FROM employee_departure WHERE id = $1`,
			[dep.id],
		);
		expect(depAfterCancel).toEqual({ status: "canceled", revision: 3 });

		const listed = await listEmploymentTermAgreements(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
		});
		expect(listed.agreements.map((a) => a.sequenceNumber)).toEqual([1, 2, 3, 4]);
		expect(listed.pendingScheduledDeparture).toBeNull();

		// F7: A pending scheduled departure whose cutoff_at <= now MUST NOT be postponed by update_leaving_date!
		await admin.query(
			`INSERT INTO member (id, organization_id, user_id, role, status, created_at)
			 VALUES ($1, $2, $3, 'owner', 'approved', now())
			 ON CONFLICT DO NOTHING`,
			[randomUUID(), ORG_ID, ADMIN_USER_ID],
		);
		const dueEmp = await seedEmployee({ key: "ft-due-emp" });
		await createInitialEmploymentAgreement(db, {
			organizationId: ORG_ID,
			employeeId: dueEmp.employeeId,
			actorUserId: ADMIN_USER_ID,
			kind: "fixed_term",
			startsOn: "2026-01-01",
			endsOn: "2026-05-31",
			reason: "Short fixed term",
		});
		const {
			rows: [dueDep],
		} = await admin.query<{ id: string }>(
			`INSERT INTO employee_departure (
				organization_id, employee_id, employment_period_id, mode, last_working_day,
				timezone, cutoff_at, status, revision, created_by, request_id, request_fingerprint
			) VALUES (
				$1, $2, $3, 'scheduled', '2026-05-31',
				'Europe/Berlin', '2026-05-31T22:00:00Z', 'pending', 1, $4, $5, 'fp-due'
			)
			RETURNING id`,
			[ORG_ID, dueEmp.employeeId, dueEmp.employmentPeriodId, ADMIN_USER_ID, randomUUID()],
		);

		// Calling recordFixedTermExtensionInTx directly refuses with departure_revision_conflict (cutoff_at <= now)
		await expect(
			db.transaction((tx) =>
				recordFixedTermExtensionInTx(tx, {
					organizationId: ORG_ID,
					employeeId: dueEmp.employeeId,
					actorUserId: ADMIN_USER_ID,
					kind: "fixed_term",
					startsOn: "2026-06-01",
					endsOn: "2026-12-31",
					reason: "Too-late extension",
					departureSyncAction: "update_leaving_date",
					now: parseInstant("2026-06-01T10:00:00Z"),
				}),
			),
		).rejects.toMatchObject({ conflictType: "departure_revision_conflict" });

		// Calling recordFixedTermExtension runs materializeDueDeparture first so the due departure becomes effective
		// in its own transaction (closing the employment period) instead of being postponed into the future!
		await expect(
			recordFixedTermExtension(db, {
				organizationId: ORG_ID,
				employeeId: dueEmp.employeeId,
				actorUserId: ADMIN_USER_ID,
				kind: "fixed_term",
				startsOn: "2026-06-01",
				endsOn: "2026-12-31",
				reason: "Late extension after cutoff",
				departureSyncAction: "update_leaving_date",
				now: parseInstant("2026-06-01T10:00:00Z"),
			}),
		).rejects.toThrow();
		const {
			rows: [dueAfter],
		} = await admin.query<{ status: string; last_working_day: string }>(
			`SELECT status, last_working_day::text FROM employee_departure WHERE id = $1`,
			[dueDep.id],
		);
		expect(dueAfter).toEqual({ status: "effective", last_working_day: "2026-05-31" });
	});

	it("enforces A1 scoped-manager wage-free policy assignment and refuses overwriting admin-pinned contract_terms policies", async () => {
		const policyA = await seedSimplePolicy("Manager Policy A", "40");
		const policyB = await seedSimplePolicy("Admin Pinned Policy B", "36");
		const policyC = await seedSimplePolicy("Manager Attempt C", "38");
		const emp = await seedEmployee({ key: "a1-emp" });

		// Even with confirmed sparse employment terms (workPolicyId: null), scoped manager CAN assign Policy A
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-01-01",
			contractType: "hourly",
			hourlyRate: 42.5,
			workPolicyId: null,
		});

		const managerAssign = await assignEmployeeWorkPolicy(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			policyId: policyA,
			actorUserId: MANAGER_USER_ID,
			actorIsOrgAdmin: false,
			effectiveFromDate: "2026-02-01",
			now: new Date("2026-01-15T10:00:00Z"),
		});
		expect(managerAssign.sourceKind).toBe("manager_assignment");
		expect("hourlyRate" in managerAssign).toBe(false);

		// N4: Scoped managers MUST NOT backdate a work policy assignment before org today
		await expect(
			assignEmployeeWorkPolicy(db, {
				organizationId: ORG_ID,
				employeeId: emp.employeeId,
				policyId: policyA,
				actorUserId: MANAGER_USER_ID,
				actorIsOrgAdmin: false,
				effectiveFromDate: "2026-01-14",
				now: new Date("2026-01-15T10:00:00Z"),
			}),
		).rejects.toMatchObject({
			_tag: "ValidationError",
			refusal: "effective_date_in_past",
		});

		const resolvedManagerPolicy = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			date: "2026-02-10",
		});
		expect(resolvedManagerPolicy?.workPolicy?.policyId).toBe(policyA);

		// Org admin now pins Policy B via contract_terms
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-03-01",
			workPolicyId: policyB,
		});

		// Scoped manager attempting to overwrite admin-pinned Policy B MUST be refused!
		await expect(
			assignEmployeeWorkPolicy(db, {
				organizationId: ORG_ID,
				employeeId: emp.employeeId,
				policyId: policyC,
				actorUserId: MANAGER_USER_ID,
				actorIsOrgAdmin: false,
				effectiveFromDate: "2026-03-15",
				now: new Date("2026-03-01T10:00:00Z"),
			}),
		).rejects.toMatchObject({
			_tag: "ValidationError",
			refusal: "contract_terms_policy_pinned",
		});

		// Policy B remains intact!
		const stillPinned = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			date: "2026-03-16",
		});
		expect(stillPinned?.workPolicy?.policyId).toBe(policyB);
	});

	it("computes read-only primary-team move operational preview without mutating employee-owned terms or personal divergences", async () => {
		const locId = await seedLocation("HQ Office");
		const policyOffice = await seedDetailedPolicy("Office Policy", locId);
		const policyRemote = await seedSimplePolicy("Remote 30h Policy", "30");
		const teamOffice = await seedTeam("Office Team");
		const teamRemote = await seedTeam("Remote Team");

		await scheduleContractDefault(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			scope: "team",
			teamId: teamOffice,
			effectiveFromDate: "2026-01-01",
			workPolicyId: policyOffice,
			weeklyContractMinutes: 2400,
			workModel: "onsite",
			balanceMode: "tracked",
		});
		await scheduleContractDefault(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			scope: "team",
			teamId: teamRemote,
			effectiveFromDate: "2026-01-01",
			workPolicyId: policyRemote,
			weeklyContractMinutes: 1800,
			workModel: "remote",
			balanceMode: "tracked",
		});

		const emp = await seedEmployee({
			key: "move-emp",
			teamId: teamOffice,
			contractType: "hourly",
		});
		// Personal divergence on balanceMode + employee-owned hourly wage & working_student profile
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-01-01",
			contractType: "hourly",
			hourlyRate: 32.5,
			employmentProfile: "working_student",
			balanceMode: "trust_based",
		});

		// Execute preview inside a PostgreSQL READ ONLY transaction to prove zero mutation!
		const roClient = await admin.connect();
		try {
			await roClient.query("BEGIN READ ONLY");
			const roDb = drizzle({ client: roClient, schema: fullSchema }) as unknown as DatabaseClient;

			const movePreview = await previewPrimaryTeamMove(roDb, {
				organizationId: ORG_ID,
				employeeId: emp.employeeId,
				targetTeamId: teamRemote,
				effectiveOnDate: "2026-06-15",
			});

			expect(movePreview.currentPrimaryTeamId).toBe(teamOffice);
			expect(movePreview.targetPrimaryTeamId).toBe(teamRemote);
			expect(movePreview.hasOperationalChanges).toBe(true);
			expect(movePreview.changes.map((c) => c.field)).toEqual(
				expect.arrayContaining(["workPolicy", "weeklyContractMinutes", "workModel"]),
			);
			expect(movePreview.preservedPersonalDivergences).toContain("balanceMode");
			expect(movePreview.projectedContract.balanceMode).toBe("trust_based");
			expect(movePreview.preservedEmployeeOwnedTerms).toMatchObject({
				contractType: "hourly",
				employmentProfile: "working_student",
				arbzgScope: "standard",
			});
			expect(movePreview.projectedContract.hourlyRate).toBe(32.5);

			await roClient.query("COMMIT");
		} finally {
			roClient.release();
		}

		// Employee's stored team and employment history are completely untouched
		const {
			rows: [empAfter],
		} = await admin.query<{ team_id: string }>(`SELECT team_id FROM employee WHERE id = $1`, [
			emp.employeeId,
		]);
		expect(empAfter.team_id).toBe(teamOffice);
	});

	it("preserves unified contract terms & custom days across wage edits (A1-4), selects prior terms covering the date (A1-5), and detects custom-day swaps in default previews (A1-27)", async () => {
		const emp = await seedEmployee({ key: "wage-preserve", contractType: "hourly" });

		// Initial confirmed contract with custom_days, trust_based, minijob, executive_exempt, hourly €20
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-01-01",
			contractType: "hourly",
			hourlyRate: 20,
			currency: "EUR",
			employmentProfile: "minijob",
			arbzgScope: "executive_exempt",
			workModel: "remote",
			presenceOverride: "exempt",
			balanceMode: "trust_based",
			scheduleMode: "custom_days",
			customDays: [
				{ dayOfWeek: "monday", minutesPerDay: 480, isWorkDay: true, latestClockIn: "09:00" },
				{ dayOfWeek: "wednesday", minutesPerDay: 360, isWorkDay: true, latestClockIn: "10:00" },
			],
		});

		// A1-4: Pay-only wage edit must preserve ALL classification, operational divergences, and custom days
		await db.transaction((tx) =>
			changeHourlyWage(tx as unknown as Parameters<typeof changeHourlyWage>[0], {
				organizationId: ORG_ID,
				employeeId: emp.employeeId,
				actorUserId: ADMIN_USER_ID,
				effectiveOn: parsePlainDate("2026-03-01"),
				hourlyRate: 24.5,
				changeReason: "Annual raise",
				reviewState: "confirmed",
			}),
		);

		const afterWage = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: emp.employeeId,
			date: "2026-03-02", // Monday
		});
		expect(afterWage?.hourlyRate).toBe(24.5);
		expect(afterWage?.employmentProfile).toBe("minijob");
		expect(afterWage?.arbzgScope).toBe("executive_exempt");
		expect(afterWage?.balanceMode).toBe("trust_based");
		expect(afterWage?.workModel).toBe("remote");
		expect(afterWage?.scheduleMode).toBe("custom_days");
		expect(afterWage?.requiredMinutes).toBe(480);
		expect(
			afterWage?.weeklyScheduleDays.find((d) => d.dayOfWeek === "wednesday")?.minutesPerDay,
		).toBe(360);

		// A1-5: Operational edit on an earlier date must NOT pull future confirmed terms forward
		const empFuture = await seedEmployee({ key: "future-terms", contractType: "hourly" });
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: empFuture.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-01-01",
			contractType: "hourly",
			hourlyRate: 18,
			employmentProfile: "regular",
		});
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: empFuture.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-08-01",
			contractType: "hourly",
			hourlyRate: 35,
			employmentProfile: "working_student",
		});
		// Operational edit on 2026-04-01 should inherit 2026-01-01's €18/regular, NOT 2026-08-01's €35/working_student!
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: empFuture.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-04-01",
			workModel: "hybrid",
		});
		const aprilContract = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: empFuture.employeeId,
			date: "2026-04-06",
		});
		expect(aprilContract?.hourlyRate).toBe(18);
		expect(aprilContract?.employmentProfile).toBe("regular");
		expect(aprilContract?.workModel).toBe("hybrid");

		// A1-27: Swapping 8h from Monday to Tuesday in org default preview marks inheriting employees affected
		const empInheriting = await seedEmployee({ key: "swap-days" });
		await scheduleContractDefault(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			scope: "organization",
			effectiveFromDate: "2026-01-01",
			scheduleMode: "custom_days",
			customDays: [
				{ dayOfWeek: "monday", minutesPerDay: 480, isWorkDay: true, latestClockIn: null },
			],
		});
		const swapPreview = await previewContractDefaultChange(db, {
			organizationId: ORG_ID,
			scope: "organization",
			effectiveFromDate: "2026-06-01",
			scheduleMode: "custom_days",
			customDays: [
				{ dayOfWeek: "tuesday", minutesPerDay: 480, isWorkDay: true, latestClockIn: null },
			],
		});
		const affectedEmp = swapPreview.inheritingEmployees.find(
			(e) => e.employeeId === empInheriting.employeeId,
		);
		expect(affectedEmp).toBeDefined();
		expect(affectedEmp?.changes.map((c) => c.field)).toContain("weeklyScheduleDays");
	});
});
