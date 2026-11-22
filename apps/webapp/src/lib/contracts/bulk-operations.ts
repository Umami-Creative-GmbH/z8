import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, exists, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import {
	contractChangeBatch,
	contractTemplate,
	contractTemplateVersion,
	contractTemplateVersionDay,
	employee,
	employeeEmploymentHistory,
	employeeEmploymentPeriod,
	workPolicy,
} from "@/db/schema";
import type { ContractChangeBatchExecutionMode } from "@/db/schema/contract-types";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import type { ContractType } from "@/lib/validations/employee";
import {
	type AsyncBatchEnqueuer,
	type BulkAdoptDefaultBatchPayload,
	type BulkTemplateApplyBatchPayload,
	type BulkTermsUpdateBatchPayload,
	type BulkTermsUpdateChanges,
	type ContractChangeBatchReceipt,
	INLINE_BATCH_THRESHOLD,
	type OperationalDivergenceField,
	type RunContractChangeBatchOptions,
	replayExistingContractChangeBatch,
	submitContractChangeBatch,
} from "./bulk-batch-engine";
import {
	parseIsoCalendarDate,
	validateAndNormalizeCustomDays,
	validateOnCallTerms,
	validateWeeklyContractMinutes,
} from "./contract-validation";
import { loadEffectiveContractsBatch } from "./resolve-contract";
import type { CustomWorkDay, EffectiveContractOnDay } from "./types";

const PREVIEW_CHUNK_SIZE = 1000;
const DEFAULT_SAMPLE_LIMIT = 200;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sortKeysCanonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeysCanonical);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			const v = (value as Record<string, unknown>)[key];
			if (v !== undefined) out[key] = sortKeysCanonical(v);
		}
		return out;
	}
	return value;
}

function normalizeActionSpecForFingerprint(spec: BulkContractActionSpec): Record<string, unknown> {
	if (spec.actionKind === "apply_template_version") {
		return {
			actionKind: spec.actionKind,
			templateVersionId: spec.templateVersionId,
			overwritePersonalDivergences: spec.overwritePersonalDivergences ?? false,
			changeReason: spec.changeReason ?? null,
		};
	}
	if (spec.actionKind === "adopt_default") {
		return {
			actionKind: spec.actionKind,
			keepDivergenceFields: [...(spec.keepDivergenceFields ?? [])].sort(),
			changeReason: spec.changeReason ?? null,
		};
	}
	return {
		actionKind: spec.actionKind,
		overwritePersonalDivergences: spec.overwritePersonalDivergences ?? false,
		changes: sortKeysCanonical(spec.changes),
		changeReason: spec.changeReason ?? null,
	};
}

function computeBulkConfirmationFingerprint(input: {
	organizationId: string;
	spec: BulkContractActionSpec;
	effectiveFromDate: string;
	employeeIds: readonly string[];
	onlyLegacyTerms: boolean;
}): string {
	return createHash("sha256")
		.update(
			JSON.stringify(
				sortKeysCanonical({
					organizationId: input.organizationId,
					effectiveFromDate: input.effectiveFromDate,
					onlyLegacyTerms: input.onlyLegacyTerms,
					spec: normalizeActionSpecForFingerprint(input.spec),
					employeeIds: [...input.employeeIds].sort(),
				}),
			),
		)
		.digest("hex");
}

function computeBulkSubmittedIntentFingerprint(input: {
	organizationId: string;
	spec: BulkContractActionSpec;
	effectiveFromDate: string;
	target: BulkEmployeeTargetFilter;
	onlyLegacyTerms: boolean;
	confirmationFingerprint?: string;
}): string {
	return createHash("sha256")
		.update(
			JSON.stringify(
				sortKeysCanonical({
					organizationId: input.organizationId,
					effectiveFromDate: input.effectiveFromDate,
					onlyLegacyTerms: input.onlyLegacyTerms,
					confirmationFingerprint: input.confirmationFingerprint ?? null,
					target: {
						employeeIds: input.target.employeeIds
							? [...new Set(input.target.employeeIds)].sort()
							: null,
						teamId: input.target.teamId ?? null,
						contractType: input.target.contractType ?? null,
						onlyLegacyTerms: input.target.onlyLegacyTerms ?? null,
					},
					spec: normalizeActionSpecForFingerprint(input.spec),
				}),
			),
		)
		.digest("hex");
}

