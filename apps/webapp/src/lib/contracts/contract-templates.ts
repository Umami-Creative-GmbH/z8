import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
	contractTemplate,
	contractTemplateVersion,
	contractTemplateVersionDay,
	workPolicy,
} from "@/db/schema";
import type {
	ArbzgScope,
	BalanceMode,
	EmploymentProfile,
	OnCallHoursKind,
	PresenceOverride,
	ScheduleSource,
	TemplateScheduleMode,
} from "@/db/schema/contract-types";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { ContractType } from "@/lib/validations/employee";
import {
	buildOnCallStatutoryPreview,
	type ContractWriteTx,
	parseIsoCalendarDate,
	resolveRemotePresenceDefault,
	validateAndNormalizeCustomDays,
	validateOnCallTerms,
	validateWeeklyContractMinutes,
} from "./contract-validation";
import { resolveEffectiveContractOnDay } from "./resolve-contract";
import { type CustomWorkDay, storedBalanceMode, type WorkModel } from "./types";

export interface ContractTemplateVersionFields {
	readonly workPolicyId?: string | null;
	readonly weeklyContractMinutes?: number | null;
	readonly scheduleMode?: TemplateScheduleMode;
	readonly customDays?: readonly CustomWorkDay[] | null;
	readonly workModel?: WorkModel | null;
	readonly presenceOverride?: PresenceOverride;
	readonly balanceMode?: BalanceMode;
	readonly scheduleSource?: ScheduleSource;
	/** Employee-owned legal/pay/statutory defaults prefilled once on hire or apply. */
	readonly defaultContractType?: ContractType | null;
	readonly defaultEmploymentProfile?: EmploymentProfile | null;
	readonly defaultArbzgScope?: ArbzgScope | null;
	readonly defaultOnCallHoursKind?: OnCallHoursKind | null;
	readonly defaultOnCallWeeklyMinutes?: number | null;
	readonly defaultOnCallDailyMinutes?: number | null;
	readonly defaultHourlyRate?: number | null;
	readonly defaultCurrency?: string | null;
}

export interface CreateContractTemplateInput extends ContractTemplateVersionFields {
	readonly organizationId: string;
	readonly actorUserId: string;
	readonly name: string;
	readonly description?: string | null;
	readonly now?: Date;
}

export interface PublishContractTemplateVersionInput extends ContractTemplateVersionFields {
	readonly organizationId: string;
	readonly actorUserId: string;
	readonly templateId: string;
	readonly name?: string;
	readonly description?: string | null;
	readonly now?: Date;
}

export interface HydratedContractTemplateVersion {
	readonly id: string;
	readonly templateId: string;
	readonly versionNumber: number;
	readonly workPolicyId: string | null;
	readonly workPolicyName: string | null;
	readonly weeklyContractMinutes: number | null;
	readonly scheduleMode: TemplateScheduleMode;
	readonly workModel: WorkModel | null;
	readonly presenceOverride: PresenceOverride;
	readonly balanceMode: BalanceMode;
	readonly scheduleSource: ScheduleSource;
	readonly isDefaultEligible: boolean;
	readonly defaultContractType: ContractType | null;
	readonly defaultEmploymentProfile: EmploymentProfile | null;
	readonly defaultArbzgScope: ArbzgScope | null;
	readonly defaultOnCallHoursKind: OnCallHoursKind | null;
	readonly defaultOnCallWeeklyMinutes: number | null;
	readonly defaultOnCallDailyMinutes: number | null;
	readonly defaultHourlyRate: number | null;
	readonly defaultCurrency: string | null;
	readonly customDays: readonly CustomWorkDay[];
	readonly createdAt: Date;
	readonly createdBy: string | null;
}

export interface HydratedContractTemplateSummary {
	readonly id: string;
	readonly organizationId: string;
	readonly name: string;
	readonly description: string | null;
	readonly isActive: boolean;
	readonly versionCount: number;
	readonly latestVersion: HydratedContractTemplateVersion | null;
	readonly createdAt: Date;
	readonly updatedAt: Date;
}

export interface HydratedContractTemplateDetail extends HydratedContractTemplateSummary {
	readonly versions: readonly HydratedContractTemplateVersion[];
}

