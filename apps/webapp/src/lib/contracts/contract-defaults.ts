import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { organization, user } from "@/db/auth-schema";
import {
	contractDefault,
	contractTemplate,
	contractTemplateVersion,
	contractTemplateVersionDay,
	employee,
	employeeEmploymentHistory,
	employeeEmploymentHistoryDay,
	employeeEmploymentPeriod,
	employeeTeamHistory,
	team,
	userSettings,
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
import type {
	BalanceMode,
	ContractDefaultScope,
	PresenceOverride,
	ScheduleSource,
	TemplateScheduleMode,
} from "@/db/schema/contract-types";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { instantFromDate, parsePlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import {
	type ContractWriteTx,
	parseIsoCalendarDate,
	recordWeeklyHoursMismatchConflictInTx,
	resolveRemotePresenceDefault,
	validateAndNormalizeCustomDays,
	validateWeeklyContractMinutes,
} from "./contract-validation";
import { normalizeHoursToMinutes } from "./custom-days";
import {
	type PolicyAssignmentScopeTarget,
	replacePolicyAssignmentWindowInTx,
} from "./policy-assignment-intervals";
import {
	attachPrecomputedScheduleAnchors,
	type ContractDefaultSnapshot,
	type EmploymentHistorySnapshot,
	type EmploymentPeriodSnapshot,
	loadEffectiveContractsBatch,
	type PolicyAssignmentSnapshot,
	resolveEffectiveContractPure,
	type TeamHistoryInterval,
	type WorkPolicySnapshot,
	type WorkPolicyVersionSnapshot,
} from "./resolve-contract";
import type {
	ContractFieldSource,
	CustomWorkDay,
	DayOfWeek,
	EffectiveContractOnDay,
	ResolvedWorkPolicyPresence,
	ResolvedWorkPolicyRegulation,
	ResolvedWorkPolicySchedule,
	WeeklyHoursMismatchWarning,
	WorkModel,
} from "./types";

export interface ScheduleContractDefaultInput {
	readonly organizationId: string;
	readonly actorUserId: string;
	readonly scope: ContractDefaultScope;
	readonly teamId?: string | null;
	readonly effectiveFromDate: string;
	readonly workPolicyId?: string | null;
	readonly weeklyContractMinutes?: number | null;
	readonly scheduleMode?: TemplateScheduleMode;
	readonly customDays?: readonly CustomWorkDay[] | null;
	readonly workModel?: WorkModel | null;
	readonly presenceOverride?: PresenceOverride;
	readonly balanceMode?: BalanceMode;
	readonly scheduleSource?: ScheduleSource;
	readonly now?: Date;
}

export interface ScheduleContractDefaultResult {
	readonly contractDefaultId: string;
	readonly templateId: string;
	readonly templateVersionId: string;
	readonly scope: ContractDefaultScope;
	readonly teamId: string | null;
	readonly effectiveFromDate: string;
	readonly effectiveUntilDate: string | null;
	readonly workPolicyAssignmentId: string | null;
	readonly remoteExemptDefaultApplied: boolean;
	readonly recordedConflictsCount: number;
}

export interface ContractDefaultFieldDiff {
	readonly field:
		| "workPolicy"
		| "weeklyContractMinutes"
		| "scheduleMode"
		| "weeklyScheduleDays"
		| "workModel"
		| "presenceOverride"
		| "presenceStatus"
		| "balanceMode"
		| "scheduleSource";
	readonly before: string | number | null;
	readonly after: string | number | null;
	readonly beforeSource: ContractFieldSource;
	readonly afterSource: ContractFieldSource;
}

export interface ContractDefaultAffectedEmployee {
	readonly employeeId: string;
	readonly firstName: string | null;
	readonly lastName: string | null;
	readonly primaryTeamId: string | null;
	readonly status: "inheriting" | "diverged" | "unchanged";
	readonly changes: readonly ContractDefaultFieldDiff[];
	readonly preservedDivergenceFields: readonly string[];
	readonly mismatchWarning: WeeklyHoursMismatchWarning | null;
}

export interface PreviewContractDefaultChangeResult {
	readonly scope: ContractDefaultScope;
	readonly teamId: string | null;
	readonly effectiveFromDate: string;
	readonly remoteExemptDefaultApplied: boolean;
	readonly totalEvaluated: number;
	readonly inheritingCount: number;
	readonly divergedCount: number;
	readonly unchangedCount: number;
	readonly mismatchWarningCount: number;
	readonly inheritingEmployees: readonly ContractDefaultAffectedEmployee[];
	readonly divergedEmployees: readonly ContractDefaultAffectedEmployee[];
	readonly unchangedEmployees: readonly ContractDefaultAffectedEmployee[];
	readonly mismatchWarnings: readonly {
		readonly employeeId: string;
		readonly firstName: string | null;
		readonly lastName: string | null;
		readonly warning: WeeklyHoursMismatchWarning;
	}[];
}

export interface HydratedContractDefault {
	readonly id: string;
	readonly organizationId: string;
	readonly scope: ContractDefaultScope;
	readonly teamId: string | null;
	readonly teamName: string | null;
	readonly templateId: string;
	readonly templateVersionId: string;
	readonly versionNumber: number;
	readonly effectiveFromDate: string;
	readonly effectiveUntilDate: string | null;
	readonly workPolicyId: string | null;
	readonly workPolicyName: string | null;
	readonly weeklyContractMinutes: number | null;
	readonly scheduleMode: TemplateScheduleMode;
	readonly workModel: WorkModel | null;
	readonly presenceOverride: PresenceOverride;
	readonly balanceMode: BalanceMode;
	readonly scheduleSource: ScheduleSource;
	readonly customDays: readonly CustomWorkDay[];
	readonly createdAt: Date;
	readonly createdBy: string | null;
}

function validateDefaultInput(input: ScheduleContractDefaultInput) {
	const effectiveFromDate = parseIsoCalendarDate(input.effectiveFromDate, "effectiveFromDate");
	const scheduleSource: ScheduleSource = input.scheduleSource ?? "policy";

	if (scheduleSource === "on_call") {
		throw new ValidationError({
			message:
				"On-call schedule source cannot be configured as an organization or primary-team default. Record on-call agreements individually on each employee.",
			field: "scheduleSource",
			refusal: "on_call_default_forbidden",
		});
	}

	if (input.scope === "team" && !input.teamId) {
		throw new ValidationError({
			message: "A primary team is required when scheduling a team default contract.",
			field: "teamId",
			refusal: "team_required",
		});
	}
	if (input.scope === "organization" && input.teamId) {
		throw new ValidationError({
			message: "Organization default contracts cannot specify a teamId.",
			field: "teamId",
			refusal: "unexpected_team_id",
		});
	}

	const scheduleMode: TemplateScheduleMode = input.scheduleMode ?? "policy";
	const weeklyContractMinutes = validateWeeklyContractMinutes(input.weeklyContractMinutes);
	const customDays = validateAndNormalizeCustomDays(scheduleMode, input.customDays);
	const workModel = input.workModel ?? null;
	const { presenceOverride, remoteExemptDefaultApplied } = resolveRemotePresenceDefault({
		workModel,
		presenceOverride: input.presenceOverride,
		fallback: "inherit" as PresenceOverride,
	});
	const balanceMode: BalanceMode = input.balanceMode ?? "tracked";
	const workPolicyId = input.workPolicyId ?? null;

	return {
		scope: input.scope,
		teamId: input.scope === "team" ? (input.teamId ?? null) : null,
		effectiveFromDate,
		workPolicyId,
		weeklyContractMinutes,
		scheduleMode,
		customDays,
		workModel,
		presenceOverride,
		remoteExemptDefaultApplied,
		balanceMode,
		scheduleSource,
	};
}

async function verifyTeamAndPolicyInTx(
	tx: Pick<DatabaseClient, "select"> & Partial<Pick<DatabaseClient, "execute">>,
	organizationId: string,
	teamId: string | null,
	workPolicyId: string | null,
	lockPolicyForShare = false,
): Promise<{ teamName: string | null }> {
	let teamName: string | null = null;
	if (teamId) {
		const [teamRow] = await tx
			.select({ id: team.id, name: team.name })
			.from(team)
			.where(and(eq(team.id, teamId), eq(team.organizationId, organizationId)))
			.limit(1);
		if (!teamRow) {
			throw new NotFoundError({
				message: "Team not found",
				entityType: "team",
				entityId: teamId,
			});
		}
		teamName = teamRow.name;
	}

	if (workPolicyId) {
		// H8 / F9-1: Lock work_policy FOR SHARE in mutating transactions after acquiring advisory +
		// assignment locks so a concurrent policy retirement cannot deactivate the policy mid-write.
		let policyRow: { id: string; isActive: boolean } | undefined;
		if (lockPolicyForShare && tx.execute) {
			const policyRes = await tx.execute<{ id: string; is_active: boolean }>(sql`
				SELECT id, is_active
				FROM work_policy
				WHERE id = ${workPolicyId}::uuid
					AND organization_id = ${organizationId}
				LIMIT 1
				FOR SHARE
			`);
			const raw = policyRes.rows[0];
			if (raw) {
				policyRow = { id: raw.id, isActive: Boolean(raw.is_active) };
			}
		} else {
			const [selected] = await tx
				.select({ id: workPolicy.id, isActive: workPolicy.isActive })
				.from(workPolicy)
				.where(and(eq(workPolicy.id, workPolicyId), eq(workPolicy.organizationId, organizationId)))
				.limit(1);
			policyRow = selected;
		}
		if (!policyRow) {
			throw new NotFoundError({
				message: "Work policy not found",
				entityType: "work_policy",
				entityId: workPolicyId,
			});
		}
		if (!policyRow.isActive) {
			throw new ValidationError({
				message: "Inactive work policies cannot be assigned to a default contract.",
				field: "workPolicyId",
				refusal: "work_policy_inactive",
			});
		}
	}

	return { teamName };
}

function buildOrgDefaultsAdvisoryLockKey(organizationId: string): string {
	return `contract_default_org:${organizationId}`;
}

function buildScopeAdvisoryLockKey(
	organizationId: string,
	scope: ContractDefaultScope,
	teamId: string | null,
): string {
	return `contract_default:${organizationId}:${scope}:${teamId ?? ""}`;
}

/**
 * Creates or schedules a date-effective Organization or Primary Team default contract
 * inside the caller's transaction. Acts as the SOLE writer of org/team
 * `work_policy_assignment` write-through rows (`source_kind = 'contract_default'`),
 * and records `contract_migration_conflict` entries when the change introduces a
 * weekly-hours vs. detailed-policy day-sum mismatch for any active employee.
 */
export async function scheduleContractDefaultInTx(
	tx: ContractWriteTx,
	input: ScheduleContractDefaultInput,
): Promise<ScheduleContractDefaultResult> {
	const validated = validateDefaultInput(input);
	const now = input.now ?? currentTimestamp();

	// Universal deadlock-free lock order (H8 / F9-1 / M3 / M4 / Astra #2):
	// (0) org defaults advisory lock (SHARED here, EXCLUSIVE in policy retirement)
	// (1) scope advisory lock (EXCLUSIVE for this org/scope/team)
	// (2) candidate employees ORDER BY id FOR KEY SHARE (before assignments/policy so Step 4's
	//     contract_migration_conflict FK inserts can never invert employee <-> assignment order!)
	// (3) active work_policy_assignment rows for this scope ORDER BY id FOR UPDATE
	// (4) work_policy row FOR SHARE
	const orgLockKey = buildOrgDefaultsAdvisoryLockKey(input.organizationId);
	await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtext(${orgLockKey}))`);

	const lockKey = buildScopeAdvisoryLockKey(
		input.organizationId,
		validated.scope,
		validated.teamId,
	);
	await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
	// Level (1.5): Lock organization FOR KEY SHARE before locking employees/assignments so FK
	// inserts on contract_template / contract_default never invert organization <-> employee/assignment.
	await tx.execute(sql`
		SELECT id
		FROM organization
		WHERE id = ${input.organizationId}
		FOR KEY SHARE
	`);

	const candidateEmployees =
		validated.workPolicyId !== null
			? await tx
					.select({ id: employee.id })
					.from(employee)
					.where(
						and(
							onCurrentRoster(input.organizationId),
							...(validated.scope === "team" && validated.teamId
								? [eq(employee.teamId, validated.teamId)]
								: []),
						),
					)
					.orderBy(asc(employee.id))
					.for("key share", { of: employee })
			: [];

	const assignmentTarget: PolicyAssignmentScopeTarget =
		validated.scope === "team" && validated.teamId
			? { assignmentType: "team", teamId: validated.teamId, employeeId: null, priority: 1 }
			: { assignmentType: "organization", teamId: null, employeeId: null, priority: 0 };

	if (assignmentTarget.assignmentType === "team") {
		await tx.execute(sql`
			SELECT id
			FROM work_policy_assignment
			WHERE organization_id = ${input.organizationId}
				AND assignment_type = 'team'
				AND team_id = ${assignmentTarget.teamId}::uuid
				AND is_active = true
			ORDER BY id
			FOR UPDATE
		`);
	} else {
		await tx.execute(sql`
			SELECT id
			FROM work_policy_assignment
			WHERE organization_id = ${input.organizationId}
				AND assignment_type = 'organization'
				AND team_id IS NULL
				AND is_active = true
			ORDER BY id
			FOR UPDATE
		`);
	}

	const { teamName } = await verifyTeamAndPolicyInTx(
		tx,
		input.organizationId,
		validated.teamId,
		validated.workPolicyId,
		true,
	);

	// 1. Reuse or create the backing template container (`kind = 'default_backing'`).
	const backingName =
		validated.scope === "organization"
			? "__default_backing:organization"
			: `__default_backing:team:${validated.teamId}`;

	let [backingTemplate] = await tx
		.select({ id: contractTemplate.id })
		.from(contractTemplate)
		.where(
			and(
				eq(contractTemplate.organizationId, input.organizationId),
				eq(contractTemplate.kind, "default_backing"),
				eq(contractTemplate.name, backingName),
			),
		)
		.limit(1);

	if (!backingTemplate) {
		const [createdTemplate] = await tx
			.insert(contractTemplate)
			.values({
				organizationId: input.organizationId,
				name: backingName,
				description:
					validated.scope === "organization"
						? "Organization default contract"
						: `Primary team default contract (${teamName ?? validated.teamId})`,
				kind: "default_backing",
				isActive: true,
				createdBy: input.actorUserId,
				updatedBy: input.actorUserId,
				updatedAt: now,
			})
			.returning({ id: contractTemplate.id });
		if (!createdTemplate) {
			throw new Error("contract_template insert returned no row");
		}
		backingTemplate = createdTemplate;
	}

	const [latestVersion] = await tx
		.select({ versionNumber: contractTemplateVersion.versionNumber })
		.from(contractTemplateVersion)
		.where(
			and(
				eq(contractTemplateVersion.organizationId, input.organizationId),
				eq(contractTemplateVersion.templateId, backingTemplate.id),
			),
		)
		.orderBy(desc(contractTemplateVersion.versionNumber))
		.limit(1);

	const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;

	const [templateVersion] = await tx
		.insert(contractTemplateVersion)
		.values({
			organizationId: input.organizationId,
			templateId: backingTemplate.id,
			versionNumber: nextVersionNumber,
			workPolicyId: validated.workPolicyId,
			weeklyContractMinutes: validated.weeklyContractMinutes,
			scheduleMode: validated.scheduleMode,
			workModel: validated.workModel,
			presenceOverride: validated.presenceOverride,
			balanceMode: validated.balanceMode,
			scheduleSource: validated.scheduleSource,
			createdBy: input.actorUserId,
		})
		.returning({ id: contractTemplateVersion.id });

	if (!templateVersion) {
		throw new Error("contract_template_version insert returned no row");
	}

	if (validated.customDays.length > 0) {
		await tx.insert(contractTemplateVersionDay).values(
			validated.customDays.map((day) => ({
				organizationId: input.organizationId,
				templateVersionId: templateVersion.id,
				dayOfWeek: day.dayOfWeek,
				minutesPerDay: day.minutesPerDay,
				isWorkDay: day.isWorkDay,
				latestClockIn: day.latestClockIn,
			})),
		);
	}

	// 2. Reconcile active `contract_default` timeline for (org, scope, teamId).
	const scopeWhere =
		validated.scope === "team" && validated.teamId
			? and(
					eq(contractDefault.organizationId, input.organizationId),
					eq(contractDefault.scope, "team"),
					eq(contractDefault.teamId, validated.teamId),
					eq(contractDefault.isActive, true),
				)
			: and(
					eq(contractDefault.organizationId, input.organizationId),
					eq(contractDefault.scope, "organization"),
					isNull(contractDefault.teamId),
					eq(contractDefault.isActive, true),
				);

	const activeDefaults = await tx
		.select()
		.from(contractDefault)
		.where(scopeWhere)
		.orderBy(asc(contractDefault.effectiveFromDate));

	const sameStart = activeDefaults.filter(
		(row) => row.effectiveFromDate === validated.effectiveFromDate,
	);
	for (const replaced of sameStart) {
		await tx
			.update(contractDefault)
			.set({
				isActive: false,
				updatedBy: input.actorUserId,
				updatedAt: now,
			})
			.where(
				and(
					eq(contractDefault.id, replaced.id),
					eq(contractDefault.organizationId, input.organizationId),
				),
			);
	}

	const remaining = activeDefaults.filter(
		(row) => row.effectiveFromDate !== validated.effectiveFromDate,
	);
	const previous = remaining
		.filter((row) => row.effectiveFromDate < validated.effectiveFromDate)
		.at(-1);
	const following = remaining.find((row) => row.effectiveFromDate > validated.effectiveFromDate);

	if (
		previous &&
		(previous.effectiveUntilDate === null ||
			previous.effectiveUntilDate > validated.effectiveFromDate)
	) {
		await tx
			.update(contractDefault)
			.set({
				effectiveUntilDate: validated.effectiveFromDate,
				updatedBy: input.actorUserId,
				updatedAt: now,
			})
			.where(
				and(
					eq(contractDefault.id, previous.id),
					eq(contractDefault.organizationId, input.organizationId),
				),
			);
	}

	const effectiveUntilDate = following?.effectiveFromDate ?? null;

	const [insertedDefault] = await tx
		.insert(contractDefault)
		.values({
			organizationId: input.organizationId,
			scope: validated.scope,
			teamId: validated.teamId,
			templateVersionId: templateVersion.id,
			requireDefaultEligible: true,
			effectiveFromDate: validated.effectiveFromDate,
			effectiveUntilDate,
			isActive: true,
			createdBy: input.actorUserId,
			updatedBy: input.actorUserId,
			updatedAt: now,
		})
		.returning({ id: contractDefault.id });

	if (!insertedDefault) {
		throw new Error("contract_default insert returned no row");
	}

	// 3. Write-through canonical org/team `work_policy_assignment` row(s) honoring 0322 btree_gist.
	const writeThroughAssignment = await replacePolicyAssignmentWindowInTx(tx, {
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		target: assignmentTarget,
		policyId: validated.workPolicyId,
		effectiveFromDate: validated.effectiveFromDate,
		effectiveUntilDate,
		sourceKind: "contract_default",
		sourceContractDefaultId: insertedDefault.id,
		now,
	});

	// 4. Record `contract_migration_conflict` ONLY on mutating write paths when this default
	//    introduces a weekly-hours vs. detailed-policy day-sum mismatch for any active employee
	//    (reusing `candidateEmployees` pre-locked FOR KEY SHARE at level (2)).
	let recordedConflictsCount = 0;
	if (candidateEmployees.length > 0 && validated.workPolicyId !== null) {
		const contracts = await loadEffectiveContractsBatch(tx, {
			organizationId: input.organizationId,
			employeeIds: candidateEmployees.map((e) => e.id),
			dates: [validated.effectiveFromDate],
		});
		for (const emp of candidateEmployees) {
			const effective = contracts.get(emp.id)?.get(validated.effectiveFromDate);
			if (effective?.mismatchWarning) {
				const inserted = await recordWeeklyHoursMismatchConflictInTx(tx, {
					organizationId: input.organizationId,
					employeeId: emp.id,
					employmentHistoryId: effective.employmentHistoryId,
					warning: effective.mismatchWarning,
					triggerSource: "contract_default",
					effectiveFromDate: validated.effectiveFromDate,
					contractDefaultId: insertedDefault.id,
				});
				if (inserted) {
					recordedConflictsCount += 1;
				}
			}
		}
	}

	return {
		contractDefaultId: insertedDefault.id,
		templateId: backingTemplate.id,
		templateVersionId: templateVersion.id,
		scope: validated.scope,
		teamId: validated.teamId,
		effectiveFromDate: validated.effectiveFromDate,
		effectiveUntilDate,
		workPolicyAssignmentId: writeThroughAssignment?.id ?? null,
		remoteExemptDefaultApplied: validated.remoteExemptDefaultApplied,
		recordedConflictsCount,
	};
}

/**
 * Transaction-owning entry point for scheduling an Organization or Primary Team default contract.
 */
export async function scheduleContractDefault(
	db: DatabaseClient,
	input: ScheduleContractDefaultInput,
): Promise<ScheduleContractDefaultResult> {
	return db.transaction((tx) => scheduleContractDefaultInTx(tx, input));
}

export interface ScheduleContractDefaultPolicyUpdateInput {
	readonly organizationId: string;
	readonly actorUserId: string;
	readonly scope: ContractDefaultScope;
	readonly teamId?: string | null;
	readonly effectiveFromDate: string;
	readonly workPolicyId: string;
	readonly now?: Date;
}

/**
 * Updates only the `workPolicyId` of an organization or primary-team default contract
 * effective on `effectiveFromDate`, carrying forward every operational field (`weeklyContractMinutes`,
 * `scheduleMode`, `customDays`, `workModel`, `presenceOverride`, `balanceMode`, `scheduleSource`)
 * from the active default in force on that date so no existing default terms are silently wiped.
 */
export async function scheduleContractDefaultPolicyUpdateInTx(
	tx: ContractWriteTx,
	input: ScheduleContractDefaultPolicyUpdateInput,
): Promise<ScheduleContractDefaultResult> {
	const effectiveFromDate = parseIsoCalendarDate(input.effectiveFromDate, "effectiveFromDate");
	const teamId = input.scope === "team" ? (input.teamId ?? null) : null;
	// Acquire (0 shared) BEFORE (1 scope) to preserve universal lock order when calling scheduleContractDefaultInTx.
	const orgLockKey = buildOrgDefaultsAdvisoryLockKey(input.organizationId);
	await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtext(${orgLockKey}))`);
	const lockKey = buildScopeAdvisoryLockKey(input.organizationId, input.scope, teamId);
	await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

	const loadActiveDefaultForScope = async (
		targetScope: ContractDefaultScope,
		targetTeamId: string | null,
	) => {
		const scopeWhere =
			targetScope === "team" && targetTeamId
				? and(
						eq(contractDefault.organizationId, input.organizationId),
						eq(contractDefault.scope, "team"),
						eq(contractDefault.teamId, targetTeamId),
						eq(contractDefault.isActive, true),
					)
				: and(
						eq(contractDefault.organizationId, input.organizationId),
						eq(contractDefault.scope, "organization"),
						isNull(contractDefault.teamId),
						eq(contractDefault.isActive, true),
					);

		const activeDefaults = await tx
			.select({
				id: contractDefault.id,
				templateVersionId: contractDefault.templateVersionId,
				effectiveFromDate: contractDefault.effectiveFromDate,
				effectiveUntilDate: contractDefault.effectiveUntilDate,
				createdAt: contractDefault.createdAt,
			})
			.from(contractDefault)
			.where(scopeWhere);

		return activeDefaults
			.filter(
				(row) =>
					row.effectiveFromDate <= effectiveFromDate &&
					(row.effectiveUntilDate === null || row.effectiveUntilDate > effectiveFromDate),
			)
			.sort((a, b) => {
				if (b.effectiveFromDate !== a.effectiveFromDate) {
					return b.effectiveFromDate.localeCompare(a.effectiveFromDate);
				}
				const createdCmp = b.createdAt.getTime() - a.createdAt.getTime();
				if (createdCmp !== 0) return createdCmp;
				return b.id.localeCompare(a.id);
			})[0];
	};

	// When scheduling a team-scope policy update and no team default exists yet on `effectiveFromDate`,
	// fall back to the active organization default ONLY for non-nullable schema fields that a team
	// default cannot leave to inherit (`scheduleMode` + `customDays`, `balanceMode`, `scheduleSource`).
	// Leave nullable/inheritable fields (`weeklyContractMinutes: null`, `workModel: null`,
	// `presenceOverride: "inherit"`) unset so future org-default updates keep flowing through and
	// field provenance continues to report `org_default`.
	const sameScopeDefault = await loadActiveDefaultForScope(input.scope, teamId);
	const inheritedOrgFallback =
		!sameScopeDefault && input.scope === "team"
			? await loadActiveDefaultForScope("organization", null)
			: undefined;
	const sourceDefault = sameScopeDefault ?? inheritedOrgFallback;

	let carriedFields: Partial<ScheduleContractDefaultInput> = {};
	if (sourceDefault) {
		const [tplVersion] = await tx
			.select()
			.from(contractTemplateVersion)
			.where(
				and(
					eq(contractTemplateVersion.id, sourceDefault.templateVersionId),
					eq(contractTemplateVersion.organizationId, input.organizationId),
				),
			)
			.limit(1);

		if (tplVersion) {
			const dayRows =
				tplVersion.scheduleMode === "custom_days"
					? await tx
							.select()
							.from(contractTemplateVersionDay)
							.where(
								and(
									eq(contractTemplateVersionDay.organizationId, input.organizationId),
									eq(contractTemplateVersionDay.templateVersionId, tplVersion.id),
								),
							)
					: [];

			const nonNullableFields: Partial<ScheduleContractDefaultInput> = {
				scheduleMode: tplVersion.scheduleMode as TemplateScheduleMode,
				customDays:
					tplVersion.scheduleMode === "custom_days"
						? dayRows.map((d) => ({
								dayOfWeek: d.dayOfWeek as DayOfWeek,
								minutesPerDay: d.minutesPerDay,
								isWorkDay: d.isWorkDay,
								latestClockIn: d.latestClockIn,
							}))
						: undefined,
				balanceMode: tplVersion.balanceMode as BalanceMode,
				scheduleSource: tplVersion.scheduleSource as ScheduleSource,
			};

			carriedFields = sameScopeDefault
				? {
						...nonNullableFields,
						weeklyContractMinutes: tplVersion.weeklyContractMinutes,
						workModel: tplVersion.workModel as WorkModel | null,
						presenceOverride: tplVersion.presenceOverride as PresenceOverride,
					}
				: {
						...nonNullableFields,
						weeklyContractMinutes: null,
						workModel: null,
						presenceOverride: "inherit",
					};
		}
	}

	return scheduleContractDefaultInTx(tx, {
		...carriedFields,
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		scope: input.scope,
		teamId,
		effectiveFromDate,
		workPolicyId: input.workPolicyId,
		now: input.now,
	});
}

