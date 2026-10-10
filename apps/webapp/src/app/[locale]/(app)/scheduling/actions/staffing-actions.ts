"use server";

import { Effect } from "effect";
import { loadSelectableEmployeePage } from "@/app/[locale]/(app)/settings/employees/selectable-employees";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	StaffingSuggestionService,
	StaffingSuggestionServiceLive,
} from "@/lib/effect/services/staffing-suggestion.service";
import {
	SHIFT_ASSIGNEE_PICKER_LIMIT,
	type StaffingShiftInput,
	type StaffingSuggestion,
} from "@/lib/scheduling/staffing/types";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { requireManagerEmployee, runSchedulingAction, type SchedulingActionResult } from "./shared";

/**
 * Ranked staffing suggestions for an open shift in the shift dialog. Only planners get them, and
 * only among the employees the dialog's "Assign To" picker offers them. Nothing is stored.
 */
export async function suggestStaffingForShift(
	input: StaffingShiftInput,
): Promise<SchedulingActionResult<StaffingSuggestion[]>> {
	const effect = Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const staffingSuggestionService = yield* StaffingSuggestionService;
		const { currentEmployee } = yield* requireManagerEmployee({
			resource: "shift",
			action: "read",
			message: "Only managers and admins can see staffing suggestions",
			queryName: "getCurrentEmployeeForStaffingSuggestions",
		});
		const picker = yield* loadSelectableEmployeePage({ limit: SHIFT_ASSIGNEE_PICKER_LIMIT });
		const timezone = yield* dbService.query("staffing.loadOrganizationTimezone", () =>
			loadOrganizationTimezone(dbService.db, currentEmployee.organizationId),
		);

		return yield* staffingSuggestionService.suggestForShift({
			organizationId: currentEmployee.organizationId,
			timezone,
			candidates: picker.employees.map((employee) => ({
				employeeId: employee.id,
				displayName: buildAuthUserDisplayName(employee.user) || employee.id,
				isActive: employee.isActive,
			})),
			shift: input,
		});
	}).pipe(Effect.provide(StaffingSuggestionServiceLive));

	return runSchedulingAction("suggestStaffingForShift", effect);
}
