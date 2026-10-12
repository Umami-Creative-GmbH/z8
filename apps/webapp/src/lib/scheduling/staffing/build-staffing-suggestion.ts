import type { ComplianceFinding } from "@/lib/scheduling/compliance/types";
import type { StaffingAbsence } from "./load-staffing-facts";
import type { assessStaffingSkills } from "./staffing-skills";
import type { StaffingReason, StaffingSuggestion, StaffingWarning } from "./types";

/** One candidate's suggestion from the facts gathered for them; ranking happens afterwards. */
export function buildStaffingSuggestion(input: {
	employeeId: string;
	displayName: string;
	skills: ReturnType<typeof assessStaffingSkills>;
	/** Findings the shift would add under the candidate's own regulation. */
	complianceFindings: readonly ComplianceFinding[];
	/** The candidate's regulation sets a minimum rest period. */
	restRuleApplies: boolean;
	/** Pending absences overlapping the shift. */
	pendingAbsences: readonly StaffingAbsence[];
	requestedThisShift: boolean;
	/** Minutes already planned for the candidate in the shift's week. */
	plannedMinutes: number;
	/** Contracted target for the shift's week; null without a usable one. */
	targetMinutes: number | null;
}): StaffingSuggestion {
	const warnings: StaffingWarning[] = [
		...input.skills.warnings,
		...input.complianceFindings.map(
			(finding): StaffingWarning => ({ type: "compliance", findingType: finding.type, finding }),
		),
		...input.pendingAbsences.map(
			(absence): StaffingWarning => ({
				type: "pendingAbsence",
				categoryName: absence.categoryName,
				startDate: absence.startDate,
				endDate: absence.endDate,
			}),
		),
	];

	const reasons: StaffingReason[] = [
		...input.skills.reasons,
		input.targetMinutes === null
			? { type: "noContractedTarget" }
			: {
					type: "plannedHours",
					plannedMinutes: input.plannedMinutes,
					targetMinutes: input.targetMinutes,
				},
	];
	if (
		input.restRuleApplies &&
		!input.complianceFindings.some((finding) => finding.type === "restTime")
	) {
		reasons.push({ type: "restPeriodOk" });
	}
	if (input.requestedThisShift) {
		reasons.push({ type: "requestedThisShift" });
	}

	return {
		employeeId: input.employeeId,
		displayName: input.displayName,
		warnings,
		notes: input.skills.notes,
		reasons,
		requestedThisShift: input.requestedThisShift,
		remainingContractedMinutes:
			input.targetMinutes === null ? null : input.targetMinutes - input.plannedMinutes,
	};
}
