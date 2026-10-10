/**
 * Who sees and changes which custom field values (#818, spec #769). Pure and
 * client-safe; `values.ts` loads the facts for a user.
 *
 * A viewer's custom field level is their base role in the organization:
 * - an org owner or admin (membership) is `admin`;
 * - otherwise the highest of their employee role and the base role of every
 *   custom role assigned to them (a custom role sees what its base role sees);
 * - a member without an active employee record, or anyone without an approved
 *   membership, has no level and sees nothing.
 *
 * The level only decides which fields; which records a viewer reaches stays
 * with the existing settings scope (managers reach the employees they manage
 * and the projects and customers they can see). The level never widens reach.
 */

import { hasOrganizationRole } from "@/lib/auth/organization-role";
import type { FieldEditLevel, FieldVisibility } from "./definition-rules";

export const CUSTOM_FIELD_VIEWER_LEVELS = ["admin", "manager", "employee"] as const;
export type CustomFieldViewerLevel = (typeof CUSTOM_FIELD_VIEWER_LEVELS)[number];

export interface CustomFieldViewerFacts {
	/** The role(s) of the viewer's approved membership; null without one. */
	membershipRole: string | null;
	/** The viewer's employee record in the organization; null without one. */
	employee: { role: CustomFieldViewerLevel; isActive: boolean } | null;
	/** Base roles of the active custom roles assigned to the viewer's employee record. */
	customRoleBaseTiers: readonly CustomFieldViewerLevel[];
}

/** Lower rank = higher level. */
const RANK: Record<CustomFieldViewerLevel, number> = { admin: 0, manager: 1, employee: 2 };

export function resolveCustomFieldViewerLevel(
	facts: CustomFieldViewerFacts,
): CustomFieldViewerLevel | null {
	if (facts.membershipRole === null) return null;
	if (
		hasOrganizationRole(facts.membershipRole, "owner") ||
		hasOrganizationRole(facts.membershipRole, "admin")
	) {
		return "admin";
	}
	if (!facts.employee?.isActive) return null;
	return [facts.employee.role, ...facts.customRoleBaseTiers].reduce((best, level) =>
		RANK[level] < RANK[best] ? level : best,
	);
}

/** Whether a viewer at `level` sees the values of a field with `visibility`. */
export function canViewCustomField(
	level: CustomFieldViewerLevel | null,
	visibility: FieldVisibility,
): boolean {
	return level !== null && RANK[level] <= RANK[visibility];
}

/** Whether a viewer at `level` changes the values of a field with `editLevel`. Employees never edit. */
export function canEditCustomField(
	level: CustomFieldViewerLevel | null,
	editLevel: FieldEditLevel,
): boolean {
	return level !== null && level !== "employee" && RANK[level] <= RANK[editLevel];
}
