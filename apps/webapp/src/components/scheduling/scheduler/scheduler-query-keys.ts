import type { DateRange } from "@/app/[locale]/(app)/scheduling/types";
import { queryKeys } from "@/lib/query/keys";

/**
 * The calendar's shifts for one viewer. A planner's drafts must never hydrate an employee's
 * published-only view. Invalidating `queryKeys.shifts.all` matches by prefix.
 */
export function schedulerShiftsQueryKey(
	organizationId: string,
	dateRange: DateRange,
	employeeId: string,
	isManager: boolean,
) {
	return [
		...queryKeys.shifts.list(organizationId, dateRange),
		"scheduling-viewer",
		employeeId,
		isManager,
	] as const;
}

/**
 * The compliance banner for one viewer. The statutory findings are the viewer's (#2026): a scoped
 * manager lists only whom they manage, so one viewer's list never hydrates another's. Invalidating
 * `queryKeys.compliance.scheduleWarnings` matches by prefix.
 */
export function schedulerComplianceQueryKey(
	organizationId: string,
	dateRange: DateRange,
	employeeId: string,
) {
	return [
		...queryKeys.compliance.scheduleWarnings(organizationId, dateRange),
		"scheduling-viewer",
		employeeId,
	] as const;
}
