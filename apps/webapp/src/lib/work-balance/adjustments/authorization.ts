import "server-only";

import {
	type OrganizationActor,
	requireOrganizationAdmin,
} from "@/lib/auth/current-organization-actor";
import { BalanceAdjustmentRefusal } from "./types";

/**
 * Who may record and cancel balance adjustments, and see them with their
 * actions in the employee's Work balance section (#993): owners and admins of
 * the active organization, for any of its employees. No approval step.
 *
 * #995 extends this with holders of an active payroll access grant for the
 * employees it covers, including employees who have left; #996 adds read-only
 * access for the employee and their managers.
 */
export function requireBalanceAdjustmentWriter(): Promise<OrganizationActor> {
	return requireOrganizationAdmin(
		() =>
			new BalanceAdjustmentRefusal(
				"not_permitted",
				"Only organization owners and admins can record or cancel balance adjustments.",
			),
	);
}