function resolveOnlyLegacyFlag(
	target: BulkEmployeeTargetFilter,
	defaultOnlyLegacyTerms: boolean,
): boolean {
	return target.onlyLegacyTerms !== undefined
		? target.onlyLegacyTerms
		: defaultOnlyLegacyTerms && !(target.employeeIds && target.employeeIds.length > 0);
}

export interface BulkEmployeeTargetFilter {
	/** Explicit employee IDs (strictly filtered to current roster in `organizationId`). */
	readonly employeeIds?: readonly string[];
	/** Optional primary team filter. */
	readonly teamId?: string | null;
	/** Optional contract type filter (`fixed` | `hourly`). */
	readonly contractType?: ContractType;
	/** When true, selects employees whose confirmed terms have `migrated_legacy_terms = true`. */
	readonly onlyLegacyTerms?: boolean;
}

export type BulkContractActionSpec =
	| {
			readonly actionKind: "apply_template_version";
			readonly templateVersionId: string;
			readonly effectiveFromDate: string;
			readonly overwritePersonalDivergences?: boolean;
			readonly changeReason?: string | null;
	  }
	| {
			readonly actionKind: "adopt_default";
			readonly effectiveFromDate: string;
			readonly keepDivergenceFields?: readonly OperationalDivergenceField[];
			readonly changeReason?: string | null;
	  }
	| {
			readonly actionKind: "bulk_operational_update";
			readonly effectiveFromDate: string;
			readonly overwritePersonalDivergences?: boolean;
			readonly changes: BulkTermsUpdateChanges;
			readonly changeReason?: string | null;
	  };

export type PreviewBulkContractActionInput = BulkContractActionSpec & {
	readonly organizationId: string;
	readonly target: BulkEmployeeTargetFilter;
	/** Maximum number of per-employee preview rows returned (aggregates always cover 100%). */
	readonly sampleLimit?: number;
};

export interface BulkEmployeePreviewEntry {
	readonly employeeId: string;
	readonly firstName: string | null;
	readonly lastName: string | null;
	readonly employeeNumber: string | null;
	readonly status: "will_update" | "skipped_divergence" | "unchanged" | "validation_error";
	readonly preservedDivergenceFields: readonly OperationalDivergenceField[];
	readonly changedFields: readonly string[];
	readonly validationErrors: readonly string[];
}

export interface PreviewBulkContractActionResult {
	readonly actionKind: BulkContractActionSpec["actionKind"];
	readonly effectiveFromDate: string;
	readonly executionMode: ContractChangeBatchExecutionMode;
	readonly totalMatched: number;
	readonly affectedCount: number;
	readonly skippedDivergenceCount: number;
	readonly unchangedCount: number;
	readonly validationErrorCount: number;
	readonly canSubmit: boolean;
	readonly confirmationFingerprint: string;
	readonly sampleTruncated: boolean;
	readonly employees: readonly BulkEmployeePreviewEntry[];
	readonly validationIssues: readonly {
		readonly employeeId: string;
		readonly employeeNumber: string | null;
		readonly errors: readonly string[];
	}[];
}

export type SubmitBulkContractActionInput = BulkContractActionSpec & {
	readonly organizationId: string;
	readonly actorUserId: string;
	readonly requestId?: string;
	readonly confirmationFingerprint?: string;
	readonly target: BulkEmployeeTargetFilter;
	readonly now?: Date;
	readonly enqueueAsyncJob?: AsyncBatchEnqueuer;
	readonly skipImmediateExecution?: boolean;
	readonly runnerOptions?: RunContractChangeBatchOptions;
};

interface MatchedEmployeeRow {
	readonly id: string;
	readonly firstName: string | null;
	readonly lastName: string | null;
	readonly employeeNumber: string | null;
	readonly contractType: ContractType;
}

