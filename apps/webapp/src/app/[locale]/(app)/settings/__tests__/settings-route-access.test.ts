import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	canResolvedTierAccessRoute,
	ORG_ADMIN_SETTINGS_ROUTES,
	resolveSettingsAccessTier,
} from "@/lib/settings-access";

const SETTINGS_ROOT = fileURLToPath(new URL("..", import.meta.url));

const ORG_ADMIN_ROUTE_FILES = [
	"billing/page.tsx",
	"avv/page.tsx",
	"roles/page.tsx",
	"travel-expenses/page.tsx",
	"legal-entities/page.tsx",
	"enterprise/domains/page.tsx",
	"enterprise/email/page.tsx",
	"email-templates/page.tsx",
	"enterprise/api-keys/page.tsx",
	"enterprise/audit-log/page.tsx",
	"telegram/page.tsx",
	"slack/page.tsx",
	"discord/page.tsx",
	"teams-notifications/page.tsx",
	"webhooks/page.tsx",
	"export/page.tsx",
	"audit-export/page.tsx",
	"demo/page.tsx",
	"import/page.tsx",
	"export-operations/page.tsx",
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
			"/settings/organizations",
			"/settings/billing",
			"/settings/avv",
			"/settings/roles",
			"/settings/travel-expenses",
			"/settings/legal-entities",
			"/settings/enterprise/domains",
			"/settings/enterprise/email",
			"/settings/email-templates",
			"/settings/enterprise/api-keys",
			"/settings/enterprise/audit-log",
			"/settings/telegram",
			"/settings/slack",
			"/settings/discord",
			"/settings/teams-notifications",
			"/settings/webhooks",
			"/settings/export",
			"/settings/audit-export",
			"/settings/demo",
			"/settings/import",
			"/settings/export-operations",
		]);
	});

	it("allows entity admins into legal-entity-owned settings while keeping parent settings blocked", () => {
		const entityAdminTier = resolveSettingsTierFromContext({
			activeOrganizationId: "org-1",
			membershipRole: "member",
			employeeRole: "employee",
			legalEntityAdminIds: ["entity-1"],
		});

		for (const route of [
			"/settings/payroll-export",
			"/settings/payroll-readiness",
			"/settings/scheduled-exports",
			"/settings/employees",
			"/settings/holidays",
			"/settings/vacation",
			"/settings/work-policies",
			"/settings/change-policies",
		]) {
			expect(canResolvedTierAccessRoute(entityAdminTier, route)).toBe(true);
		}

		expect(canResolvedTierAccessRoute(entityAdminTier, "/settings/legal-entities")).toBe(false);
		expect(canResolvedTierAccessRoute(entityAdminTier, "/settings/locations")).toBe(false);
		expect(canResolvedTierAccessRoute(entityAdminTier, "/settings/work-categories")).toBe(false);
		expect(canResolvedTierAccessRoute(entityAdminTier, "/settings/statistics")).toBe(false);
	});

	it("keeps the export operations page on the shared org-admin helper", () => {
		const source = stripComments(
			readFileSync(join(SETTINGS_ROOT, "export-operations/page.tsx"), "utf8"),
		);

		expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(true);
		expect(source.includes("getCurrentSettingsRouteContext(")).toBe(false);
	});

	it("allows managers through teams but not organization management", () => {
		const managerTier = resolveSettingsTierFromContext({
			activeOrganizationId: "org-1",
			membershipRole: "member",
			employeeRole: "manager",
		});

		expect(canResolvedTierAccessRoute(managerTier, "/settings/organizations")).toBe(false);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/teams")).toBe(true);
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
		expect(canResolvedTierAccessRoute(managerTier, "/settings/legal-entities")).toBe(false);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/slack")).toBe(false);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/discord")).toBe(false);
		expect(canResolvedTierAccessRoute(managerTier, "/settings/teams-notifications")).toBe(false);
	});

	it("guards direct demo route and mutations with the demo data feature helper", () => {
		const pageSource = stripComments(readFileSync(join(SETTINGS_ROOT, "demo/page.tsx"), "utf8"));
		const actionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "demo/actions.ts"), "utf8"),
		);

		expect(pageSource.includes("assertDemoDataEnabledForOrganization(")).toBe(true);
		expect(pageSource.includes("notFound(")).toBe(true);
		expect(actionsSource.includes("canUseDemoData(")).toBe(true);
		expect(actionsSource).not.toMatch(/Effect\.promise\(\(\) => isOrgAdminCasl\(/);
	});

	it("lets the calendar route use scoped settings access while keeping mutations org-admin only", () => {
		const pageSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "calendar/page.tsx"), "utf8"),
		);
		const actionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "calendar/actions.ts"), "utf8"),
		);

		expect(pageSource.includes("getCurrentSettingsRouteContext(")).toBe(true);
		expect(pageSource.includes("requireOrgAdminSettingsAccess(")).toBe(false);
		expect(pageSource.includes("canResolvedTierAccessRoute(")).toBe(true);
		expect(pageSource.includes("/settings/calendar")).toBe(true);
		expect(pageSource.includes("getManagerCalendarReadView(")).toBe(true);
		expect(pageSource.includes("getCalendarSettings(")).toBe(true);
		expect(pageSource.includes('canManage={accessTier === "orgAdmin"}')).toBe(false);
		expect(pageSource.includes("googleEnabled: true")).toBe(false);
		expect(pageSource.includes("microsoft365Enabled: true")).toBe(false);
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
		const pageSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "surcharges/page.tsx"), "utf8"),
		);
		const actionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "surcharges/actions.ts"), "utf8"),
		);

		expect(pageSource.includes("getCurrentSettingsRouteContext(")).toBe(true);
		expect(pageSource.includes("requireOrgAdminSettingsAccess(")).toBe(false);
		expect(pageSource.includes("canResolvedTierAccessRoute(")).toBe(true);
		expect(pageSource.includes("/settings/surcharges")).toBe(true);
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

	it("denies direct entity-admin access to non-entity manager settings routes", () => {
		const pages = [
			["locations/page.tsx", "/settings/locations"],
			["locations/[locationId]/page.tsx", "/settings/locations"],
			["work-categories/page.tsx", "/settings/work-categories"],
			["skills/page.tsx", "/settings/skills"],
			["projects/page.tsx", "/settings/projects"],
			["calendar/page.tsx", "/settings/calendar"],
			["statistics/page.tsx", "/settings/statistics"],
			["teams/page.tsx", "/settings/teams"],
			["surcharges/page.tsx", "/settings/surcharges"],
			["customers/page.tsx", "/settings/customers"],
			["permissions/page.tsx", "/settings/permissions"],
		] as const;

		for (const [relativePath, route] of pages) {
			const source = stripComments(readFileSync(join(SETTINGS_ROOT, relativePath), "utf8"));

			expect(canResolvedTierAccessRoute("entityAdmin", route)).toBe(false);
			expect(source.includes("canResolvedTierAccessRoute(")).toBe(true);
			expect(source.includes(route)).toBe(true);
		}
	});

	it("checks location detail access from the shared settings route context before rendering", () => {
		const source = stripComments(
			readFileSync(join(SETTINGS_ROOT, "locations/[locationId]/page.tsx"), "utf8"),
		);

		expect(source.includes("getCurrentSettingsRouteContext(")).toBe(true);
		expect(source.includes("authContext.employee")).toBe(false);
		expect(source.includes("NoEmployeeError")).toBe(false);
		expect(source.includes("canResolvedTierAccessRoute(")).toBe(true);
		expect(source.includes("/settings/locations")).toBe(true);
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

	it("lets entity admins manage selected legal entity vacation and work policies", () => {
		const vacationPageSource = stripComments(readFileSync(join(SETTINGS_ROOT, "vacation/page.tsx"), "utf8"));
		const workPolicyManagementSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "../../../../components/settings/work-policy-management.tsx"), "utf8"),
		);

		expect(vacationPageSource.includes('accessTier === "orgAdmin" || accessTier === "entityAdmin"')).toBe(true);
		expect(workPolicyManagementSource.includes('accessTier === "orgAdmin" || accessTier === "entityAdmin"')).toBe(true);
	});

	it("guards legal entity selector context on manager-access settings pages", () => {
		const pages = [
			"change-policies/page.tsx",
			"holidays/page.tsx",
			"vacation/page.tsx",
			"work-policies/page.tsx",
		];

		for (const relativePath of pages) {
			const source = stripComments(readFileSync(join(SETTINGS_ROOT, relativePath), "utf8"));
			const guardIndex = source.indexOf("shouldShowLegalEntitySelector(");
			const contextIndex = source.indexOf("await getLegalEntitySelectionContext(");

			expect(guardIndex).toBeGreaterThan(-1);
			expect(contextIndex).toBeGreaterThan(guardIndex);
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

	it("wraps employee app access switch fields in a TanStack form item", () => {
		const source = stripComments(
			readFileSync(join(SETTINGS_ROOT, "employees/[employeeId]/page-sections.tsx"), "utf8"),
		);
		const accessSwitchFieldSource = source.slice(
			source.indexOf("function AccessSwitchField"),
			source.indexOf("function TextField"),
		);

		expect(accessSwitchFieldSource).toContain("<TFormItem>");
		expect(accessSwitchFieldSource).toContain("</TFormItem>");
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
		expect(employeeMutationsSource.includes("ensureSettingsActorCanAccessEmployeeTarget(")).toBe(
			true,
		);
		expect(rateMutationsSource.includes("requireAdmin(currentEmployee")).toBe(false);
		expect(rateMutationsSource.includes("ensureSettingsActorCanAccessEmployeeTarget(")).toBe(true);
		expect(skillsActionsSource.includes('currentEmployee.role !== "admin"')).toBe(false);
	});

	it("does not re-export type-only skill shapes from the server actions module", () => {
		const skillsActionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "skills/actions.ts"), "utf8"),
		);

		expect(skillsActionsSource).not.toMatch(/export\s+type\s+\{[^}]*EmployeeSkillWithDetails/);
		expect(skillsActionsSource).not.toMatch(/export\s+type\s+\{[^}]*SkillValidationResult/);
		expect(skillsActionsSource).not.toMatch(/export\s+type\s+\{[^}]*SkillWithRelations/);
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
		expect(vacationActionsSource.includes("ensureSettingsActorCanAccessEmployeeTarget(")).toBe(
			true,
		);
		expect(vacationAssignmentActionsSource.includes("getEmployeeSettingsActorContext(")).toBe(true);
		expect(
			vacationAssignmentActionsSource.includes("ensureSettingsActorCanAccessEmployeeTarget("),
		).toBe(true);
		expect(workPolicyActionsSource.includes("getEmployeeSettingsActorContext(")).toBe(true);
		expect(workPolicyActionsSource.includes("ensureSettingsActorCanAccessEmployeeTarget(")).toBe(
			true,
		);
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
		expect(actionsSource.includes('employeeRecord.role !== "admin"')).toBe(false);
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
		expect(customerActionsSource.includes("ensureSettingsActorCanAccessCustomerTarget(")).toBe(
			true,
		);
		expect(customerActionsSource.includes('emp?.role === "admin"')).toBe(false);
	});

	it("uses shared scheduling scope helpers for shift templates and coverage actions", () => {
		const templateActionsSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "../scheduling/actions/template-actions.ts"), "utf8"),
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

	it("keeps payroll and scheduled export pages on legal entity settings access helpers", () => {
		const pages = ["payroll-export/page.tsx", "payroll-readiness/page.tsx", "scheduled-exports/page.tsx"];

		for (const relativePath of pages) {
			const source = stripComments(readFileSync(join(SETTINGS_ROOT, relativePath), "utf8"));

			expect(source.includes("requireLegalEntitySettingsAccess(")).toBe(true);
			expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(false);
		}

		const authHelperSource = stripComments(
			readFileSync(join(SETTINGS_ROOT, "../../../../lib/auth-helpers.ts"), "utf8"),
		);
		expect(authHelperSource.includes("getLegalEntitySelectionContext(")).toBe(true);
	});

	it("keeps scheduled export actions on legal entity settings access checks", () => {
		const source = stripComments(
			readFileSync(join(SETTINGS_ROOT, "scheduled-exports/actions.ts"), "utf8"),
		);

		expect(source.includes("requireLegalEntitySettingsAccess(")).toBe(true);
		expect(source.includes("isOrgAdminCasl(")).toBe(false);
		expect(source.includes('authContext.employee.role !== "admin"')).toBe(false);
	});

	it("keeps the demo data feature flag out of direct Better Auth organization input", () => {
		const source = stripComments(
			readFileSync(join(SETTINGS_ROOT, "../../../../lib/auth.ts"), "utf8"),
		);
		const demoDataField = source.slice(
			source.indexOf("demoDataEnabled:"),
			source.indexOf("timezone:", source.indexOf("demoDataEnabled:")),
		);

		expect(demoDataField).toContain("input: false");
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
			readFileSync(
				join(SETTINGS_ROOT, "../../../../components/settings/employee-skills-card.tsx"),
				"utf8",
			),
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

		expect(pageClientSource.includes('props.accessTier === "orgAdmin"')).toBe(true);
		expect(pageClientSource.includes("{isAdmin && (")).toBe(false);
		expect(querySource.includes('currentEmployeeQuery.data?.role === "admin"')).toBe(false);
		expect(querySource.includes('isAdmin: options.accessTier === "orgAdmin"')).toBe(true);
	});

	it("keeps organization management org-admin-only and separate from teams", () => {
		const source = stripComments(
			readFileSync(join(SETTINGS_ROOT, "organizations/page.tsx"), "utf8"),
		);

		expect(source.includes("getCurrentSettingsRouteContext(")).toBe(true);
		expect(source.includes('accessTier !== "orgAdmin"')).toBe(true);
		expect(source.includes("loadTeamSettingsPageData(")).toBe(false);
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

	it.each(
		ORG_ADMIN_SETTINGS_ROUTES,
	)("permits owner and admin through %s while keeping members out", (route) => {
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
	});

	it("replaces direct admin-only page guards with the shared org-admin helper", () => {
		const offenders: string[] = [];

		for (const relativePath of ORG_ADMIN_ROUTE_FILES) {
			const absolutePath = join(SETTINGS_ROOT, relativePath);

			if (!existsSync(absolutePath)) {
				continue;
			}

			const source = stripComments(readFileSync(absolutePath, "utf8"));

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
	legalEntityAdminIds?: string[];
}) {
	return resolveSettingsAccessTier(input);
}