export interface PreviewTemplateApplicationResult {
	readonly templateId: string;
	readonly templateName: string;
	readonly templateVersionId: string;
	readonly versionNumber: number;
	readonly effectiveFromDate: string;
	readonly employeeId: string;
	readonly preserveDivergences: boolean;
	readonly operationalOverridesToWrite: {
		readonly workPolicyId: string | null;
		readonly weeklyContractMinutes: number | null;
		readonly scheduleMode: TemplateScheduleMode | null;
		readonly customDays: readonly CustomWorkDay[];
		readonly workModel: WorkModel | null;
		readonly presenceOverride: PresenceOverride | null;
		readonly balanceMode: BalanceMode | null;
		readonly scheduleSource: ScheduleSource | null;
	};
	readonly employeeOwnedPrefill: {
		readonly contractType: ContractType;
		readonly hourlyRate: number | null;
		readonly currency: string;
		readonly employmentProfile: EmploymentProfile;
		readonly arbzgScope: ArbzgScope;
		readonly onCallHoursKind: OnCallHoursKind | null;
		readonly onCallWeeklyMinutes: number | null;
		readonly onCallDailyMinutes: number | null;
	};
	readonly onCallPreview: ReturnType<typeof buildOnCallStatutoryPreview>;
	readonly preservedDivergenceFields: readonly string[];
	readonly remoteExemptDefaultApplied: boolean;
}

function validateTemplateVersionInput(input: ContractTemplateVersionFields) {
	const scheduleSource: ScheduleSource = input.scheduleSource ?? "policy";
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
	const onCall = validateOnCallTerms({
		scheduleSource,
		onCallHoursKind: input.defaultOnCallHoursKind,
		onCallWeeklyMinutes: input.defaultOnCallWeeklyMinutes,
		onCallDailyMinutes: input.defaultOnCallDailyMinutes,
		requireKindWhenOnCall: false,
	});

	const defaultContractType = input.defaultContractType ?? null;
	const defaultHourlyRate =
		defaultContractType === "fixed" ? null : (input.defaultHourlyRate ?? null);
	if (
		defaultHourlyRate !== null &&
		(!Number.isFinite(defaultHourlyRate) || defaultHourlyRate < 0)
	) {
		throw new ValidationError({
			message: "Default hourly rate must be a non-negative number.",
			field: "defaultHourlyRate",
			refusal: "invalid_hourly_rate",
		});
	}

	return {
		workPolicyId: input.workPolicyId ?? null,
		weeklyContractMinutes,
		scheduleMode,
		customDays,
		workModel,
		presenceOverride,
		remoteExemptDefaultApplied,
		balanceMode,
		scheduleSource,
		defaultContractType,
		defaultEmploymentProfile: input.defaultEmploymentProfile ?? null,
		defaultArbzgScope: input.defaultArbzgScope ?? null,
		defaultOnCallHoursKind: onCall.onCallHoursKind,
		defaultOnCallWeeklyMinutes: onCall.onCallWeeklyMinutes,
		defaultOnCallDailyMinutes: onCall.onCallDailyMinutes,
		defaultHourlyRate,
		defaultCurrency: input.defaultCurrency?.trim() || null,
	};
}

async function verifyTemplatePolicyInTx(
	tx: ContractWriteTx,
	organizationId: string,
	workPolicyId: string | null,
): Promise<void> {
	if (!workPolicyId) return;
	const [policy] = await tx
		.select({ id: workPolicy.id, isActive: workPolicy.isActive })
		.from(workPolicy)
		.where(and(eq(workPolicy.id, workPolicyId), eq(workPolicy.organizationId, organizationId)))
		.limit(1);
	if (!policy) {
		throw new NotFoundError({
			message: "Work policy not found",
			entityType: "work_policy",
			entityId: workPolicyId,
		});
	}
	if (!policy.isActive) {
		throw new ValidationError({
			message: "Inactive work policies cannot be used in a contract template.",
			field: "workPolicyId",
			refusal: "work_policy_inactive",
		});
	}
}

/**
 * Creates a named stamping contract template and its initial immutable version (v1).
 * Never mutates any employee records.
 */
