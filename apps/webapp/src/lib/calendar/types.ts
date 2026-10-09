export type CalendarEventType =
	| "holiday"
	| "absence"
	| "time_entry"
	| "work_period"
	| "break";

export interface CalendarEvent {
	id: string;
	type: CalendarEventType;
	date: Date;
	endDate?: Date; // For multi-day events (absences, holidays)
	title: string;
	titleKey?: string;
	description?: string;
	descriptionKey?: string;
	color: string;
	metadata: Record<string, any>;
}

export interface DailyWorkRequirement {
	requiredMinutes: number;
	policyId: string;
	policyName: string;
}

export type DailyWorkRequirements = Record<string, DailyWorkRequirement>;

export type DailyWorkActualMinutes = Record<string, number>;

export type DailyWorkHoursStatus = "met" | "over" | "under" | "missing";

export interface DailyWorkRequirementProgress extends DailyWorkRequirement {
	deltaMinutes: number;
	status: DailyWorkHoursStatus;
}

/** The day total of one local day, compared with that day's requirement when one exists. */
export interface DailyWorkHoursSummary {
	actualMinutes: number;
	/** Counts the elapsed part of live work, so the total is not final yet. */
	includesLiveWork: boolean;
	requirement: DailyWorkRequirementProgress | null;
}

/** An employee's live work: started and not yet ended. */
export interface LiveWork {
	startedAt: Date;
}

export type DailyWorkHoursSummaries = Map<string, DailyWorkHoursSummary>;

export interface HolidayEvent extends CalendarEvent {
	type: "holiday";
	metadata: {
		categoryName: string;
		categoryType: string;
		blocksTimeEntry: boolean;
		isRecurring: boolean;
		// Preset information (when holiday comes from a preset)
		presetId?: string;
		presetName?: string;
		presetSource?: string;
	};
}

export interface AbsenceEvent extends CalendarEvent {
	type: "absence";
	metadata: {
		categoryName: string;
		status: "pending" | "approved" | "rejected";
		employeeName: string;
	};
}

export interface TimeEntryEvent extends CalendarEvent {
	type: "time_entry";
	metadata: {
		entryType: "clock_in" | "clock_out" | "correction";
		employeeName: string;
		time?: string; // Formatted time string (e.g., "2:30 PM")
		utcOffsetMinutes?: number;
		timezone?: string;
	};
}

export interface SurchargeBreakdown {
	ruleId: string;
	ruleName: string;
	ruleType: "day_of_week" | "time_window" | "date_based";
	percentage: number;
	qualifyingMinutes: number;
	surchargeMinutes: number;
}

export interface WorkPeriodEvent extends CalendarEvent {
	type: "work_period";
	metadata: {
		workLocationType?: string | null;
		durationMinutes: number;
		employeeId: string;
		employeeName: string;
		notes?: string;
		// Time fields - formatted time strings (e.g., "2:30 PM")
		startTime?: string;
		endTime?: string;
		clockInUtcOffsetMinutes?: number;
		clockInTimezone?: string;
		clockOutUtcOffsetMinutes?: number;
		clockOutTimezone?: string;
		// Project fields - optional, only present if work period is assigned to a project
		projectId?: string;
		projectName?: string;
		projectColor?: string;
		/** Billable Time (#900): only a project with a customer can make work billable. */
		projectHasCustomer?: boolean;
		/** Billable Time (#900): whether the work is billable. */
		isBillable?: boolean;
		// Surcharge fields - optional, only present if surcharges are enabled
		surchargeMinutes?: number;
		totalCreditedMinutes?: number;
		surchargeBreakdown?: SurchargeBreakdown[];
		// Approval status - for change policy enforcement
		// "approved" = normal working period (default)
		// "pending" = awaiting manager approval
		// "rejected" = manager rejected the change
		approvalStatus?: "approved" | "pending" | "rejected";
		isRunning?: true;
		automaticClockOut?: {
			cutoffAt: string;
			limitMinutes: number;
			processedAt: string;
		};
		// Last applied edit by someone other than the employee (manager/admin)
		editedByName?: string;
		editedAt?: Date;
	};
}

export interface BreakEvent extends CalendarEvent {
	type: "break";
	metadata: {
		durationMinutes: number;
		employeeName: string;
	};
}
