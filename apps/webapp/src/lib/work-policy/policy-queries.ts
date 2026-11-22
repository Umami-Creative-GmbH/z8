import { and, asc, desc, eq, gt, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
	contractDefault,
	contractTemplateVersion,
	workPolicy,
	workPolicyAssignment,
	workPolicyBreakOption,
	workPolicyBreakRule,
	workPolicyPresence,
	workPolicyRegulation,
	workPolicySchedule,
	workPolicyScheduleDay,
	workPolicyVersion,
} from "@/db/schema";
import { scheduleContractDefaultPolicyUpdate } from "@/lib/contracts/contract-defaults";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import {
	createVersionedWorkPolicyInTx,
	type PolicyTransaction,
	type VersionedWorkPolicyDetails,
} from "./versioned-policy-writer";

type ReadDb = Pick<DatabaseClient, "select" | "query">;

export type WorkPolicyWithVersionDetails = VersionedWorkPolicyDetails;

/**
 * Resolves the active organization-level default work policy ID as of `asOfDate`
 * from `contract_default` (org scope) or active organization `work_policy_assignment`.
 * Never reads the deprecated `work_policy.is_default` column.
 */
export async function loadActiveOrganizationDefaultPolicyId(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	asOfDate?: string,
): Promise<string | null> {
	const orgTimezone = await loadOrganizationTimezone(db as DatabaseClient, organizationId);
	const dayStr = asOfDate ?? plainDateAt(systemClock.nowInstant(), orgTimezone).toString();
	const now = currentTimestamp();

	const [defaultRows, orgAssignments] = await Promise.all([
		db
			.select({
				workPolicyId: contractTemplateVersion.workPolicyId,
				effectiveFromDate: contractDefault.effectiveFromDate,
				effectiveUntilDate: contractDefault.effectiveUntilDate,
				createdAt: contractDefault.createdAt,
				id: contractDefault.id,
			})
			.from(contractDefault)
			.innerJoin(
				contractTemplateVersion,
				and(
					eq(contractTemplateVersion.id, contractDefault.templateVersionId),
					eq(contractTemplateVersion.organizationId, contractDefault.organizationId),
				),
			)
			.where(
				and(
					eq(contractDefault.organizationId, organizationId),
					eq(contractDefault.scope, "organization"),
					eq(contractDefault.isActive, true),
				),
			),
		db
			.select({
				policyId: workPolicyAssignment.policyId,
				effectiveFromDate: workPolicyAssignment.effectiveFromDate,
				effectiveUntilDate: workPolicyAssignment.effectiveUntilDate,
				effectiveFrom: workPolicyAssignment.effectiveFrom,
				effectiveUntil: workPolicyAssignment.effectiveUntil,
				createdAt: workPolicyAssignment.createdAt,
				id: workPolicyAssignment.id,
			})
			.from(workPolicyAssignment)
			.innerJoin(
				workPolicy,
				and(
					eq(workPolicy.id, workPolicyAssignment.policyId),
					eq(workPolicy.organizationId, workPolicyAssignment.organizationId),
					eq(workPolicy.isActive, true),
				),
			)
			.where(
				and(
					eq(workPolicyAssignment.organizationId, organizationId),
					eq(workPolicyAssignment.assignmentType, "organization"),
					eq(workPolicyAssignment.isActive, true),
				),
			),
	]);

	const activeDefaults = defaultRows
		.filter(
			(row) =>
				row.workPolicyId !== null &&
				row.effectiveFromDate <= dayStr &&
				(row.effectiveUntilDate === null || row.effectiveUntilDate > dayStr),
		)
		.sort((a, b) => {
			if (b.effectiveFromDate !== a.effectiveFromDate) {
				return b.effectiveFromDate.localeCompare(a.effectiveFromDate);
			}
			const createdCmp = b.createdAt.getTime() - a.createdAt.getTime();
			if (createdCmp !== 0) return createdCmp;
			return b.id.localeCompare(a.id);
		});

	if (activeDefaults[0]?.workPolicyId) {
		return activeDefaults[0].workPolicyId;
	}

	const activeAssignments = orgAssignments
		.filter((row) => {
			if (row.effectiveFromDate !== null) {
				if (row.effectiveFromDate > dayStr) return false;
				if (row.effectiveUntilDate !== null && row.effectiveUntilDate <= dayStr) return false;
				return true;
			}
			if (row.effectiveFrom !== null && row.effectiveFrom > now) return false;
			if (row.effectiveUntil !== null && row.effectiveUntil <= now) return false;
			return true;
		})
		.sort((a, b) => {
			const aFrom = a.effectiveFromDate ?? "";
			const bFrom = b.effectiveFromDate ?? "";
			if (bFrom !== aFrom) return bFrom.localeCompare(aFrom);
			const createdCmp = b.createdAt.getTime() - a.createdAt.getTime();
			if (createdCmp !== 0) return createdCmp;
			return b.id.localeCompare(a.id);
		});

	return activeAssignments[0]?.policyId ?? null;
}

