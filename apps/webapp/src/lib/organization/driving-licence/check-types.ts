export const LICENCE_CLASSES = [
	"AM",
	"A1",
	"A2",
	"A",
	"B",
	"BE",
	"C1",
	"C1E",
	"C",
	"CE",
	"D1",
	"D1E",
	"D",
	"DE",
	"L",
	"T",
] as const;
export type LicenceClass = (typeof LICENCE_CLASSES)[number];
export type CheckResult = "successful" | "unsuccessful" | "inconclusive";
export interface DrivingCheckClass {
	code: LicenceClass;
	result: CheckResult;
	expiryDate: string | null;
	restrictions: string;
}
export const EMPLOYEE_DRIVING_DECLARATION =
	"I confirm that no known driving ban, withdrawal or other impediment prevents the intended driving, and that I meet the applicable driving restrictions.";
export interface CompleteDrivingLicenceCheckInput {
	employeeId: string;
	commandId: string;
	originalInspected: boolean;
	identityConfirmed: boolean;
	employeeDeclaration: boolean;
	verifierConfirmed: boolean;
	documentIssuedOn: string;
	documentExpiresOn: string;
	classes: DrivingCheckClass[];
	failureScope?: "classes" | "document" | "person";
}
/**
 * Reason of a class authorization ended because the employee is no longer an intended driver
 * (#1425). Such a class is history: it never counts towards the status, and a later check
 * starts afresh instead of carrying it on.
 */
export const NO_LONGER_INTENDED = "no_longer_intended";
export function endedAsNoLongerIntended(row: { state: string; suspensionReason: string | null }) {
	return row.state === "ended" && row.suspensionReason === NO_LONGER_INTENDED;
}
export type AuthorizationStatus =
	| "not_enrolled"
	| "not_yet_checked"
	| "active"
	| "partially_active"
	| "suspended"
	| "ended";
