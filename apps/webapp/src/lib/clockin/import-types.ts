export interface ClockinMappedWorkday {
	employeeId: string;
	startAt: string;
	endAt: string | null;
}

export interface ExistingWorkPeriodCandidate {
	employeeId: string;
	startTime: Date;
	endTime: Date | null;
}

export interface ClockinMappedAbsence {
	employeeId: string;
	startDate: string;
	endDate: string;
}

export interface ExistingAbsenceCandidate {
	employeeId: string;
	startDate: string;
	endDate: string;
}

export interface ClockinImportUserMapping {
	clockinEmployeeId: number;
	employeeId: string | null;
	userId: string | null;
	mappingType: "auto_email" | "manual" | "new_employee" | "skipped";
}

export interface ClockinImportSelections {
	workdays: boolean;
	absences: boolean;
	schedules: boolean;
	dateRange: {
		startDate: string;
		endDate: string;
	};
}

export interface ClockinEntityImportResult {
	imported: number;
	skipped: number;
	errors: string[];
}

export interface ClockinImportResult {
	workdays: ClockinEntityImportResult;
	absences: ClockinEntityImportResult;
	schedules: ClockinEntityImportResult;
	status: "success" | "partial" | "failed";
	durationMs: number;
	errorMessage?: string;
}
