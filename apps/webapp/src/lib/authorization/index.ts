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

// Ability builder
export {
	type AppAbility,
	can,
	cannot,
	createEmptyAbility,
	defineAbilityFor,
} from "./ability";
// Effect helpers
export {
	buildPermissionFlags,
	checkAbility,
	guardWith,
	requireAbility,
	requireAbsenceApprover,
	requireEmployeeAdmin,
	requireExportAdmin,
	requireLocationAdmin,
	requireManagerOrAbove,
	requireOrgAdmin,
	requireOrgOwner,
	requirePrincipalCan,
	requireProjectAdmin,
	requireReportGenerator,
	requireScheduleAdmin,
	requireVacationPolicyAdmin,
	requireWorkPolicyAdmin,
	withAuthorization,
} from "./effect-helpers";
// Enforcement helpers
export {
	assertCan,
	checkCan,
	checkCannot,
	checkMany,
	ForbiddenError,
	isForbiddenError,
	throwIfCannot,
	toHttpError,
} from "./enforce";

export type { AccessiblePredicate, DrizzleFieldMap } from "./query";
export {
	accessibleByDrizzle,
	UnsupportedAuthorizationConditionError,
} from "./query";
export { asAppSubject } from "./subjects";
// Types
export type {
	AbsenceAuthorizationSubject,
	Action,
	ApprovalAuthorizationSubject,
	ApprovalSubject,
	AppSubjectRecord,
	CustomRoleInfo,
	DatabaseSubjectName,
	EmployeeAuthorizationSubject,
	EmployeeInfo,
	EmployeeScopedSubject,
	OrganizationSubject,
	OrgMembership,
	OrgScopedSubject,
	PlatformSubject,
	PrincipalContext,
	Subject,
	SubjectTypeMap,
	TeamPermissions,
	TeamScopedSubject,
	TimeEntryAuthorizationSubject,
	WorkforceSubject,
} from "./types";