export async function createContractTemplateInTx(
	tx: ContractWriteTx,
	input: CreateContractTemplateInput,
): Promise<{
	templateId: string;
	templateVersionId: string;
	versionNumber: 1;
	isDefaultEligible: boolean;
}> {
	const name = input.name.trim();
	if (!name) {
		throw new ValidationError({
			message: "Template name is required.",
			field: "name",
			refusal: "template_name_required",
		});
	}

	const validated = validateTemplateVersionInput(input);
	const now = input.now ?? currentTimestamp();
	await verifyTemplatePolicyInTx(tx, input.organizationId, validated.workPolicyId);

	const [duplicate] = await tx
		.select({ id: contractTemplate.id })
		.from(contractTemplate)
		.where(
			and(
				eq(contractTemplate.organizationId, input.organizationId),
				eq(contractTemplate.kind, "template"),
				eq(contractTemplate.isActive, true),
				eq(contractTemplate.name, name),
			),
		)
		.limit(1);

	if (duplicate) {
		throw new ConflictError({
			message: "An active contract template with this name already exists.",
			conflictType: "duplicate_name",
			details: { entityType: "contract_template", field: "name" },
		});
	}

	const [createdTemplate] = await tx
		.insert(contractTemplate)
		.values({
			organizationId: input.organizationId,
			name,
			description: input.description?.trim() || null,
			kind: "template",
			isActive: true,
			createdBy: input.actorUserId,
			updatedBy: input.actorUserId,
			updatedAt: now,
		})
		.returning({ id: contractTemplate.id });

	if (!createdTemplate) {
		throw new Error("contract_template insert returned no row");
	}

	const [createdVersion] = await tx
		.insert(contractTemplateVersion)
		.values({
			organizationId: input.organizationId,
			templateId: createdTemplate.id,
			versionNumber: 1,
			workPolicyId: validated.workPolicyId,
			weeklyContractMinutes: validated.weeklyContractMinutes,
			scheduleMode: validated.scheduleMode,
			workModel: validated.workModel,
			presenceOverride: validated.presenceOverride,
			balanceMode: validated.balanceMode,
			scheduleSource: validated.scheduleSource,
			defaultContractType: validated.defaultContractType,
			defaultEmploymentProfile: validated.defaultEmploymentProfile,
			defaultArbzgScope: validated.defaultArbzgScope,
			defaultOnCallHoursKind: validated.defaultOnCallHoursKind,
			defaultOnCallWeeklyMinutes: validated.defaultOnCallWeeklyMinutes,
			defaultOnCallDailyMinutes: validated.defaultOnCallDailyMinutes,
			defaultHourlyRate: validated.defaultHourlyRate,
			defaultCurrency: validated.defaultCurrency,
			createdBy: input.actorUserId,
		})
		.returning({
			id: contractTemplateVersion.id,
			isDefaultEligible: contractTemplateVersion.isDefaultEligible,
		});

	if (!createdVersion) {
		throw new Error("contract_template_version insert returned no row");
	}

	if (validated.customDays.length > 0) {
		await tx.insert(contractTemplateVersionDay).values(
			validated.customDays.map((day) => ({
				organizationId: input.organizationId,
				templateVersionId: createdVersion.id,
				dayOfWeek: day.dayOfWeek,
				minutesPerDay: day.minutesPerDay,
				isWorkDay: day.isWorkDay,
				latestClockIn: day.latestClockIn,
			})),
		);
	}

	return {
		templateId: createdTemplate.id,
		templateVersionId: createdVersion.id,
		versionNumber: 1,
		isDefaultEligible: createdVersion.isDefaultEligible,
	};
}

export async function createContractTemplate(
	db: DatabaseClient,
	input: CreateContractTemplateInput,
) {
	return db.transaction((tx) => createContractTemplateInTx(tx, input));
}

/**
 * Publishes a new immutable `contract_template_version` (version N+1) for an existing template.
 * Never mutates any existing employee contract terms or policy assignments.
 */