/**
 * Loads one or all active policies for an organization with their latest effective
 * version's children scoped strictly by `policy_version_id`. Derives `isDefault`
 * from the canonical org default without reading `work_policy.is_default`.
 */
export async function loadWorkPoliciesWithLatestVersion(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	options: { policyId?: string; includeInactive?: boolean } = {},
): Promise<WorkPolicyWithVersionDetails[]> {
	const conditions = [eq(workPolicy.organizationId, organizationId)];
	if (options.policyId) {
		conditions.push(eq(workPolicy.id, options.policyId));
	}
	if (!options.includeInactive) {
		conditions.push(eq(workPolicy.isActive, true));
	}

	const [policyRows, defaultPolicyId] = await Promise.all([
		db
			.select()
			.from(workPolicy)
			.where(and(...conditions))
			.orderBy(asc(workPolicy.name)),
		loadActiveOrganizationDefaultPolicyId(db, organizationId),
	]);

	if (policyRows.length === 0) return [];

	const policyIds = policyRows.map((p) => p.id);
	const versionRows = await db
		.select()
		.from(workPolicyVersion)
		.where(
			and(
				eq(workPolicyVersion.organizationId, organizationId),
				inArray(workPolicyVersion.policyId, policyIds),
			),
		)
		.orderBy(desc(workPolicyVersion.effectiveFromDate), desc(workPolicyVersion.versionNumber));

	const latestVersionByPolicyId = new Map<string, typeof workPolicyVersion.$inferSelect>();
	const versionDatesByPolicyId = new Map<string, Set<string>>();
	for (const version of versionRows) {
		if (!latestVersionByPolicyId.has(version.policyId)) {
			latestVersionByPolicyId.set(version.policyId, version);
		}
		let dates = versionDatesByPolicyId.get(version.policyId);
		if (!dates) {
			dates = new Set<string>();
			versionDatesByPolicyId.set(version.policyId, dates);
		}
		dates.add(version.effectiveFromDate);
	}

	const selectedVersionIds = [...latestVersionByPolicyId.values()].map((v) => v.id);
	const [scheduleRows, regulationRows, presenceRows] = await Promise.all([
		selectedVersionIds.length > 0
			? db
					.select()
					.from(workPolicySchedule)
					.where(inArray(workPolicySchedule.policyVersionId, selectedVersionIds))
			: Promise.resolve([]),
		selectedVersionIds.length > 0
			? db
					.select()
					.from(workPolicyRegulation)
					.where(inArray(workPolicyRegulation.policyVersionId, selectedVersionIds))
			: Promise.resolve([]),
		selectedVersionIds.length > 0
			? db
					.select()
					.from(workPolicyPresence)
					.where(inArray(workPolicyPresence.policyVersionId, selectedVersionIds))
			: Promise.resolve([]),
	]);

	const scheduleIds = scheduleRows.map((s) => s.id);
	const regulationIds = regulationRows.map((r) => r.id);
	const [scheduleDayRows, breakRuleRows] = await Promise.all([
		scheduleIds.length > 0
			? db
					.select()
					.from(workPolicyScheduleDay)
					.where(inArray(workPolicyScheduleDay.scheduleId, scheduleIds))
			: Promise.resolve([]),
		regulationIds.length > 0
			? db
					.select()
					.from(workPolicyBreakRule)
					.where(inArray(workPolicyBreakRule.regulationId, regulationIds))
					.orderBy(asc(workPolicyBreakRule.sortOrder))
			: Promise.resolve([]),
	]);

	const breakRuleIds = breakRuleRows.map((r) => r.id);
	const breakOptionRows =
		breakRuleIds.length > 0
			? await db
					.select()
					.from(workPolicyBreakOption)
					.where(inArray(workPolicyBreakOption.breakRuleId, breakRuleIds))
					.orderBy(asc(workPolicyBreakOption.sortOrder))
			: [];

	const daysByScheduleId = Map.groupBy(scheduleDayRows, (d) => d.scheduleId);
	const optionsByRuleId = Map.groupBy(breakOptionRows, (o) => o.breakRuleId);
	const rulesByRegulationId = Map.groupBy(breakRuleRows, (r) => r.regulationId);

	const scheduleByVersionId = new Map(
		scheduleRows
			.filter((s): s is typeof s & { policyVersionId: string } => s.policyVersionId !== null)
			.map((s) => [s.policyVersionId, { ...s, days: daysByScheduleId.get(s.id) ?? [] }]),
	);
	const regulationByVersionId = new Map(
		regulationRows
			.filter((r): r is typeof r & { policyVersionId: string } => r.policyVersionId !== null)
			.map((r) => [
				r.policyVersionId,
				{
					...r,
					breakRules: (rulesByRegulationId.get(r.id) ?? []).map((rule) => ({
						...rule,
						options: optionsByRuleId.get(rule.id) ?? [],
					})),
				},
			]),
	);
	const presenceByVersionId = new Map(
		presenceRows
			.filter((p): p is typeof p & { policyVersionId: string } => p.policyVersionId !== null)
			.map((p) => [p.policyVersionId, p]),
	);

	return policyRows.map((policyRow) => {
		const version = latestVersionByPolicyId.get(policyRow.id);
		const versionEffectiveDates = [...(versionDatesByPolicyId.get(policyRow.id) ?? [])].sort();
		return {
			...policyRow,
			versionEffectiveDates,
			scheduleEnabled: version ? version.scheduleEnabled : policyRow.scheduleEnabled,
			regulationEnabled: version ? version.regulationEnabled : policyRow.regulationEnabled,
			presenceEnabled: version ? version.presenceEnabled : policyRow.presenceEnabled,
			isDefault: policyRow.id === defaultPolicyId,
			schedule: version ? (scheduleByVersionId.get(version.id) ?? null) : null,
			regulation: version ? (regulationByVersionId.get(version.id) ?? null) : null,
			presence: version ? (presenceByVersionId.get(version.id) ?? null) : null,
		};
	});
}

