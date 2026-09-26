/**
 * The bounded field set an explicit historical repair proposal may change (#323).
 * Dependency-free so client forms can offer exactly the fields the server accepts.
 * Period endpoints mirror hashed entries and are never repairable; approval state,
 * deletion, links, ownership and record creation are outside explicit repair too.
 */
export type RequestedRepairChange =
	| { target: "time_record"; field: "start_at" | "end_at"; after: string }
	| { target: "time_record" | "work_period"; field: "duration_minutes"; after: number }
	| {
			target: "time_record" | "work_period";
			field: "work_category_id" | "work_location_type";
			after: string;
	  }
	| { target: "work_period"; field: "project_id"; after: string };

export type RepairChangeField = RequestedRepairChange["field"];
export type RepairChangeTarget = RequestedRepairChange["target"];

/** Which fields each representation may change. */
export const REPAIRABLE_FIELDS: Record<RepairChangeTarget, readonly RepairChangeField[]> = {
	time_record: ["start_at", "end_at", "duration_minutes", "work_category_id", "work_location_type"],
	work_period: ["duration_minutes", "work_category_id", "work_location_type", "project_id"],
};