export async function publishContractTemplateVersionInTx(
	tx: ContractWriteTx,
	input: PublishContractTemplateVersionInput,
): Promise<{
	templateId: string;
	templateVersionId: string;
	versionNumber: number;
	isDefaultEligible: boolean;
}> {
	const validated = validateTemplateVersionInput(input);
	const now = input.now ?? currentTimestamp();
	await verifyTemplatePolicyInTx(tx, input.organizationId, validated.workPolicyId);

	const locked = await tx.execute<{ id: string; name: string; is_active: boolean }>(sql`
		SELECT id, name, is_active
		FROM contract_template
		WHERE id = ${input.templateId}::uuid
			AND organization_id = ${input.organizationId}
			AND kind = 'template'
		FOR UPDATE
	`);

	const templateRow = locked.rows[0];
	if (!templateRow) {
		throw new NotFoundError({
			message: "Contract template not found",
			entityType: "contract_template",
			entityId: input.templateId,
		});
	}

	const nextName = input.name !== undefined ? input.name.trim() : templateRow.name;
	if (!nextName) {
		throw new ValidationError({
			message: "Template name cannot be empty.",
			field: "name",
			refusal: "template_name_required",
		});
	}

	if (nextName !== templateRow.name && templateRow.is_active) {
		const [duplicate] = await tx
			.select({ id: contractTemplate.id })
			.from(contractTemplate)
			.where(
				and(
					eq(contractTemplate.organizationId, input.organizationId),
					eq(contractTemplate.kind, "template"),
					eq(contractTemplate.isActive, true),
					eq(contractTemplate.name, nextName),
				),
			)
			.limit(1);
		if (duplicate && duplicate.id !== templateRow.id) {
			throw new ConflictError({
				message: "An active contract template with this name already exists.",
				conflictType: "duplicate_name",
				details: { entityType: "contract_template", field: "name" },
			});
		}
	}

	if (input.name !== undefined || input.description !== undefined) {
		await tx
			.update(contractTemplate)
			.set({
				name: nextName,
				...(input.description !== undefined
					? { description: input.description?.trim() || null }
					: {}),
				updatedBy: input.actorUserId,
				updatedAt: now,
			})
			.where(
				and(
					eq(contractTemplate.id, input.templateId),
					eq(contractTemplate.organizationId, input.organizationId),
				),
			);
	}

	const [latest] = await tx
		.select({ versionNumber: contractTemplateVersion.versionNumber })
		.from(contractTemplateVersion)
		.where(
			and(
				eq(contractTemplateVersion.organizationId, input.organizationId),
				eq(contractTemplateVersion.templateId, input.templateId),
			),
		)
		.orderBy(desc(contractTemplateVersion.versionNumber))
		.limit(1);

	const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;

	const [createdVersion] = await tx
		.insert(contractTemplateVersion)
		.values({
			organizationId: input.organizationId,
			templateId: input.templateId,
			versionNumber: nextVersionNumber,
			workPolicyId: validated.workPolicyId,
			weeklyContractMinutes: validated.weeklyContractMinutes,
			scheduleMode: validated.scheduleMode,
			workModel: validated.workModel,
			presenceOverride: validated.presenceOverride,
			balanceMode: validated.balanceMode,
			scheduleSource: validated.scheduleSource,
			defaultContractType: validated.defaultContractType,
			defaultEmploymentProfile: validated.defaultEmploymentProfile,
			defaultArbzgScope: validated.defaultArbzgScope,
			defaultOnCallHoursKind: validated.defaultOnCallHoursKind,
			defaultOnCallWeeklyMinutes: validated.defaultOnCallWeeklyMinutes,
			defaultOnCallDailyMinutes: validated.defaultOnCallDailyMinutes,
			defaultHourlyRate: validated.defaultHourlyRate,
			defaultCurrency: validated.defaultCurrency,
			createdBy: input.actorUserId,
		})
		.returning({
			id: contractTemplateVersion.id,
			isDefaultEligible: contractTemplateVersion.isDefaultEligible,
		});

	if (!createdVersion) {
		throw new Error("contract_template_version insert returned no row");
	}

	if (validated.customDays.length > 0) {
		await tx.insert(contractTemplateVersionDay).values(
			validated.customDays.map((day) => ({
				organizationId: input.organizationId,
				templateVersionId: createdVersion.id,
				dayOfWeek: day.dayOfWeek,
				minutesPerDay: day.minutesPerDay,
				isWorkDay: day.isWorkDay,
				latestClockIn: day.latestClockIn,
			})),
		);
	}

	return {
		templateId: input.templateId,
		templateVersionId: createdVersion.id,
		versionNumber: nextVersionNumber,
		isDefaultEligible: createdVersion.isDefaultEligible,
	};
}

