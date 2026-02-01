/**
 * CASL Authorization Layer
 *
 * Public exports for the unified RBAC system.
 *
 * @example
 * ```typescript
 * import {
 *   defineAbilityFor,
 *   assertCan,
 *   checkCan,
 *   type PrincipalContext,
 *   type AppAbility,
 * } from "@/lib/authorization";
 *
 * // Build ability from context
 * const ability = defineAbilityFor(principal);
 *
 * // Check permission
 * if (checkCan(ability, "update", "Team")) {
 *   // User can update teams
 * }
 *
 * // Enforce permission (throws if denied)
 * assertCan(ability, "delete", "Team");
 * ```
 */

// Types
export type {
	Action,
	Subject,
	PlatformSubject,
	OrganizationSubject,
	WorkforceSubject,
	PrincipalContext,
	OrgMembership,
	EmployeeInfo,
	TeamPermissions,
	OrgScopedSubject,
	TeamScopedSubject,
	EmployeeScopedSubject,
	ApprovalSubject,
	SubjectTypeMap,
} from "./types";

// Ability builder
export {
	defineAbilityFor,
	createEmptyAbility,
	can,
	cannot,
	type AppAbility,
} from "./ability";

// Enforcement helpers
export {
	assertCan,
	throwIfCannot,
	checkCan,
	checkCannot,
	checkMany,
	ForbiddenError,
	toHttpError,
	isForbiddenError,
} from "./enforce";

// Effect helpers
export {
	checkAbility,
	requireAbility,
	requirePrincipalCan,
	requireOrgAdmin,
	requireOrgOwner,
	requireEmployeeAdmin,
	requireManagerOrAbove,
	requireLocationAdmin,
	requireProjectAdmin,
	requireWorkPolicyAdmin,
	requireVacationPolicyAdmin,
	requireExportAdmin,
	requireScheduleAdmin,
	requireAbsenceApprover,
	requireReportGenerator,
	withAuthorization,
	guardWith,
	buildPermissionFlags,
} from "./effect-helpers";
