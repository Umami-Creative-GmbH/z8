import type { AbsenceDurationKind, DayPeriod, SickDetail } from "@/lib/absences/types";

export type ManagerAbsenceRole = "admin" | "manager" | "employee";

export type ManagerAbsenceSortKey =
	| "employee"
	| "team"
	| "vacationAllowance"
	| "usedVacationDays"
	| "pendingVacationDays"
	| "remainingVacationDays"
	| "sickDays";

export type ManagerAbsenceSortDirection = "asc" | "desc";

export interface ManagerAbsenceTeamOption {
	id: string;
	name: string;
}

export interface ManagerAbsenceActor {
	id: string;
	userId: string;
	organizationId: string;
	role: ManagerAbsenceRole;
	name: string;
}

export interface ManagerAbsenceEmployeeTarget {
	id: string;
	organizationId: string;
	isActive: boolean;
}

export interface ManagerAbsenceRowAbsence {
	id: string;
	category: {
		name: string;
		type: string;
		color: string | null;
	};
	sickDetail: SickDetail | null;
}

export interface ManagerAbsenceEmployeeRow {
	id: string;
	userId: string;
	name: string;
	email: string;
	image: string | null;
	employeeNumber: string | null;
	position: string | null;
	role: ManagerAbsenceRole;
	teamName: string | null;
	vacationAllowance: number;
	usedVacationDays: number;
	pendingVacationDays: number;
	remainingVacationDays: number;
	sickDays: number;
	absences?: ManagerAbsenceRowAbsence[];
}

export interface ManagerAbsenceListParams {
	search: string;
	page: number;
	pageSize: number;
	year: number;
	teamId: string | null;
	sort: ManagerAbsenceSortKey;
	direction: ManagerAbsenceSortDirection;
}

export interface ManagerAbsenceListResult {
	rows: ManagerAbsenceEmployeeRow[];
	teams: ManagerAbsenceTeamOption[];
	total: number;
	page: number;
	pageSize: number;
	year: number;
	teamId: string | null;
	sort: ManagerAbsenceSortKey;
	direction: ManagerAbsenceSortDirection;
	pageCount: number;
}

export interface ManagerAbsenceCalendarEntry {
	id: string;
	employeeId: string;
	employeeName: string;
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
	status: "approved" | "pending";
	category: {
		name: string;
		type: string;
		color: string | null;
	};
}

export interface ManagerAbsenceCalendarDay {
	date: string;
	approvedCount: number;
	pendingCount: number;
	totalCount: number;
	entries: ManagerAbsenceCalendarEntry[];
}

export interface ManagerAbsenceCalendarResult {
	year: number;
	teamId: string | null;
	entries: ManagerAbsenceCalendarEntry[];
}

export interface RecordAbsenceForEmployeeInput {
	employeeId: string;
	categoryId: string;
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
	durationKind?: AbsenceDurationKind;
	startTime?: string;
	endTime?: string;
	notes?: string;
	sickDetail?: SickDetail;
}
