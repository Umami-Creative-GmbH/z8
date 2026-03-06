/**
 * CoverageLevel value object representing the coverage status of a time slot.
 */

export type CoverageStatus = "under" | "met" | "over";

export interface CoverageLevel {
	required: number;
	actual: number;
}

/**
 * Get the coverage status for a given coverage level.
 * - "under": actual < required (understaffed)
 * - "met": actual === required (exactly right)
 * - "over": actual > required (overstaffed)
 */
export function getCoverageStatus(level: CoverageLevel): CoverageStatus {
	if (level.actual < level.required) {
		return "under";
	}
	if (level.actual > level.required) {
		return "over";
	}
	return "met";
}

/**
 * Get the gap count (how many more staff are needed).
 * Returns 0 if coverage is met or exceeded.
 */
export function getCoverageGap(level: CoverageLevel): number {
	return Math.max(0, level.required - level.actual);
}

/**
 * Get the surplus count (how many extra staff are scheduled).
 * Returns 0 if coverage is not exceeded.
 */
export function getCoverageSurplus(level: CoverageLevel): number {
	return Math.max(0, level.actual - level.required);
}

/**
 * Get the utilization percentage.
 * Returns 100 if required is 0 and actual is 0.
 * Returns Infinity if required is 0 but actual > 0.
 */
export function getCoverageUtilization(level: CoverageLevel): number {
	if (level.required === 0) {
		return level.actual === 0 ? 100 : Number.POSITIVE_INFINITY;
	}
	return (level.actual / level.required) * 100;
}

/**
 * Create a coverage level.
 */
export function createCoverageLevel(required: number, actual: number): CoverageLevel {
	return { required, actual };
}

/**
 * Check if coverage has any gaps.
 */
export function hasGap(level: CoverageLevel): boolean {
	return level.actual < level.required;
}

/**
 * Get a human-readable description of the coverage status.
 */
export function getCoverageDescription(level: CoverageLevel): string {
	const status = getCoverageStatus(level);
	const gap = getCoverageGap(level);
	const surplus = getCoverageSurplus(level);

	switch (status) {
		case "under":
			return `Understaffed by ${gap} (${level.actual}/${level.required})`;
		case "over":
			return `Overstaffed by ${surplus} (${level.actual}/${level.required})`;
		case "met":
			return `Fully staffed (${level.actual}/${level.required})`;
	}
}
