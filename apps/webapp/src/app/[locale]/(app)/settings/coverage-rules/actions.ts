"use server";

import { revalidatePath } from "next/cache";
import { Effect } from "effect";
import { getAuthContext } from "@/lib/auth-helpers";
import { CoverageService, type CoverageRuleWithRelations, type TargetCoverageGap, type CoverageSettingsData } from "@/lib/effect/services/coverage.service";
import { safeAction } from "@/lib/effect/runtime";
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
	const authContext = await getAuthContext();
	if (!authContext?.employee) {
		return { success: false, error: "Unauthorized" };
	}

	// Only admins and managers can view coverage rules
	if (!["admin", "manager"].includes(authContext.employee.role)) {
		return { success: false, error: "Unauthorized: Admin or manager access required" };
	}

	const effect = Effect.gen(function* (_) {
		const coverageService = yield* _(CoverageService);
		return yield* _(coverageService.getCoverageRules(authContext.employee!.organizationId, subareaId));
	});

	return safeAction(effect);
}

/**
 * Get a single coverage rule by ID.
 */
export async function getCoverageRule(
	ruleId: string,
): Promise<ServerActionResult<CoverageRuleWithRelations | null>> {
	const authContext = await getAuthContext();
	if (!authContext?.employee) {
		return { success: false, error: "Unauthorized" };
	}

	if (!["admin", "manager"].includes(authContext.employee.role)) {
		return { success: false, error: "Unauthorized: Admin or manager access required" };
	}

	const effect = Effect.gen(function* (_) {
		const coverageService = yield* _(CoverageService);
		return yield* _(coverageService.getCoverageRuleById(ruleId));
	});

	return safeAction(effect);
}

/**
 * Create a new coverage rule.
 */
export async function createCoverageRule(
	data: CreateCoverageRule,
): Promise<ServerActionResult<CoverageRuleWithRelations>> {
	const authContext = await getAuthContext();
	if (!authContext?.employee || authContext.employee.role !== "admin") {
		return { success: false, error: "Unauthorized: Admin access required" };
	}

	// Validate input
	const validated = createCoverageRuleSchema.safeParse(data);
	if (!validated.success) {
		return { success: false, error: validated.error.issues[0]?.message ?? "Invalid data" };
	}

	const effect = Effect.gen(function* (_) {
		const coverageService = yield* _(CoverageService);
		return yield* _(
			coverageService.createCoverageRule({
				organizationId: authContext.employee!.organizationId,
				subareaId: validated.data.subareaId,
				dayOfWeek: validated.data.dayOfWeek,
				startTime: validated.data.startTime,
				endTime: validated.data.endTime,
				minimumStaffCount: validated.data.minimumStaffCount,
				priority: validated.data.priority ?? 0,
				createdBy: authContext.user.id,
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
	const authContext = await getAuthContext();
	if (!authContext?.employee || authContext.employee.role !== "admin") {
		return { success: false, error: "Unauthorized: Admin access required" };
	}

	// Validate input
	const validated = updateCoverageRuleSchema.safeParse(data);
	if (!validated.success) {
		return { success: false, error: validated.error.issues[0]?.message ?? "Invalid data" };
	}

	const effect = Effect.gen(function* (_) {
		const coverageService = yield* _(CoverageService);
		return yield* _(
			coverageService.updateCoverageRule(ruleId, {
				...validated.data,
				updatedBy: authContext.user.id,
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
	const authContext = await getAuthContext();
	if (!authContext?.employee || authContext.employee.role !== "admin") {
		return { success: false, error: "Unauthorized: Admin access required" };
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
	const authContext = await getAuthContext();
	if (!authContext?.employee) {
		return { success: false, error: "Unauthorized" };
	}

	// Only admins and managers can view coverage heatmap
	if (!["admin", "manager"].includes(authContext.employee.role)) {
		return { success: false, error: "Unauthorized: Admin or manager access required" };
	}

	const effect = Effect.gen(function* (_) {
		const coverageService = yield* _(CoverageService);
		return yield* _(
			coverageService.getTargetHeatmapData({
				organizationId: authContext.employee!.organizationId,
				startDate: params.startDate,
				endDate: params.endDate,
				subareaIds: params.subareaIds,
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
	const authContext = await getAuthContext();
	if (!authContext?.employee) {
		return { success: false, error: "Unauthorized" };
	}

	if (!["admin", "manager"].includes(authContext.employee.role)) {
		return { success: false, error: "Unauthorized: Admin or manager access required" };
	}

	const effect = Effect.gen(function* (_) {
		const coverageService = yield* _(CoverageService);
		return yield* _(
			coverageService.validateScheduleCanPublish({
				organizationId: authContext.employee!.organizationId,
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
	const authContext = await getAuthContext();
	if (!authContext?.employee) {
		return { success: false, error: "Unauthorized" };
	}

	if (!["admin", "manager"].includes(authContext.employee.role)) {
		return { success: false, error: "Unauthorized: Admin or manager access required" };
	}

	const effect = Effect.gen(function* (_) {
		const coverageService = yield* _(CoverageService);
		return yield* _(coverageService.getCoverageSettings(authContext.employee!.organizationId));
	});

	return safeAction(effect);
}

/**
 * Update coverage settings for the organization.
 */
export async function updateCoverageSettings(
	settings: { allowPublishWithGaps: boolean },
): Promise<ServerActionResult<CoverageSettingsData>> {
	const authContext = await getAuthContext();
	if (!authContext?.employee || authContext.employee.role !== "admin") {
		return { success: false, error: "Unauthorized: Admin access required" };
	}

	const effect = Effect.gen(function* (_) {
		const coverageService = yield* _(CoverageService);
		return yield* _(
			coverageService.updateCoverageSettings(authContext.employee!.organizationId, {
				allowPublishWithGaps: settings.allowPublishWithGaps,
				updatedBy: authContext.user.id,
			}),
		);
	});

	const result = await safeAction(effect);
	if (result.success) {
		revalidatePath("/settings/coverage-rules");
	}
	return result;
}