export async function publishContractTemplateVersion(
	db: DatabaseClient,
	input: PublishContractTemplateVersionInput,
) {
	return db.transaction((tx) => publishContractTemplateVersionInTx(tx, input));
}

export async function archiveContractTemplate(
	db: DatabaseClient,
	input: { organizationId: string; templateId: string; actorUserId: string },
): Promise<void> {
	const updated = await db
		.update(contractTemplate)
		.set({
			isActive: false,
			updatedBy: input.actorUserId,
			updatedAt: currentTimestamp(),
		})
		.where(
			and(
				eq(contractTemplate.id, input.templateId),
				eq(contractTemplate.organizationId, input.organizationId),
				eq(contractTemplate.kind, "template"),
			),
		)
		.returning({ id: contractTemplate.id });

	if (updated.length === 0) {
		throw new NotFoundError({
			message: "Contract template not found",
			entityType: "contract_template",
			entityId: input.templateId,
		});
	}
}

async function hydrateTemplateVersions(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	templateIds: readonly string[],
): Promise<Map<string, HydratedContractTemplateVersion[]>> {
	const result = new Map<string, HydratedContractTemplateVersion[]>();
	if (templateIds.length === 0) return result;

	const versions = await db
		.select({
			id: contractTemplateVersion.id,
			templateId: contractTemplateVersion.templateId,
			versionNumber: contractTemplateVersion.versionNumber,
			workPolicyId: contractTemplateVersion.workPolicyId,
			workPolicyName: workPolicy.name,
			weeklyContractMinutes: contractTemplateVersion.weeklyContractMinutes,
			scheduleMode: contractTemplateVersion.scheduleMode,
			workModel: contractTemplateVersion.workModel,
			presenceOverride: contractTemplateVersion.presenceOverride,
			balanceMode: contractTemplateVersion.balanceMode,
			scheduleSource: contractTemplateVersion.scheduleSource,
			isDefaultEligible: contractTemplateVersion.isDefaultEligible,
			defaultContractType: contractTemplateVersion.defaultContractType,
			defaultEmploymentProfile: contractTemplateVersion.defaultEmploymentProfile,
			defaultArbzgScope: contractTemplateVersion.defaultArbzgScope,
			defaultOnCallHoursKind: contractTemplateVersion.defaultOnCallHoursKind,
			defaultOnCallWeeklyMinutes: contractTemplateVersion.defaultOnCallWeeklyMinutes,
			defaultOnCallDailyMinutes: contractTemplateVersion.defaultOnCallDailyMinutes,
			defaultHourlyRate: contractTemplateVersion.defaultHourlyRate,
			defaultCurrency: contractTemplateVersion.defaultCurrency,
			createdAt: contractTemplateVersion.createdAt,
			createdBy: contractTemplateVersion.createdBy,
		})
		.from(contractTemplateVersion)
		.leftJoin(
			workPolicy,
			and(
				eq(workPolicy.id, contractTemplateVersion.workPolicyId),
				eq(workPolicy.organizationId, contractTemplateVersion.organizationId),
			),
		)
		.where(
			and(
				eq(contractTemplateVersion.organizationId, organizationId),
				inArray(contractTemplateVersion.templateId, [...templateIds]),
			),
		)
		.orderBy(desc(contractTemplateVersion.versionNumber));

	const versionIds = versions.map((v) => v.id);
	const days =
		versionIds.length > 0
			? await db
					.select()
					.from(contractTemplateVersionDay)
					.where(
						and(
							eq(contractTemplateVersionDay.organizationId, organizationId),
							inArray(contractTemplateVersionDay.templateVersionId, versionIds),
						),
					)
			: [];
	const daysByVersion = Map.groupBy(days, (d) => d.templateVersionId);

	for (const version of versions) {
		const list = result.get(version.templateId) ?? [];
		list.push({
			...version,
			customDays: (daysByVersion.get(version.id) ?? []).map((d) => ({
				dayOfWeek: d.dayOfWeek,
				minutesPerDay: d.minutesPerDay,
				isWorkDay: d.isWorkDay,
				latestClockIn: d.latestClockIn,
			})),
		});
		result.set(version.templateId, list);
	}
	return result;
}