export async function loadWorkPolicyWithLatestVersion(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	policyId: string,
): Promise<WorkPolicyWithVersionDetails | null> {
	const rows = await loadWorkPoliciesWithLatestVersion(db, organizationId, {
		policyId,
		includeInactive: true,
	});
	return rows[0] ?? null;
}

/**
 * Sets the organization's default work policy via `scheduleContractDefault`, keeping
 * `scheduleContractDefault` as the sole writer of canonical org/team `work_policy_assignment`
 * write-through rows without touching `work_policy.is_default`.
 */
export async function setOrganizationDefaultWorkPolicy(
	db: DatabaseClient,
	input: {
		organizationId: string;
		actorUserId: string;
		policyId: string;
	},
): Promise<void> {
	const orgTimezone = await loadOrganizationTimezone(db, input.organizationId);
	const effectiveFromDate = plainDateAt(systemClock.nowInstant(), orgTimezone).toString();

	await scheduleContractDefaultPolicyUpdate(db, {
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		scope: "organization",
		effectiveFromDate,
		workPolicyId: input.policyId,
	});
}

export async function listWorkPolicyAssignmentsForOrganization(db: ReadDb, organizationId: string) {
	const orgTimezone = await loadOrganizationTimezone(db as DatabaseClient, organizationId);
	const orgTodayDate = plainDateAt(systemClock.nowInstant(), orgTimezone).toString();
	return db.query.workPolicyAssignment.findMany({
		where: and(
			eq(workPolicyAssignment.organizationId, organizationId),
			eq(workPolicyAssignment.isActive, true),
			or(
				isNull(workPolicyAssignment.effectiveUntilDate),
				gt(workPolicyAssignment.effectiveUntilDate, orgTodayDate),
			),
		),
		with: {
			policy: {
				columns: { id: true, name: true },
			},
			team: {
				columns: { id: true, name: true },
			},
			employee: {
				columns: { id: true },
				with: { user: { columns: { firstName: true, lastName: true } } },
			},
		},
		orderBy: [desc(workPolicyAssignment.createdAt)],
	});
}

export async function findWorkPolicyAssignmentInOrganization(
	db: ReadDb,
	organizationId: string,
	assignmentId: string,
) {
	return db.query.workPolicyAssignment.findFirst({
		where: and(
			eq(workPolicyAssignment.id, assignmentId),
			eq(workPolicyAssignment.organizationId, organizationId),
		),
	});
}

