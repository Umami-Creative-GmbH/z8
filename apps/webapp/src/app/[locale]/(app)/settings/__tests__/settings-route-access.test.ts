import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	getResolvedSettingsVisibility,
	getVisibleSettings,
	SETTINGS_ENTRIES,
} from "@/components/settings/settings-config";
import { AUTH_ORGANIZATION_SCHEMA } from "@/lib/auth/auth-schema-options";
import {
	meetsSettingsAccess,
	settingsAccessOf,
} from "@/lib/organization-action/settings-access";
import { readTestText } from "@/test/read-test-text";

const SETTINGS_ROOT = fileURLToPath(new URL("..", import.meta.url));

const ORG_ADMIN_ROUTE_FILES = [
	"clocking/page.tsx",
	"notification-channels/page.tsx",
	"billing/page.tsx",
	"avv/page.tsx",
	"roles/page.tsx",
	"payroll-access/page.tsx",
	"travel-expenses/page.tsx",
	"enterprise/domains/page.tsx",
	"enterprise/identity-setup/page.tsx",
	"enterprise/email/page.tsx",
	"enterprise/api-keys/page.tsx",
	"enterprise/api-keys/[keyId]/page.tsx",
	"report-share-links/page.tsx",
	"export/page.tsx",
	"export/history/[organizationId]/page.tsx",
	"payroll-export/page.tsx",
	"work-diagnostics/page.tsx",
	"audit-export/page.tsx",
	"demo/page.tsx",
	"import/page.tsx",
	"export-operations/page.tsx",
	"scheduled-exports/page.tsx",
	"implementation-checklist/page.tsx",
	"personnel-files/page.tsx",
	"kiosks/page.tsx",
	"custom-fields/page.tsx",
	"vehicles/page.tsx",
	"equipment/page.tsx",
	"driving-licence/page.tsx",
] as const;

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("org-admin settings route access", () => {
	it("keeps settings layout mobile overflow guards in place", () => {
		const source = stripComments(readTestText(join(SETTINGS_ROOT, "layout.tsx"), "utf8"));

		expect(source).toContain('className="flex min-h-0 min-w-0 flex-1 overflow-hidden"');
		expect(source).toContain('className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"');
		expect(source).toContain('className="min-w-0 flex-1 overflow-auto overflow-x-hidden"');
	});

	it("keeps merged chat settings on the mobile-safe tab layout", () => {
		const source = readTestText(join(SETTINGS_ROOT, "notification-channels/page.tsx"), "utf8");
		expect(source).toContain("<SettingsTabbedPage");
	});

	it("keeps payroll officer settings on the shared detail page spacing", () => {
		const source = stripComments(
			readTestText(join(SETTINGS_ROOT, "payroll-access/page.tsx"), "utf8"),
		);

		expect(source).toContain("<PageHeader");
		expect(source).toContain('className="page-frame"');
		expect(source).toContain('className="page-measure space-y-6"');
		expect(source).not.toContain("text-2xl");
	});

	it("treats owners as org admins for settings route checks", () => {
		const access = settingsAccessOf({
			membershipRole: "owner",
			employee: { id: "emp-1", role: "employee", former: false },
		});

		expect(access).toBe("owner");
		expect(meetsSettingsAccess(access, "orgAdmin")).toBe(true);
	});

	it("keeps the export operations page on the shared org-admin helper", () => {
		const source = stripComments(
			readTestText(join(SETTINGS_ROOT, "export-operations/page.tsx"), "utf8"),
		);

		expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(true);
	});

	it("allows managers through teams but not organization management", () => {
		const managerAccess = settingsAccessOf({
			membershipRole: "member",
			employee: { id: "emp-1", role: "manager", former: false },
		});
		const visibleHrefs = new Set(
			getVisibleSettings(managerAccess, true).map((entry) => entry.href),
		);

		expect(managerAccess).toBe("scopedManager");
		expect(visibleHrefs.has("/settings/organization")).toBe(false);
		expect(visibleHrefs.has("/settings/teams")).toBe(true);
		expect(visibleHrefs.has("/settings/statistics")).toBe(false);
		expect(visibleHrefs.has("/settings/employees")).toBe(true);
		expect(visibleHrefs.has("/settings/locations")).toBe(true);
		expect(visibleHrefs.has("/settings/skills")).toBe(true);
		expect(visibleHrefs.has("/settings/vacation")).toBe(true);
		expect(visibleHrefs.has("/settings/work-categories")).toBe(true);
		expect(visibleHrefs.has("/settings/work-policies")).toBe(true);
		expect(visibleHrefs.has("/settings/shifts")).toBe(true);
		expect(visibleHrefs.has("/settings/projects")).toBe(true);
		expect(visibleHrefs.has("/settings/customers")).toBe(true);
		expect(visibleHrefs.has("/settings/surcharges")).toBe(true);
		expect(visibleHrefs.has("/settings/calendar")).toBe(true);
		expect(visibleHrefs.has("/settings/billing")).toBe(false);
		expect(visibleHrefs.has("/settings/notification-channels")).toBe(false);
		expect(visibleHrefs.has("/settings/implementation-checklist")).toBe(false);
	});

	it("guards direct demo route and mutations with the demo data feature helper", () => {
		const pageSource = stripComments(readTestText(join(SETTINGS_ROOT, "demo/page.tsx"), "utf8"));
		const actionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "demo/actions.ts"), "utf8"),
		);

		expect(pageSource.includes("isDemoDataEnabledForOrganization(")).toBe(true);
		expect(pageSource.includes("notFound(")).toBe(true);
		expect(actionsSource.includes("demoDataFeatureGate(")).toBe(true);
		expect(actionsSource).not.toMatch(/Effect\.promise\(\(\) => isOrgAdminCasl\(/);
	});

	it("lets the calendar route use scoped settings access while keeping mutations org-admin only", () => {
		const pageSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "calendar/page.tsx"), "utf8"),
		);
		const actionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "calendar/actions.ts"), "utf8"),
		);

		expect(pageSource.includes("getCurrentSettingsAccess(")).toBe(true);
		expect(pageSource.includes("requireOrgAdminSettingsAccess(")).toBe(false);
		expect(pageSource.includes('meetsSettingsAccess(caller.settingsAccess, "scopedManager")')).toBe(
			true,
		);
		expect(pageSource.includes("getManagerCalendarReadView(")).toBe(true);
		expect(pageSource.includes("getCalendarSettings(")).toBe(true);
		expect(pageSource.includes("googleEnabled: true")).toBe(false);
		expect(pageSource.includes("microsoft365Enabled: true")).toBe(false);
		expect(pageSource.includes("if (!settingsResult.success)")).toBe(true);
		expect(actionsSource.includes("teamPermissions")).toBe(true);
		expect(actionsSource.includes("locationEmployee")).toBe(true);
		expect(actionsSource.includes("subareaEmployee")).toBe(true);
		expect(actionsSource.includes("projectManager")).toBe(true);
		expect(actionsSource.includes("projectAssignment")).toBe(true);
		expect(actionsSource.includes("projectAssignment.organizationId")).toBe(true);
		expect(actionsSource.includes('requires: "orgAdmin"')).toBe(true);
		expect(actionsSource.includes("getManagerCalendarReadView")).toBe(true);
	});

	it("lets the surcharges route use scoped settings access with read-only manager controls", () => {
		const pageSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "surcharges/page.tsx"), "utf8"),
		);
		const actionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "surcharges/actions.ts"), "utf8"),
		);

		expect(pageSource.includes("getCurrentSettingsAccess(")).toBe(true);
		expect(pageSource.includes("requireOrgAdminSettingsAccess(")).toBe(false);
		expect(pageSource.includes('meetsSettingsAccess(caller.settingsAccess, "scopedManager")')).toBe(
			true,
		);
		expect(pageSource.includes('meetsSettingsAccess(caller.settingsAccess, "orgAdmin")')).toBe(
			true,
		);
		expect(actionsSource.includes("requireOrgAdminSurchargeActor(")).toBe(false);
		expect(actionsSource.includes('requires: "orgAdmin"')).toBe(true);
		expect(actionsSource.includes("projectManager")).toBe(true);
		expect(actionsSource.includes("locationEmployee")).toBe(true);
		expect(actionsSource.includes("subareaEmployee")).toBe(true);
		expect(actionsSource.includes('authContext.employee.role !== "admin"')).toBe(false);
	});

	it("lets the locations route use scoped settings access instead of the org-admin helper", () => {
		const source = stripComments(readTestText(join(SETTINGS_ROOT, "locations/page.tsx"), "utf8"));

		expect(source.includes("getCurrentSettingsAccess(")).toBe(true);
		expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(false);
	});

	it("checks location detail access from the shared settings access resolver before rendering", () => {
		const source = stripComments(
			readTestText(join(SETTINGS_ROOT, "locations/[locationId]/page.tsx"), "utf8"),
		);

		expect(source.includes("getCurrentSettingsAccess(")).toBe(true);
		expect(source.includes("authContext.employee")).toBe(false);
		expect(source.includes("NoEmployeeError")).toBe(false);
		expect(source.includes('meetsSettingsAccess(caller.settingsAccess, "scopedManager")')).toBe(
			true,
		);
	});

	it("leaves location assignment mutations to organization-action settings access", () => {
		const source = stripComments(
			readTestText(join(SETTINGS_ROOT, "locations/assignment-actions.ts"), "utf8"),
		);

		expect(source.includes('requires: "orgAdmin"')).toBe(true);
		expect(source.includes('emp?.role === "admin"')).toBe(false);
	});

	it("lets shift settings page use scoped settings access instead of the org-admin helper", () => {
		const source = stripComments(readTestText(join(SETTINGS_ROOT, "shifts/page.tsx"), "utf8"));

		expect(source.includes("getSchedulingSettingsAccessContext(")).toBe(true);
		expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(false);
	});

	it("lets project and customer settings pages use scoped settings access instead of the org-admin helper", () => {
		const pages = ["projects/page.tsx", "customers/page.tsx"];

		for (const relativePath of pages) {
			const source = stripComments(readTestText(join(SETTINGS_ROOT, relativePath), "utf8"));

			expect(source.includes("getCurrentSettingsAccess(")).toBe(true);
			expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(false);
		}
	});

	it("lets vacation and work-policy pages use scoped settings access instead of the org-admin helper", () => {
		const pages = ["vacation/page.tsx", "work-policies/page.tsx"];

		for (const relativePath of pages) {
			const source = stripComments(readTestText(join(SETTINGS_ROOT, relativePath), "utf8"));

			expect(source.includes("getCurrentSettingsAccess(")).toBe(true);
			expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(false);
		}
	});

	it("keeps vacation employee allowances on shared org-admin route access instead of employee-role checks", () => {
		const source = stripComments(
			readTestText(join(SETTINGS_ROOT, "vacation/employees/page.tsx"), "utf8"),
		);

		expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(true);
		expect(source.includes("getCurrentEmployee(")).toBe(false);
		expect(source.includes('authContext.employee.role !== "admin"')).toBe(false);
	});

	it("lets the work-categories route use scoped settings access and read-only manager controls", () => {
		const pageSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "work-categories/page.tsx"), "utf8"),
		);
		const actionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "work-categories/actions.ts"), "utf8"),
		);

		expect(pageSource.includes("getCurrentSettingsAccess(")).toBe(true);
		expect(pageSource.includes("requireOrgAdminSettingsAccess(")).toBe(false);
		expect(pageSource.includes('meetsSettingsAccess(settingsAccess, "orgAdmin")')).toBe(true);
		expect(actionsSource.includes('requires: "scopedManager"')).toBe(true);
		expect(actionsSource.includes('requires: "orgAdmin"')).toBe(true);
		expect(actionsSource.includes("actor.managedScope()")).toBe(true);
		expect(actionsSource.includes("getEmployeeSettingsActorContext(")).toBe(false);
		expect(actionsSource.includes('employeeRecord.role !== "admin"')).toBe(false);
	});

	it("lets employee and skill settings pages use scoped settings access instead of the org-admin helper", () => {
		const pages = ["employees/page.tsx", "employees/[employeeId]/page.tsx", "skills/page.tsx"];

		for (const relativePath of pages) {
			const source = stripComments(readTestText(join(SETTINGS_ROOT, relativePath), "utf8"));

			expect(source.includes("getCurrentSettingsAccess(")).toBe(true);
			expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(false);
		}
	});

	it("checks employee detail access at page entry before rendering the client surface", () => {
		const source = stripComments(
			readTestText(join(SETTINGS_ROOT, "employees/[employeeId]/page.tsx"), "utf8"),
		);

		expect(source.includes("getEmployee(")).toBe(true);
		expect(source.includes('redirectWithLocale("/settings/employees")')).toBe(true);
	});

	it("keeps the route locale on every localized redirect", () => {
		// API routes have no locale prefix.
		const unprefixedRedirect = /\bredirect\(\s*["'`]\/(?!api\/)/;
		const localeRoot = join(SETTINGS_ROOT, "../..");
		const files = [
			...listSourceFiles(localeRoot),
			join(SETTINGS_ROOT, "../../../../lib/auth-helpers.ts"),
		];
		const offenders = files.filter((file) =>
			unprefixedRedirect.test(stripComments(readTestText(file, "utf8"))),
		);

		expect(offenders.map((file) => relative(localeRoot, file))).toEqual([]);
	});

	it("uses shared scoped access helpers instead of admin-only checks for employee and skill actions", () => {
		const employeeMutationsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "employees/employee-mutations.actions.ts"), "utf8"),
		);
		const skillsActionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "skills/actions.ts"), "utf8"),
		);

		expect(employeeMutationsSource.includes("requireAdmin(currentEmployee")).toBe(false);
		expect(employeeMutationsSource.includes("loadManagedEmployee(")).toBe(true);
		expect(skillsActionsSource.includes('currentEmployee.role !== "admin"')).toBe(false);
	});

	it("does not re-export type-only skill shapes from the server actions module", () => {
		const skillsActionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "skills/actions.ts"), "utf8"),
		);

		expect(skillsActionsSource).not.toMatch(/export\s+type\s+\{[^}]*EmployeeSkillWithDetails/);
		expect(skillsActionsSource).not.toMatch(/export\s+type\s+\{[^}]*SkillValidationResult/);
		expect(skillsActionsSource).not.toMatch(/export\s+type\s+\{[^}]*SkillWithRelations/);
	});

	it("keeps the implementation checklist context loader server-only", () => {
		const actionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "implementation-checklist/actions.ts"), "utf8"),
		);
		const queriesSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "implementation-checklist/queries.ts"), "utf8"),
		);

		expect(actionsSource).not.toMatch(
			/export\s+async\s+function\s+loadImplementationChecklistForContext/,
		);
		expect(queriesSource.startsWith('import "server-only";')).toBe(true);
		expect(queriesSource).toMatch(
			/export\s+async\s+function\s+loadImplementationChecklistForContext/,
		);
	});

	it("uses shared scoped access helpers for vacation and work-policy actions", () => {
		const vacationActionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "vacation/actions.ts"), "utf8"),
		);
		const vacationAssignmentActionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "vacation/assignment-actions.ts"), "utf8"),
		);
		const workPolicyActionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "work-policies/actions.ts"), "utf8"),
		);

		for (const source of [
			vacationActionsSource,
			vacationAssignmentActionsSource,
			workPolicyActionsSource,
		]) {
			expect(source.includes('requires: "scopedManager"')).toBe(true);
			expect(source.includes("getEmployeeSettingsActorContext(")).toBe(false);
			expect(source.includes("ensureSettingsActorCanAccessEmployeeTarget(")).toBe(false);
			expect(source.includes('employeeRecord.role !== "admin"')).toBe(false);
		}
		// A scoped manager reaches only the employees in their managed scope.
		expect(vacationActionsSource.includes("findManagedEmployee(")).toBe(true);
		expect(vacationAssignmentActionsSource.includes("findManagedEmployee(")).toBe(true);
		expect(workPolicyActionsSource.includes("refuseUnlessManaged(")).toBe(true);
		// Policy compliance stays org-admin only.
		expect(workPolicyActionsSource).toMatch(
			/name: "workPolicies\.listViolations",\s*requires: "orgAdmin"/,
		);
	});

	it("uses scoped holiday access helpers for reads while keeping mutations org-admin only", () => {
		const holidayActionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "vacation/holiday-actions.ts"), "utf8"),
		);
		const presetActionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "vacation/holiday-preset-actions.ts"), "utf8"),
		);

		for (const source of [holidayActionsSource, presetActionsSource]) {
			expect(source.includes('requires: "scopedManager"')).toBe(true);
			expect(source.includes('requires: "orgAdmin"')).toBe(true);
			expect(source.includes("holidayScopeOf(")).toBe(true);
			expect(source.includes("filterAssignmentsForManagerHolidayScope(")).toBe(true);
			expect(source.includes("getEmployeeSettingsActorContext(")).toBe(false);
			expect(source.includes('employeeRecord.role !== "admin"')).toBe(false);
		}
	});

	it("keeps change-policy actions manager-aware under work-policies", () => {
		const actionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "work-policies/change-policy-actions.ts"), "utf8"),
		);

		expect(actionsSource.includes('requires: "scopedManager"')).toBe(true);
		expect(actionsSource.includes('requires: "orgAdmin"')).toBe(true);
		expect(actionsSource.includes("actor.managedScope()")).toBe(true);
		expect(actionsSource.includes("getEmployeeSettingsActorContext(")).toBe(false);
		expect(actionsSource.includes('employeeRecord.role !== "admin"')).toBe(false);
	});

	it("uses shared scoped access helpers for project and customer actions", () => {
		const projectActionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "projects/actions.ts"), "utf8"),
		);
		const customerActionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "customers/actions.ts"), "utf8"),
		);

		expect(projectActionsSource.includes("projectSettingsActorOf(")).toBe(true);
		expect(projectActionsSource.includes("reachesProject(")).toBe(true);
		expect(projectActionsSource.includes('emp?.role === "admin"')).toBe(false);
		expect(customerActionsSource.includes("projectSettingsActorOf(")).toBe(true);
		expect(customerActionsSource.includes("reachesCustomer(")).toBe(true);
		expect(customerActionsSource.includes('emp?.role === "admin"')).toBe(false);
	});

	it("uses shared scheduling scope helpers for shift templates and coverage actions", () => {
		const templateActionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "../scheduling/actions/template-actions.ts"), "utf8"),
		);
		const coverageActionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "shifts/coverage-rule-actions.ts"), "utf8"),
		);

		expect(templateActionsSource.includes("getSchedulingSettingsAccessContext(")).toBe(true);
		expect(templateActionsSource.includes("canManageScopedSchedulingSubarea(")).toBe(true);
		expect(templateActionsSource.includes("requireManagerEmployee(")).toBe(false);
		expect(coverageActionsSource.includes("coverageRuleSubareaScope(")).toBe(true);
		expect(coverageActionsSource.includes('authContext.employee.role !== "admin"')).toBe(false);
	});

	it("keeps the skills read api on settings access checks instead of employee-only role checks", () => {
		const source = stripComments(
			readTestText(join(SETTINGS_ROOT, "../../../api/settings/skills/route.ts"), "utf8"),
		);

		expect(source.includes("getCurrentSettingsAccess(")).toBe(true);
		expect(source.includes("authContext?.employee")).toBe(false);
		expect(source.includes('authContext.employee.role !== "admin"')).toBe(false);
	});

	it("keeps audit log, roles, and team permission settings surfaces on org-admin settings access", () => {
		const auditExportSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "audit-export/page.tsx"), "utf8"),
		);
		const auditLogActionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "audit-export/audit-log-actions.ts"), "utf8"),
		);
		const rolesSource = stripComments(readTestText(join(SETTINGS_ROOT, "roles/page.tsx"), "utf8"));
		const permissionsActionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "roles/team-permission-actions.ts"), "utf8"),
		);

		expect(auditExportSource.includes("requireOrgAdminSettingsAccess(")).toBe(true);
		expect(auditLogActionsSource.includes('requires: "orgAdmin"')).toBe(true);
		expect(auditLogActionsSource.includes('employee?.role !== "admin"')).toBe(false);
		expect(rolesSource.includes("requireOrgAdminSettingsAccess(")).toBe(true);
		expect(rolesSource.includes("<SettingsTabbedPage")).toBe(true);
		expect(rolesSource.includes('value: "team-permissions"')).toBe(true);
		expect(permissionsActionsSource.includes("organizationAction(")).toBe(true);
		expect(permissionsActionsSource.includes("getEmployeeSettingsActorContext(")).toBe(false);
		expect(permissionsActionsSource.includes('currentEmployee.role !== "admin"')).toBe(false);
	});

	it("keeps enterprise and travel-expense actions on shared org-admin helpers instead of employee-role checks", () => {
		const travelExpensesSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "travel-expenses/actions.ts"), "utf8"),
		);
		const enterpriseActionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "enterprise/actions.ts"), "utf8"),
		);

		// Travel expense settings share one guard (spec #598 review), built on the org-admin helper.
		const expenseAdministratorSource = stripComments(
			readTestText(
				join(SETTINGS_ROOT, "../../../../lib/travel-expenses/expense-administrator.ts"),
				"utf8",
			),
		);
		// Travel expense settings actions authorize through the organization action module (#1617).
		expect(travelExpensesSource.includes('requires: "orgAdmin"')).toBe(true);
		expect(expenseAdministratorSource.includes("canManageCurrentOrganizationSettings(")).toBe(true);
		expect(expenseAdministratorSource.includes('role !== "admin"')).toBe(false);
		expect(travelExpensesSource.includes('authContext.employee.role !== "admin"')).toBe(false);
		// Enterprise settings actions authorize through the organization action module (#1612).
		expect(enterpriseActionsSource.includes('requires: "orgAdmin"')).toBe(true);
		expect(enterpriseActionsSource.includes('authContext.employee?.role !== "admin"')).toBe(false);
	});

	it("keeps enterprise identity setup on org-admin settings access", () => {
		const setupPageSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "enterprise/identity-setup/page.tsx"), "utf8"),
		);

		expect(setupPageSource.includes("requireOrgAdminSettingsAccess(")).toBe(true);
		expect(setupPageSource.includes('employee?.role !== "admin"')).toBe(false);
		expect(
			SETTINGS_ENTRIES.find((entry) => entry.href === "/settings/enterprise/identity-setup")
				?.minimumAccess,
		).toBe("orgAdmin");
	});

	it("keeps the scheduled exports page shell on shared org-admin parity helpers", () => {
		const source = stripComments(
			readTestText(join(SETTINGS_ROOT, "scheduled-exports/page.tsx"), "utf8"),
		);

		expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(true);
		expect(source.includes('authContext.employee.role !== "admin"')).toBe(false);
	});

	it.each([
		"demoDataEnabled",
		"worksCouncilEnabled",
		"billableTimeEnabled",
		"personnelFilesEnabled",
		"equipmentEnabled",
	] as const)(
		"keeps the %s feature switch out of direct Better Auth organization input",
		(feature) => {
			expect(AUTH_ORGANIZATION_SCHEMA.organization.additionalFields[feature].input).toBe(false);
		},
	);

	it("hides the equipment settings page while equipment is switched off", () => {
		const source = readTestText(join(SETTINGS_ROOT, "equipment/page.tsx"), "utf8");

		expect(source).toMatch(
			/if \(!\(await isEquipmentEnabled\(db, organizationId\)\)\) notFound\(\);/,
		);
	});

	it.each([
		["compliance/works-council/page.tsx", "worksCouncilEnabled"],
		["customers/page.tsx", "projectsEnabled"],
		["projects/page.tsx", "projectsEnabled"],
		["surcharges/page.tsx", "surchargesEnabled"],
		["shifts/page.tsx", "shiftsEnabled"],
	] as const)(
		"guards direct access to %s with the shared %s feature-flag guard (#1961)",
		(pagePath, feature) => {
			const source = stripComments(readTestText(join(SETTINGS_ROOT, pagePath), "utf8"));

			expect(source).toContain("requireOrganizationFeatureEnabled(");
			expect(source).toContain(`"${feature}"`);
		},
	);

	it("keeps works council settings updates in an exported organizationAction without inline server actions (#1961)", () => {
		const pageSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "compliance/works-council/page.tsx"), "utf8"),
		);
		const actionsSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "compliance/works-council/actions.ts"), "utf8"),
		);

		expect(pageSource).not.toContain('"use server"');
		expect(pageSource).not.toContain("'use server'");
		expect(actionsSource).toContain("organizationAction(");
		expect(actionsSource).toContain('requires: "orgAdmin"');
	});

	it("keeps report-share-links accessible with a Projects-disabled notice instead of notFound (#1961)", () => {
		const source = stripComments(
			readTestText(join(SETTINGS_ROOT, "report-share-links/page.tsx"), "utf8"),
		);

		expect(source).toContain("requireOrgAdminSettingsAccess(");
		expect(source).toContain('isOrganizationFeatureEnabled(organizationId, "projectsEnabled")');
		expect(source).not.toContain("requireOrganizationFeatureEnabled(");
	});

	it("gates the Billable Time settings pages and top-level Hand-off workspace on org admins and the module flag", () => {
		for (const page of [
			join(SETTINGS_ROOT, "billable-time/page.tsx"),
			join(SETTINGS_ROOT, "billable-time/cost-rates/page.tsx"),
			join(SETTINGS_ROOT, "billable-time/accounting/page.tsx"),
			join(SETTINGS_ROOT, "../billable-time/hand-off/page.tsx"),
		]) {
			const source = stripComments(readTestText(page, "utf8"));

			expect(source.includes("requireBillableTimeSettingsAccess("), page).toBe(true);
		}
		for (const [legacyPage, target] of [
			["billable-time/rates/page.tsx", 'redirectWithLocale("/settings/billable-time")'],
			["billable-time/hand-off/page.tsx", 'redirectWithLocale("/billable-time/hand-off")'],
		] as const) {
			const source = stripComments(
				readTestText(join(SETTINGS_ROOT, legacyPage), "utf8"),
			);
			expect(source.includes(target), legacyPage).toBe(true);
		}
	});

	it("narrows manager employee editing away from org-admin-only form controls", () => {
		const source = stripComments(
			readTestText(
				join(SETTINGS_ROOT, "employees/[employeeId]/employee-edit-form-card.tsx"),
				"utf8",
			),
		);

		expect(source.includes("canEditOrgAdminFields")).toBe(true);
		expect(source.includes("canEditManagerFields")).toBe(true);
		expect(source.includes("disabled={!isAdmin || isUpdating}")).toBe(false);
	});

	it("keeps the employee skill controls visible for scoped managers instead of admin-only clients", () => {
		const detailClientSource = stripComments(
			readTestText(
				join(SETTINGS_ROOT, "employees/[employeeId]/employee-detail-page-client.tsx"),
				"utf8",
			),
		);
		const employeeSkillsCardSource = stripComments(
			readTestText(
				join(SETTINGS_ROOT, "../../../../components/settings/employee-skills-card.tsx"),
				"utf8",
			),
		);

		expect(detailClientSource.includes("canManageSkills")).toBe(true);
		expect(detailClientSource.includes("isAdmin={isAdmin}")).toBe(false);
		expect(employeeSkillsCardSource.includes("canManageSkills")).toBe(true);
		expect(employeeSkillsCardSource.includes("{isAdmin && (")).toBe(false);
	});

	it("keeps employee list invite visibility on settings access instead of employee admin role", () => {
		const pageClientSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "employees/employees-page-client.tsx"), "utf8"),
		);
		const querySource = stripComments(
			readTestText(join(SETTINGS_ROOT, "../../../../lib/query/use-employees.ts"), "utf8"),
		);

		expect(pageClientSource.includes('meetsSettingsAccess(props.settingsAccess, "orgAdmin")')).toBe(
			true,
		);
		expect(pageClientSource.includes("{isAdmin && (")).toBe(false);
		expect(querySource.includes('currentEmployeeQuery.data?.role === "admin"')).toBe(false);
		expect(querySource).toMatch(
			/meetsSettingsAccess\(\s*options\.settingsAccess \?\? null,\s*"orgAdmin",?\s*\)/,
		);
		expect(querySource.includes("isAdmin: isOrgAdmin")).toBe(true);
	});

	it("keeps organization management org-admin-only and separate from teams", () => {
		const source = stripComments(
			readTestText(join(SETTINGS_ROOT, "organization/page.tsx"), "utf8"),
		);

		// The shared settings access resolver guards the page and feeds its controls (#1623).
		expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(true);
		expect(source.includes("settingsAccess={settingsAccess}")).toBe(true);
		expect(source.includes("loadTeamSettingsPageData(")).toBe(false);
	});

	it("derives team detail capabilities from scoped team data instead of employee-only checks", () => {
		const pageSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "teams/[teamId]/page.tsx"), "utf8"),
		);
		const clientSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "teams/[teamId]/team-detail-page-client.tsx"), "utf8"),
		);
		const controllerSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "teams/[teamId]/use-team-detail-page.ts"), "utf8"),
		);

		expect(pageSource.includes("getCurrentEmployee(")).toBe(false);
		expect(controllerSource.includes("team?.canManageSettings")).toBe(true);
		expect(controllerSource.includes("team?.canManageMembers")).toBe(true);
		expect(
			`${clientSource}\n${controllerSource}`.includes('currentEmployee?.role === "admin"'),
		).toBe(false);
	});

	it.each(
		SETTINGS_ENTRIES.filter((entry) => entry.minimumAccess === "orgAdmin").map(
			(entry) => entry.href,
		),
	)("permits owner and admin through %s while keeping members and scoped managers out", (route) => {
		const ownerAccess = settingsAccessOf({
			membershipRole: "owner",
			employee: null,
		});
		const adminAccess = settingsAccessOf({
			membershipRole: "admin",
			employee: { id: "emp-admin", role: "admin", former: false },
		});
		const managerAccess = settingsAccessOf({
			membershipRole: "member",
			employee: { id: "emp-manager", role: "manager", former: false },
		});
		const memberAccess = settingsAccessOf({
			membershipRole: "member",
			employee: { id: "emp-member", role: "employee", former: false },
		});
		const formerOwnerAccess = settingsAccessOf({
			membershipRole: "owner",
			employee: { id: "emp-former", role: "admin", former: true },
		});

		const canSee = (access: ReturnType<typeof settingsAccessOf>) =>
			getResolvedSettingsVisibility({
				settingsAccess: access,
				billingEnabled: true,
				settingsCapabilities: { canManageDrivingLicence: true },
			}).visibleSettings.some((entry) => entry.href === route);

		expect(canSee(ownerAccess)).toBe(true);
		expect(canSee(adminAccess)).toBe(true);
		expect(canSee(managerAccess)).toBe(false);
		expect(canSee(memberAccess)).toBe(false);
		expect(canSee(formerOwnerAccess)).toBe(false);
	});

	it("replaces direct admin-only page guards with the shared org-admin helper", () => {
		const offenders: string[] = [];

		for (const relativePath of ORG_ADMIN_ROUTE_FILES) {
			const absolutePath = join(SETTINGS_ROOT, relativePath);

			if (!existsSync(absolutePath)) {
				continue;
			}

			const source = stripComments(readTestText(absolutePath, "utf8"));

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

	it("streams fail-closed billing access behind a focused boundary", () => {
		const billingSource = stripComments(
			readTestText(join(SETTINGS_ROOT, "billing/page.tsx"), "utf8"),
		);

		expect(billingSource).toContain("await connection()");
		expect(billingSource.indexOf("await connection()")).toBeLessThan(
			billingSource.indexOf('if (env.BILLING_ENABLED !== "true")'),
		);
		expect(billingSource).toContain("async function BillingSettingsContent()");
		expect(billingSource).toContain(
			"<Suspense fallback={<BillingSettingsLoading />}>\n\t\t\t<BillingSettingsContent />\n\t\t</Suspense>",
		);
		expect(
			billingSource.indexOf("async function BillingSettingsContent()") <
				billingSource.indexOf('if (env.BILLING_ENABLED !== "true")'),
		).toBe(true);
		expect(
			billingSource.indexOf('if (env.BILLING_ENABLED !== "true")') <
				billingSource.indexOf("await requireOrgAdminSettingsAccess()"),
		).toBe(true);
	});

	it("streams fail-closed AVV access behind a focused boundary", () => {
		const avvSource = stripComments(readTestText(join(SETTINGS_ROOT, "avv/page.tsx"), "utf8"));

		expect(avvSource).toContain("await connection()");
		expect(avvSource.indexOf("await connection()")).toBeLessThan(
			avvSource.indexOf('if (env.BILLING_ENABLED !== "true")'),
		);
		expect(avvSource).toContain("async function AvvPageContent()");
		expect(avvSource).toContain(
			"<Suspense fallback={<AvvPageLoading />}>\n\t\t\t<AvvPageContent />\n\t\t</Suspense>",
		);
		expect(
			avvSource.indexOf("async function AvvPageContent()") <
				avvSource.indexOf('if (env.BILLING_ENABLED !== "true")'),
		).toBe(true);
		expect(
			avvSource.indexOf('if (env.BILLING_ENABLED !== "true")') <
				avvSource.indexOf("requireOrgAdminSettingsAccess()"),
		).toBe(true);
	});
});

function listSourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const entryPath = join(directory, entry.name);

		if (entry.isDirectory()) {
			return entry.name === "__tests__" ? [] : listSourceFiles(entryPath);
		}

		return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [entryPath] : [];
	});
}
