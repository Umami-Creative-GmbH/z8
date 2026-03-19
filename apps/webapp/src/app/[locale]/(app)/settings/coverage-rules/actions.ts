"use server";

import { revalidatePath } from "next/cache";
import { Effect } from "effect";
import { CoverageService, type CoverageRuleWithRelations, type TargetCoverageGap, type CoverageSettingsData } from "@/lib/effect/services/coverage.service";
import { safeAction } from "@/lib/effect/runtime";
import {
	canManageScopedSchedulingSubarea,
	filterItemsToManageableSubareas,
	getCoverageRuleScopeTarget,
	getSchedulingSettingsAccessContext,
} from "@/lib/settings-scheduling-access";
import {
	createCoverageRuleSchema,
	updateCoverageRuleSchema,
	type CreateCoverageRule,
	type UpdateCoverageRule,
} from "@/lib/validations/coverage";
import type { HeatmapDataPoint } from "@/lib/coverage/domain/entities/coverage-snapshot";

// ============================================
// TYPES
// ============================================

export type ServerActionResult<T> = { success: true; data: T } | { success: false; error: string };

// ============================================
// COVERAGE RULE CRUD
// ============================================

/**
 * Get all coverage rules for the organization.
 */
export async function getCoverageRules(
	subareaId?: string,
): Promise<ServerActionResult<CoverageRuleWithRelations[]>> {
	const accessContext = await getSchedulingSettingsAccessContext();
	if (!accessContext || !accessContext.canAccessCoverageRules) {
		return { success: false, error: "Unauthorized" };
	}

	if (
		subareaId &&
		!canManageScopedSchedulingSubarea(
			accessContext.accessTier,
			accessContext.manageableSubareaIds,
			subareaId,
		)
	) {
		return { success: false, error: "Unauthorized" };
	}

	const effect = Effect.gen(function* (_) {
		const coverageService = yield* _(CoverageService);
		return yield* _(coverageService.getCoverageRules(accessContext.organizationId, subareaId));
	});

	const result = await safeAction(effect);
	if (!result.success) {
		return result;
	}

	return {
		success: true,
		data: filterItemsToManageableSubareas(result.data, accessContext.manageableSubareaIds),
	};
}

/**
 * Get a single coverage rule by ID.
 */
export async function getCoverageRule(
	ruleId: string,
): Promise<ServerActionResult<CoverageRuleWithRelations | null>> {
	const accessContext = await getSchedulingSettingsAccessContext();
	if (!accessContext || !accessContext.canAccessCoverageRules) {
		return { success: false, error: "Unauthorized" };
	}

	const effect = Effect.gen(function* (_) {
		const coverageService = yield* _(CoverageService);
		return yield* _(coverageService.getCoverageRuleById(ruleId));
	});

	const result = await safeAction(effect);
	if (!result.success || !result.data) {
		return result;
	}

	if (
		!canManageScopedSchedulingSubarea(
			accessContext.accessTier,
			accessContext.manageableSubareaIds,
			result.data.subareaId,
		)
	) {
		return { success: false, error: "Unauthorized" };
	}

	return result;
}

/**
 * Create a new coverage rule.
 */
export async function createCoverageRule(
	data: CreateCoverageRule,
): Promise<ServerActionResult<CoverageRuleWithRelations>> {
	const accessContext = await getSchedulingSettingsAccessContext();
	if (!accessContext || !accessContext.canAccessCoverageRules) {
		return { success: false, error: "Unauthorized" };
	}

	// Validate input
	const validated = createCoverageRuleSchema.safeParse(data);
	if (!validated.success) {
		return { success: false, error: validated.error.issues[0]?.message ?? "Invalid data" };
	}

	if (
		!canManageScopedSchedulingSubarea(
			accessContext.accessTier,
			accessContext.manageableSubareaIds,
			validated.data.subareaId,
		)
	) {
		return { success: false, error: "Unauthorized" };
	}

	const effect = Effect.gen(function* (_) {
		const coverageService = yield* _(CoverageService);
		return yield* _(
			coverageService.createCoverageRule({
				organizationId: accessContext.organizationId,
				subareaId: validated.data.subareaId,
				dayOfWeek: validated.data.dayOfWeek,
				startTime: validated.data.startTime,
				endTime: validated.data.endTime,
				minimumStaffCount: validated.data.minimumStaffCount,
				priority: validated.data.priority ?? 0,
				createdBy: accessContext.authContext.user.id,
			}),
		);
	});

	const result = await safeAction(effect);
	if (result.success) {
		revalidatePath("/settings/coverage-rules");
	}
	return result;
}

/**
 * Update a coverage rule.
 */
export async function updateCoverageRule(
	ruleId: string,
	data: UpdateCoverageRule,
): Promise<ServerActionResult<CoverageRuleWithRelations>> {
	const accessContext = await getSchedulingSettingsAccessContext();
	if (!accessContext || !accessContext.canAccessCoverageRules) {
		return { success: false, error: "Unauthorized" };
	}

	const existingRuleTarget = await getCoverageRuleScopeTarget(ruleId);
	if (!existingRuleTarget) {
		return { success: false, error: "Coverage rule not found" };
	}

	if (existingRuleTarget.organizationId !== accessContext.organizationId) {
		return { success: false, error: "Unauthorized" };
	}

	// Validate input
	const validated = updateCoverageRuleSchema.safeParse(data);
	if (!validated.success) {
		return { success: false, error: validated.error.issues[0]?.message ?? "Invalid data" };
	}

	const nextSubareaId = validated.data.subareaId ?? existingRuleTarget.subareaId;
	if (
		!canManageScopedSchedulingSubarea(
			accessContext.accessTier,
			accessContext.manageableSubareaIds,
			nextSubareaId,
		)
	) {
		return { success: false, error: "Unauthorized" };
	}

	const effect = Effect.gen(function* (_) {
		const coverageService = yield* _(CoverageService);
		return yield* _(
			coverageService.updateCoverageRule(ruleId, {
				...validated.data,
				updatedBy: accessContext.authContext.user.id,
			}),
		);
	});

	const result = await safeAction(effect);
	if (result.success) {
		revalidatePath("/settings/coverage-rules");
	}
	return result;
}