/** Whether any active work policy, assignment, or contract default is configured for the org. */
export async function hasWorkPolicySettingsInOrg(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
): Promise<boolean> {
	const [policies, assignments, defaults] = await Promise.all([
		db
			.select({ id: workPolicy.id })
			.from(workPolicy)
			.where(and(eq(workPolicy.organizationId, organizationId), eq(workPolicy.isActive, true)))
			.limit(1),
		db
			.select({ id: workPolicyAssignment.id })
			.from(workPolicyAssignment)
			.where(
				and(
					eq(workPolicyAssignment.organizationId, organizationId),
					eq(workPolicyAssignment.isActive, true),
				),
			)
			.limit(1),
		db
			.select({ id: contractDefault.id })
			.from(contractDefault)
			.where(
				and(eq(contractDefault.organizationId, organizationId), eq(contractDefault.isActive, true)),
			)
			.limit(1),
	]);
	return policies.length > 0 || assignments.length > 0 || defaults.length > 0;
}

/** Whether the organization has an org-level policy/default or the employee has an active assignment. */
export async function hasEmployeeOrOrgWorkPolicy(
	db: Pick<DatabaseClient, "select">,
	input: { organizationId: string; employeeId?: string | null },
): Promise<boolean> {
	const [orgDefaultId, orgAssignment] = await Promise.all([
		loadActiveOrganizationDefaultPolicyId(db, input.organizationId),
		db
			.select({ id: workPolicyAssignment.id })
			.from(workPolicyAssignment)
			.where(
				and(
					eq(workPolicyAssignment.organizationId, input.organizationId),
					eq(workPolicyAssignment.assignmentType, "organization"),
					eq(workPolicyAssignment.isActive, true),
				),
			)
			.limit(1),
	]);
	if (orgDefaultId || orgAssignment.length > 0) return true;
	if (!input.employeeId) return false;

	const empAssignment = await db
		.select({ id: workPolicyAssignment.id })
		.from(workPolicyAssignment)
		.where(
			and(
				eq(workPolicyAssignment.organizationId, input.organizationId),
				eq(workPolicyAssignment.employeeId, input.employeeId),
				eq(workPolicyAssignment.assignmentType, "employee"),
				eq(workPolicyAssignment.isActive, true),
			),
		)
		.limit(1);
	return empAssignment.length > 0;
}

/**
 * Creates an onboarding work template using the version-aware policy writer
 * without touching deprecated `work_policy.is_default`.
 */
export async function createOnboardingWorkTemplateInTx(
	tx: PolicyTransaction,
	input: {
		organizationId: string;
		actorUserId: string;
		name: string;
		hoursPerWeek: number;
		workingDays: readonly (
			| "monday"
			| "tuesday"
			| "wednesday"
			| "thursday"
			| "friday"
			| "saturday"
			| "sunday"
		)[];
		setAsDefault: boolean;
	},
): Promise<void> {
	if (input.setAsDefault) {
		const [existing] = await tx
			.select({ id: workPolicyAssignment.id })
			.from(workPolicyAssignment)
			.where(
				and(
					eq(workPolicyAssignment.organizationId, input.organizationId),
					eq(workPolicyAssignment.assignmentType, "organization"),
					eq(workPolicyAssignment.isActive, true),
				),
			)
			.limit(1);
		if (existing) {
			throw new ValidationError({
				message:
					"An organization default already exists. Create a non-default template or manage work policies in settings.",
				field: "setAsDefault",
				refusal: "work_template_default_exists",
			});
		}
	}

	const allDays = [
		"monday",
		"tuesday",
		"wednesday",
		"thursday",
		"friday",
		"saturday",
		"sunday",
	] as const;
	const hoursPerDay =
		input.workingDays.length > 0 ? input.hoursPerWeek / input.workingDays.length : 0;

	const created = await createVersionedWorkPolicyInTx(tx, {
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		data: {
			name: input.name,
			description: "Created during onboarding",
			scheduleEnabled: true,
			regulationEnabled: false,
			presenceEnabled: false,
			schedule: {
				scheduleCycle: "weekly",
				scheduleType: "simple",
				workingDaysPreset: "weekdays",
				hoursPerCycle: input.hoursPerWeek.toString(),
				homeOfficeDaysPerCycle: 0,
				days: allDays.map((day) => ({
					dayOfWeek: day,
					hoursPerDay: input.workingDays.includes(day) ? hoursPerDay.toFixed(1) : "0",
					isWorkDay: input.workingDays.includes(day),
				})),
			},
		},
	});

	if (input.setAsDefault) {
		await tx.insert(workPolicyAssignment).values({
			policyId: created.policy.id,
			organizationId: input.organizationId,
			assignmentType: "organization",
			priority: 0,
			effectiveFrom: new Date(),
			effectiveFromDate: "1970-01-01",
			sourceKind: "legacy",
			isActive: true,
			createdBy: input.actorUserId,
		});
	}
}