export async function listContractTemplates(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	options: { includeInactive?: boolean } = {},
): Promise<HydratedContractTemplateSummary[]> {
	const conditions = [
		eq(contractTemplate.organizationId, organizationId),
		eq(contractTemplate.kind, "template"),
	];
	if (!options.includeInactive) {
		conditions.push(eq(contractTemplate.isActive, true));
	}

	const templates = await db
		.select()
		.from(contractTemplate)
		.where(and(...conditions))
		.orderBy(asc(contractTemplate.name));

	const versionsByTemplate = await hydrateTemplateVersions(
		db,
		organizationId,
		templates.map((t) => t.id),
	);

	return templates.map((t) => {
		const versions = versionsByTemplate.get(t.id) ?? [];
		return {
			id: t.id,
			organizationId: t.organizationId,
			name: t.name,
			description: t.description,
			isActive: t.isActive,
			versionCount: versions.length,
			latestVersion: versions[0] ?? null,
			createdAt: t.createdAt,
			updatedAt: t.updatedAt,
		};
	});
}

export async function getContractTemplate(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	templateId: string,
): Promise<HydratedContractTemplateDetail | null> {
	const [templateRow] = await db
		.select()
		.from(contractTemplate)
		.where(
			and(
				eq(contractTemplate.id, templateId),
				eq(contractTemplate.organizationId, organizationId),
				eq(contractTemplate.kind, "template"),
			),
		)
		.limit(1);

	if (!templateRow) return null;

	const versionsByTemplate = await hydrateTemplateVersions(db, organizationId, [templateRow.id]);
	const versions = versionsByTemplate.get(templateRow.id) ?? [];

	return {
		id: templateRow.id,
		organizationId: templateRow.organizationId,
		name: templateRow.name,
		description: templateRow.description,
		isActive: templateRow.isActive,
		versionCount: versions.length,
		latestVersion: versions[0] ?? null,
		versions,
		createdAt: templateRow.createdAt,
		updatedAt: templateRow.updatedAt,
	};
}

/**
 * Strictly read-only preview of stamping a `contract_template_version` onto an employee
 * as of `effectiveFromDate`: computes sparse operational overrides (respecting
 * `preserveDivergences`, defaulting true) and one-time employee-owned field prefills.
 */