async function resolveTargetEmployees(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	target: BulkEmployeeTargetFilter,
	defaultOnlyLegacyTerms: boolean,
	effectiveFromDate: string,
): Promise<readonly MatchedEmployeeRow[]> {
	const conditions: SQL[] = [onCurrentRoster(organizationId)];

	if (target.employeeIds && target.employeeIds.length > 0) {
		const uniqueIds = [...new Set(target.employeeIds)];
		conditions.push(inArray(employee.id, uniqueIds));
	}
	if (target.teamId) {
		conditions.push(eq(employee.teamId, target.teamId));
	}
	if (target.contractType) {
		conditions.push(eq(employee.contractType, target.contractType));
	}

	const onlyLegacy = resolveOnlyLegacyFlag(target, defaultOnlyLegacyTerms);

	if (onlyLegacy) {
		// A1-19: Determine eligibility strictly from the confirmed terms covering
		// `effectiveFromDate` in the employee's active employment period, never from
		// already-superseded historical legacy rows.
		conditions.push(
			exists(
				db
					.select({ one: sql`1` })
					.from(employeeEmploymentHistory)
					.leftJoin(
						employeeEmploymentPeriod,
						and(
							eq(employeeEmploymentPeriod.id, employeeEmploymentHistory.employmentPeriodId),
							eq(employeeEmploymentPeriod.organizationId, organizationId),
						),
					)
					.where(
						and(
							eq(employeeEmploymentHistory.organizationId, organizationId),
							eq(employeeEmploymentHistory.employeeId, employee.id),
							eq(employeeEmploymentHistory.reviewState, "confirmed"),
							eq(employeeEmploymentHistory.migratedLegacyTerms, true),
							sql`${employeeEmploymentHistory.validFromDate} <= ${effectiveFromDate}::date`,
							or(
								isNull(employeeEmploymentHistory.validUntilDate),
								sql`${employeeEmploymentHistory.validUntilDate} > ${effectiveFromDate}::date`,
							),
							or(
								isNull(employeeEmploymentHistory.employmentPeriodId),
								eq(employeeEmploymentPeriod.status, "open"),
							),
						),
					),
			),
		);
	}

	return db
		.select({
			id: employee.id,
			firstName: user.firstName,
			lastName: user.lastName,
			employeeNumber: employee.employeeNumber,
			contractType: employee.contractType,
		})
		.from(employee)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(and(...conditions))
		.orderBy(asc(employee.id));
}

