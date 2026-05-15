import type { AbsenceDurationKind, DayPeriod } from "@/lib/absences/types";

export type ManagerAbsenceRole = "admin" | "manager" | "employee";

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

export interface ManagerAbsenceEmployeeRow {
	id: string;
	userId: string;
	name: string;
	email: string;
	employeeNumber: string | null;
	position: string | null;
	role: ManagerAbsenceRole;
	teamName: string | null;
	vacationAllowance: number;
	usedVacationDays: number;
	pendingVacationDays: number;
	remainingVacationDays: number;
	sickDays: number;
}

export interface ManagerAbsenceListParams {
	search: string;
	page: number;
	pageSize: number;
	year: number;
}

export interface ManagerAbsenceListResult {
	rows: ManagerAbsenceEmployeeRow[];
	total: number;
	page: number;
	pageSize: number;
	year: number;
	pageCount: number;
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
}
