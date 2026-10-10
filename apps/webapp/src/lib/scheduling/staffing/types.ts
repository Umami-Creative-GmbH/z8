import type { ComplianceFinding } from "@/lib/scheduling/compliance/types";

/**
 * How many employees the shift dialog's "Assign To" picker loads. Staffing suggestions consider
 * exactly the same employees.
 */
export const SHIFT_ASSIGNEE_PICKER_LIMIT = 1000;

/** A problem shown next to a suggested employee that the planner may knowingly accept. */
export type StaffingWarning =
	| { type: "missingRequiredSkill"; skillId: string; skillName: string }
	| {
			type: "expiredRequiredSkill";
			skillId: string;
			skillName: string;
			/** ISO instant the certificate expires at, before the shift ends. */
			expiresAt: string;
	  }
	| { type: "compliance"; findingType: ComplianceFinding["type"]; finding: ComplianceFinding }
	| {
			type: "pendingAbsence";
			categoryName: string;
			/** `YYYY-MM-DD` */
			startDate: string;
			/** `YYYY-MM-DD` */
			endDate: string;
	  };

/** A softer remark than a warning. */
export type StaffingNote = { type: "missingPreferredSkill"; skillId: string; skillName: string };

/** Why a candidate holds its place in the list. */
export type StaffingReason =
	| { type: "skillsHeld"; skillNames: string[] }
	| { type: "plannedHours"; plannedMinutes: number; targetMinutes: number }
	| { type: "noContractedTarget" }
	| { type: "restPeriodOk" }
	| { type: "requestedThisShift" };

/** One employee who could take an open shift. Never stored. */
export interface StaffingSuggestion {
	employeeId: string;
	displayName: string;
	warnings: StaffingWarning[];
	notes: StaffingNote[];
	reasons: StaffingReason[];
	requestedThisShift: boolean;
	/** Contracted target for the shift's week minus the minutes already planned; null without a usable target. */
	remainingContractedMinutes: number | null;
}

/** The open shift being staffed, as the planner entered it in the organization's zone. */
export interface StaffingShiftInput {
	subareaId: string;
	templateId?: string | null;
	/** `YYYY-MM-DD` */
	date: string;
	/** `HH:mm` */
	startTime: string;
	/** `HH:mm`; at or before the start means the next day. */
	endTime: string;
	/** The saved shift, if any: left out of overlap checks and the source of pickup requests. */
	shiftId?: string | null;
}
