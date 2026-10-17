import type { VacationBalanceConfiguration } from "@/lib/absences/types";
import type { RefusalActionResult } from "@/lib/effect/refusal-action";
import type { WorkBalanceSnapshot } from "@/lib/work-balance/service";

export type TrackingDateRefusalCode =
	| "not_permitted"
	| "invalid_input"
	| "stale_preview"
	| "blocked";
export class TrackingDateRefusal extends Error {
	constructor(
		readonly code: TrackingDateRefusalCode,
		message: string,
	) {
		super(message);
		this.name = "TrackingDateRefusal";
	}
}
export type TrackingDateBlocker =
	| { employeeId: string; kind: "month_closed"; month: string }
	| {
			employeeId: string;
			kind: "employee_exception_conflict";
			exceptionDate: string;
			minimumDate: string;
	  };
export interface TrackingEmployeeImpact {
	employeeId: string;
	employeeName: string;
	timezone: string;
	throughDate: string;
	oldBoundary: string | null;
	proposedBoundary: string;
	before: WorkBalanceSnapshot;
	after: WorkBalanceSnapshot;
	periods: Array<{
		month: string;
		timezone: string;
		before: WorkBalanceSnapshot;
		after: WorkBalanceSnapshot;
		closed: boolean;
	}>;
	openingBalance: { id: string; day: string; minutes: number } | null;
	vacation: Array<{
		year: number;
		allowanceDays: number | null;
		remainingDays: number | null;
		configuration?: VacationBalanceConfiguration;
	}>;
}
export interface TrackingDateImpact {
	kind: "activation" | "date_change";
	currentDate: string | null;
	proposedDate: string;
	fingerprint: string;
	employees: TrackingEmployeeImpact[];
	blockers: TrackingDateBlocker[];
}
export type TrackingDateActionResult<T> = RefusalActionResult<
	T,
	TrackingDateRefusalCode
>;