export async function scheduleContractDefaultPolicyUpdate(
	db: DatabaseClient,
	input: ScheduleContractDefaultPolicyUpdateInput,
): Promise<ScheduleContractDefaultResult> {
	return db.transaction((tx) => scheduleContractDefaultPolicyUpdateInTx(tx, input));
}

const CANONICAL_DAY_ORDER: readonly DayOfWeek[] = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
];

function serializeWeeklyScheduleGrid(
	days: readonly {
		readonly dayOfWeek: DayOfWeek;
		readonly isWorkDay: boolean;
		readonly minutesPerDay: number;
		readonly latestClockIn: string | null;
	}[],
): string {
	if (days.length === 0) return "";
	const byDay = new Map(days.map((d) => [d.dayOfWeek, d]));
	return CANONICAL_DAY_ORDER.map((day) => {
		const row = byDay.get(day);
		if (!row) return `${day}:0:0:`;
		return `${day}:${row.isWorkDay ? 1 : 0}:${row.minutesPerDay}:${row.latestClockIn ?? ""}`;
	}).join("|");
}

function diffOperationalContracts(
	before: EffectiveContractOnDay,
	after: EffectiveContractOnDay,
): {
	changes: ContractDefaultFieldDiff[];
	preservedDivergenceFields: string[];
} {
	const beforeGrid = serializeWeeklyScheduleGrid(before.weeklyScheduleDays);
	const afterGrid = serializeWeeklyScheduleGrid(after.weeklyScheduleDays);

	const comparisons: {
		field: ContractDefaultFieldDiff["field"];
		beforeVal: string | number | null;
		afterVal: string | number | null;
		beforeSource: ContractFieldSource;
		afterSource: ContractFieldSource;
	}[] = [
		{
			field: "workPolicy",
			beforeVal: before.workPolicy?.policyId ?? null,
			afterVal: after.workPolicy?.policyId ?? null,
			beforeSource: before.workPolicySource,
			afterSource: after.workPolicySource,
		},
		{
			field: "weeklyContractMinutes",
			beforeVal: before.weeklyContractMinutes,
			afterVal: after.weeklyContractMinutes,
			beforeSource: before.weeklyContractMinutesSource,
			afterSource: after.weeklyContractMinutesSource,
		},
		{
			field: "scheduleMode",
			beforeVal: before.scheduleMode,
			afterVal: after.scheduleMode,
			beforeSource: before.scheduleModeSource,
			afterSource: after.scheduleModeSource,
		},
		{
			field: "weeklyScheduleDays",
			beforeVal: beforeGrid || null,
			afterVal: afterGrid || null,
			beforeSource: before.scheduleModeSource,
			afterSource: after.scheduleModeSource,
		},
		{
			field: "workModel",
			beforeVal: before.workModel,
			afterVal: after.workModel,
			beforeSource: before.workModelSource,
			afterSource: after.workModelSource,
		},
		{
			field: "presenceOverride",
			beforeVal: before.presenceOverride,
			afterVal: after.presenceOverride,
			beforeSource: before.presenceOverrideSource,
			afterSource: after.presenceOverrideSource,
		},
		{
			field: "presenceStatus",
			beforeVal: before.presenceStatus,
			afterVal: after.presenceStatus,
			beforeSource: before.presenceOverrideSource,
			afterSource: after.presenceOverrideSource,
		},
		{
			field: "balanceMode",
			beforeVal: before.balanceMode,
			afterVal: after.balanceMode,
			beforeSource: before.balanceModeSource,
			afterSource: after.balanceModeSource,
		},
		{
			field: "scheduleSource",
			beforeVal: before.scheduleSource,
			afterVal: after.scheduleSource,
			beforeSource: before.scheduleSourceSource,
			afterSource: after.scheduleSourceSource,
		},
	];

	const changes: ContractDefaultFieldDiff[] = [];
	const preservedDivergenceFields: string[] = [];

	for (const entry of comparisons) {
		if (entry.beforeVal !== entry.afterVal) {
			changes.push({
				field: entry.field,
				before: entry.beforeVal,
				after: entry.afterVal,
				beforeSource: entry.beforeSource,
				afterSource: entry.afterSource,
			});
		} else if (
			entry.field !== "presenceStatus" &&
			entry.field !== "weeklyScheduleDays" &&
			entry.afterSource === "employee_override"
		) {
			preservedDivergenceFields.push(entry.field);
		}
	}

	return { changes, preservedDivergenceFields };
}

