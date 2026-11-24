/**
 * Every absence category type, in the order of the `absence_type` database
 * enum: the one list the schema, the category settings and the display read.
 * Dependency-free, so the schema can import it (`schema-import-boundaries`).
 */
export const absenceTypes = [
	"home_office",
	"sick",
	"vacation",
	"personal",
	"unpaid",
	"parental",
	"bereavement",
	"custom",
	// Built-in category drawing on the work balance (#1000)
	"time_off_in_lieu",
	// An External Contractor's calendar unavailability: never vacation, sick leave or payroll (#1996)
	"contractor_unavailability",
] as const;

export type AbsenceType = (typeof absenceTypes)[number];

/**
 * The category type an External Contractor records unavailability with (#1996): a calendar
 * marker only. It is never vacation, sick leave, time off in lieu or a payroll absence.
 */
export const CONTRACTOR_UNAVAILABILITY_TYPE = "contractor_unavailability" satisfies AbsenceType;