/**
 * Version-scoped export of an organization's work policies, returning exactly one active
 * version per policy as of `asOfDate` (zero duplicate rows across multi-version policies).
 */
export async function loadWorkPoliciesForExport(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	asOfDate?: string,
) {
	const orgTimezone = await loadOrganizationTimezone(db as DatabaseClient, organizationId);
	const dayStr = asOfDate ?? plainDateAt(systemClock.nowInstant(), orgTimezone).toString();

	const [policies, defaultPolicyId, assignments] = await Promise.all([
		db.select().from(workPolicy).where(eq(workPolicy.organizationId, organizationId)),
		loadActiveOrganizationDefaultPolicyId(db, organizationId, dayStr),
		db
			.select()
			.from(workPolicyAssignment)
			.where(eq(workPolicyAssignment.organizationId, organizationId)),
	]);

	const policyIds = policies.map((p) => p.id);
	const versionRows =
		policyIds.length > 0
			? await db
					.select()
					.from(workPolicyVersion)
					.where(
						and(
							eq(workPolicyVersion.organizationId, organizationId),
							inArray(workPolicyVersion.policyId, policyIds),
						),
					)
					.orderBy(desc(workPolicyVersion.effectiveFromDate), desc(workPolicyVersion.versionNumber))
			: [];

	// Select exactly one active version per policy as of `dayStr` (falling back to latest if all future).
	const activeVersionByPolicyId = new Map<string, typeof workPolicyVersion.$inferSelect>();
	const latestVersionByPolicyId = new Map<string, typeof workPolicyVersion.$inferSelect>();
	for (const version of versionRows) {
		if (!latestVersionByPolicyId.has(version.policyId)) {
			latestVersionByPolicyId.set(version.policyId, version);
		}
		if (version.effectiveFromDate <= dayStr && !activeVersionByPolicyId.has(version.policyId)) {
			activeVersionByPolicyId.set(version.policyId, version);
		}
	}

	const selectedVersions = policies
		.map((p) => activeVersionByPolicyId.get(p.id) ?? latestVersionByPolicyId.get(p.id))
		.filter((v): v is typeof workPolicyVersion.$inferSelect => v !== undefined);
	const scheduleEnabledVersionIds = selectedVersions
		.filter((v) => v.scheduleEnabled)
		.map((v) => v.id);
	const regulationEnabledVersionIds = selectedVersions
		.filter((v) => v.regulationEnabled)
		.map((v) => v.id);

	const [schedules, regulations] = await Promise.all([
		scheduleEnabledVersionIds.length > 0
			? db
					.select()
					.from(workPolicySchedule)
					.where(inArray(workPolicySchedule.policyVersionId, scheduleEnabledVersionIds))
			: Promise.resolve([]),
		regulationEnabledVersionIds.length > 0
			? db
					.select()
					.from(workPolicyRegulation)
					.where(inArray(workPolicyRegulation.policyVersionId, regulationEnabledVersionIds))
			: Promise.resolve([]),
	]);

	const scheduleIds = schedules.map((s) => s.id);
	const regulationIds = regulations.map((r) => r.id);
	const [scheduleDays, breakRules] = await Promise.all([
		scheduleIds.length > 0
			? db
					.select()
					.from(workPolicyScheduleDay)
					.where(inArray(workPolicyScheduleDay.scheduleId, scheduleIds))
			: Promise.resolve([]),
		regulationIds.length > 0
			? db
					.select()
					.from(workPolicyBreakRule)
					.where(inArray(workPolicyBreakRule.regulationId, regulationIds))
			: Promise.resolve([]),
	]);

	const breakRuleIds = breakRules.map((r) => r.id);
	const breakOptions =
		breakRuleIds.length > 0
			? await db
					.select()
					.from(workPolicyBreakOption)
					.where(inArray(workPolicyBreakOption.breakRuleId, breakRuleIds))
			: [];

	const activeVersionMap = new Map(selectedVersions.map((v) => [v.policyId, v]));

	return {
		policies: policies.map((p) => {
			const v = activeVersionMap.get(p.id);
			return {
				id: p.id,
				name: p.name,
				description: p.description,
				scheduleEnabled: v ? v.scheduleEnabled : p.scheduleEnabled,
				regulationEnabled: v ? v.regulationEnabled : p.regulationEnabled,
				presenceEnabled: v ? v.presenceEnabled : p.presenceEnabled,
				activeVersionId: v?.id ?? null,
				activeVersionNumber: v?.versionNumber ?? null,
				activeVersionEffectiveFromDate: v?.effectiveFromDate ?? null,
				isDefault: p.id === defaultPolicyId,
				isActive: p.isActive,
			};
		}),
		schedules: schedules.map((s) => ({
			policyId: s.policyId,
			policyVersionId: s.policyVersionId,
			scheduleCycle: s.scheduleCycle,
			scheduleType: s.scheduleType,
			hoursPerCycle: s.hoursPerCycle,
			homeOfficeDaysPerCycle: s.homeOfficeDaysPerCycle,
			workingDaysPreset: s.workingDaysPreset,
		})),
		scheduleDays: scheduleDays.map((sd) => ({
			scheduleId: sd.scheduleId,
			dayOfWeek: sd.dayOfWeek,
			hoursPerDay: sd.hoursPerDay,
			isWorkDay: sd.isWorkDay,
			cycleWeek: sd.cycleWeek,
			latestClockIn: sd.latestClockIn,
		})),
		regulations: regulations.map((r) => ({
			id: r.id,
			policyId: r.policyId,
			policyVersionId: r.policyVersionId,
			maxDailyMinutes: r.maxDailyMinutes,
			maxWeeklyMinutes: r.maxWeeklyMinutes,
			maxUninterruptedMinutes: r.maxUninterruptedMinutes,
		})),
		breakRules: breakRules.map((br) => ({
			id: br.id,
			regulationId: br.regulationId,
			workingMinutesThreshold: br.workingMinutesThreshold,
			requiredBreakMinutes: br.requiredBreakMinutes,
			sortOrder: br.sortOrder,
		})),
		breakOptions: breakOptions.map((bo) => ({
			breakRuleId: bo.breakRuleId,
			splitCount: bo.splitCount,
			minimumSplitMinutes: bo.minimumSplitMinutes,
			minimumLongestSplitMinutes: bo.minimumLongestSplitMinutes,
			sortOrder: bo.sortOrder,
		})),
		assignments: assignments.map((a) => ({
			policyId: a.policyId,
			assignmentType: a.assignmentType,
			teamId: a.teamId,
			employeeId: a.employeeId,
			priority: a.priority,
			effectiveFrom: a.effectiveFrom?.toISOString() ?? null,
			effectiveUntil: a.effectiveUntil?.toISOString() ?? null,
			effectiveFromDate: a.effectiveFromDate ?? null,
			effectiveUntilDate: a.effectiveUntilDate ?? null,
			isActive: a.isActive,
		})),
	};
}