function parseFixedDaysJson(raw: string | null): readonly DayOfWeek[] | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as DayOfWeek[]) : null;
	} catch {
		return null;
	}
}

/**
 * Strictly read-only preview of an Organization or Primary Team default contract change.
 * Performs ZERO database writes (never inserts `contract_migration_conflict`) and separates
 * employees who inherit changes vs. employees who keep personal divergences.
 */
export async function previewContractDefaultChange(
	db: Pick<DatabaseClient, "select">,
	input: Omit<ScheduleContractDefaultInput, "actorUserId" | "now">,
): Promise<PreviewContractDefaultChangeResult> {
	const validated = validateDefaultInput({ ...input, actorUserId: "preview" });
	await verifyTeamAndPolicyInTx(db, input.organizationId, validated.teamId, validated.workPolicyId);

	const employeeRows = await db
		.select({
			id: employee.id,
			firstName: user.firstName,
			lastName: user.lastName,
			teamId: employee.teamId,
			userId: employee.userId,
			contractType: employee.contractType,
			userTimezone: userSettings.timezone,
		})
		.from(employee)
		.leftJoin(user, eq(user.id, employee.userId))
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
		.where(
			and(
				onCurrentRoster(input.organizationId),
				...(validated.scope === "team" && validated.teamId
					? [eq(employee.teamId, validated.teamId)]
					: []),
			),
		);

	if (employeeRows.length === 0) {
		return {
			scope: validated.scope,
			teamId: validated.teamId,
			effectiveFromDate: validated.effectiveFromDate,
			remoteExemptDefaultApplied: validated.remoteExemptDefaultApplied,
			totalEvaluated: 0,
			inheritingCount: 0,
			divergedCount: 0,
			unchangedCount: 0,
			mismatchWarningCount: 0,
			inheritingEmployees: [],
			divergedEmployees: [],
			unchangedEmployees: [],
			mismatchWarnings: [],
		};
	}

	const employeeIds = employeeRows.map((e) => e.id);
	const targetDate = parsePlainDate(validated.effectiveFromDate);

	const [[orgRow], periodRows, teamHistoryRows, termsRows, defaultRows, assignmentRows] =
		await Promise.all([
			db
				.select({ timezone: organization.timezone })
				.from(organization)
				.where(eq(organization.id, input.organizationId))
				.limit(1),
			db
				.select({
					id: employeeEmploymentPeriod.id,
					employeeId: employeeEmploymentPeriod.employeeId,
					status: employeeEmploymentPeriod.status,
					startedAt: employeeEmploymentPeriod.startedAt,
					startProvenance: employeeEmploymentPeriod.startProvenance,
					endedAt: employeeEmploymentPeriod.endedAt,
					createdAt: employeeEmploymentPeriod.createdAt,
				})
				.from(employeeEmploymentPeriod)
				.where(
					and(
						eq(employeeEmploymentPeriod.organizationId, input.organizationId),
						inArray(employeeEmploymentPeriod.employeeId, employeeIds),
					),
				),
			db
				.select({
					id: employeeTeamHistory.id,
					employeeId: employeeTeamHistory.employeeId,
					teamId: employeeTeamHistory.teamId,
					effectiveFrom: employeeTeamHistory.effectiveFrom,
					effectiveTo: employeeTeamHistory.effectiveTo,
				})
				.from(employeeTeamHistory)
				.where(
					and(
						eq(employeeTeamHistory.organizationId, input.organizationId),
						inArray(employeeTeamHistory.employeeId, employeeIds),
					),
				),
			db
				.select()
				.from(employeeEmploymentHistory)
				.where(
					and(
						eq(employeeEmploymentHistory.organizationId, input.organizationId),
						inArray(employeeEmploymentHistory.employeeId, employeeIds),
						eq(employeeEmploymentHistory.reviewState, "confirmed"),
					),
				)
				.orderBy(
					asc(employeeEmploymentHistory.validFrom),
					asc(employeeEmploymentHistory.createdAt),
				),
			db
				.select({
					id: contractDefault.id,
					scope: contractDefault.scope,
					teamId: contractDefault.teamId,
					templateVersionId: contractDefault.templateVersionId,
					effectiveFromDate: contractDefault.effectiveFromDate,
					effectiveUntilDate: contractDefault.effectiveUntilDate,
					createdAt: contractDefault.createdAt,
					workPolicyId: contractTemplateVersion.workPolicyId,
					weeklyContractMinutes: contractTemplateVersion.weeklyContractMinutes,
					scheduleMode: contractTemplateVersion.scheduleMode,
					workModel: contractTemplateVersion.workModel,
					presenceOverride: contractTemplateVersion.presenceOverride,
					balanceMode: contractTemplateVersion.balanceMode,
					scheduleSource: contractTemplateVersion.scheduleSource,
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
						eq(contractDefault.organizationId, input.organizationId),
						eq(contractDefault.isActive, true),
					),
				),
			db
				.select({
					id: workPolicyAssignment.id,
					policyId: workPolicyAssignment.policyId,
					assignmentType: workPolicyAssignment.assignmentType,
					teamId: workPolicyAssignment.teamId,
					employeeId: workPolicyAssignment.employeeId,
					priority: workPolicyAssignment.priority,
					sourceKind: workPolicyAssignment.sourceKind,
					sourceEmploymentHistoryId: workPolicyAssignment.sourceEmploymentHistoryId,
					sourceEmploymentPeriodId: employeeEmploymentHistory.employmentPeriodId,
					isActive: workPolicyAssignment.isActive,
					effectiveFrom: workPolicyAssignment.effectiveFrom,
					effectiveUntil: workPolicyAssignment.effectiveUntil,
					effectiveFromDate: workPolicyAssignment.effectiveFromDate,
					effectiveUntilDate: workPolicyAssignment.effectiveUntilDate,
					createdAt: workPolicyAssignment.createdAt,
				})
				.from(workPolicyAssignment)
				.leftJoin(
					employeeEmploymentHistory,
					and(
						eq(employeeEmploymentHistory.id, workPolicyAssignment.sourceEmploymentHistoryId),
						eq(employeeEmploymentHistory.organizationId, workPolicyAssignment.organizationId),
					),
				)
				.where(
					and(
						eq(workPolicyAssignment.organizationId, input.organizationId),
						or(
							eq(workPolicyAssignment.isActive, true),
							and(
								eq(workPolicyAssignment.assignmentType, "employee"),
								eq(workPolicyAssignment.sourceKind, "employment_terms"),
							),
						),
					),
				),
		]);

	const orgTimezone = orgRow?.timezone ?? "UTC";
	const historyIds = termsRows.map((r) => r.id);
	const templateVersionIds = [...new Set(defaultRows.map((r) => r.templateVersionId))];
	const referencedTeamIds = [
		...new Set([
			...teamHistoryRows.map((r) => r.teamId),
			...defaultRows.flatMap((r) => (r.teamId ? [r.teamId] : [])),
			...(validated.teamId ? [validated.teamId] : []),
		]),
	];
	const referencedPolicyIds = [
		...new Set([
			...termsRows.flatMap((r) => (r.workPolicyId ? [r.workPolicyId] : [])),
			...defaultRows.flatMap((r) => (r.workPolicyId ? [r.workPolicyId] : [])),
			...assignmentRows.map((r) => r.policyId),
			...(validated.workPolicyId ? [validated.workPolicyId] : []),
		]),
	];

	const [historyDayRows, templateDayRows, referencedTeams, policyRows, versionRows] =
		await Promise.all([
			historyIds.length > 0
				? db
						.select()
						.from(employeeEmploymentHistoryDay)
						.where(
							and(
								eq(employeeEmploymentHistoryDay.organizationId, input.organizationId),
								inArray(employeeEmploymentHistoryDay.employmentHistoryId, historyIds),
							),
						)
				: Promise.resolve([]),
			templateVersionIds.length > 0
				? db
						.select()
						.from(contractTemplateVersionDay)
						.where(
							and(
								eq(contractTemplateVersionDay.organizationId, input.organizationId),
								inArray(contractTemplateVersionDay.templateVersionId, templateVersionIds),
							),
						)
				: Promise.resolve([]),
			referencedTeamIds.length > 0
				? db
						.select({ id: team.id, organizationId: team.organizationId, name: team.name })
						.from(team)
						.where(inArray(team.id, referencedTeamIds))
				: Promise.resolve([]),
			referencedPolicyIds.length > 0
				? db
						.select()
						.from(workPolicy)
						.where(
							and(
								eq(workPolicy.organizationId, input.organizationId),
								inArray(workPolicy.id, referencedPolicyIds),
							),
						)
				: Promise.resolve([]),
			referencedPolicyIds.length > 0
				? db
						.select()
						.from(workPolicyVersion)
						.where(
							and(
								eq(workPolicyVersion.organizationId, input.organizationId),
								inArray(workPolicyVersion.policyId, referencedPolicyIds),
							),
						)
				: Promise.resolve([]),
		]);

	const versionIds = versionRows.map((v) => v.id);
	const [scheduleRows, regulationRows, presenceRows] = await Promise.all([
		versionIds.length > 0
			? db
					.select()
					.from(workPolicySchedule)
					.where(inArray(workPolicySchedule.policyVersionId, versionIds))
			: Promise.resolve([]),
		versionIds.length > 0
			? db
					.select()
					.from(workPolicyRegulation)
					.where(inArray(workPolicyRegulation.policyVersionId, versionIds))
			: Promise.resolve([]),
		versionIds.length > 0
			? db
					.select()
					.from(workPolicyPresence)
					.where(inArray(workPolicyPresence.policyVersionId, versionIds))
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
			: Promise.resolve([]),
	]);

	const breakRuleIds = breakRuleRows.map((r) => r.id);
	const breakOptionRows =
		breakRuleIds.length > 0
			? await db
					.select()
					.from(workPolicyBreakOption)
					.where(inArray(workPolicyBreakOption.breakRuleId, breakRuleIds))
			: [];

	const validOrgTeamIds = new Set<string>();
	const foreignTeamIds = new Set<string>();
	const teamNames = new Map<string, string>();
	for (const t of referencedTeams) {
		if (t.organizationId === input.organizationId) {
			validOrgTeamIds.add(t.id);
			teamNames.set(t.id, t.name);
		} else {
			foreignTeamIds.add(t.id);
		}
	}

	const historyDaysByHistoryId = new Map<string, CustomWorkDay[]>();
	for (const row of historyDayRows) {
		const list = historyDaysByHistoryId.get(row.employmentHistoryId) ?? [];
		list.push({
			dayOfWeek: row.dayOfWeek,
			minutesPerDay: row.minutesPerDay,
			isWorkDay: row.isWorkDay,
			latestClockIn: row.latestClockIn,
		});
		historyDaysByHistoryId.set(row.employmentHistoryId, list);
	}

	const templateDaysByVersionId = new Map<string, CustomWorkDay[]>();
	for (const row of templateDayRows) {
		const list = templateDaysByVersionId.get(row.templateVersionId) ?? [];
		list.push({
			dayOfWeek: row.dayOfWeek,
			minutesPerDay: row.minutesPerDay,
			isWorkDay: row.isWorkDay,
			latestClockIn: row.latestClockIn,
		});
		templateDaysByVersionId.set(row.templateVersionId, list);
	}

	const scheduleDaysByScheduleId = Map.groupBy(scheduleDayRows, (d) => d.scheduleId);
	const breakOptionsByRuleId = Map.groupBy(breakOptionRows, (o) => o.breakRuleId);
	const breakRulesByRegulationId = Map.groupBy(breakRuleRows, (r) => r.regulationId);

	const scheduleByVersionId = new Map<string, ResolvedWorkPolicySchedule>();
	for (const row of scheduleRows) {
		scheduleByVersionId.set(row.policyVersionId, {
			id: row.id,
			scheduleCycle: row.scheduleCycle,
			scheduleType: row.scheduleType,
			workingDaysPreset: row.workingDaysPreset,
			hoursPerCycle: row.hoursPerCycle,
			normalizedCycleMinutes: normalizeHoursToMinutes(row.hoursPerCycle),
			homeOfficeDaysPerCycle: row.homeOfficeDaysPerCycle ?? 0,
			days: (scheduleDaysByScheduleId.get(row.id) ?? []).map((day) => ({
				dayOfWeek: day.dayOfWeek,
				hoursPerDay: day.hoursPerDay,
				minutesPerDay: normalizeHoursToMinutes(day.hoursPerDay) ?? 0,
				isWorkDay: day.isWorkDay,
				cycleWeek: day.cycleWeek ?? 1,
				latestClockIn: day.latestClockIn ?? null,
			})),
		});
	}

	const regulationByVersionId = new Map<string, ResolvedWorkPolicyRegulation>();
	for (const row of regulationRows) {
		regulationByVersionId.set(row.policyVersionId, {
			id: row.id,
			maxDailyMinutes: row.maxDailyMinutes,
			maxWeeklyMinutes: row.maxWeeklyMinutes,
			maxUninterruptedMinutes: row.maxUninterruptedMinutes,
			minRestPeriodMinutes: row.minRestPeriodMinutes,
			restPeriodEnforcement: row.restPeriodEnforcement ?? "warn",
			overtimeDailyThresholdMinutes: row.overtimeDailyThresholdMinutes,
			overtimeWeeklyThresholdMinutes: row.overtimeWeeklyThresholdMinutes,
			overtimeMonthlyThresholdMinutes: row.overtimeMonthlyThresholdMinutes,
			alertBeforeLimitMinutes: row.alertBeforeLimitMinutes ?? 30,
			alertThresholdPercent: row.alertThresholdPercent ?? 80,
			breakRules: (breakRulesByRegulationId.get(row.id) ?? [])
				.sort((a, b) => a.sortOrder - b.sortOrder)
				.map((rule) => ({
					id: rule.id,
					workingMinutesThreshold: rule.workingMinutesThreshold,
					requiredBreakMinutes: rule.requiredBreakMinutes,
					options: (breakOptionsByRuleId.get(rule.id) ?? [])
						.sort((a, b) => a.sortOrder - b.sortOrder)
						.map((opt) => ({
							splitCount: opt.splitCount,
							minimumSplitMinutes: opt.minimumSplitMinutes,
							minimumLongestSplitMinutes: opt.minimumLongestSplitMinutes,
						})),
				})),
		});
	}

	const presenceByVersionId = new Map<string, ResolvedWorkPolicyPresence>();
	for (const row of presenceRows) {
		presenceByVersionId.set(row.policyVersionId, {
			id: row.id,
			presenceMode: row.presenceMode,
			requiredOnsiteDays: row.requiredOnsiteDays,
			requiredOnsiteFixedDays: parseFixedDaysJson(row.requiredOnsiteFixedDays),
			locationId: row.locationId,
			evaluationPeriod: row.evaluationPeriod,
			enforcement: row.enforcement,
		});
	}

	const versionsByPolicyId = new Map<string, WorkPolicyVersionSnapshot[]>();
	for (const v of versionRows) {
		const list = versionsByPolicyId.get(v.policyId) ?? [];
		list.push({
			id: v.id,
			policyId: v.policyId,
			versionNumber: v.versionNumber,
			effectiveFromDate: v.effectiveFromDate,
			scheduleEnabled: v.scheduleEnabled,
			regulationEnabled: v.regulationEnabled,
			presenceEnabled: v.presenceEnabled,
			schedule: scheduleByVersionId.get(v.id) ?? null,
			regulation: regulationByVersionId.get(v.id) ?? null,
			presence: presenceByVersionId.get(v.id) ?? null,
		});
		versionsByPolicyId.set(v.policyId, list);
	}

	const policiesById = new Map<string, WorkPolicySnapshot>();
	for (const p of policyRows) {
		policiesById.set(p.id, {
			id: p.id,
			name: p.name,
			isActive: p.isActive,
			retiredOnDate:
				!p.isActive && p.updatedAt
					? plainDateAt(instantFromDate(p.updatedAt), orgTimezone).toString()
					: null,
			scheduleEnabled: p.scheduleEnabled,
			regulationEnabled: p.regulationEnabled,
			presenceEnabled: p.presenceEnabled,
			versions: attachPrecomputedScheduleAnchors(versionsByPolicyId.get(p.id) ?? []),
		});
	}

	const currentDefaults: ContractDefaultSnapshot[] = defaultRows.map((row) => ({
		...row,
		customDays: templateDaysByVersionId.get(row.templateVersionId) ?? [],
	}));

	// Build projected defaults by overlaying the proposed default onto the matching scope.
	const sameScopeDefaults = currentDefaults.filter(
		(d) =>
			d.scope === validated.scope &&
			(validated.scope === "organization" ? d.teamId === null : d.teamId === validated.teamId),
	);
	const otherScopeDefaults = currentDefaults.filter(
		(d) =>
			!(
				d.scope === validated.scope &&
				(validated.scope === "organization" ? d.teamId === null : d.teamId === validated.teamId)
			),
	);
	const remainingSameScope = sameScopeDefaults
		.filter((d) => d.effectiveFromDate !== validated.effectiveFromDate)
		.sort((a, b) => a.effectiveFromDate.localeCompare(b.effectiveFromDate));
	const followingDefault = remainingSameScope.find(
		(d) => d.effectiveFromDate > validated.effectiveFromDate,
	);
	const adjustedSameScope = remainingSameScope.map((d) => {
		if (
			d.effectiveFromDate < validated.effectiveFromDate &&
			(d.effectiveUntilDate === null || d.effectiveUntilDate > validated.effectiveFromDate)
		) {
			return { ...d, effectiveUntilDate: validated.effectiveFromDate };
		}
		return d;
	});

	const proposedDefaultSnapshot: ContractDefaultSnapshot = {
		id: "preview-contract-default",
		scope: validated.scope,
		teamId: validated.teamId,
		templateVersionId: "preview-template-version",
		effectiveFromDate: validated.effectiveFromDate,
		effectiveUntilDate: followingDefault?.effectiveFromDate ?? null,
		createdAt: currentTimestamp(),
		workPolicyId: validated.workPolicyId,
		weeklyContractMinutes: validated.weeklyContractMinutes,
		scheduleMode: validated.scheduleMode,
		workModel: validated.workModel,
		presenceOverride: validated.presenceOverride,
		balanceMode: validated.balanceMode,
		scheduleSource: validated.scheduleSource,
		customDays: validated.customDays,
	};

	const projectedDefaults: ContractDefaultSnapshot[] = [
		...otherScopeDefaults,
		...adjustedSameScope,
		proposedDefaultSnapshot,
	];

	// Also project write-through policy assignments cleanly so legacy org/team assignments don't
	// mask a cleared or replaced default policy during preview.
	const projectedAssignments: PolicyAssignmentSnapshot[] = assignmentRows
		.filter((a) => {
			if (validated.scope === "organization") {
				return a.assignmentType !== "organization";
			}
			return !(a.assignmentType === "team" && a.teamId === validated.teamId);
		})
		.concat(
			validated.workPolicyId
				? [
						{
							id: "preview-policy-assignment",
							policyId: validated.workPolicyId,
							assignmentType: validated.scope,
							teamId: validated.teamId,
							employeeId: null,
							priority: validated.scope === "team" ? 1 : 0,
							sourceKind: "contract_default" as const,
							sourceEmploymentHistoryId: null,
							sourceEmploymentPeriodId: null,
							isActive: true,
							effectiveFrom: null,
							effectiveUntil: null,
							effectiveFromDate: validated.effectiveFromDate,
							effectiveUntilDate: followingDefault?.effectiveFromDate ?? null,
							createdAt: currentTimestamp(),
						},
					]
				: [],
		);

	const periodsByEmployee = new Map<string, EmploymentPeriodSnapshot[]>();
	for (const p of periodRows) {
		const list = periodsByEmployee.get(p.employeeId) ?? [];
		list.push({
			id: p.id,
			employeeId: p.employeeId,
			status: p.status,
			startedAt: p.startedAt ? instantFromDate(p.startedAt) : null,
			startProvenance: p.startProvenance,
			endedAt: p.endedAt ? instantFromDate(p.endedAt) : null,
			createdAt: instantFromDate(p.createdAt),
		});
		periodsByEmployee.set(p.employeeId, list);
	}

	const teamHistoryByEmployee = new Map<string, TeamHistoryInterval[]>();
	for (const row of teamHistoryRows) {
		const list = teamHistoryByEmployee.get(row.employeeId) ?? [];
		list.push({
			id: row.id,
			employeeId: row.employeeId,
			teamId: row.teamId,
			effectiveFrom: instantFromDate(row.effectiveFrom),
			effectiveTo: row.effectiveTo ? instantFromDate(row.effectiveTo) : null,
		});
		teamHistoryByEmployee.set(row.employeeId, list);
	}

	const termsByEmployee = new Map<string, EmploymentHistorySnapshot[]>();
	for (const row of termsRows) {
		const list = termsByEmployee.get(row.employeeId) ?? [];
		list.push({
			id: row.id,
			employeeId: row.employeeId,
			employmentPeriodId: row.employmentPeriodId,
			validFrom: row.validFrom,
			validUntil: row.validUntil,
			validFromDate: row.validFromDate,
			validUntilDate: row.validUntilDate,
			contractType: row.contractType,
			weeklyContractMinutes: row.weeklyContractMinutes,
			workModel: row.workModel,
			workPolicyId: row.workPolicyId,
			scheduleMode: row.scheduleMode,
			presenceOverride: row.presenceOverride,
			balanceMode: row.balanceMode,
			scheduleSource: row.scheduleSource,
			employmentProfile: row.employmentProfile,
			arbzgScope: row.arbzgScope,
			onCallHoursKind: row.onCallHoursKind,
			onCallWeeklyMinutes: row.onCallWeeklyMinutes,
			onCallDailyMinutes: row.onCallDailyMinutes,
			migratedLegacyTerms: row.migratedLegacyTerms,
			hourlyRate: row.hourlyRate,
			currency: row.currency,
			createdAt: row.createdAt,
			customDays: historyDaysByHistoryId.get(row.id) ?? [],
		});
		termsByEmployee.set(row.employeeId, list);
	}

	const inheritingEmployees: ContractDefaultAffectedEmployee[] = [];
	const divergedEmployees: ContractDefaultAffectedEmployee[] = [];
	const unchangedEmployees: ContractDefaultAffectedEmployee[] = [];
	const mismatchWarnings: {
		employeeId: string;
		firstName: string | null;
		lastName: string | null;
		warning: WeeklyHoursMismatchWarning;
	}[] = [];

	for (const emp of employeeRows) {
		const employeeCalendarTimezone = resolveEffectiveTimezone(emp.userTimezone, orgTimezone);
		const sharedInput = {
			date: targetDate,
			employeeId: emp.id,
			employeeContractType: emp.contractType,
			employeeCalendarTimezone,
			organizationTimezone: orgTimezone,
			employmentPeriods: periodsByEmployee.get(emp.id) ?? [],
			teamHistory: teamHistoryByEmployee.get(emp.id) ?? [],
			validOrgTeamIds,
			foreignTeamIds,
			teamNames,
			confirmedTerms: termsByEmployee.get(emp.id) ?? [],
			policiesById,
		};

		const beforeContract = resolveEffectiveContractPure({
			...sharedInput,
			contractDefaults: currentDefaults,
			policyAssignments: assignmentRows,
		});
		const afterContract = resolveEffectiveContractPure({
			...sharedInput,
			contractDefaults: projectedDefaults,
			policyAssignments: projectedAssignments,
		});

		const { changes, preservedDivergenceFields } = diffOperationalContracts(
			beforeContract,
			afterContract,
		);

		if (afterContract.mismatchWarning) {
			mismatchWarnings.push({
				employeeId: emp.id,
				firstName: emp.firstName,
				lastName: emp.lastName,
				warning: afterContract.mismatchWarning,
			});
		}

		if (changes.length > 0) {
			inheritingEmployees.push({
				employeeId: emp.id,
				firstName: emp.firstName,
				lastName: emp.lastName,
				primaryTeamId: afterContract.primaryTeamId,
				status: "inheriting",
				changes,
				preservedDivergenceFields,
				mismatchWarning: afterContract.mismatchWarning,
			});
		} else if (preservedDivergenceFields.length > 0) {
			divergedEmployees.push({
				employeeId: emp.id,
				firstName: emp.firstName,
				lastName: emp.lastName,
				primaryTeamId: afterContract.primaryTeamId,
				status: "diverged",
				changes: [],
				preservedDivergenceFields,
				mismatchWarning: afterContract.mismatchWarning,
			});
		} else {
			unchangedEmployees.push({
				employeeId: emp.id,
				firstName: emp.firstName,
				lastName: emp.lastName,
				primaryTeamId: afterContract.primaryTeamId,
				status: "unchanged",
				changes: [],
				preservedDivergenceFields: [],
				mismatchWarning: afterContract.mismatchWarning,
			});
		}
	}

	return {
		scope: validated.scope,
		teamId: validated.teamId,
		effectiveFromDate: validated.effectiveFromDate,
		remoteExemptDefaultApplied: validated.remoteExemptDefaultApplied,
		totalEvaluated: employeeRows.length,
		inheritingCount: inheritingEmployees.length,
		divergedCount: divergedEmployees.length,
		unchangedCount: unchangedEmployees.length,
		mismatchWarningCount: mismatchWarnings.length,
		inheritingEmployees,
		divergedEmployees,
		unchangedEmployees,
		mismatchWarnings,
	};
}