export async function previewTemplateApplication(
	db: Pick<DatabaseClient, "select">,
	input: {
		organizationId: string;
		employeeId: string;
		templateVersionId: string;
		effectiveFromDate: string;
		preserveDivergences?: boolean;
	},
): Promise<PreviewTemplateApplicationResult> {
	const effectiveFromDate = parseIsoCalendarDate(input.effectiveFromDate, "effectiveFromDate");
	const preserveDivergences = input.preserveDivergences ?? true;

	const [versionRow] = await db
		.select({
			version: contractTemplateVersion,
			templateName: contractTemplate.name,
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
				eq(contractTemplateVersion.id, input.templateVersionId),
				eq(contractTemplateVersion.organizationId, input.organizationId),
			),
		)
		.limit(1);

	if (!versionRow) {
		throw new NotFoundError({
			message: "Contract template version not found",
			entityType: "contract_template_version",
			entityId: input.templateVersionId,
		});
	}

	const [templateDays, currentContract] = await Promise.all([
		db
			.select()
			.from(contractTemplateVersionDay)
			.where(
				and(
					eq(contractTemplateVersionDay.organizationId, input.organizationId),
					eq(contractTemplateVersionDay.templateVersionId, input.templateVersionId),
				),
			),
		resolveEffectiveContractOnDay(db, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			date: effectiveFromDate,
		}),
	]);

	if (!currentContract) {
		throw new NotFoundError({
			message: "Employee not found",
			entityType: "employee",
			entityId: input.employeeId,
		});
	}

	const v = versionRow.version;
	const normalizedDays: CustomWorkDay[] = templateDays.map((d) => ({
		dayOfWeek: d.dayOfWeek,
		minutesPerDay: d.minutesPerDay,
		isWorkDay: d.isWorkDay,
		latestClockIn: d.latestClockIn,
	}));

	const preservedDivergenceFields: string[] = [];

	const pickOperational = <T>(
		field: string,
		isCurrentlyDiverged: boolean,
		currentVal: T,
		templateVal: T,
	): T => {
		if (preserveDivergences && isCurrentlyDiverged) {
			preservedDivergenceFields.push(field);
			return currentVal;
		}
		return templateVal;
	};

	const nextWorkModel = pickOperational(
		"workModel",
		currentContract.workModelSource === "employee_override",
		currentContract.workModel,
		v.workModel,
	);
	const nextPresenceOverride = pickOperational(
		"presenceOverride",
		currentContract.presenceOverrideSource === "employee_override",
		currentContract.presenceOverride,
		v.presenceOverride,
	);
	const nextScheduleSource = pickOperational(
		"scheduleSource",
		currentContract.scheduleSourceSource === "employee_override",
		currentContract.scheduleSource,
		v.scheduleSource,
	);
	const nextScheduleMode = pickOperational(
		"scheduleMode",
		currentContract.scheduleModeSource === "employee_override",
		currentContract.scheduleMode,
		v.scheduleMode,
	);
	const nextWeeklyMinutes = pickOperational(
		"weeklyContractMinutes",
		currentContract.weeklyContractMinutesSource === "employee_override",
		currentContract.weeklyContractMinutes,
		v.weeklyContractMinutes,
	);
	const nextWorkPolicyId = pickOperational(
		"workPolicy",
		currentContract.workPolicySource === "employee_override",
		currentContract.workPolicy?.policyId ?? null,
		v.workPolicyId,
	);
	const nextBalanceMode = pickOperational(
		"balanceMode",
		currentContract.balanceModeSource === "employee_override",
		storedBalanceMode(currentContract.balanceMode),
		v.balanceMode,
	);

	const employeeOwnedPrefill = {
		contractType: v.defaultContractType ?? currentContract.contractType,
		hourlyRate:
			(v.defaultContractType ?? currentContract.contractType) === "fixed"
				? null
				: (v.defaultHourlyRate ?? currentContract.hourlyRate),
		currency: v.defaultCurrency ?? currentContract.currency,
		employmentProfile: v.defaultEmploymentProfile ?? currentContract.employmentProfile ?? "regular",
		arbzgScope: v.defaultArbzgScope ?? currentContract.arbzgScope,
		onCallHoursKind:
			nextScheduleSource === "on_call"
				? (v.defaultOnCallHoursKind ?? currentContract.onCallTerms?.hoursKind ?? null)
				: null,
		onCallWeeklyMinutes:
			nextScheduleSource === "on_call"
				? (v.defaultOnCallWeeklyMinutes ?? currentContract.onCallTerms?.weeklyMinutes ?? null)
				: null,
		onCallDailyMinutes:
			nextScheduleSource === "on_call"
				? (v.defaultOnCallDailyMinutes ?? currentContract.onCallTerms?.dailyMinutes ?? null)
				: null,
	};

	return {
		templateId: v.templateId,
		templateName: versionRow.templateName,
		templateVersionId: v.id,
		versionNumber: v.versionNumber,
		effectiveFromDate,
		employeeId: input.employeeId,
		preserveDivergences,
		operationalOverridesToWrite: {
			workPolicyId: nextWorkPolicyId,
			weeklyContractMinutes: nextWeeklyMinutes,
			scheduleMode: nextScheduleMode,
			customDays: nextScheduleMode === "custom_days" ? normalizedDays : [],
			workModel: nextWorkModel,
			presenceOverride: nextPresenceOverride,
			balanceMode: nextBalanceMode,
			scheduleSource: nextScheduleSource,
		},
		employeeOwnedPrefill,
		onCallPreview: buildOnCallStatutoryPreview({
			scheduleSource: nextScheduleSource,
			onCallHoursKind: employeeOwnedPrefill.onCallHoursKind,
			onCallWeeklyMinutes: employeeOwnedPrefill.onCallWeeklyMinutes,
			onCallDailyMinutes: employeeOwnedPrefill.onCallDailyMinutes,
		}),
		preservedDivergenceFields,
		remoteExemptDefaultApplied: nextWorkModel === "remote" && nextPresenceOverride === "exempt",
	};
}