export interface WorkPolicyAssignmentTargetColumns {
	organizationId: AnyPgColumn;
	assignmentType: AnyPgColumn;
	employeeId: AnyPgColumn;
	teamId: AnyPgColumn;
}

/**
 * Lists work policy assignments reaching an employee (personal, team, or organization)
 * for GDPR personal data exports.
 */
export async function listEmployeeWorkPolicyAssignmentsForPersonalDataExport(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	reachesEmployee: (columns: WorkPolicyAssignmentTargetColumns) => SQL | undefined,
) {
	return db
		.select({
			policy: workPolicy.name,
			assignmentType: workPolicyAssignment.assignmentType,
			teamId: workPolicyAssignment.teamId,
			priority: workPolicyAssignment.priority,
			effectiveFrom: workPolicyAssignment.effectiveFrom,
			effectiveUntil: workPolicyAssignment.effectiveUntil,
			isActive: workPolicyAssignment.isActive,
			createdAt: workPolicyAssignment.createdAt,
			createdBy: workPolicyAssignment.createdBy,
		})
		.from(workPolicyAssignment)
		.innerJoin(
			workPolicy,
			and(
				eq(workPolicy.id, workPolicyAssignment.policyId),
				eq(workPolicy.organizationId, organizationId),
			),
		)
		.where(reachesEmployee(workPolicyAssignment));
}