async function validateBulkActionInputs(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	spec: BulkContractActionSpec,
): Promise<{
	effectiveFromDate: string;
	templateVersion: {
		id: string;
		workPolicyId: string | null;
		weeklyContractMinutes: number | null;
		scheduleMode: "policy" | "hours_only" | "custom_days";
		workModel: "onsite" | "hybrid" | "remote" | "flexible" | null;
		presenceOverride: "inherit" | "exempt" | "require_onsite";
		balanceMode: "tracked" | "trust_based";
		scheduleSource: "policy" | "published_shifts" | "on_call";
		defaultContractType: ContractType | null;
		defaultHourlyRate: number | null;
		defaultCurrency: string | null;
		defaultEmploymentProfile: string | null;
		defaultArbzgScope: string | null;
		defaultOnCallHoursKind: string | null;
		defaultOnCallWeeklyMinutes: number | null;
		defaultOnCallDailyMinutes: number | null;
		customDays: readonly CustomWorkDay[];
	} | null;
}> {
	const effectiveFromDate = parseIsoCalendarDate(spec.effectiveFromDate, "effectiveFromDate");

	if (spec.actionKind === "apply_template_version") {
		const [row] = await db
			.select({
				version: contractTemplateVersion,
				templateActive: contractTemplate.isActive,
			})
			.from(contractTemplateVersion)
			.innerJoin(
				contractTemplate,
				and(
					eq(contractTemplate.id, contractTemplateVersion.templateId),
					eq(contractTemplate.organizationId, contractTemplateVersion.organizationId),
				),
			)
			.where(
				and(
					eq(contractTemplateVersion.id, spec.templateVersionId),
					eq(contractTemplateVersion.organizationId, organizationId),
				),
			)
			.limit(1);

		if (!row) {
			throw new NotFoundError({
				message: "Contract template version not found",
				entityType: "contract_template_version",
				entityId: spec.templateVersionId,
			});
		}

		if (row.version.workPolicyId) {
			const [policy] = await db
				.select({ id: workPolicy.id, isActive: workPolicy.isActive })
				.from(workPolicy)
				.where(
					and(
						eq(workPolicy.id, row.version.workPolicyId),
						eq(workPolicy.organizationId, organizationId),
					),
				)
				.limit(1);
			if (!policy || !policy.isActive) {
				throw new ValidationError({
					message: "The template references an inactive or missing work policy.",
					field: "templateVersionId",
					refusal: "work_policy_inactive",
				});
			}
		}

		const days = await db
			.select()
			.from(contractTemplateVersionDay)
			.where(
				and(
					eq(contractTemplateVersionDay.organizationId, organizationId),
					eq(contractTemplateVersionDay.templateVersionId, row.version.id),
				),
			);

		return {
			effectiveFromDate,
			templateVersion: {
				id: row.version.id,
				workPolicyId: row.version.workPolicyId,
				weeklyContractMinutes: row.version.weeklyContractMinutes,
				scheduleMode: row.version.scheduleMode,
				workModel: row.version.workModel,
				presenceOverride: row.version.presenceOverride,
				balanceMode: row.version.balanceMode,
				scheduleSource: row.version.scheduleSource,
				defaultContractType: row.version.defaultContractType,
				defaultHourlyRate: row.version.defaultHourlyRate,
				defaultCurrency: row.version.defaultCurrency,
				defaultEmploymentProfile: row.version.defaultEmploymentProfile,
				defaultArbzgScope: row.version.defaultArbzgScope,
				defaultOnCallHoursKind: row.version.defaultOnCallHoursKind,
				defaultOnCallWeeklyMinutes: row.version.defaultOnCallWeeklyMinutes,
				defaultOnCallDailyMinutes: row.version.defaultOnCallDailyMinutes,
				customDays: days.map((d) => ({
					dayOfWeek: d.dayOfWeek,
					minutesPerDay: d.minutesPerDay,
					isWorkDay: d.isWorkDay,
					latestClockIn: d.latestClockIn,
				})),
			},
		};
	}

	if (spec.actionKind === "bulk_operational_update") {
		const c = spec.changes;
		const hasAnyField =
			c.workPolicyId !== undefined ||
			c.clearPersonalPolicyPin === true ||
			c.weeklyContractMinutes !== undefined ||
			c.scheduleMode !== undefined ||
			c.customDays !== undefined ||
			c.workModel !== undefined ||
			c.presenceOverride !== undefined ||
			c.balanceMode !== undefined ||
			c.scheduleSource !== undefined ||
			c.contractType !== undefined ||
			c.hourlyRate !== undefined ||
			c.currency !== undefined ||
			c.employmentProfile !== undefined ||
			c.arbzgScope !== undefined;

		if (!hasAnyField) {
			throw new ValidationError({
				message: "Select at least one contract field to update.",
				field: "changes",
				refusal: "empty_bulk_changes",
			});
		}

		validateWeeklyContractMinutes(c.weeklyContractMinutes);
		validateAndNormalizeCustomDays(c.scheduleMode, c.customDays);
		if (c.scheduleSource !== undefined || c.onCallHoursKind !== undefined) {
			validateOnCallTerms({
				scheduleSource: c.scheduleSource,
				onCallHoursKind: c.onCallHoursKind,
				onCallWeeklyMinutes: c.onCallWeeklyMinutes,
				onCallDailyMinutes: c.onCallDailyMinutes,
				requireKindWhenOnCall: true,
			});
		}
		if (c.workPolicyId) {
			const [policy] = await db
				.select({ id: workPolicy.id, isActive: workPolicy.isActive })
				.from(workPolicy)
				.where(
					and(eq(workPolicy.id, c.workPolicyId), eq(workPolicy.organizationId, organizationId)),
				)
				.limit(1);
			if (!policy) {
				throw new NotFoundError({
					message: "Work policy not found",
					entityType: "work_policy",
					entityId: c.workPolicyId,
				});
			}
			if (!policy.isActive) {
				throw new ValidationError({
					message: "Inactive work policies cannot be applied in bulk.",
					field: "workPolicyId",
					refusal: "work_policy_inactive",
				});
			}
		}
	}

	return { effectiveFromDate, templateVersion: null };
}

