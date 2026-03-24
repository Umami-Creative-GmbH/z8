import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	ORG_ADMIN_SETTINGS_ROUTES,
	canResolvedTierAccessRoute,
	resolveSettingsAccessTier,
} from "@/lib/settings-access";

const SETTINGS_ROOT = fileURLToPath(new URL("..", import.meta.url));

const ORG_ADMIN_ROUTE_FILES = [
	"billing/page.tsx",
	"avv/page.tsx",
	"roles/page.tsx",
	"travel-expenses/page.tsx",
	"enterprise/domains/page.tsx",
	"enterprise/email/page.tsx",
	"enterprise/api-keys/page.tsx",
	"enterprise/audit-log/page.tsx",
	"telegram/page.tsx",
	"webhooks/page.tsx",
	"export/page.tsx",
	"payroll-export/page.tsx",
	"audit-export/page.tsx",
	"demo/page.tsx",
	"import/page.tsx",
	"scheduled-exports/page.tsx",
] as const;

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("org-admin settings route access", () => {
	it("treats owners as org admins for settings route checks", () => {
		const accessTier = resolveSettingsTierFromContext({
			activeOrganizationId: "org-1",
			membershipRole: "owner",
			employeeRole: "employee",
		});

		expect(accessTier).toBe("orgAdmin");
	});

	it("keeps the exported org-admin route list aligned with the approved sweep", () => {
			expect(ORG_ADMIN_SETTINGS_ROUTES).toEqual([
			"/settings/billing",
			"/settings/avv",
			"/settings/roles",
			"/settings/travel-expenses",
			"/settings/enterprise/domains",
			"/settings/enterprise/email",
			"/settings/enterprise/api-keys",
			"/settings/enterprise/audit-log",
			"/settings/telegram",
			"/settings/webhooks",
			"/settings/export",
			"/settings/payroll-export",
			"/settings/audit-export",
			"/settings/demo",
			"/settings/import",
			"/settings/scheduled-exports",
		]);
	});

	it("allows managers through the scoped organization and teams route only", () => {
		const managerTier = resolveSettingsTierFromContext({
			activeOrganizationId: "org-1",
			membershipRole: "member",
			employeeRole: "manager",
		});

		expect(canResolvedTierAccessRoute(managerTier, "/settings/organizations")).toBe(true);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/statistics")).toBe(true);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/change-policies")).toBe(true);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/employees")).toBe(true);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/holidays")).toBe(true);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/locations")).toBe(true);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/skills")).toBe(true);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/vacation")).toBe(true);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/work-categories")).toBe(true);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/work-policies")).toBe(true);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/shifts")).toBe(true);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/coverage-rules")).toBe(true);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/projects")).toBe(true);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/customers")).toBe(true);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/surcharges")).toBe(true);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/calendar")).toBe(true);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/billing")).toBe(false);
	});

	it("lets the calendar route use scoped settings access while keeping mutations org-admin only", () => {
		const pageSource = stripComments(readFileSync(join(SETTINGS_ROOT, "calendar/page.tsx"), "utf8"));
		const actionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "calendar/actions.ts"), "utf8"),
		);

		expect(pageSource.includes("getCurrentSettingsRouteContext(")).toBe(true);
		expect(pageSource.includes("requireOrgAdminSettingsAccess(")).toBe(false);
		expect(pageSource.includes('accessTier === "member"')).toBe(true);
		expect(pageSource.includes("getManagerCalendarReadView(")).toBe(true);
		expect(pageSource.includes("getCalendarSettings(")).toBe(true);
		expect(pageSource.includes('canManage={accessTier === "orgAdmin"}')).toBe(false);
		expect(pageSource.includes('googleEnabled: true')).toBe(false);
		expect(pageSource.includes('microsoft365Enabled: true')).toBe(false);
		expect(pageSource.includes("if (!settingsResult.success)")).toBe(true);
		expect(actionsSource.includes("teamPermissions")).toBe(true);
		expect(actionsSource.includes("locationEmployee")).toBe(true);
		expect(actionsSource.includes("subareaEmployee")).toBe(true);
		expect(actionsSource.includes("projectManager")).toBe(true);
		expect(actionsSource.includes("projectAssignment")).toBe(true);
		expect(actionsSource.includes("projectAssignment.organizationId")).toBe(true);
		expect(actionsSource.includes("requireOrgAdminCalendarSettingsAccess(")).toBe(true);
		expect(actionsSource.includes("getManagerCalendarReadView")).toBe(true);
	});

	it("lets the surcharges route use scoped settings access with read-only manager controls", () => {
		const pageSource = stripComments(readFileSync(join(SETTINGS_ROOT, "surcharges/page.tsx"), "utf8"));
		const actionsSource = stripComments(readFileSync(join(SETTINGS_ROOT, "surcharges/actions.ts"), "utf8"));

		expect(pageSource.includes("getCurrentSettingsRouteContext(")).toBe(true);
		expect(pageSource.includes("requireOrgAdminSettingsAccess(")).toBe(false);
		expect(pageSource.includes('accessTier === "member"')).toBe(true);
		expect(pageSource.includes('canManage={accessTier === "orgAdmin"}')).toBe(true);
		expect(actionsSource.includes("requireOrgAdminSurchargeActor(")).toBe(true);
		expect(actionsSource.includes("projectManager")).toBe(true);
		expect(actionsSource.includes("locationEmployee")).toBe(true);
		expect(actionsSource.includes("subareaEmployee")).toBe(true);
		expect(actionsSource.includes('authContext.employee.role !== "admin"')).toBe(false);
	});

	it("lets the locations route use scoped settings access instead of the org-admin helper", () => {
		const source = stripComments(readFileSync(join(SETTINGS_ROOT, "locations/page.tsx"), "utf8"));

		expect(source.includes("getCurrentSettingsRouteContext(")).toBe(true);
		expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(false);
	});

	it("checks location detail access from the shared settings route context before rendering", () => {
		const source = stripComments(readFileSync(join(SETTINGS_ROOT, "locations/[locationId]/page.tsx"), "utf8"));

		expect(source.includes("getCurrentSettingsRouteContext(")).toBe(true);
		expect(source.includes("authContext.employee")).toBe(false);
		expect(source.includes("NoEmployeeError")).toBe(false);
		expect(source.includes("accessTier === \"member\"")).toBe(true);
	});

	it("uses shared org-admin parity helpers for location assignment mutations", () => {
		const source = stripComments(
			readFileSync(join(SETTINGS_ROOT, "locations/assignment-actions.ts"), "utf8"),
		);

		expect(source.includes("getLocationSettingsActorContext(")).toBe(true);
		expect(source.includes("requireLocationOrgAdminAccess(")).toBe(true);
		expect(source.includes('emp?.role === "admin"')).toBe(false);
	});

	it("lets shift and coverage settings pages use scoped settings access instead of the org-admin helper", () => {
		const pages = ["shifts/page.tsx", "coverage-rules/page.tsx"];

		for (const relativePath of pages) {
			const source = stripComments(readFileSync(join(SETTINGS_ROOT, relativePath), "utf8"));

			expect(source.includes("getSchedulingSettingsAccessContext(")).toBe(true);
			expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(false);
		}
	});

	it("lets project and customer settings pages use scoped settings access instead of the org-admin helper", () => {
		const pages = ["projects/page.tsx", "customers/page.tsx"];

		for (const relativePath of pages) {
			const source = stripComments(readFileSync(join(SETTINGS_ROOT, relativePath), "utf8"));

			expect(source.includes("getCurrentSettingsRouteContext(")).toBe(true);
			expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(false);
		}
	});

	it("lets the holidays route use scoped settings access instead of the org-admin helper", () => {
		const source = stripComments(readFileSync(join(SETTINGS_ROOT, "holidays/page.tsx"), "utf8"));

		expect(source.includes("getCurrentSettingsRouteContext(")).toBe(true);
		expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(false);
		expect(source.includes('accessTier === "member"')).toBe(true);
	});

	it("lets vacation and work-policy pages use scoped settings access instead of the org-admin helper", () => {
		const pages = ["vacation/page.tsx", "work-policies/page.tsx"];

		for (const relativePath of pages) {
			const source = stripComments(readFileSync(join(SETTINGS_ROOT, relativePath), "utf8"));

			expect(source.includes("getCurrentSettingsRouteContext(")).toBe(true);
			expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(false);
		}
	});

	it("keeps vacation employee allowances on shared org-admin route access instead of employee-role checks", () => {
		const source = stripComments(
			readFileSync(join(SETTINGS_ROOT, "vacation/employees/page.tsx"), "utf8"),
		);

		expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(true);
		expect(source.includes("getCurrentEmployee(")).toBe(false);
		expect(source.includes('authContext.employee.role !== "admin"')).toBe(false);
	});

	it("lets the work-categories route use scoped settings access and read-only manager controls", () => {
		const pageSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "work-categories/page.tsx"), "utf8"),
		);
		const actionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "work-categories/actions.ts"), "utf8"),
		);

		expect(pageSource.includes("getCurrentSettingsRouteContext(")).toBe(true);
		expect(pageSource.includes("requireOrgAdminSettingsAccess(")).toBe(false);
		expect(pageSource.includes('canManage={accessTier === "orgAdmin"}')).toBe(true);
		expect(actionsSource.includes("getEmployeeSettingsActorContext(")).toBe(true);
		expect(actionsSource.includes("requireOrgAdminEmployeeSettingsAccess(")).toBe(true);
		expect(actionsSource.includes('employeeRecord.role !== "admin"')).toBe(false);
	});

	it("lets employee and skill settings pages use scoped settings access instead of the org-admin helper", () => {
		const pages = ["employees/page.tsx", "employees/[employeeId]/page.tsx", "skills/page.tsx"];

		for (const relativePath of pages) {
			const source = stripComments(readFileSync(join(SETTINGS_ROOT, relativePath), "utf8"));

			expect(source.includes("getCurrentSettingsRouteContext(")).toBe(true);
			expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(false);
		}
	});

	it("checks employee detail access at page entry before rendering the client surface", () => {
		const source = stripComments(
			readFileSync(join(SETTINGS_ROOT, "employees/[employeeId]/page.tsx"), "utf8"),
		);

		expect(source.includes("getEmployee(")).toBe(true);
		expect(source.includes('redirect("/settings/employees")')).toBe(true);
	});

	it("uses shared scoped access helpers instead of admin-only checks for employee and skill actions", () => {
		const employeeMutationsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "employees/employee-mutations.actions.ts"), "utf8"),
		);
		const rateMutationsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "employees/rate-mutations.actions.ts"), "utf8"),
		);
		const skillsActionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "skills/actions.ts"), "utf8"),
		);

		expect(employeeMutationsSource.includes("requireAdmin(currentEmployee")).toBe(false);
		expect(employeeMutationsSource.includes("ensureSettingsActorCanAccessEmployeeTarget(")).toBe(true);
		expect(rateMutationsSource.includes("requireAdmin(currentEmployee")).toBe(false);
		expect(rateMutationsSource.includes("ensureSettingsActorCanAccessEmployeeTarget(")).toBe(true);
		expect(skillsActionsSource.includes('currentEmployee.role !== "admin"')).toBe(false);
	});

	it("uses shared scoped access helpers for vacation and work-policy actions", () => {
		const vacationActionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "vacation/actions.ts"), "utf8"),
		);
		const vacationAssignmentActionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "vacation/assignment-actions.ts"), "utf8"),
		);
		const workPolicyActionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "work-policies/actions.ts"), "utf8"),
		);

		expect(vacationActionsSource.includes("getEmployeeSettingsActorContext(")).toBe(true);
		expect(vacationActionsSource.includes("ensureSettingsActorCanAccessEmployeeTarget(")).toBe(true);
		expect(vacationAssignmentActionsSource.includes("getEmployeeSettingsActorContext(")).toBe(true);
		expect(vacationAssignmentActionsSource.includes("ensureSettingsActorCanAccessEmployeeTarget(")).toBe(true);
		expect(workPolicyActionsSource.includes("getEmployeeSettingsActorContext(")).toBe(true);
		expect(workPolicyActionsSource.includes("ensureSettingsActorCanAccessEmployeeTarget(")).toBe(true);
		expect(workPolicyActionsSource.includes("policyBelongsToOrganization(")).toBe(true);
		expect(workPolicyActionsSource.includes("canAccessWorkPolicyComplianceActions(")).toBe(true);
		expect(vacationAssignmentActionsSource.includes('employeeRecord.role !== "admin"')).toBe(false);
		expect(workPolicyActionsSource.includes('employeeRecord.role !== "admin"')).toBe(false);
	});

	it("uses scoped holiday access helpers for reads while keeping mutations org-admin only", () => {
		const holidayActionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "holidays/actions.ts"), "utf8"),
		);
		const presetActionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "holidays/preset-actions.ts"), "utf8"),
		);

		expect(holidayActionsSource.includes("getEmployeeSettingsActorContext(")).toBe(true);
		expect(holidayActionsSource.includes("getScopedHolidayAccessContext(")).toBe(true);
		expect(holidayActionsSource.includes("filterAssignmentsForManagerHolidayScope(")).toBe(true);
		expect(holidayActionsSource.includes("requireOrgAdminEmployeeSettingsAccess(")).toBe(true);
		expect(holidayActionsSource.includes("manageableTeamIds")).toBe(true);
		expect(holidayActionsSource.includes('employeeRecord.role !== "admin"')).toBe(false);
		expect(presetActionsSource.includes("getEmployeeSettingsActorContext(")).toBe(true);
		expect(presetActionsSource.includes("getScopedHolidayAccessContext(")).toBe(true);
		expect(presetActionsSource.includes("filterAssignmentsForManagerHolidayScope(")).toBe(true);
		expect(presetActionsSource.includes("requireOrgAdminEmployeeSettingsAccess(")).toBe(true);
		expect(presetActionsSource.includes("manageableTeamIds")).toBe(true);
		expect(presetActionsSource.includes('employeeRecord.role !== "admin"')).toBe(false);
	});

	it("lets the change-policies route use scoped settings access and manager-aware actions", () => {
		const pageSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "change-policies/page.tsx"), "utf8"),
		);
		const actionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "change-policies/actions.ts"), "utf8"),
		);

		expect(pageSource.includes("getCurrentSettingsRouteContext(")).toBe(true);
		expect(pageSource.includes("requireOrgAdminSettingsAccess(")).toBe(false);
		expect(pageSource.includes('accessTier === "member"')).toBe(true);
		expect(pageSource.includes('canManage={accessTier === "orgAdmin"}')).toBe(true);
		expect(actionsSource.includes("getEmployeeSettingsActorContext(")).toBe(true);
		expect(actionsSource.includes("requireOrgAdminEmployeeSettingsAccess(")).toBe(true);
		expect(actionsSource.includes("getManagedEmployeeIdsForSettingsActor(")).toBe(true);
		expect(actionsSource.includes("employeeRecord.role !== \"admin\"")).toBe(false);
	});

	it("uses shared scoped access helpers for project and customer actions", () => {
		const projectActionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "projects/actions.ts"), "utf8"),
		);
		const customerActionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "customers/actions.ts"), "utf8"),
		);

		expect(projectActionsSource.includes("getProjectSettingsActorContext(")).toBe(true);
		expect(projectActionsSource.includes("ensureSettingsActorCanAccessProjectTarget(")).toBe(true);
		expect(projectActionsSource.includes('emp?.role === "admin"')).toBe(false);
		expect(customerActionsSource.includes("getProjectSettingsActorContext(")).toBe(true);
		expect(customerActionsSource.includes("ensureSettingsActorCanAccessCustomerTarget(")).toBe(true);
		expect(customerActionsSource.includes('emp?.role === "admin"')).toBe(false);
	});

	it("uses shared scheduling scope helpers for shift templates and coverage actions", () => {
		const templateActionsSource = stripComments(
			readFileSync(
				join(SETTINGS_ROOT, "../scheduling/actions/template-actions.ts"),
				"utf8",
			),
		);
		const coverageActionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "coverage-rules/actions.ts"), "utf8"),
		);

		expect(templateActionsSource.includes("getSchedulingSettingsAccessContext(")).toBe(true);
		expect(templateActionsSource.includes("canManageScopedSchedulingSubarea(")).toBe(true);
		expect(templateActionsSource.includes("requireManagerEmployee(")).toBe(false);
		expect(coverageActionsSource.includes("getSchedulingSettingsAccessContext(")).toBe(true);
		expect(coverageActionsSource.includes("canManageScopedSchedulingSubarea(")).toBe(true);
		expect(coverageActionsSource.includes('authContext.employee.role !== "admin"')).toBe(false);
	});

	it("keeps the skills read api on settings access tier checks instead of employee-only role checks", () => {
		const source = stripComments(
			readFileSync(join(SETTINGS_ROOT, "../../../api/settings/skills/route.ts"), "utf8"),
		);

		expect(source.includes("getCurrentSettingsRouteContext(")).toBe(true);
		expect(source.includes("authContext?.employee")).toBe(false);
		expect(source.includes('authContext.employee.role !== "admin"')).toBe(false);
	});

	it("keeps audit log and permissions settings surfaces on shared settings access helpers", () => {
		const auditLogSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "audit-log/page.tsx"), "utf8"),
		);
		const auditLogActionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "audit-log/actions.ts"), "utf8"),
		);
		const permissionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "permissions/page.tsx"), "utf8"),
		);
		const permissionsActionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "permissions/actions.ts"), "utf8"),
		);

		expect(auditLogSource.includes("requireOrgAdminSettingsAccess(")).toBe(true);
		expect(auditLogSource.includes('authContext.employee?.role !== "admin"')).toBe(false);
		expect(auditLogActionsSource.includes("canManageCurrentOrganizationSettings(")).toBe(true);
		expect(auditLogActionsSource.includes('employee?.role !== "admin"')).toBe(false);
		expect(permissionsSource.includes("getCurrentSettingsRouteContext(")).toBe(true);
		expect(permissionsSource.includes("getCurrentEmployee(")).toBe(false);
		expect(permissionsSource.includes('currentEmployee.role !== "admin"')).toBe(false);
		expect(permissionsActionsSource.includes("getEmployeeSettingsActorContext(")).toBe(true);
		expect(permissionsActionsSource.includes("requireOrgAdminEmployeeSettingsAccess(")).toBe(true);
		expect(permissionsActionsSource.includes('currentEmployee.role !== "admin"')).toBe(false);
	});

	it("keeps enterprise and travel-expense actions on shared org-admin helpers instead of employee-role checks", () => {
		const travelExpensesSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "travel-expenses/actions.ts"), "utf8"),
		);
		const enterpriseActionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "enterprise/actions.ts"), "utf8"),
		);

		expect(travelExpensesSource.includes("canManageCurrentOrganizationSettings(")).toBe(true);
		expect(travelExpensesSource.includes('authContext.employee.role !== "admin"')).toBe(false);
		expect(enterpriseActionsSource.includes("canManageCurrentOrganizationSettings(")).toBe(true);
		expect(enterpriseActionsSource.includes('authContext.employee?.role !== "admin"')).toBe(false);
	});

	it("keeps the scheduled exports page shell on shared org-admin parity helpers", () => {
		const source = stripComments(
			readFileSync(join(SETTINGS_ROOT, "scheduled-exports/page.tsx"), "utf8"),
		);

		expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(true);
		expect(source.includes('authContext.employee.role !== "admin"')).toBe(false);
	});

	it("narrows manager employee editing away from org-admin-only form controls", () => {
		const source = stripComments(
			readFileSync(join(SETTINGS_ROOT, "employees/[employeeId]/page-sections.tsx"), "utf8"),
		);

		expect(source.includes("canEditOrgAdminFields")).toBe(true);
		expect(source.includes("canEditManagerFields")).toBe(true);
		expect(source.includes("disabled={!isAdmin || isUpdating}")).toBe(false);
	});

	it("keeps the employee skill controls visible for scoped managers instead of admin-only clients", () => {
		const detailClientSource = stripComments(
			readFileSync(
				join(SETTINGS_ROOT, "employees/[employeeId]/employee-detail-page-client.tsx"),
				"utf8",
			),
		);
		const employeeSkillsCardSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "../../../../components/settings/employee-skills-card.tsx"), "utf8"),
		);

		expect(detailClientSource.includes("canManageSkills")).toBe(true);
		expect(detailClientSource.includes("isAdmin={isAdmin}")).toBe(false);
		expect(employeeSkillsCardSource.includes("canManageSkills")).toBe(true);
		expect(employeeSkillsCardSource.includes("{isAdmin && (")).toBe(false);
	});

	it("keeps employee list invite visibility on settings access tier instead of employee admin role", () => {
		const pageClientSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "employees/employees-page-client.tsx"), "utf8"),
		);
		const querySource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "../../../../lib/query/use-employees.ts"), "utf8"),
		);

		expect(pageClientSource.includes("props.accessTier === \"orgAdmin\"")).toBe(true);
		expect(pageClientSource.includes("{isAdmin && (")).toBe(false);
		expect(querySource.includes('currentEmployeeQuery.data?.role === "admin"')).toBe(false);
		expect(querySource.includes('isAdmin: options.accessTier === "orgAdmin"')).toBe(true);
	});

	it("lets the organizations route use scoped settings access instead of the org-admin helper", () => {
		const source = stripComments(
			readFileSync(join(SETTINGS_ROOT, "organizations/page.tsx"), "utf8"),
		);

		expect(source.includes("getCurrentSettingsRouteContext(")).toBe(true);
		expect(source.includes("loadTeamSettingsPageData(")).toBe(true);
		expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(false);
	});

	it("derives team detail capabilities from scoped team data instead of employee-only checks", () => {
		const source = stripComments(
			readFileSync(join(SETTINGS_ROOT, "teams/[teamId]/page.tsx"), "utf8"),
		);

		expect(source.includes("getCurrentEmployee(")).toBe(false);
		expect(source.includes("team?.canManageSettings")).toBe(true);
		expect(source.includes("team?.canManageMembers")).toBe(true);
		expect(source.includes('currentEmployee?.role === "admin"')).toBe(false);
	});

	it.each(ORG_ADMIN_SETTINGS_ROUTES)(
		"permits owner and admin through %s while keeping members out",
		(route) => {
			const ownerTier = resolveSettingsTierFromContext({
				activeOrganizationId: "org-1",
				membershipRole: "owner",
				employeeRole: null,
			});
			const adminTier = resolveSettingsTierFromContext({
				activeOrganizationId: "org-1",
				membershipRole: "admin",
				employeeRole: "admin",
			});
			const memberTier = resolveSettingsTierFromContext({
				activeOrganizationId: "org-1",
				membershipRole: "member",
				employeeRole: "employee",
			});

			expect(canResolvedTierAccessRoute(ownerTier, route)).toBe(true);
			expect(canResolvedTierAccessRoute(adminTier, route)).toBe(true);
			expect(canResolvedTierAccessRoute(memberTier, route)).toBe(false);
		},
	);

	it("replaces direct admin-only page guards with the shared org-admin helper", () => {
		const offenders: string[] = [];

		for (const relativePath of ORG_ADMIN_ROUTE_FILES) {
			const source = stripComments(readFileSync(join(SETTINGS_ROOT, relativePath), "utf8"));

			if (!source.includes("requireOrgAdminSettingsAccess(")) {
				offenders.push(relativePath);
				continue;
			}

			if (
				source.includes('employee.role !== "admin"') ||
				source.includes('memberRecord?.role !== "owner" && memberRecord?.role !== "admin"') ||
				source.includes('memberRecord.role !== "owner" && memberRecord.role !== "admin"')
			) {
				offenders.push(relativePath);
			}
		}

		expect(offenders).toEqual([]);
	});

	it("marks billing and avv settings pages as fully dynamic before auth checks", () => {
		const billingSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "billing/page.tsx"), "utf8"),
		);
		const avvSource = stripComments(readFileSync(join(SETTINGS_ROOT, "avv/page.tsx"), "utf8"));

		expect(billingSource.indexOf("await connection(")).toBeGreaterThan(-1);
		expect(
			billingSource.indexOf("await connection(") <
				billingSource.indexOf('if (process.env.BILLING_ENABLED !== "true")'),
		).toBe(true);
		expect(
			billingSource.indexOf("await connection(") <
				billingSource.indexOf("await requireOrgAdminSettingsAccess()"),
		).toBe(true);

		expect(avvSource.indexOf("await connection(")).toBeGreaterThan(-1);
		expect(
			avvSource.indexOf("await connection(") <
				avvSource.indexOf('if (process.env.BILLING_ENABLED !== "true")'),
		).toBe(true);
		expect(
			avvSource.indexOf("await connection(") <
				avvSource.indexOf("await requireOrgAdminSettingsAccess()"),
		).toBe(true);
	});
});

function resolveSettingsTierFromContext(input: {
	activeOrganizationId: string | null;
	membershipRole: "owner" | "admin" | "member" | null;
	employeeRole: "admin" | "manager" | "employee" | null;
}) {
	return resolveSettingsAccessTier(input);
}
