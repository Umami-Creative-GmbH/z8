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

/** The vehicle group a class belongs to, in licence order. */
export const LICENCE_CLASS_GROUPS = ["motorcycle", "car", "truck", "bus", "tractor"] as const;
export type LicenceClassGroup = (typeof LICENCE_CLASS_GROUPS)[number];
export interface LicenceClassInfo {
	group: LicenceClassGroup;
	/** A light or small variant of the group's vehicle (moped, light truck, minibus). */
	light: boolean;
	/** Includes a heavier trailer (the E classes). */
	trailer: boolean;
	/** The class itself expires (C and D classes, every five years), apart from the document. */
	expires: boolean;
}
export const LICENCE_CLASS_INFO: Record<LicenceClass, LicenceClassInfo> = {
	AM: { group: "motorcycle", light: true, trailer: false, expires: false },
	A1: { group: "motorcycle", light: true, trailer: false, expires: false },
	A2: { group: "motorcycle", light: false, trailer: false, expires: false },
	A: { group: "motorcycle", light: false, trailer: false, expires: false },
	B: { group: "car", light: false, trailer: false, expires: false },
	BE: { group: "car", light: false, trailer: true, expires: false },
	C1: { group: "truck", light: true, trailer: false, expires: true },
	C1E: { group: "truck", light: true, trailer: true, expires: true },
	C: { group: "truck", light: false, trailer: false, expires: true },
	CE: { group: "truck", light: false, trailer: true, expires: true },
	D1: { group: "bus", light: true, trailer: false, expires: true },
	D1E: { group: "bus", light: true, trailer: true, expires: true },
	D: { group: "bus", light: false, trailer: false, expires: true },
	DE: { group: "bus", light: false, trailer: true, expires: true },
	L: { group: "tractor", light: true, trailer: false, expires: false },
	T: { group: "tractor", light: false, trailer: false, expires: false },
};
export function isLicenceClass(code: string): code is LicenceClass {
	return (LICENCE_CLASSES as readonly string[]).includes(code);
}
/** One class of an intended driver's own statement (#2003). Grants nothing. */
export interface DeclaredLicenceClass {
	code: LicenceClass;
	/** The class's own expiry date (C and D classes), when the employee entered one. */
	expiryDate: string | null;
}
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