function evaluateEmployeeAgainstAction(
	emp: MatchedEmployeeRow,
	current: EffectiveContractOnDay | undefined,
	spec: BulkContractActionSpec,
	templateVersion: Awaited<ReturnType<typeof validateBulkActionInputs>>["templateVersion"],
): BulkEmployeePreviewEntry {
	const validationErrors: string[] = [];
	const preservedDivergenceFields: OperationalDivergenceField[] = [];
	const changedFields: string[] = [];

	if (!current) {
		return {
			employeeId: emp.id,
			firstName: emp.firstName,
			lastName: emp.lastName,
			employeeNumber: emp.employeeNumber,
			status: "validation_error",
			preservedDivergenceFields: [],
			changedFields: [],
			validationErrors: ["Employee could not be resolved on the effective date."],
		};
	}

	if (!current.isEmployedOnDay) {
		validationErrors.push("Employee has no active employment period on the effective date.");
	}

	if (spec.actionKind === "adopt_default") {
		const keep = new Set(spec.keepDivergenceFields ?? []);
		const checks: [OperationalDivergenceField, boolean][] = [
			["workPolicy", current.workPolicySource === "employee_override"],
			["weeklyContractMinutes", current.weeklyContractMinutesSource === "employee_override"],
			["scheduleMode", current.scheduleModeSource === "employee_override"],
			["workModel", current.workModelSource === "employee_override"],
			["presenceOverride", current.presenceOverrideSource === "employee_override"],
			["balanceMode", current.balanceModeSource === "employee_override"],
			["scheduleSource", current.scheduleSourceSource === "employee_override"],
		];
		for (const [field, isDiverged] of checks) {
			if (isDiverged) {
				if (keep.has(field)) preservedDivergenceFields.push(field);
				else changedFields.push(field);
			}
		}
		if (current.migratedLegacyTerms && !changedFields.includes("migratedLegacyTerms")) {
			changedFields.push("migratedLegacyTerms");
		}

		const status =
			validationErrors.length > 0
				? "validation_error"
				: changedFields.length > 0
					? "will_update"
					: "unchanged";
		return {
			employeeId: emp.id,
			firstName: emp.firstName,
			lastName: emp.lastName,
			employeeNumber: emp.employeeNumber,
			status,
			preservedDivergenceFields,
			changedFields,
			validationErrors,
		};
	}

	const preserve = !(spec.overwritePersonalDivergences ?? false);

	const targetChanges: BulkTermsUpdateChanges =
		spec.actionKind === "apply_template_version" && templateVersion
			? {
					...(templateVersion.workPolicyId !== null
						? { workPolicyId: templateVersion.workPolicyId }
						: {}),
					...(templateVersion.weeklyContractMinutes !== null
						? { weeklyContractMinutes: templateVersion.weeklyContractMinutes }
						: {}),
					scheduleMode: templateVersion.scheduleMode,
					...(templateVersion.scheduleMode === "custom_days"
						? { customDays: templateVersion.customDays }
						: {}),
					...(templateVersion.workModel !== null ? { workModel: templateVersion.workModel } : {}),
					...(templateVersion.presenceOverride !== "inherit"
						? { presenceOverride: templateVersion.presenceOverride }
						: {}),
					balanceMode: templateVersion.balanceMode,
					scheduleSource: templateVersion.scheduleSource,
					...(templateVersion.defaultContractType !== null
						? { contractType: templateVersion.defaultContractType }
						: {}),
					...(templateVersion.defaultHourlyRate !== null
						? { hourlyRate: templateVersion.defaultHourlyRate }
						: {}),
					...(templateVersion.defaultCurrency !== null
						? { currency: templateVersion.defaultCurrency }
						: {}),
				}
			: spec.actionKind === "bulk_operational_update"
				? spec.changes
				: {};

	const checkOperational = (
		field: OperationalDivergenceField,
		targeted: boolean,
		isDiverged: boolean,
		differs: boolean,
	) => {
		if (!targeted) return;
		if (preserve && isDiverged) {
			preservedDivergenceFields.push(field);
		} else if (differs) {
			changedFields.push(field);
		}
	};

	checkOperational(
		"workPolicy",
		targetChanges.workPolicyId !== undefined || targetChanges.clearPersonalPolicyPin === true,
		current.workPolicySource === "employee_override",
		targetChanges.clearPersonalPolicyPin
			? current.workPolicySource === "employee_override"
			: (targetChanges.workPolicyId ?? null) !== (current.workPolicy?.policyId ?? null),
	);
	checkOperational(
		"weeklyContractMinutes",
		targetChanges.weeklyContractMinutes !== undefined,
		current.weeklyContractMinutesSource === "employee_override",
		targetChanges.weeklyContractMinutes !== current.weeklyContractMinutes,
	);
	checkOperational(
		"scheduleMode",
		targetChanges.scheduleMode !== undefined || targetChanges.customDays !== undefined,
		current.scheduleModeSource === "employee_override",
		targetChanges.scheduleMode !== current.scheduleMode ||
			targetChanges.scheduleMode === "custom_days",
	);
	checkOperational(
		"workModel",
		targetChanges.workModel !== undefined,
		current.workModelSource === "employee_override",
		targetChanges.workModel !== current.workModel,
	);
	checkOperational(
		"presenceOverride",
		targetChanges.presenceOverride !== undefined,
		current.presenceOverrideSource === "employee_override",
		targetChanges.presenceOverride !== current.presenceOverride,
	);
	checkOperational(
		"balanceMode",
		targetChanges.balanceMode !== undefined,
		current.balanceModeSource === "employee_override",
		targetChanges.balanceMode !== current.balanceMode,
	);
	checkOperational(
		"scheduleSource",
		targetChanges.scheduleSource !== undefined,
		current.scheduleSourceSource === "employee_override",
		targetChanges.scheduleSource !== current.scheduleSource,
	);

	// Validate employee-owned contract constraints (e.g. hourly rate required when switching to hourly)
	const nextContractType = targetChanges.contractType ?? current.contractType;
	const nextHourlyRate =
		targetChanges.hourlyRate !== undefined ? targetChanges.hourlyRate : current.hourlyRate;
	if (nextContractType === "hourly" && nextHourlyRate == null) {
		validationErrors.push("Hourly contract requires an hourly rate.");
	}
	if (
		targetChanges.contractType !== undefined &&
		targetChanges.contractType !== current.contractType
	) {
		changedFields.push("contractType");
	}
	if (targetChanges.hourlyRate !== undefined && targetChanges.hourlyRate !== current.hourlyRate) {
		changedFields.push("hourlyRate");
	}

	const nextScheduleSource =
		preserve && current.scheduleSourceSource === "employee_override"
			? current.scheduleSource
			: (targetChanges.scheduleSource ?? current.scheduleSource);
	if (
		nextScheduleSource === "on_call" &&
		!(
			targetChanges.onCallHoursKind ??
			(spec.actionKind === "apply_template_version"
				? templateVersion?.defaultOnCallHoursKind
				: null) ??
			current.onCallTerms?.hoursKind
		)
	) {
		validationErrors.push("On-call schedule source requires an on-call hours kind.");
	}

	let status: BulkEmployeePreviewEntry["status"];
	if (validationErrors.length > 0) {
		status = "validation_error";
	} else if (changedFields.length > 0) {
		status = "will_update";
	} else if (preservedDivergenceFields.length > 0) {
		status = "skipped_divergence";
	} else {
		status = "unchanged";
	}

	return {
		employeeId: emp.id,
		firstName: emp.firstName,
		lastName: emp.lastName,
		employeeNumber: emp.employeeNumber,
		status,
		preservedDivergenceFields,
		changedFields,
		validationErrors,
	};
}

