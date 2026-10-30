import type {
	EmployeeDetailRecord,
	EmployeeListParams,
	PaginatedEmployeeResponse,
} from "@/app/[locale]/(app)/settings/employees/employee-action-types";
import type { EmployeeEmploymentHistoryWithPeriod } from "@/app/[locale]/(app)/settings/employees/employment-history-actions";
import type { EmployeeScheduleDetails } from "@/app/[locale]/(app)/settings/work-policies/actions";

export type EmployeeReadScope = { userId: string; organizationId: string };
/** Only the manager selector's display fields; no employment or operational detail. */
export type EmployeeManagerChoice = {
	id: string;
	userId: string;
	user: {
		firstName: string | null;
		lastName: string | null;
		name: string;
		email: string;
		image: string | null;
	};
};
export type EmployeeReadData = {
	directory: PaginatedEmployeeResponse;
	detail: EmployeeDetailRecord;
	schedule: EmployeeScheduleDetails | null;
	managers: EmployeeManagerChoice[];
	"employment-history": EmployeeEmploymentHistoryWithPeriod[];
	"work-policies": { id: string; name: string }[];
};
export type EmployeeReadDataset = keyof EmployeeReadData;
export type EmployeeReadParams = {
	directory: EmployeeListParams;
	detail: { employeeId: string };
	schedule: { employeeId: string };
	managers: { employeeId: string };
	"employment-history": { employeeId: string };
	"work-policies": Record<string, never>;
};
export type EmployeeReadSnapshot<K extends EmployeeReadDataset> = {
	scope: EmployeeReadScope;
	data: EmployeeReadData[K];
	updatedAt: number;
};

export function sameEmployeeReadScope(
	left: EmployeeReadScope,
	right: EmployeeReadScope | null,
) {
	return (
		right !== null &&
		left.userId === right.userId &&
		left.organizationId === right.organizationId
	);
}
