import type { StaffingSuggestion } from "./types";

const nameCollator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function hasRequiredSkillWarning(suggestion: StaffingSuggestion): boolean {
	return suggestion.warnings.some(
		(warning) => warning.type === "missingRequiredSkill" || warning.type === "expiredRequiredSkill",
	);
}

function hasComplianceWarning(suggestion: StaffingSuggestion): boolean {
	return suggestion.warnings.some((warning) => warning.type === "compliance");
}

/** `false` sorts before `true`. */
function compareFlags(left: boolean, right: boolean): number {
	return Number(left) - Number(right);
}

function compareRemainingMinutes(left: number | null, right: number | null): number {
	if (left === null || right === null) {
		return compareFlags(left === null, right === null);
	}
	return right - left;
}

/**
 * Orders staffing suggestions by fixed keys, each one deciding only ties of the one before:
 * 1. no warning about a required skill,
 * 2. no compliance warning,
 * 3. requested this shift,
 * 4. most remaining contracted minutes, candidates without a target last,
 * 5. display name.
 * There is no score.
 */
export function rankStaffingSuggestions(
	suggestions: readonly StaffingSuggestion[],
): StaffingSuggestion[] {
	return suggestions.toSorted(
		(left, right) =>
			compareFlags(hasRequiredSkillWarning(left), hasRequiredSkillWarning(right)) ||
			compareFlags(hasComplianceWarning(left), hasComplianceWarning(right)) ||
			compareFlags(!left.requestedThisShift, !right.requestedThisShift) ||
			compareRemainingMinutes(left.remainingContractedMinutes, right.remainingContractedMinutes) ||
			nameCollator.compare(left.displayName, right.displayName) ||
			left.employeeId.localeCompare(right.employeeId),
	);
}