/**
 * Strictly read-only dry-run preview for all 3 bulk contract actions:
 * 1. `apply_template_version` (stamping a `contract_template_version` with effective date)
 * 2. `adopt_default` (bulk "Adopt Org/Team default" for `migrated_legacy_terms = true`)
 * 3. `bulk_operational_update` (bulk operational/policy updates)
 *
 * Processes employees in bounded chunks (`500` per batch) so 10,000-employee orgs stay
 * fast and memory-bounded without mutating any database state.
 */
export async function previewBulkContractAction(
	db: Pick<DatabaseClient, "select">,
	input: PreviewBulkContractActionInput,
): Promise<PreviewBulkContractActionResult> {
	const { effectiveFromDate, templateVersion } = await validateBulkActionInputs(
		db,
		input.organizationId,
		input,
	);

	const onlyLegacyTerms = resolveOnlyLegacyFlag(input.target, input.actionKind === "adopt_default");
	const matched = await resolveTargetEmployees(
		db,
		input.organizationId,
		input.target,
		input.actionKind === "adopt_default",
		effectiveFromDate,
	);

	const sampleLimit = Math.max(input.sampleLimit ?? DEFAULT_SAMPLE_LIMIT, 0);
	const sampleEntries: BulkEmployeePreviewEntry[] = [];
	const validationIssues: {
		employeeId: string;
		employeeNumber: string | null;
		errors: readonly string[];
	}[] = [];

	let affectedCount = 0;
	let skippedDivergenceCount = 0;
	let unchangedCount = 0;
	let validationErrorCount = 0;

	for (let offset = 0; offset < matched.length; offset += PREVIEW_CHUNK_SIZE) {
		const chunk = matched.slice(offset, offset + PREVIEW_CHUNK_SIZE);
		const resolvedMap = await loadEffectiveContractsBatch(db, {
			organizationId: input.organizationId,
			employeeIds: chunk.map((e) => e.id),
			dates: [effectiveFromDate],
		});

		for (const emp of chunk) {
			const current = resolvedMap.get(emp.id)?.get(effectiveFromDate);
			const entry = evaluateEmployeeAgainstAction(emp, current, input, templateVersion);

			if (entry.status === "will_update") affectedCount += 1;
			else if (entry.status === "skipped_divergence") skippedDivergenceCount += 1;
			else if (entry.status === "unchanged") unchangedCount += 1;
			else {
				validationErrorCount += 1;
				if (validationIssues.length < 200) {
					validationIssues.push({
						employeeId: emp.id,
						employeeNumber: emp.employeeNumber,
						errors: entry.validationErrors,
					});
				}
			}

			if (sampleEntries.length < sampleLimit) {
				sampleEntries.push(entry);
			}
		}
	}

	const confirmationFingerprint = computeBulkConfirmationFingerprint({
		organizationId: input.organizationId,
		spec: input,
		effectiveFromDate,
		employeeIds: matched.map((m) => m.id),
		onlyLegacyTerms,
	});

	const executionMode: ContractChangeBatchExecutionMode =
		matched.length <= INLINE_BATCH_THRESHOLD ? "inline" : "async";

	return {
		actionKind: input.actionKind,
		effectiveFromDate,
		executionMode,
		totalMatched: matched.length,
		affectedCount,
		skippedDivergenceCount,
		unchangedCount,
		validationErrorCount,
		canSubmit: matched.length > 0 && validationErrorCount === 0,
		confirmationFingerprint,
		sampleTruncated: matched.length > sampleEntries.length,
		employees: sampleEntries,
		validationIssues,
	};
}