/**
 * Lists active and scheduled Organization and Primary Team default contracts for an organization.
 */
export async function getContractDefaults(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	options: { scope?: ContractDefaultScope; teamId?: string } = {},
): Promise<HydratedContractDefault[]> {
	const conditions = [
		eq(contractDefault.organizationId, organizationId),
		eq(contractDefault.isActive, true),
	];
	if (options.scope) {
		conditions.push(eq(contractDefault.scope, options.scope));
	}
	if (options.teamId) {
		conditions.push(eq(contractDefault.teamId, options.teamId));
	}

	const rows = await db
		.select({
			id: contractDefault.id,
			organizationId: contractDefault.organizationId,
			scope: contractDefault.scope,
			teamId: contractDefault.teamId,
			teamName: team.name,
			templateId: contractTemplateVersion.templateId,
			templateVersionId: contractDefault.templateVersionId,
			versionNumber: contractTemplateVersion.versionNumber,
			effectiveFromDate: contractDefault.effectiveFromDate,
			effectiveUntilDate: contractDefault.effectiveUntilDate,
			workPolicyId: contractTemplateVersion.workPolicyId,
			workPolicyName: workPolicy.name,
			weeklyContractMinutes: contractTemplateVersion.weeklyContractMinutes,
			scheduleMode: contractTemplateVersion.scheduleMode,
			workModel: contractTemplateVersion.workModel,
			presenceOverride: contractTemplateVersion.presenceOverride,
			balanceMode: contractTemplateVersion.balanceMode,
			scheduleSource: contractTemplateVersion.scheduleSource,
			createdAt: contractDefault.createdAt,
			createdBy: contractDefault.createdBy,
		})
		.from(contractDefault)
		.innerJoin(
			contractTemplateVersion,
			and(
				eq(contractTemplateVersion.id, contractDefault.templateVersionId),
				eq(contractTemplateVersion.organizationId, contractDefault.organizationId),
			),
		)
		.leftJoin(
			team,
			and(
				eq(team.id, contractDefault.teamId),
				eq(team.organizationId, contractDefault.organizationId),
			),
		)
		.leftJoin(
			workPolicy,
			and(
				eq(workPolicy.id, contractTemplateVersion.workPolicyId),
				eq(workPolicy.organizationId, contractDefault.organizationId),
			),
		)
		.where(and(...conditions))
		.orderBy(asc(contractDefault.scope), asc(contractDefault.effectiveFromDate));

	if (rows.length === 0) return [];

	const versionIds = [...new Set(rows.map((r) => r.templateVersionId))];
	const dayRows = await db
		.select()
		.from(contractTemplateVersionDay)
		.where(
			and(
				eq(contractTemplateVersionDay.organizationId, organizationId),
				inArray(contractTemplateVersionDay.templateVersionId, versionIds),
			),
		);
	const daysByVersion = Map.groupBy(dayRows, (d) => d.templateVersionId);

	return rows.map((row) => ({
		...row,
		customDays: (daysByVersion.get(row.templateVersionId) ?? []).map((d) => ({
			dayOfWeek: d.dayOfWeek,
			minutesPerDay: d.minutesPerDay,
			isWorkDay: d.isWorkDay,
			latestClockIn: d.latestClockIn,
		})),
	}));
}
