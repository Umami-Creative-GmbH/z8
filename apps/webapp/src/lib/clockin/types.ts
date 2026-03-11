// ============================================
// CLOCKIN API RESPONSE TYPES
// ============================================

export interface ClockinPaginationLinks {
	first: string | null;
	last: string | null;
	prev: string | null;
	next: string | null;
}

export interface ClockinPaginationMeta {
	current_page: number;
	from: number | null;
	last_page: number;
	path: string;
	per_page: number;
	to: number | null;
	total: number;
}

export interface ClockinPaginatedResponse<T> {
	data: T[];
	links: ClockinPaginationLinks;
	meta: ClockinPaginationMeta;
}

export interface ClockinEmployee {
	id: number;
	personnel_number: string | null;
	first_name: string;
	last_name: string;
	email: string | null;
	department_name: string | null;
	entry_date: string | null;
	contract_ending: string | null;
	trial_period_end_date: string | null;
	created_at: string;
	updated_at: string;
}

export interface ClockinActivity {
	id: number;
	employee_id: number;
	task_id: number | null;
	project_id: number | null;
	device_id: number | null;
	starts_at: string;
	ends_at: string | null;
	workday: string;
	project_number: string | null;
	employee_personnel_number: string | null;
	customer_identifier: string | null;
}

export interface ClockinEvent {
	id: number;
	employee_id: number;
	task_id: number | null;
	project_id: number | null;
	task_label: string | null;
	occured_at: string;
}

export interface ClockinWorkday {
	employee_id: number;
	date: string;
	starts_at: string | null;
	ends_at: string | null;
	break_seconds: number;
	work_seconds: number;
	target_seconds: number;
	activities: ClockinActivity[];
	events: ClockinEvent[];
}

export interface ClockinAbsence {
	id: number;
	employee_id: number;
	absencecategory_name: string | null;
	approval: string | null;
	duration: number | null;
	note: string | null;
	starts_at: string;
	ends_at: string;
	created_at: string;
	updated_at: string;
}

export interface ClockinSearchDateRange {
	startDate: string;
	endDate: string;
}

export interface ClockinWorkdaySearchRequest extends ClockinSearchDateRange {
	employeeIds: number[];
}

export interface ClockinAbsenceSearchRequest extends ClockinSearchDateRange {
	employeeIds?: number[];
}