/**
 * Commits and dispatches one of the 3 bulk contract actions through the unified
 * commit-first durable `submitContractChangeBatch` engine.
 */
export async function submitBulkContractAction(
	db: DatabaseClient,
	input: SubmitBulkContractActionInput,
): Promise<ContractChangeBatchReceipt> {
	const { effectiveFromDate } = await validateBulkActionInputs(db, input.organizationId, input);
	const onlyLegacyTerms = resolveOnlyLegacyFlag(input.target, input.actionKind === "adopt_default");
	const submittedIntentFingerprint = computeBulkSubmittedIntentFingerprint({
		organizationId: input.organizationId,
		spec: input,
		effectiveFromDate,
		target: input.target,
		onlyLegacyTerms,
		confirmationFingerprint: input.confirmationFingerprint,
	});

	// Replay check BEFORE re-resolving live target employees so an identical retry after
	// commit (e.g. `onlyLegacyTerms: true` after legacy terms were just adopted) returns
	// the original receipt instead of failing on post-commit target drift (A1-21/A1-22).
	if (input.requestId) {
		if (!UUID_REGEX.test(input.requestId)) {
			throw new ValidationError({
				message: "Invalid UUID for requestId.",
				field: "requestId",
				refusal: "invalid_uuid",
			});
		}
		const [existing] = await db
			.select()
			.from(contractChangeBatch)
			.where(
				and(
					eq(contractChangeBatch.organizationId, input.organizationId),
					eq(contractChangeBatch.requestId, input.requestId),
				),
			)
			.limit(1);
		if (existing) {
			const storedIntent = (existing.payload as { submittedIntentFingerprint?: unknown } | null)
				?.submittedIntentFingerprint;
			if (storedIntent === submittedIntentFingerprint) {
				return replayExistingContractChangeBatch(db, {
					organizationId: input.organizationId,
					existingBatch: existing,
					enqueueAsyncJob: input.enqueueAsyncJob,
					skipImmediateExecution: input.skipImmediateExecution,
					runnerOptions: input.runnerOptions,
				});
			}
			throw new ConflictError({
				message: "This request ID was already used with a different batch payload.",
				conflictType: "request_conflict",
				details: { requestId: input.requestId },
			});
		}
	}

	const matched = await resolveTargetEmployees(
		db,
		input.organizationId,
		input.target,
		input.actionKind === "adopt_default",
		effectiveFromDate,
	);

	if (matched.length === 0) {
		throw new ValidationError({
			message: "No matching current-roster employees found for this bulk action.",
			field: "target",
			refusal: "empty_batch",
		});
	}

	// A1-21: Verify confirmation fingerprint against the normalized operation and exact
	// matched employee IDs so roster/operation drift after preview requires a fresh preview.
	const currentFingerprint = computeBulkConfirmationFingerprint({
		organizationId: input.organizationId,
		spec: input,
		effectiveFromDate,
		employeeIds: matched.map((m) => m.id),
		onlyLegacyTerms,
	});
	if (input.confirmationFingerprint && input.confirmationFingerprint !== currentFingerprint) {
		throw new ConflictError({
			message:
				"Bulk action preview is stale because matching employees or parameters changed. Re-run preview before submitting.",
			conflictType: "confirmation_fingerprint_mismatch",
		});
	}

	const requestId = input.requestId ?? randomUUID();

	if (input.actionKind === "apply_template_version") {
		const payload: BulkTemplateApplyBatchPayload & { submittedIntentFingerprint: string } = {
			templateVersionId: input.templateVersionId,
			effectiveFromDate,
			overwritePersonalDivergences: input.overwritePersonalDivergences ?? false,
			changeReason: input.changeReason ?? null,
			submittedIntentFingerprint,
		};
		return submitContractChangeBatch(db, {
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			requestId,
			operationKind: "bulk_template_apply",
			payload: payload as unknown as Record<string, unknown>,
			items: matched.map((emp) => ({ employeeId: emp.id, payload: {} })),
			now: input.now,
			enqueueAsyncJob: input.enqueueAsyncJob,
			skipImmediateExecution: input.skipImmediateExecution,
			runnerOptions: input.runnerOptions,
		});
	}

	if (input.actionKind === "adopt_default") {
		const payload: BulkAdoptDefaultBatchPayload & { submittedIntentFingerprint: string } = {
			effectiveFromDate,
			keepDivergenceFields: input.keepDivergenceFields ?? [],
			onlyLegacyTerms,
			changeReason: input.changeReason ?? null,
			submittedIntentFingerprint,
		};
		return submitContractChangeBatch(db, {
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			requestId,
			operationKind: "bulk_adopt_default",
			payload: payload as unknown as Record<string, unknown>,
			items: matched.map((emp) => ({ employeeId: emp.id, payload: {} })),
			now: input.now,
			enqueueAsyncJob: input.enqueueAsyncJob,
			skipImmediateExecution: input.skipImmediateExecution,
			runnerOptions: input.runnerOptions,
		});
	}

	const payload: BulkTermsUpdateBatchPayload & { submittedIntentFingerprint: string } = {
		effectiveFromDate,
		overwritePersonalDivergences: input.overwritePersonalDivergences ?? false,
		changes: input.changes,
		changeReason: input.changeReason ?? null,
		submittedIntentFingerprint,
	};
	return submitContractChangeBatch(db, {
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		requestId,
		operationKind: "bulk_terms_update",
		payload: payload as unknown as Record<string, unknown>,
		items: matched.map((emp) => ({ employeeId: emp.id, payload: {} })),
		now: input.now,
		enqueueAsyncJob: input.enqueueAsyncJob,
		skipImmediateExecution: input.skipImmediateExecution,
		runnerOptions: input.runnerOptions,
	});
}