/**
 * Delete a coverage rule.
 */
export async function deleteCoverageRule(ruleId: string): Promise<ServerActionResult<void>> {
	const accessContext = await getSchedulingSettingsAccessContext();
	if (!accessContext || !accessContext.canAccessCoverageRules) {
		return { success: false, error: "Unauthorized" };
	}

	const existingRuleTarget = await getCoverageRuleScopeTarget(ruleId);
	if (!existingRuleTarget) {
		return { success: false, error: "Coverage rule not found" };
	}

	if (existingRuleTarget.organizationId !== accessContext.organizationId) {
		return { success: false, error: "Unauthorized" };
	}

	if (
		!canManageScopedSchedulingSubarea(
			accessContext.accessTier,
			accessContext.manageableSubareaIds,
			existingRuleTarget.subareaId,
		)
	) {
		return { success: false, error: "Unauthorized" };
	}

	const effect = Effect.gen(function* (_) {
		const coverageService = yield* _(CoverageService);
		return yield* _(coverageService.deleteCoverageRule(ruleId));
	});

	const result = await safeAction(effect);
	if (result.success) {
		revalidatePath("/settings/coverage-rules");
	}
	return result;
}

// ============================================
// COVERAGE CALCULATION
// ============================================

/**
 * Get heatmap data for coverage visualization in the scheduler.
 */
export async function getTargetHeatmapData(params: {
	startDate: Date;
	endDate: Date;
	subareaIds?: string[];
}): Promise<ServerActionResult<HeatmapDataPoint[]>> {
	const accessContext = await getSchedulingSettingsAccessContext();
	if (!accessContext || !accessContext.canAccessCoverageRules) {
		return { success: false, error: "Unauthorized" };
	}

	const scopedSubareaIds = accessContext.manageableSubareaIds
		? params.subareaIds?.filter((subareaId) => accessContext.manageableSubareaIds?.has(subareaId)) ??
			[...accessContext.manageableSubareaIds]
		: params.subareaIds;

	const effect = Effect.gen(function* (_) {
		const coverageService = yield* _(CoverageService);
		return yield* _(
			coverageService.getTargetHeatmapData({
				organizationId: accessContext.organizationId,
				startDate: params.startDate,
				endDate: params.endDate,
				subareaIds: scopedSubareaIds,
			}),
		);
	});

	return safeAction(effect);
}

/**
 * Validate if a schedule can be published (check for coverage gaps).
 */
export async function validateScheduleForPublish(params: {
	startDate: Date;
	endDate: Date;
}): Promise<ServerActionResult<{ canPublish: boolean; gaps: TargetCoverageGap[] }>> {
	const accessContext = await getSchedulingSettingsAccessContext();
	if (
		!accessContext ||
		!accessContext.canAccessCoverageRules ||
		accessContext.accessTier !== "orgAdmin"
	) {
		return { success: false, error: "Unauthorized" };
	}

	const effect = Effect.gen(function* (_) {
		const coverageService = yield* _(CoverageService);
		return yield* _(
			coverageService.validateScheduleCanPublish({
				organizationId: accessContext.organizationId,
				startDate: params.startDate,
				endDate: params.endDate,
			}),
		);
	});

	return safeAction(effect);
}

// ============================================
// COVERAGE SETTINGS
// ============================================

/**
 * Get coverage settings for the organization.
 */
export async function getCoverageSettings(): Promise<ServerActionResult<CoverageSettingsData>> {
	const accessContext = await getSchedulingSettingsAccessContext();
	if (
		!accessContext ||
		!accessContext.canAccessCoverageRules ||
		accessContext.accessTier !== "orgAdmin"
	) {
		return { success: false, error: "Unauthorized" };
	}

	const effect = Effect.gen(function* (_) {
		const coverageService = yield* _(CoverageService);
		return yield* _(coverageService.getCoverageSettings(accessContext.organizationId));
	});

	return safeAction(effect);
}

/**
 * Update coverage settings for the organization.
 */
export async function updateCoverageSettings(
	settings: { allowPublishWithGaps: boolean },
): Promise<ServerActionResult<CoverageSettingsData>> {
	const accessContext = await getSchedulingSettingsAccessContext();
	if (!accessContext || !accessContext.canManageCoverageSettings) {
		return { success: false, error: "Unauthorized" };
	}

	const effect = Effect.gen(function* (_) {
		const coverageService = yield* _(CoverageService);
		return yield* _(
			coverageService.updateCoverageSettings(accessContext.organizationId, {
				allowPublishWithGaps: settings.allowPublishWithGaps,
				updatedBy: accessContext.authContext.user.id,
			}),
		);
	});

	const result = await safeAction(effect);
	if (result.success) {
		revalidatePath("/settings/coverage-rules");
	}
	return result;
}
