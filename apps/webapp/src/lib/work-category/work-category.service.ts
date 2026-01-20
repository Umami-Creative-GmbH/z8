/**
 * Work Category Service
 *
 * Business logic for calculating effective working time based on work categories.
 * Work categories apply a factor (0.0-2.0) to tracked time to calculate effective time.
 *
 * Example: "Passive Travel" with factor 0.5 means 2 hours tracked = 1 hour effective.
 */

import type { WorkCategoryRecord } from "@/lib/query/work-category.queries";

// ============================================
// Types
// ============================================

export interface EffectiveTimeCalculation {
	/** Original tracked time in minutes */
	trackedMinutes: number;
	/** Factor applied (1.0 if no category) */
	factor: number;
	/** Effective time after applying factor (trackedMinutes * factor) */
	effectiveMinutes: number;
	/** Category name (null if no category selected) */
	categoryName: string | null;
	/** Category color (null if no category selected) */
	categoryColor: string | null;
}

export interface WorkPeriodWithCategory {
	id: string;
	durationMinutes: number | null;
	workCategory: {
		id: string;
		name: string;
		factor: string;
		color: string | null;
	} | null;
}

export interface PeriodEffectiveTimeSummary {
	/** Total tracked time across all work periods */
	totalTrackedMinutes: number;
	/** Total effective time after applying all factors */
	totalEffectiveMinutes: number;
	/** Breakdown by category */
	byCategory: Map<
		string | null,
		{
			categoryId: string | null;
			categoryName: string | null;
			categoryColor: string | null;
			factor: number;
			trackedMinutes: number;
			effectiveMinutes: number;
			periodCount: number;
		}
	>;
}

// ============================================
// Core Calculations
// ============================================

/**
 * Calculate effective working time for a single work period.
 *
 * @param trackedMinutes - Actual time tracked
 * @param category - Work category with factor (null means factor 1.0)
 * @returns Calculation result with tracked, effective, and factor
 */
export function calculateEffectiveTime(
	trackedMinutes: number,
	category: Pick<WorkCategoryRecord, "name" | "factor" | "color"> | null,
): EffectiveTimeCalculation {
	// Default factor is 1.0 (100% of tracked time counts)
	const factor = category ? parseFloat(category.factor) : 1.0;

	// Ensure factor is within valid range
	const clampedFactor = Math.max(0, Math.min(2, factor));

	// Calculate effective time
	const effectiveMinutes = Math.round(trackedMinutes * clampedFactor);

	return {
		trackedMinutes,
		factor: clampedFactor,
		effectiveMinutes,
		categoryName: category?.name ?? null,
		categoryColor: category?.color ?? null,
	};
}

/**
 * Calculate effective time for multiple work periods and aggregate the results.
 *
 * @param workPeriods - Array of work periods with optional category
 * @returns Summary with totals and breakdown by category
 */
export function calculatePeriodEffectiveTimeSummary(
	workPeriods: WorkPeriodWithCategory[],
): PeriodEffectiveTimeSummary {
	const byCategory = new Map<
		string | null,
		{
			categoryId: string | null;
			categoryName: string | null;
			categoryColor: string | null;
			factor: number;
			trackedMinutes: number;
			effectiveMinutes: number;
			periodCount: number;
		}
	>();

	let totalTrackedMinutes = 0;
	let totalEffectiveMinutes = 0;

	for (const period of workPeriods) {
		if (!period.durationMinutes) continue;

		const category = period.workCategory;
		const calculation = calculateEffectiveTime(
			period.durationMinutes,
			category
				? {
						name: category.name,
						factor: category.factor,
						color: category.color,
					}
				: null,
		);

		totalTrackedMinutes += calculation.trackedMinutes;
		totalEffectiveMinutes += calculation.effectiveMinutes;

		// Aggregate by category
		const categoryId = category?.id ?? null;
		const existing = byCategory.get(categoryId);

		if (existing) {
			existing.trackedMinutes += calculation.trackedMinutes;
			existing.effectiveMinutes += calculation.effectiveMinutes;
			existing.periodCount += 1;
		} else {
			byCategory.set(categoryId, {
				categoryId,
				categoryName: calculation.categoryName,
				categoryColor: calculation.categoryColor,
				factor: calculation.factor,
				trackedMinutes: calculation.trackedMinutes,
				effectiveMinutes: calculation.effectiveMinutes,
				periodCount: 1,
			});
		}
	}

	return {
		totalTrackedMinutes,
		totalEffectiveMinutes,
		byCategory,
	};
}

// ============================================
// Formatting Utilities
// ============================================

/**
 * Format minutes as hours and minutes (e.g., "2h 30m")
 */
export function formatMinutesAsHoursMinutes(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;

	if (hours === 0) {
		return `${mins}m`;
	}

	if (mins === 0) {
		return `${hours}h`;
	}

	return `${hours}h ${mins}m`;
}

/**
 * Format effective time with factor indication.
 * Shows both tracked and effective if different.
 *
 * @example
 * formatEffectiveTimeDisplay({ trackedMinutes: 120, effectiveMinutes: 60, factor: 0.5 })
 * // Returns: "2h tracked → 1h effective (0.5x)"
 */
export function formatEffectiveTimeDisplay(
	calculation: EffectiveTimeCalculation,
): string {
	const { trackedMinutes, effectiveMinutes, factor } = calculation;

	const tracked = formatMinutesAsHoursMinutes(trackedMinutes);
	const effective = formatMinutesAsHoursMinutes(effectiveMinutes);

	// If factor is 1.0, just show the time
	if (factor === 1.0) {
		return tracked;
	}

	return `${tracked} tracked → ${effective} effective (${factor}x)`;
}

/**
 * Format factor as a percentage or multiplier string
 *
 * @example
 * formatFactor(0.5) // "50%"
 * formatFactor(1.0) // "100%"
 * formatFactor(1.5) // "150%"
 */
export function formatFactor(factor: number): string {
	return `${Math.round(factor * 100)}%`;
}

/**
 * Format factor as a multiplier
 *
 * @example
 * formatFactorAsMultiplier(0.5) // "0.5x"
 * formatFactorAsMultiplier(1.0) // "1x"
 * formatFactorAsMultiplier(1.5) // "1.5x"
 */
export function formatFactorAsMultiplier(factor: number): string {
	// Remove trailing zeros for cleaner display
	const formatted = factor.toFixed(2).replace(/\.?0+$/, "");
	return `${formatted}x`;
}

// ============================================
// Validation
// ============================================

/**
 * Validate that a factor is within the allowed range (0.0 to 2.0)
 */
export function isValidFactor(factor: number): boolean {
	return !Number.isNaN(factor) && factor >= 0 && factor <= 2;
}

/**
 * Parse and validate a factor from string input
 */
export function parseFactorInput(input: string): { valid: boolean; value: number } {
	const parsed = parseFloat(input);

	if (Number.isNaN(parsed)) {
		return { valid: false, value: 1.0 };
	}

	if (!isValidFactor(parsed)) {
		return { valid: false, value: parsed };
	}

	return { valid: true, value: parsed };
}
