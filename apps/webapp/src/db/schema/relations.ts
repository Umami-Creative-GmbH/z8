import { relations } from "drizzle-orm";

// Import auth tables
import {
	invitation,
	member,
	organization,
	session,
	user,
} from "../auth-schema";
import { absenceCategory, absenceEntry } from "./absence";
// Conditional access policies
import {
	accessPolicy,
	accessViolationLog,
	sessionExtension,
	trustedDevice,
} from "./access-policy";
import { approvalRequest } from "./approval";
import { auditLog } from "./audit";
import { changePolicy, changePolicyAssignment } from "./change-policy";
import { complianceException } from "./compliance";
import { complianceConfig, complianceFinding } from "./compliance-finding";
import { coverageRule, coverageSettings } from "./coverage";
import { customer } from "./customer";
import {
	organizationBranding,
	organizationDomain,
	organizationEmailConfig,
	organizationSocialOAuth,
} from "./enterprise";
import { dataExport, exportStorageConfig } from "./export";
import {
	holiday,
	holidayAssignment,
	holidayCategory,
	holidayPreset,
	holidayPresetAssignment,
	holidayPresetHoliday,
} from "./holiday";
// Identity management (role templates, lifecycle)
import {
	roleTemplate,
	roleTemplateMapping,
	userLifecycleConfig,
	userLifecycleEvent,
	userRoleTemplateAssignment,
} from "./identity";
import { inviteCode, inviteCodeUsage, memberApproval } from "./invite-code";
import {
	notification,
	notificationPreference,
	pushSubscription,
} from "./notification";
// Import tables from all domain files
import {
	employee,
	employeeManagers,
	employeeRateHistory,
	location,
	locationEmployee,
	locationSubarea,
	subareaEmployee,
	team,
	teamPermissions,
} from "./organization";
import {
	payrollExportConfig,
	payrollExportFormat,
	payrollExportJob,
	payrollExportSyncRecord,
	payrollWageTypeMapping,
} from "./payroll-export";
import {
	project,
	projectAssignment,
	projectManager,
	projectNotificationState,
} from "./project";
// SCIM provisioning
import { scimProviderConfig, scimProvisioningLog } from "./scim";
import { shift, shiftRecurrence, shiftRequest, shiftTemplate } from "./shift";
// Skills & qualifications
import {
	employeeSkill,
	shiftTemplateSkillRequirement,
	skill,
	skillRequirementOverride,
	subareaSkillRequirement,
} from "./skill";
import {
	surchargeCalculation,
	surchargeModel,
	surchargeModelAssignment,
	surchargeRule,
} from "./surcharge";
import { timeEntry, workPeriod } from "./time-tracking";
import { userSettings } from "./user-settings";
import {
	employeeVacationAllowance,
	vacationAdjustment,
	vacationAllowance,
	vacationPolicyAssignment,
} from "./vacation";
import { webhookDelivery, webhookEndpoint } from "./webhook";
import { hydrationStats, waterIntakeLog } from "./wellness";
import {
	workCategory,
	workCategorySet,
	workCategorySetAssignment,
	workCategorySetCategory,
} from "./work-category";
import {
	workPolicy,
	workPolicyAssignment,
	workPolicyBreakOption,
	workPolicyBreakRule,
	workPolicyRegulation,
	workPolicySchedule,
	workPolicyScheduleDay,
	workPolicyViolation,
} from "./work-policy";

// ============================================
// RELATIONS
// ============================================

// Organization relations (includes auth relations: members, invitations)
export const organizationRelations = relations(
	organization,
	({ one, many }) => ({
		// Auth relations (from auth-schema tables)
		members: many(member),
		invitations: many(invitation),
		// Invite codes
		inviteCodes: many(inviteCode),
		memberApprovals: many(memberApproval),
		// Business relations
		teams: many(team),
		employees: many(employee),
		absenceCategories: many(absenceCategory),
		holidayCategories: many(holidayCategory),
		holidays: many(holiday),
		holidayPresets: many(holidayPreset),
		holidayPresetAssignments: many(holidayPresetAssignment),
		holidayAssignments: many(holidayAssignment),
		vacationAllowances: many(vacationAllowance),
		vacationPolicyAssignments: many(vacationPolicyAssignment),
		// Work policies (unified schedules + regulations)
		workPolicies: many(workPolicy),
		workPolicyAssignments: many(workPolicyAssignment),
		workPolicyViolations: many(workPolicyViolation),
		// Shift scheduling
		shiftTemplates: many(shiftTemplate),
		shifts: many(shift),
		// Customers
		customers: many(customer),
		// Projects
		projects: many(project),
		projectAssignments: many(projectAssignment),
		// Notifications
		notifications: many(notification),
		notificationPreferences: many(notificationPreference),
		// Enterprise features
		domains: many(organizationDomain),
		branding: one(organizationBranding),
		emailConfig: one(organizationEmailConfig),
		socialOAuthConfigs: many(organizationSocialOAuth),
		// Surcharges
		surchargeModels: many(surchargeModel),
		surchargeModelAssignments: many(surchargeModelAssignment),
		surchargeCalculations: many(surchargeCalculation),
		// Locations
		locations: many(location),
		// Work categories
		workCategories: many(workCategory),
		workCategorySets: many(workCategorySet),
		workCategorySetAssignments: many(workCategorySetAssignment),
		// Change policies
		changePolicies: many(changePolicy),
		changePolicyAssignments: many(changePolicyAssignment),
		// Time tracking
		timeEntries: many(timeEntry),
		workPeriods: many(workPeriod),
		// Approval workflows
		approvalRequests: many(approvalRequest),
		// Compliance exceptions
		complianceExceptions: many(complianceException),
		// Compliance Radar
		complianceFindings: many(complianceFinding),
		complianceConfig: one(complianceConfig),
		// Audit trail
		auditLogs: many(auditLog),
		// Webhooks
		webhookEndpoints: many(webhookEndpoint),
		webhookDeliveries: many(webhookDelivery),
		// Payroll exports
		payrollExportConfigs: many(payrollExportConfig),
		payrollExportJobs: many(payrollExportJob),
		// Coverage
		coverageRules: many(coverageRule),
		coverageSettings: one(coverageSettings),
	}),
);

export const teamRelations = relations(team, ({ one, many }) => ({
	organization: one(organization, {
		fields: [team.organizationId],
		references: [organization.id],
	}),
	employees: many(employee),
	holidayPresetAssignments: many(holidayPresetAssignment),
	holidayAssignments: many(holidayAssignment),
	vacationPolicyAssignments: many(vacationPolicyAssignment),
	workPolicyAssignments: many(workPolicyAssignment),
	projectAssignments: many(projectAssignment),
	// Surcharges
	surchargeModelAssignments: many(surchargeModelAssignment),
	// Work categories
	workCategorySetAssignments: many(workCategorySetAssignment),
	// Change policies
	changePolicyAssignments: many(changePolicyAssignment),
}));

// Location relations
export const locationRelations = relations(location, ({ one, many }) => ({
	organization: one(organization, {
		fields: [location.organizationId],
		references: [organization.id],
	}),
	subareas: many(locationSubarea),
	employees: many(locationEmployee),
	creator: one(user, {
		fields: [location.createdBy],
		references: [user.id],
		relationName: "location_creator",
	}),
	updater: one(user, {
		fields: [location.updatedBy],
		references: [user.id],
		relationName: "location_updater",
	}),
}));

export const locationSubareaRelations = relations(
	locationSubarea,
	({ one, many }) => ({
		location: one(location, {
			fields: [locationSubarea.locationId],
			references: [location.id],
		}),
		employees: many(subareaEmployee),
		// Shift scheduling relations
		shifts: many(shift),
		shiftTemplates: many(shiftTemplate),
		shiftRecurrences: many(shiftRecurrence),
		// Coverage targets
		coverageRules: many(coverageRule),
		// Skill requirements for this subarea
		skillRequirements: many(subareaSkillRequirement),
		creator: one(user, {
			fields: [locationSubarea.createdBy],
			references: [user.id],
			relationName: "subarea_creator",
		}),
		updater: one(user, {
			fields: [locationSubarea.updatedBy],
			references: [user.id],
			relationName: "subarea_updater",
		}),
	}),
);

export const locationEmployeeRelations = relations(
	locationEmployee,
	({ one }) => ({
		location: one(location, {
			fields: [locationEmployee.locationId],
			references: [location.id],
		}),
		employee: one(employee, {
			fields: [locationEmployee.employeeId],
			references: [employee.id],
		}),
		creator: one(user, {
			fields: [locationEmployee.createdBy],
			references: [user.id],
		}),
	}),
);

export const subareaEmployeeRelations = relations(
	subareaEmployee,
	({ one }) => ({
		subarea: one(locationSubarea, {
			fields: [subareaEmployee.subareaId],
			references: [locationSubarea.id],
		}),
		employee: one(employee, {
			fields: [subareaEmployee.employeeId],
			references: [employee.id],
		}),
		creator: one(user, {
			fields: [subareaEmployee.createdBy],
			references: [user.id],
		}),
	}),
);

export const employeeRelations = relations(employee, ({ one, many }) => ({
	user: one(user, {
		fields: [employee.userId],
		references: [user.id],
	}),
	// User settings (timezone, preferences, etc.) - accessed via shared userId
	userSettings: one(userSettings, {
		fields: [employee.userId],
		references: [userSettings.userId],
	}),
	organization: one(organization, {
		fields: [employee.organizationId],
		references: [organization.id],
	}),
	team: one(team, {
		fields: [employee.teamId],
		references: [team.id],
	}),
	manager: one(employee, {
		fields: [employee.managerId],
		references: [employee.id],
		relationName: "manager_employee",
	}),
	subordinates: many(employee, {
		relationName: "manager_employee",
	}),
	rateHistory: many(employeeRateHistory),
	// Multiple managers support
	managers: many(employeeManagers, {
		relationName: "employee_managers",
	}),
	managedEmployees: many(employeeManagers, {
		relationName: "manager_employees",
	}),
	// Team permissions
	teamPermissions: many(teamPermissions),
	// Time tracking
	timeEntries: many(timeEntry),
	workPeriods: many(workPeriod),
	absenceEntries: many(absenceEntry),
	vacationAllowances: many(employeeVacationAllowance),
	requestedApprovals: many(approvalRequest, {
		relationName: "approval_requester",
	}),
	approvalsToDo: many(approvalRequest, {
		relationName: "approval_approver",
	}),
	// Holiday assignments
	holidayPresetAssignments: many(holidayPresetAssignment),
	holidayAssignments: many(holidayAssignment),
	// Vacation policy assignments
	vacationPolicyAssignments: many(vacationPolicyAssignment),
	// Work policy assignments (unified)
	workPolicyAssignments: many(workPolicyAssignment),
	workPolicyViolations: many(workPolicyViolation),
	// Compliance exceptions
	complianceExceptionsAsEmployee: many(complianceException, {
		relationName: "compliance_exception_employee",
	}),
	complianceExceptionsAsApprover: many(complianceException, {
		relationName: "compliance_exception_approver",
	}),
	// Compliance findings
	complianceFindings: many(complianceFinding, {
		relationName: "compliance_finding_employee",
	}),
	findingsAcknowledged: many(complianceFinding, {
		relationName: "compliance_finding_acknowledger",
	}),
	findingsWaived: many(complianceFinding, {
		relationName: "compliance_finding_waiver",
	}),
	findingsResolved: many(complianceFinding, {
		relationName: "compliance_finding_resolver",
	}),
	// Shift scheduling
	shifts: many(shift),
	shiftRequestsAsRequester: many(shiftRequest, {
		relationName: "shift_request_requester",
	}),
	shiftRequestsAsTarget: many(shiftRequest, {
		relationName: "shift_request_target",
	}),
	shiftRequestsAsApprover: many(shiftRequest, {
		relationName: "shift_request_approver",
	}),
	// Projects
	projectManagements: many(projectManager),
	projectAssignments: many(projectAssignment),
	// Surcharges
	surchargeModelAssignments: many(surchargeModelAssignment),
	surchargeCalculations: many(surchargeCalculation),
	// Location assignments
	locationAssignments: many(locationEmployee),
	subareaAssignments: many(subareaEmployee),
	// Work categories
	workCategorySetAssignments: many(workCategorySetAssignment),
	// Change policies
	changePolicyAssignments: many(changePolicyAssignment),
	// Skills & qualifications
	skills: many(employeeSkill),
	skillOverrides: many(skillRequirementOverride),
}));

// Employee Rate History
export const employeeRateHistoryRelations = relations(
	employeeRateHistory,
	({ one }) => ({
		employee: one(employee, {
			fields: [employeeRateHistory.employeeId],
			references: [employee.id],
		}),
		organization: one(organization, {
			fields: [employeeRateHistory.organizationId],
			references: [organization.id],
		}),
		creator: one(user, {
			fields: [employeeRateHistory.createdBy],
			references: [user.id],
		}),
	}),
);

// Time tracking relations
export const timeEntryRelations = relations(timeEntry, ({ one }) => ({
	employee: one(employee, {
		fields: [timeEntry.employeeId],
		references: [employee.id],
	}),
	organization: one(organization, {
		fields: [timeEntry.organizationId],
		references: [organization.id],
	}),
	previousEntry: one(timeEntry, {
		fields: [timeEntry.previousEntryId],
		references: [timeEntry.id],
		relationName: "entry_chain",
	}),
	replacesEntry: one(timeEntry, {
		fields: [timeEntry.replacesEntryId],
		references: [timeEntry.id],
		relationName: "entry_correction",
	}),
	supersededBy: one(timeEntry, {
		fields: [timeEntry.supersededById],
		references: [timeEntry.id],
		relationName: "entry_superseded",
	}),
	creator: one(user, {
		fields: [timeEntry.createdBy],
		references: [user.id],
	}),
}));

export const workPeriodRelations = relations(workPeriod, ({ one }) => ({
	employee: one(employee, {
		fields: [workPeriod.employeeId],
		references: [employee.id],
	}),
	organization: one(organization, {
		fields: [workPeriod.organizationId],
		references: [organization.id],
	}),
	clockIn: one(timeEntry, {
		fields: [workPeriod.clockInId],
		references: [timeEntry.id],
		relationName: "work_period_clock_in",
	}),
	clockOut: one(timeEntry, {
		fields: [workPeriod.clockOutId],
		references: [timeEntry.id],
		relationName: "work_period_clock_out",
	}),
	project: one(project, {
		fields: [workPeriod.projectId],
		references: [project.id],
	}),
	surchargeCalculation: one(surchargeCalculation),
	workCategory: one(workCategory, {
		fields: [workPeriod.workCategoryId],
		references: [workCategory.id],
	}),
}));

// Absence relations
export const absenceCategoryRelations = relations(
	absenceCategory,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [absenceCategory.organizationId],
			references: [organization.id],
		}),
		absenceEntries: many(absenceEntry),
	}),
);

export const absenceEntryRelations = relations(absenceEntry, ({ one }) => ({
	employee: one(employee, {
		fields: [absenceEntry.employeeId],
		references: [employee.id],
	}),
	category: one(absenceCategory, {
		fields: [absenceEntry.categoryId],
		references: [absenceCategory.id],
	}),
	approver: one(employee, {
		fields: [absenceEntry.approvedBy],
		references: [employee.id],
	}),
}));

// Approval relations
export const approvalRequestRelations = relations(
	approvalRequest,
	({ one }) => ({
		organization: one(organization, {
			fields: [approvalRequest.organizationId],
			references: [organization.id],
		}),
		requester: one(employee, {
			fields: [approvalRequest.requestedBy],
			references: [employee.id],
			relationName: "approval_requester",
		}),
		approver: one(employee, {
			fields: [approvalRequest.approverId],
			references: [employee.id],
			relationName: "approval_approver",
		}),
	}),
);

// Holiday relations
export const holidayCategoryRelations = relations(
	holidayCategory,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [holidayCategory.organizationId],
			references: [organization.id],
		}),
		holidays: many(holiday),
		presetHolidays: many(holidayPresetHoliday),
	}),
);

export const holidayRelations = relations(holiday, ({ one, many }) => ({
	organization: one(organization, {
		fields: [holiday.organizationId],
		references: [organization.id],
	}),
	category: one(holidayCategory, {
		fields: [holiday.categoryId],
		references: [holidayCategory.id],
	}),
	assignments: many(holidayAssignment),
	creator: one(user, {
		fields: [holiday.createdBy],
		references: [user.id],
	}),
	updater: one(user, {
		fields: [holiday.updatedBy],
		references: [user.id],
	}),
}));

// Holiday preset relations
export const holidayPresetRelations = relations(
	holidayPreset,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [holidayPreset.organizationId],
			references: [organization.id],
		}),
		holidays: many(holidayPresetHoliday),
		assignments: many(holidayPresetAssignment),
		creator: one(user, {
			fields: [holidayPreset.createdBy],
			references: [user.id],
		}),
		updater: one(user, {
			fields: [holidayPreset.updatedBy],
			references: [user.id],
		}),
	}),
);

export const holidayPresetHolidayRelations = relations(
	holidayPresetHoliday,
	({ one }) => ({
		preset: one(holidayPreset, {
			fields: [holidayPresetHoliday.presetId],
			references: [holidayPreset.id],
		}),
		category: one(holidayCategory, {
			fields: [holidayPresetHoliday.categoryId],
			references: [holidayCategory.id],
		}),
	}),
);

export const holidayPresetAssignmentRelations = relations(
	holidayPresetAssignment,
	({ one }) => ({
		preset: one(holidayPreset, {
			fields: [holidayPresetAssignment.presetId],
			references: [holidayPreset.id],
		}),
		organization: one(organization, {
			fields: [holidayPresetAssignment.organizationId],
			references: [organization.id],
		}),
		team: one(team, {
			fields: [holidayPresetAssignment.teamId],
			references: [team.id],
		}),
		employee: one(employee, {
			fields: [holidayPresetAssignment.employeeId],
			references: [employee.id],
		}),
		creator: one(user, {
			fields: [holidayPresetAssignment.createdBy],
			references: [user.id],
		}),
	}),
);

export const holidayAssignmentRelations = relations(
	holidayAssignment,
	({ one }) => ({
		holiday: one(holiday, {
			fields: [holidayAssignment.holidayId],
			references: [holiday.id],
		}),
		organization: one(organization, {
			fields: [holidayAssignment.organizationId],
			references: [organization.id],
		}),
		team: one(team, {
			fields: [holidayAssignment.teamId],
			references: [team.id],
		}),
		employee: one(employee, {
			fields: [holidayAssignment.employeeId],
			references: [employee.id],
		}),
		creator: one(user, {
			fields: [holidayAssignment.createdBy],
			references: [user.id],
		}),
	}),
);

// Vacation allowance relations
export const vacationAllowanceRelations = relations(
	vacationAllowance,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [vacationAllowance.organizationId],
			references: [organization.id],
		}),
		creator: one(user, {
			fields: [vacationAllowance.createdBy],
			references: [user.id],
		}),
		assignments: many(vacationPolicyAssignment),
	}),
);

export const employeeVacationAllowanceRelations = relations(
	employeeVacationAllowance,
	({ one }) => ({
		employee: one(employee, {
			fields: [employeeVacationAllowance.employeeId],
			references: [employee.id],
		}),
	}),
);

export const vacationAdjustmentRelations = relations(
	vacationAdjustment,
	({ one }) => ({
		employee: one(employee, {
			fields: [vacationAdjustment.employeeId],
			references: [employee.id],
		}),
		adjuster: one(employee, {
			fields: [vacationAdjustment.adjustedBy],
			references: [employee.id],
		}),
	}),
);

// Vacation policy assignment relations
export const vacationPolicyAssignmentRelations = relations(
	vacationPolicyAssignment,
	({ one }) => ({
		policy: one(vacationAllowance, {
			fields: [vacationPolicyAssignment.policyId],
			references: [vacationAllowance.id],
		}),
		organization: one(organization, {
			fields: [vacationPolicyAssignment.organizationId],
			references: [organization.id],
		}),
		team: one(team, {
			fields: [vacationPolicyAssignment.teamId],
			references: [team.id],
		}),
		employee: one(employee, {
			fields: [vacationPolicyAssignment.employeeId],
			references: [employee.id],
		}),
		creator: one(user, {
			fields: [vacationPolicyAssignment.createdBy],
			references: [user.id],
		}),
	}),
);

// Employee managers relations
export const employeeManagersRelations = relations(
	employeeManagers,
	({ one }) => ({
		employee: one(employee, {
			fields: [employeeManagers.employeeId],
			references: [employee.id],
			relationName: "employee_managers",
		}),
		manager: one(employee, {
			fields: [employeeManagers.managerId],
			references: [employee.id],
			relationName: "manager_employees",
		}),
		assigner: one(user, {
			fields: [employeeManagers.assignedBy],
			references: [user.id],
		}),
	}),
);

// Team permissions relations
export const teamPermissionsRelations = relations(
	teamPermissions,
	({ one }) => ({
		employee: one(employee, {
			fields: [teamPermissions.employeeId],
			references: [employee.id],
		}),
		organization: one(organization, {
			fields: [teamPermissions.organizationId],
			references: [organization.id],
		}),
		team: one(team, {
			fields: [teamPermissions.teamId],
			references: [team.id],
		}),
		grantor: one(employee, {
			fields: [teamPermissions.grantedBy],
			references: [employee.id],
		}),
	}),
);

// Shift scheduling relations
export const shiftTemplateRelations = relations(
	shiftTemplate,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [shiftTemplate.organizationId],
			references: [organization.id],
		}),
		subarea: one(locationSubarea, {
			fields: [shiftTemplate.subareaId],
			references: [locationSubarea.id],
		}),
		shifts: many(shift),
		recurrences: many(shiftRecurrence),
		creator: one(user, {
			fields: [shiftTemplate.createdBy],
			references: [user.id],
		}),
		// Skill requirements for this template
		skillRequirements: many(shiftTemplateSkillRequirement),
	}),
);

export const shiftRecurrenceRelations = relations(
	shiftRecurrence,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [shiftRecurrence.organizationId],
			references: [organization.id],
		}),
		template: one(shiftTemplate, {
			fields: [shiftRecurrence.templateId],
			references: [shiftTemplate.id],
		}),
		subarea: one(locationSubarea, {
			fields: [shiftRecurrence.subareaId],
			references: [locationSubarea.id],
		}),
		shifts: many(shift),
		creator: one(user, {
			fields: [shiftRecurrence.createdBy],
			references: [user.id],
		}),
	}),
);

export const shiftRelations = relations(shift, ({ one, many }) => ({
	organization: one(organization, {
		fields: [shift.organizationId],
		references: [organization.id],
	}),
	employee: one(employee, {
		fields: [shift.employeeId],
		references: [employee.id],
	}),
	template: one(shiftTemplate, {
		fields: [shift.templateId],
		references: [shiftTemplate.id],
	}),
	subarea: one(locationSubarea, {
		fields: [shift.subareaId],
		references: [locationSubarea.id],
	}),
	recurrence: one(shiftRecurrence, {
		fields: [shift.recurrenceId],
		references: [shiftRecurrence.id],
	}),
	requests: many(shiftRequest),
	creator: one(user, {
		fields: [shift.createdBy],
		references: [user.id],
	}),
	publisher: one(user, {
		fields: [shift.publishedBy],
		references: [user.id],
	}),
	// Skill override records for this shift
	skillOverrides: many(skillRequirementOverride),
}));

export const shiftRequestRelations = relations(shiftRequest, ({ one }) => ({
	shift: one(shift, {
		fields: [shiftRequest.shiftId],
		references: [shift.id],
	}),
	requester: one(employee, {
		fields: [shiftRequest.requesterId],
		references: [employee.id],
		relationName: "shift_request_requester",
	}),
	targetEmployee: one(employee, {
		fields: [shiftRequest.targetEmployeeId],
		references: [employee.id],
		relationName: "shift_request_target",
	}),
	approver: one(employee, {
		fields: [shiftRequest.approverId],
		references: [employee.id],
		relationName: "shift_request_approver",
	}),
}));

// Project relations
export const projectRelations = relations(project, ({ one, many }) => ({
	organization: one(organization, {
		fields: [project.organizationId],
		references: [organization.id],
	}),
	customer: one(customer, {
		fields: [project.customerId],
		references: [customer.id],
	}),
	managers: many(projectManager),
	assignments: many(projectAssignment),
	workPeriods: many(workPeriod),
	notificationState: one(projectNotificationState),
	creator: one(user, {
		fields: [project.createdBy],
		references: [user.id],
	}),
	updater: one(user, {
		fields: [project.updatedBy],
		references: [user.id],
	}),
}));

export const projectManagerRelations = relations(projectManager, ({ one }) => ({
	project: one(project, {
		fields: [projectManager.projectId],
		references: [project.id],
	}),
	employee: one(employee, {
		fields: [projectManager.employeeId],
		references: [employee.id],
	}),
	assigner: one(user, {
		fields: [projectManager.assignedBy],
		references: [user.id],
	}),
}));

export const projectAssignmentRelations = relations(
	projectAssignment,
	({ one }) => ({
		project: one(project, {
			fields: [projectAssignment.projectId],
			references: [project.id],
		}),
		organization: one(organization, {
			fields: [projectAssignment.organizationId],
			references: [organization.id],
		}),
		team: one(team, {
			fields: [projectAssignment.teamId],
			references: [team.id],
		}),
		employee: one(employee, {
			fields: [projectAssignment.employeeId],
			references: [employee.id],
		}),
		creator: one(user, {
			fields: [projectAssignment.createdBy],
			references: [user.id],
		}),
	}),
);

export const projectNotificationStateRelations = relations(
	projectNotificationState,
	({ one }) => ({
		project: one(project, {
			fields: [projectNotificationState.projectId],
			references: [project.id],
		}),
	}),
);

// Customer relations
export const customerRelations = relations(customer, ({ one, many }) => ({
	organization: one(organization, {
		fields: [customer.organizationId],
		references: [organization.id],
	}),
	projects: many(project),
	creator: one(user, {
		fields: [customer.createdBy],
		references: [user.id],
		relationName: "customer_creator",
	}),
	updater: one(user, {
		fields: [customer.updatedBy],
		references: [user.id],
		relationName: "customer_updater",
	}),
}));

// Notification relations
export const notificationRelations = relations(notification, ({ one }) => ({
	user: one(user, {
		fields: [notification.userId],
		references: [user.id],
	}),
	organization: one(organization, {
		fields: [notification.organizationId],
		references: [organization.id],
	}),
}));

export const notificationPreferenceRelations = relations(
	notificationPreference,
	({ one }) => ({
		user: one(user, {
			fields: [notificationPreference.userId],
			references: [user.id],
		}),
		organization: one(organization, {
			fields: [notificationPreference.organizationId],
			references: [organization.id],
		}),
	}),
);

export const pushSubscriptionRelations = relations(
	pushSubscription,
	({ one }) => ({
		user: one(user, {
			fields: [pushSubscription.userId],
			references: [user.id],
		}),
	}),
);

// Enterprise relations
export const organizationDomainRelations = relations(
	organizationDomain,
	({ one }) => ({
		organization: one(organization, {
			fields: [organizationDomain.organizationId],
			references: [organization.id],
		}),
	}),
);

export const organizationBrandingRelations = relations(
	organizationBranding,
	({ one }) => ({
		organization: one(organization, {
			fields: [organizationBranding.organizationId],
			references: [organization.id],
		}),
	}),
);

export const organizationEmailConfigRelations = relations(
	organizationEmailConfig,
	({ one }) => ({
		organization: one(organization, {
			fields: [organizationEmailConfig.organizationId],
			references: [organization.id],
		}),
	}),
);

export const organizationSocialOAuthRelations = relations(
	organizationSocialOAuth,
	({ one }) => ({
		organization: one(organization, {
			fields: [organizationSocialOAuth.organizationId],
			references: [organization.id],
		}),
	}),
);

// Data export relations
export const dataExportRelations = relations(dataExport, ({ one }) => ({
	organization: one(organization, {
		fields: [dataExport.organizationId],
		references: [organization.id],
	}),
	requestedBy: one(employee, {
		fields: [dataExport.requestedById],
		references: [employee.id],
	}),
}));

export const exportStorageConfigRelations = relations(
	exportStorageConfig,
	({ one }) => ({
		organization: one(organization, {
			fields: [exportStorageConfig.organizationId],
			references: [organization.id],
		}),
	}),
);

// Surcharge relations
export const surchargeModelRelations = relations(
	surchargeModel,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [surchargeModel.organizationId],
			references: [organization.id],
		}),
		rules: many(surchargeRule),
		assignments: many(surchargeModelAssignment),
		calculations: many(surchargeCalculation),
		creator: one(user, {
			fields: [surchargeModel.createdBy],
			references: [user.id],
			relationName: "surcharge_model_creator",
		}),
		updater: one(user, {
			fields: [surchargeModel.updatedBy],
			references: [user.id],
			relationName: "surcharge_model_updater",
		}),
	}),
);

export const surchargeRuleRelations = relations(surchargeRule, ({ one }) => ({
	model: one(surchargeModel, {
		fields: [surchargeRule.modelId],
		references: [surchargeModel.id],
	}),
	creator: one(user, {
		fields: [surchargeRule.createdBy],
		references: [user.id],
	}),
}));

export const surchargeModelAssignmentRelations = relations(
	surchargeModelAssignment,
	({ one }) => ({
		model: one(surchargeModel, {
			fields: [surchargeModelAssignment.modelId],
			references: [surchargeModel.id],
		}),
		organization: one(organization, {
			fields: [surchargeModelAssignment.organizationId],
			references: [organization.id],
		}),
		team: one(team, {
			fields: [surchargeModelAssignment.teamId],
			references: [team.id],
		}),
		employee: one(employee, {
			fields: [surchargeModelAssignment.employeeId],
			references: [employee.id],
		}),
		creator: one(user, {
			fields: [surchargeModelAssignment.createdBy],
			references: [user.id],
		}),
	}),
);

export const surchargeCalculationRelations = relations(
	surchargeCalculation,
	({ one }) => ({
		employee: one(employee, {
			fields: [surchargeCalculation.employeeId],
			references: [employee.id],
		}),
		organization: one(organization, {
			fields: [surchargeCalculation.organizationId],
			references: [organization.id],
		}),
		workPeriod: one(workPeriod, {
			fields: [surchargeCalculation.workPeriodId],
			references: [workPeriod.id],
		}),
		rule: one(surchargeRule, {
			fields: [surchargeCalculation.surchargeRuleId],
			references: [surchargeRule.id],
		}),
		model: one(surchargeModel, {
			fields: [surchargeCalculation.surchargeModelId],
			references: [surchargeModel.id],
		}),
	}),
);

// Audit log relations
export const auditLogRelations = relations(auditLog, ({ one }) => ({
	organization: one(organization, {
		fields: [auditLog.organizationId],
		references: [organization.id],
	}),
	performedByUser: one(user, {
		fields: [auditLog.performedBy],
		references: [user.id],
	}),
	employeeRecord: one(employee, {
		fields: [auditLog.employeeId],
		references: [employee.id],
	}),
}));

// Hydration relations
export const waterIntakeLogRelations = relations(waterIntakeLog, ({ one }) => ({
	user: one(user, {
		fields: [waterIntakeLog.userId],
		references: [user.id],
	}),
}));

export const hydrationStatsRelations = relations(hydrationStats, ({ one }) => ({
	user: one(user, {
		fields: [hydrationStats.userId],
		references: [user.id],
	}),
}));

// User settings relations
export const userSettingsRelations = relations(userSettings, ({ one }) => ({
	user: one(user, {
		fields: [userSettings.userId],
		references: [user.id],
	}),
}));

// ============================================
// WORK CATEGORY RELATIONS
// ============================================

export const workCategorySetRelations = relations(
	workCategorySet,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [workCategorySet.organizationId],
			references: [organization.id],
		}),
		// Many-to-many through junction table
		setCategories: many(workCategorySetCategory),
		assignments: many(workCategorySetAssignment),
		creator: one(user, {
			fields: [workCategorySet.createdBy],
			references: [user.id],
			relationName: "work_category_set_creator",
		}),
		updater: one(user, {
			fields: [workCategorySet.updatedBy],
			references: [user.id],
			relationName: "work_category_set_updater",
		}),
	}),
);

export const workCategoryRelations = relations(
	workCategory,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [workCategory.organizationId],
			references: [organization.id],
		}),
		// Many-to-many through junction table
		setCategories: many(workCategorySetCategory),
		workPeriods: many(workPeriod),
		creator: one(user, {
			fields: [workCategory.createdBy],
			references: [user.id],
			relationName: "work_category_creator",
		}),
		updater: one(user, {
			fields: [workCategory.updatedBy],
			references: [user.id],
			relationName: "work_category_updater",
		}),
	}),
);

// Junction table relations for many-to-many
export const workCategorySetCategoryRelations = relations(
	workCategorySetCategory,
	({ one }) => ({
		set: one(workCategorySet, {
			fields: [workCategorySetCategory.setId],
			references: [workCategorySet.id],
		}),
		category: one(workCategory, {
			fields: [workCategorySetCategory.categoryId],
			references: [workCategory.id],
		}),
	}),
);

export const workCategorySetAssignmentRelations = relations(
	workCategorySetAssignment,
	({ one }) => ({
		set: one(workCategorySet, {
			fields: [workCategorySetAssignment.setId],
			references: [workCategorySet.id],
		}),
		organization: one(organization, {
			fields: [workCategorySetAssignment.organizationId],
			references: [organization.id],
		}),
		team: one(team, {
			fields: [workCategorySetAssignment.teamId],
			references: [team.id],
		}),
		employee: one(employee, {
			fields: [workCategorySetAssignment.employeeId],
			references: [employee.id],
		}),
		creator: one(user, {
			fields: [workCategorySetAssignment.createdBy],
			references: [user.id],
		}),
	}),
);

// ============================================
// CHANGE POLICY RELATIONS
// ============================================

export const changePolicyRelations = relations(
	changePolicy,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [changePolicy.organizationId],
			references: [organization.id],
		}),
		assignments: many(changePolicyAssignment),
		creator: one(user, {
			fields: [changePolicy.createdBy],
			references: [user.id],
			relationName: "change_policy_creator",
		}),
		updater: one(user, {
			fields: [changePolicy.updatedBy],
			references: [user.id],
			relationName: "change_policy_updater",
		}),
	}),
);

export const changePolicyAssignmentRelations = relations(
	changePolicyAssignment,
	({ one }) => ({
		policy: one(changePolicy, {
			fields: [changePolicyAssignment.policyId],
			references: [changePolicy.id],
		}),
		organization: one(organization, {
			fields: [changePolicyAssignment.organizationId],
			references: [organization.id],
		}),
		team: one(team, {
			fields: [changePolicyAssignment.teamId],
			references: [team.id],
		}),
		employee: one(employee, {
			fields: [changePolicyAssignment.employeeId],
			references: [employee.id],
		}),
		creator: one(user, {
			fields: [changePolicyAssignment.createdBy],
			references: [user.id],
		}),
	}),
);

// ============================================
// INVITE CODE RELATIONS
// ============================================

export const inviteCodeRelations = relations(inviteCode, ({ one, many }) => ({
	organization: one(organization, {
		fields: [inviteCode.organizationId],
		references: [organization.id],
	}),
	defaultTeam: one(team, {
		fields: [inviteCode.defaultTeamId],
		references: [team.id],
	}),
	usages: many(inviteCodeUsage),
	creator: one(user, {
		fields: [inviteCode.createdBy],
		references: [user.id],
		relationName: "invite_code_creator",
	}),
	updater: one(user, {
		fields: [inviteCode.updatedBy],
		references: [user.id],
		relationName: "invite_code_updater",
	}),
}));

export const inviteCodeUsageRelations = relations(
	inviteCodeUsage,
	({ one }) => ({
		inviteCode: one(inviteCode, {
			fields: [inviteCodeUsage.inviteCodeId],
			references: [inviteCode.id],
		}),
		user: one(user, {
			fields: [inviteCodeUsage.userId],
			references: [user.id],
		}),
		member: one(member, {
			fields: [inviteCodeUsage.memberId],
			references: [member.id],
		}),
	}),
);

export const memberApprovalRelations = relations(memberApproval, ({ one }) => ({
	member: one(member, {
		fields: [memberApproval.memberId],
		references: [member.id],
	}),
	organization: one(organization, {
		fields: [memberApproval.organizationId],
		references: [organization.id],
	}),
	assignedTeam: one(team, {
		fields: [memberApproval.assignedTeamId],
		references: [team.id],
	}),
	approver: one(user, {
		fields: [memberApproval.approvedBy],
		references: [user.id],
	}),
}));

// ============================================
// WORK POLICY RELATIONS (unified schedules + regulations)
// ============================================

export const workPolicyRelations = relations(workPolicy, ({ one, many }) => ({
	organization: one(organization, {
		fields: [workPolicy.organizationId],
		references: [organization.id],
	}),
	schedule: one(workPolicySchedule),
	regulation: one(workPolicyRegulation),
	assignments: many(workPolicyAssignment),
	violations: many(workPolicyViolation),
	creator: one(user, {
		fields: [workPolicy.createdBy],
		references: [user.id],
		relationName: "work_policy_creator",
	}),
	updater: one(user, {
		fields: [workPolicy.updatedBy],
		references: [user.id],
		relationName: "work_policy_updater",
	}),
}));

export const workPolicyScheduleRelations = relations(
	workPolicySchedule,
	({ one, many }) => ({
		policy: one(workPolicy, {
			fields: [workPolicySchedule.policyId],
			references: [workPolicy.id],
		}),
		days: many(workPolicyScheduleDay),
	}),
);

export const workPolicyScheduleDayRelations = relations(
	workPolicyScheduleDay,
	({ one }) => ({
		schedule: one(workPolicySchedule, {
			fields: [workPolicyScheduleDay.scheduleId],
			references: [workPolicySchedule.id],
		}),
	}),
);

export const workPolicyRegulationRelations = relations(
	workPolicyRegulation,
	({ one, many }) => ({
		policy: one(workPolicy, {
			fields: [workPolicyRegulation.policyId],
			references: [workPolicy.id],
		}),
		breakRules: many(workPolicyBreakRule),
	}),
);

export const workPolicyBreakRuleRelations = relations(
	workPolicyBreakRule,
	({ one, many }) => ({
		regulation: one(workPolicyRegulation, {
			fields: [workPolicyBreakRule.regulationId],
			references: [workPolicyRegulation.id],
		}),
		options: many(workPolicyBreakOption),
	}),
);

export const workPolicyBreakOptionRelations = relations(
	workPolicyBreakOption,
	({ one }) => ({
		breakRule: one(workPolicyBreakRule, {
			fields: [workPolicyBreakOption.breakRuleId],
			references: [workPolicyBreakRule.id],
		}),
	}),
);

export const workPolicyAssignmentRelations = relations(
	workPolicyAssignment,
	({ one }) => ({
		policy: one(workPolicy, {
			fields: [workPolicyAssignment.policyId],
			references: [workPolicy.id],
		}),
		organization: one(organization, {
			fields: [workPolicyAssignment.organizationId],
			references: [organization.id],
		}),
		team: one(team, {
			fields: [workPolicyAssignment.teamId],
			references: [team.id],
		}),
		employee: one(employee, {
			fields: [workPolicyAssignment.employeeId],
			references: [employee.id],
		}),
		creator: one(user, {
			fields: [workPolicyAssignment.createdBy],
			references: [user.id],
		}),
	}),
);

export const workPolicyViolationRelations = relations(
	workPolicyViolation,
	({ one }) => ({
		employee: one(employee, {
			fields: [workPolicyViolation.employeeId],
			references: [employee.id],
		}),
		organization: one(organization, {
			fields: [workPolicyViolation.organizationId],
			references: [organization.id],
		}),
		policy: one(workPolicy, {
			fields: [workPolicyViolation.policyId],
			references: [workPolicy.id],
		}),
		workPeriod: one(workPeriod, {
			fields: [workPolicyViolation.workPeriodId],
			references: [workPeriod.id],
		}),
		acknowledger: one(employee, {
			fields: [workPolicyViolation.acknowledgedBy],
			references: [employee.id],
			relationName: "work_policy_violation_acknowledger",
		}),
	}),
);

// ============================================
// WEBHOOK RELATIONS
// ============================================

export const webhookEndpointRelations = relations(
	webhookEndpoint,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [webhookEndpoint.organizationId],
			references: [organization.id],
		}),
		deliveries: many(webhookDelivery),
		creator: one(user, {
			fields: [webhookEndpoint.createdBy],
			references: [user.id],
		}),
	}),
);

export const webhookDeliveryRelations = relations(
	webhookDelivery,
	({ one }) => ({
		webhookEndpoint: one(webhookEndpoint, {
			fields: [webhookDelivery.webhookEndpointId],
			references: [webhookEndpoint.id],
		}),
		organization: one(organization, {
			fields: [webhookDelivery.organizationId],
			references: [organization.id],
		}),
	}),
);

// ============================================
// PAYROLL EXPORT RELATIONS
// ============================================

export const payrollExportFormatRelations = relations(
	payrollExportFormat,
	({ many }) => ({
		configs: many(payrollExportConfig),
	}),
);

export const payrollExportConfigRelations = relations(
	payrollExportConfig,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [payrollExportConfig.organizationId],
			references: [organization.id],
		}),
		format: one(payrollExportFormat, {
			fields: [payrollExportConfig.formatId],
			references: [payrollExportFormat.id],
		}),
		creator: one(user, {
			fields: [payrollExportConfig.createdBy],
			references: [user.id],
			relationName: "payrollExportConfig_creator",
		}),
		updater: one(user, {
			fields: [payrollExportConfig.updatedBy],
			references: [user.id],
			relationName: "payrollExportConfig_updater",
		}),
		mappings: many(payrollWageTypeMapping),
		jobs: many(payrollExportJob),
	}),
);

export const payrollWageTypeMappingRelations = relations(
	payrollWageTypeMapping,
	({ one }) => ({
		config: one(payrollExportConfig, {
			fields: [payrollWageTypeMapping.configId],
			references: [payrollExportConfig.id],
		}),
		workCategory: one(workCategory, {
			fields: [payrollWageTypeMapping.workCategoryId],
			references: [workCategory.id],
		}),
		absenceCategory: one(absenceCategory, {
			fields: [payrollWageTypeMapping.absenceCategoryId],
			references: [absenceCategory.id],
		}),
		creator: one(user, {
			fields: [payrollWageTypeMapping.createdBy],
			references: [user.id],
		}),
	}),
);

export const payrollExportJobRelations = relations(
	payrollExportJob,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [payrollExportJob.organizationId],
			references: [organization.id],
		}),
		config: one(payrollExportConfig, {
			fields: [payrollExportJob.configId],
			references: [payrollExportConfig.id],
		}),
		requestedBy: one(employee, {
			fields: [payrollExportJob.requestedById],
			references: [employee.id],
		}),
		syncRecords: many(payrollExportSyncRecord),
	}),
);

export const payrollExportSyncRecordRelations = relations(
	payrollExportSyncRecord,
	({ one }) => ({
		job: one(payrollExportJob, {
			fields: [payrollExportSyncRecord.jobId],
			references: [payrollExportJob.id],
		}),
	}),
);

// ============================================
// COMPLIANCE EXCEPTION RELATIONS
// ============================================

export const complianceExceptionRelations = relations(
	complianceException,
	({ one }) => ({
		organization: one(organization, {
			fields: [complianceException.organizationId],
			references: [organization.id],
		}),
		employee: one(employee, {
			fields: [complianceException.employeeId],
			references: [employee.id],
			relationName: "compliance_exception_employee",
		}),
		approver: one(employee, {
			fields: [complianceException.approverId],
			references: [employee.id],
			relationName: "compliance_exception_approver",
		}),
		workPeriod: one(workPeriod, {
			fields: [complianceException.workPeriodId],
			references: [workPeriod.id],
		}),
		creator: one(user, {
			fields: [complianceException.createdBy],
			references: [user.id],
		}),
	}),
);

// ============================================
// CALENDAR SYNC RELATIONS
// ============================================

import {
	calendarConnection,
	icsFeed,
	organizationCalendarSettings,
	syncedAbsence,
} from "./calendar-sync";

export const calendarConnectionRelations = relations(
	calendarConnection,
	({ one, many }) => ({
		employee: one(employee, {
			fields: [calendarConnection.employeeId],
			references: [employee.id],
		}),
		organization: one(organization, {
			fields: [calendarConnection.organizationId],
			references: [organization.id],
		}),
		syncedAbsences: many(syncedAbsence),
	}),
);

export const syncedAbsenceRelations = relations(syncedAbsence, ({ one }) => ({
	absenceEntry: one(absenceEntry, {
		fields: [syncedAbsence.absenceEntryId],
		references: [absenceEntry.id],
	}),
	calendarConnection: one(calendarConnection, {
		fields: [syncedAbsence.calendarConnectionId],
		references: [calendarConnection.id],
	}),
}));

export const icsFeedRelations = relations(icsFeed, ({ one }) => ({
	organization: one(organization, {
		fields: [icsFeed.organizationId],
		references: [organization.id],
	}),
	employee: one(employee, {
		fields: [icsFeed.employeeId],
		references: [employee.id],
	}),
	team: one(team, {
		fields: [icsFeed.teamId],
		references: [team.id],
	}),
	creator: one(user, {
		fields: [icsFeed.createdBy],
		references: [user.id],
	}),
}));

export const organizationCalendarSettingsRelations = relations(
	organizationCalendarSettings,
	({ one }) => ({
		organization: one(organization, {
			fields: [organizationCalendarSettings.organizationId],
			references: [organization.id],
		}),
	}),
);

// ============================================
// SCHEDULED EXPORT RELATIONS
// ============================================

import { scheduledExport, scheduledExportExecution } from "./scheduled-export";

export const scheduledExportRelations = relations(
	scheduledExport,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [scheduledExport.organizationId],
			references: [organization.id],
		}),
		payrollConfig: one(payrollExportConfig, {
			fields: [scheduledExport.payrollConfigId],
			references: [payrollExportConfig.id],
		}),
		creator: one(user, {
			fields: [scheduledExport.createdBy],
			references: [user.id],
			relationName: "scheduled_export_creator",
		}),
		updater: one(user, {
			fields: [scheduledExport.updatedBy],
			references: [user.id],
			relationName: "scheduled_export_updater",
		}),
		executions: many(scheduledExportExecution),
	}),
);

export const scheduledExportExecutionRelations = relations(
	scheduledExportExecution,
	({ one }) => ({
		scheduledExport: one(scheduledExport, {
			fields: [scheduledExportExecution.scheduledExportId],
			references: [scheduledExport.id],
		}),
		organization: one(organization, {
			fields: [scheduledExportExecution.organizationId],
			references: [organization.id],
		}),
	}),
);

// ============================================
// AUDIT EXPORT RELATIONS
// ============================================

import {
	auditExportConfig,
	auditExportFile,
	auditExportPackage,
	auditSigningKey,
	auditVerificationLog,
} from "./audit-export";

export const auditExportConfigRelations = relations(
	auditExportConfig,
	({ one }) => ({
		organization: one(organization, {
			fields: [auditExportConfig.organizationId],
			references: [organization.id],
		}),
		creator: one(user, {
			fields: [auditExportConfig.createdBy],
			references: [user.id],
		}),
	}),
);

export const auditSigningKeyRelations = relations(
	auditSigningKey,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [auditSigningKey.organizationId],
			references: [organization.id],
		}),
		packages: many(auditExportPackage),
	}),
);

export const auditExportPackageRelations = relations(
	auditExportPackage,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [auditExportPackage.organizationId],
			references: [organization.id],
		}),
		requestedBy: one(user, {
			fields: [auditExportPackage.requestedById],
			references: [user.id],
		}),
		dataExport: one(dataExport, {
			fields: [auditExportPackage.dataExportId],
			references: [dataExport.id],
		}),
		payrollExportJob: one(payrollExportJob, {
			fields: [auditExportPackage.payrollExportJobId],
			references: [payrollExportJob.id],
		}),
		signingKey: one(auditSigningKey, {
			fields: [auditExportPackage.signingKeyId],
			references: [auditSigningKey.id],
		}),
		files: many(auditExportFile),
		verifications: many(auditVerificationLog),
	}),
);

export const auditExportFileRelations = relations(
	auditExportFile,
	({ one }) => ({
		package: one(auditExportPackage, {
			fields: [auditExportFile.packageId],
			references: [auditExportPackage.id],
		}),
	}),
);

export const auditVerificationLogRelations = relations(
	auditVerificationLog,
	({ one }) => ({
		package: one(auditExportPackage, {
			fields: [auditVerificationLog.packageId],
			references: [auditExportPackage.id],
		}),
		verifiedBy: one(user, {
			fields: [auditVerificationLog.verifiedById],
			references: [user.id],
		}),
	}),
);

// ============================================
// TEAMS INTEGRATION RELATIONS
// ============================================

import {
	teamsApprovalCard,
	teamsConversation,
	teamsEscalation,
	teamsTenantConfig,
	teamsUserMapping,
} from "./teams-integration";

export const teamsTenantConfigRelations = relations(
	teamsTenantConfig,
	({ one }) => ({
		organization: one(organization, {
			fields: [teamsTenantConfig.organizationId],
			references: [organization.id],
		}),
		configuredBy: one(user, {
			fields: [teamsTenantConfig.configuredByUserId],
			references: [user.id],
		}),
	}),
);

export const teamsUserMappingRelations = relations(
	teamsUserMapping,
	({ one }) => ({
		user: one(user, {
			fields: [teamsUserMapping.userId],
			references: [user.id],
		}),
		organization: one(organization, {
			fields: [teamsUserMapping.organizationId],
			references: [organization.id],
		}),
	}),
);

export const teamsConversationRelations = relations(
	teamsConversation,
	({ one }) => ({
		organization: one(organization, {
			fields: [teamsConversation.organizationId],
			references: [organization.id],
		}),
		user: one(user, {
			fields: [teamsConversation.userId],
			references: [user.id],
		}),
	}),
);

export const teamsApprovalCardRelations = relations(
	teamsApprovalCard,
	({ one }) => ({
		organization: one(organization, {
			fields: [teamsApprovalCard.organizationId],
			references: [organization.id],
		}),
		approvalRequest: one(approvalRequest, {
			fields: [teamsApprovalCard.approvalRequestId],
			references: [approvalRequest.id],
		}),
		recipient: one(user, {
			fields: [teamsApprovalCard.recipientUserId],
			references: [user.id],
		}),
	}),
);

export const teamsEscalationRelations = relations(
	teamsEscalation,
	({ one }) => ({
		organization: one(organization, {
			fields: [teamsEscalation.organizationId],
			references: [organization.id],
		}),
		approvalRequest: one(approvalRequest, {
			fields: [teamsEscalation.approvalRequestId],
			references: [approvalRequest.id],
		}),
		originalApprover: one(employee, {
			fields: [teamsEscalation.originalApproverId],
			references: [employee.id],
			relationName: "teams_escalation_original_approver",
		}),
		escalatedToApprover: one(employee, {
			fields: [teamsEscalation.escalatedToApproverId],
			references: [employee.id],
			relationName: "teams_escalation_escalated_to",
		}),
	}),
);

// ============================================
// SCIM PROVISIONING RELATIONS
// ============================================

export const scimProviderConfigRelations = relations(
	scimProviderConfig,
	({ one }) => ({
		organization: one(organization, {
			fields: [scimProviderConfig.organizationId],
			references: [organization.id],
		}),
		defaultRoleTemplate: one(roleTemplate, {
			fields: [scimProviderConfig.defaultRoleTemplateId],
			references: [roleTemplate.id],
		}),
		creator: one(user, {
			fields: [scimProviderConfig.createdBy],
			references: [user.id],
			relationName: "scim_config_creator",
		}),
		updater: one(user, {
			fields: [scimProviderConfig.updatedBy],
			references: [user.id],
			relationName: "scim_config_updater",
		}),
	}),
);

export const scimProvisioningLogRelations = relations(
	scimProvisioningLog,
	({ one }) => ({
		organization: one(organization, {
			fields: [scimProvisioningLog.organizationId],
			references: [organization.id],
		}),
		user: one(user, {
			fields: [scimProvisioningLog.userId],
			references: [user.id],
		}),
	}),
);

// ============================================
// IDENTITY MANAGEMENT RELATIONS
// ============================================

export const userLifecycleConfigRelations = relations(
	userLifecycleConfig,
	({ one }) => ({
		organization: one(organization, {
			fields: [userLifecycleConfig.organizationId],
			references: [organization.id],
		}),
	}),
);

export const roleTemplateRelations = relations(
	roleTemplate,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [roleTemplate.organizationId],
			references: [organization.id],
		}),
		defaultTeam: one(team, {
			fields: [roleTemplate.defaultTeamId],
			references: [team.id],
		}),
		creator: one(user, {
			fields: [roleTemplate.createdBy],
			references: [user.id],
		}),
		mappings: many(roleTemplateMapping),
		assignments: many(userRoleTemplateAssignment),
	}),
);

export const roleTemplateMappingRelations = relations(
	roleTemplateMapping,
	({ one }) => ({
		organization: one(organization, {
			fields: [roleTemplateMapping.organizationId],
			references: [organization.id],
		}),
		roleTemplate: one(roleTemplate, {
			fields: [roleTemplateMapping.roleTemplateId],
			references: [roleTemplate.id],
		}),
		creator: one(user, {
			fields: [roleTemplateMapping.createdBy],
			references: [user.id],
		}),
	}),
);

export const userRoleTemplateAssignmentRelations = relations(
	userRoleTemplateAssignment,
	({ one }) => ({
		user: one(user, {
			fields: [userRoleTemplateAssignment.userId],
			references: [user.id],
		}),
		organization: one(organization, {
			fields: [userRoleTemplateAssignment.organizationId],
			references: [organization.id],
		}),
		roleTemplate: one(roleTemplate, {
			fields: [userRoleTemplateAssignment.roleTemplateId],
			references: [roleTemplate.id],
		}),
		assignedByUser: one(user, {
			fields: [userRoleTemplateAssignment.assignedBy],
			references: [user.id],
			relationName: "role_assignment_assignor",
		}),
	}),
);

export const userLifecycleEventRelations = relations(
	userLifecycleEvent,
	({ one }) => ({
		organization: one(organization, {
			fields: [userLifecycleEvent.organizationId],
			references: [organization.id],
		}),
		user: one(user, {
			fields: [userLifecycleEvent.userId],
			references: [user.id],
		}),
		employee: one(employee, {
			fields: [userLifecycleEvent.employeeId],
			references: [employee.id],
		}),
		approver: one(user, {
			fields: [userLifecycleEvent.approvedBy],
			references: [user.id],
			relationName: "lifecycle_event_approver",
		}),
		creator: one(user, {
			fields: [userLifecycleEvent.createdBy],
			references: [user.id],
			relationName: "lifecycle_event_creator",
		}),
	}),
);

// ============================================
// CONDITIONAL ACCESS RELATIONS
// ============================================

export const accessPolicyRelations = relations(
	accessPolicy,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [accessPolicy.organizationId],
			references: [organization.id],
		}),
		creator: one(user, {
			fields: [accessPolicy.createdBy],
			references: [user.id],
			relationName: "access_policy_creator",
		}),
		updater: one(user, {
			fields: [accessPolicy.updatedBy],
			references: [user.id],
			relationName: "access_policy_updater",
		}),
		sessionExtensions: many(sessionExtension),
		violations: many(accessViolationLog),
	}),
);

export const trustedDeviceRelations = relations(
	trustedDevice,
	({ one, many }) => ({
		user: one(user, {
			fields: [trustedDevice.userId],
			references: [user.id],
		}),
		organization: one(organization, {
			fields: [trustedDevice.organizationId],
			references: [organization.id],
		}),
		creator: one(user, {
			fields: [trustedDevice.createdBy],
			references: [user.id],
			relationName: "trusted_device_creator",
		}),
		revoker: one(user, {
			fields: [trustedDevice.revokedBy],
			references: [user.id],
			relationName: "trusted_device_revoker",
		}),
		sessionExtensions: many(sessionExtension),
	}),
);

export const sessionExtensionRelations = relations(
	sessionExtension,
	({ one }) => ({
		session: one(session, {
			fields: [sessionExtension.sessionId],
			references: [session.id],
		}),
		organization: one(organization, {
			fields: [sessionExtension.organizationId],
			references: [organization.id],
		}),
		trustedDevice: one(trustedDevice, {
			fields: [sessionExtension.trustedDeviceId],
			references: [trustedDevice.id],
		}),
		accessPolicy: one(accessPolicy, {
			fields: [sessionExtension.accessPolicyId],
			references: [accessPolicy.id],
		}),
	}),
);

export const accessViolationLogRelations = relations(
	accessViolationLog,
	({ one }) => ({
		organization: one(organization, {
			fields: [accessViolationLog.organizationId],
			references: [organization.id],
		}),
		user: one(user, {
			fields: [accessViolationLog.userId],
			references: [user.id],
		}),
		session: one(session, {
			fields: [accessViolationLog.sessionId],
			references: [session.id],
		}),
		policy: one(accessPolicy, {
			fields: [accessViolationLog.policyId],
			references: [accessPolicy.id],
		}),
	}),
);

// ============================================
// SKILL & QUALIFICATION RELATIONS
// ============================================

export const skillRelations = relations(skill, ({ one, many }) => ({
	organization: one(organization, {
		fields: [skill.organizationId],
		references: [organization.id],
	}),
	creator: one(user, {
		fields: [skill.createdBy],
		references: [user.id],
		relationName: "skill_creator",
	}),
	updater: one(user, {
		fields: [skill.updatedBy],
		references: [user.id],
		relationName: "skill_updater",
	}),
	employeeSkills: many(employeeSkill),
	subareaRequirements: many(subareaSkillRequirement),
	templateRequirements: many(shiftTemplateSkillRequirement),
}));

export const employeeSkillRelations = relations(employeeSkill, ({ one }) => ({
	employee: one(employee, {
		fields: [employeeSkill.employeeId],
		references: [employee.id],
	}),
	skill: one(skill, {
		fields: [employeeSkill.skillId],
		references: [skill.id],
	}),
	assigner: one(user, {
		fields: [employeeSkill.assignedBy],
		references: [user.id],
	}),
}));

export const subareaSkillRequirementRelations = relations(
	subareaSkillRequirement,
	({ one }) => ({
		subarea: one(locationSubarea, {
			fields: [subareaSkillRequirement.subareaId],
			references: [locationSubarea.id],
		}),
		skill: one(skill, {
			fields: [subareaSkillRequirement.skillId],
			references: [skill.id],
		}),
		creator: one(user, {
			fields: [subareaSkillRequirement.createdBy],
			references: [user.id],
		}),
	}),
);

export const shiftTemplateSkillRequirementRelations = relations(
	shiftTemplateSkillRequirement,
	({ one }) => ({
		template: one(shiftTemplate, {
			fields: [shiftTemplateSkillRequirement.templateId],
			references: [shiftTemplate.id],
		}),
		skill: one(skill, {
			fields: [shiftTemplateSkillRequirement.skillId],
			references: [skill.id],
		}),
		creator: one(user, {
			fields: [shiftTemplateSkillRequirement.createdBy],
			references: [user.id],
		}),
	}),
);

export const skillRequirementOverrideRelations = relations(
	skillRequirementOverride,
	({ one }) => ({
		organization: one(organization, {
			fields: [skillRequirementOverride.organizationId],
			references: [organization.id],
		}),
		shift: one(shift, {
			fields: [skillRequirementOverride.shiftId],
			references: [shift.id],
		}),
		employee: one(employee, {
			fields: [skillRequirementOverride.employeeId],
			references: [employee.id],
		}),
		overrider: one(user, {
			fields: [skillRequirementOverride.overriddenBy],
			references: [user.id],
		}),
	}),
);

// ============================================
// COVERAGE TARGET RELATIONS
// ============================================

export const coverageRuleRelations = relations(coverageRule, ({ one }) => ({
	organization: one(organization, {
		fields: [coverageRule.organizationId],
		references: [organization.id],
	}),
	subarea: one(locationSubarea, {
		fields: [coverageRule.subareaId],
		references: [locationSubarea.id],
	}),
	creator: one(user, {
		fields: [coverageRule.createdBy],
		references: [user.id],
		relationName: "coverage_rule_creator",
	}),
	updater: one(user, {
		fields: [coverageRule.updatedBy],
		references: [user.id],
		relationName: "coverage_rule_updater",
	}),
}));

export const coverageSettingsRelations = relations(
	coverageSettings,
	({ one }) => ({
		organization: one(organization, {
			fields: [coverageSettings.organizationId],
			references: [organization.id],
		}),
		updater: one(user, {
			fields: [coverageSettings.updatedBy],
			references: [user.id],
			relationName: "coverage_settings_updater",
		}),
	}),
);

// ============================================
// COMPLIANCE RADAR RELATIONS
// ============================================

export const complianceFindingRelations = relations(
	complianceFinding,
	({ one }) => ({
		organization: one(organization, {
			fields: [complianceFinding.organizationId],
			references: [organization.id],
		}),
		employee: one(employee, {
			fields: [complianceFinding.employeeId],
			references: [employee.id],
			relationName: "compliance_finding_employee",
		}),
		acknowledgedByRef: one(employee, {
			fields: [complianceFinding.acknowledgedBy],
			references: [employee.id],
			relationName: "compliance_finding_acknowledger",
		}),
		waivedByRef: one(employee, {
			fields: [complianceFinding.waivedBy],
			references: [employee.id],
			relationName: "compliance_finding_waiver",
		}),
		resolvedByRef: one(employee, {
			fields: [complianceFinding.resolvedBy],
			references: [employee.id],
			relationName: "compliance_finding_resolver",
		}),
		workPolicy: one(workPolicy, {
			fields: [complianceFinding.workPolicyId],
			references: [workPolicy.id],
		}),
		exception: one(complianceException, {
			fields: [complianceFinding.exceptionId],
			references: [complianceException.id],
		}),
		creator: one(user, {
			fields: [complianceFinding.createdBy],
			references: [user.id],
			relationName: "compliance_finding_creator",
		}),
	}),
);

export const complianceConfigRelations = relations(
	complianceConfig,
	({ one }) => ({
		organization: one(organization, {
			fields: [complianceConfig.organizationId],
			references: [organization.id],
		}),
		creator: one(user, {
			fields: [complianceConfig.createdBy],
			references: [user.id],
			relationName: "compliance_config_creator",
		}),
		updater: one(user, {
			fields: [complianceConfig.updatedBy],
			references: [user.id],
			relationName: "compliance_config_updater",
		}),
	}),
);

// ============================================
// TELEGRAM INTEGRATION RELATIONS
// ============================================

import {
	telegramApprovalMessage,
	telegramBotConfig,
	telegramConversation,
	telegramEscalation,
	telegramLinkCode,
	telegramUserMapping,
} from "./telegram-integration";

export const telegramBotConfigRelations = relations(
	telegramBotConfig,
	({ one }) => ({
		organization: one(organization, {
			fields: [telegramBotConfig.organizationId],
			references: [organization.id],
		}),
		configuredBy: one(user, {
			fields: [telegramBotConfig.configuredByUserId],
			references: [user.id],
		}),
	}),
);

export const telegramUserMappingRelations = relations(
	telegramUserMapping,
	({ one }) => ({
		user: one(user, {
			fields: [telegramUserMapping.userId],
			references: [user.id],
		}),
		organization: one(organization, {
			fields: [telegramUserMapping.organizationId],
			references: [organization.id],
		}),
	}),
);

export const telegramConversationRelations = relations(
	telegramConversation,
	({ one }) => ({
		organization: one(organization, {
			fields: [telegramConversation.organizationId],
			references: [organization.id],
		}),
		user: one(user, {
			fields: [telegramConversation.userId],
			references: [user.id],
		}),
	}),
);

export const telegramLinkCodeRelations = relations(
	telegramLinkCode,
	({ one }) => ({
		user: one(user, {
			fields: [telegramLinkCode.userId],
			references: [user.id],
		}),
		organization: one(organization, {
			fields: [telegramLinkCode.organizationId],
			references: [organization.id],
		}),
	}),
);

export const telegramApprovalMessageRelations = relations(
	telegramApprovalMessage,
	({ one }) => ({
		organization: one(organization, {
			fields: [telegramApprovalMessage.organizationId],
			references: [organization.id],
		}),
		approvalRequest: one(approvalRequest, {
			fields: [telegramApprovalMessage.approvalRequestId],
			references: [approvalRequest.id],
		}),
		recipient: one(user, {
			fields: [telegramApprovalMessage.recipientUserId],
			references: [user.id],
		}),
	}),
);

export const telegramEscalationRelations = relations(
	telegramEscalation,
	({ one }) => ({
		organization: one(organization, {
			fields: [telegramEscalation.organizationId],
			references: [organization.id],
		}),
		approvalRequest: one(approvalRequest, {
			fields: [telegramEscalation.approvalRequestId],
			references: [approvalRequest.id],
		}),
		originalApprover: one(employee, {
			fields: [telegramEscalation.originalApproverId],
			references: [employee.id],
			relationName: "telegram_escalation_original_approver",
		}),
		escalatedToApprover: one(employee, {
			fields: [telegramEscalation.escalatedToApproverId],
			references: [employee.id],
			relationName: "telegram_escalation_escalated_to",
		}),
	}),
);

// ============================================
// DISCORD INTEGRATION RELATIONS
// ============================================

import {
	discordApprovalMessage,
	discordBotConfig,
	discordConversation,
	discordEscalation,
	discordLinkCode,
	discordUserMapping,
} from "./discord-integration";

export const discordBotConfigRelations = relations(
	discordBotConfig,
	({ one }) => ({
		organization: one(organization, {
			fields: [discordBotConfig.organizationId],
			references: [organization.id],
		}),
		configuredBy: one(user, {
			fields: [discordBotConfig.configuredByUserId],
			references: [user.id],
		}),
	}),
);

export const discordUserMappingRelations = relations(
	discordUserMapping,
	({ one }) => ({
		user: one(user, {
			fields: [discordUserMapping.userId],
			references: [user.id],
		}),
		organization: one(organization, {
			fields: [discordUserMapping.organizationId],
			references: [organization.id],
		}),
	}),
);

// Clockodo import
import { clockodoUserMapping } from "./clockodo-import";

export const clockodoUserMappingRelations = relations(
	clockodoUserMapping,
	({ one }) => ({
		user: one(user, {
			fields: [clockodoUserMapping.userId],
			references: [user.id],
		}),
		organization: one(organization, {
			fields: [clockodoUserMapping.organizationId],
			references: [organization.id],
		}),
		employee: one(employee, {
			fields: [clockodoUserMapping.employeeId],
			references: [employee.id],
		}),
	}),
);

export const discordConversationRelations = relations(
	discordConversation,
	({ one }) => ({
		organization: one(organization, {
			fields: [discordConversation.organizationId],
			references: [organization.id],
		}),
		user: one(user, {
			fields: [discordConversation.userId],
			references: [user.id],
		}),
	}),
);

export const discordLinkCodeRelations = relations(
	discordLinkCode,
	({ one }) => ({
		user: one(user, {
			fields: [discordLinkCode.userId],
			references: [user.id],
		}),
		organization: one(organization, {
			fields: [discordLinkCode.organizationId],
			references: [organization.id],
		}),
	}),
);

export const discordApprovalMessageRelations = relations(
	discordApprovalMessage,
	({ one }) => ({
		organization: one(organization, {
			fields: [discordApprovalMessage.organizationId],
			references: [organization.id],
		}),
		approvalRequest: one(approvalRequest, {
			fields: [discordApprovalMessage.approvalRequestId],
			references: [approvalRequest.id],
		}),
		recipient: one(user, {
			fields: [discordApprovalMessage.recipientUserId],
			references: [user.id],
		}),
	}),
);

export const discordEscalationRelations = relations(
	discordEscalation,
	({ one }) => ({
		organization: one(organization, {
			fields: [discordEscalation.organizationId],
			references: [organization.id],
		}),
		approvalRequest: one(approvalRequest, {
			fields: [discordEscalation.approvalRequestId],
			references: [approvalRequest.id],
		}),
		originalApprover: one(employee, {
			fields: [discordEscalation.originalApproverId],
			references: [employee.id],
			relationName: "discord_escalation_original_approver",
		}),
		escalatedToApprover: one(employee, {
			fields: [discordEscalation.escalatedToApproverId],
			references: [employee.id],
			relationName: "discord_escalation_escalated_to",
		}),
	}),
);

// ============================================
// SLACK INTEGRATION RELATIONS
// ============================================

import {
	slackApprovalMessage,
	slackConversation,
	slackEscalation,
	slackLinkCode,
	slackOAuthState,
	slackUserMapping,
	slackWorkspaceConfig,
} from "./slack-integration";

export const slackWorkspaceConfigRelations = relations(
	slackWorkspaceConfig,
	({ one }) => ({
		organization: one(organization, {
			fields: [slackWorkspaceConfig.organizationId],
			references: [organization.id],
		}),
		configuredBy: one(user, {
			fields: [slackWorkspaceConfig.configuredByUserId],
			references: [user.id],
		}),
	}),
);

export const slackOAuthStateRelations = relations(
	slackOAuthState,
	({ one }) => ({
		organization: one(organization, {
			fields: [slackOAuthState.organizationId],
			references: [organization.id],
		}),
		user: one(user, {
			fields: [slackOAuthState.userId],
			references: [user.id],
		}),
	}),
);

export const slackUserMappingRelations = relations(
	slackUserMapping,
	({ one }) => ({
		user: one(user, {
			fields: [slackUserMapping.userId],
			references: [user.id],
		}),
		organization: one(organization, {
			fields: [slackUserMapping.organizationId],
			references: [organization.id],
		}),
	}),
);

export const slackConversationRelations = relations(
	slackConversation,
	({ one }) => ({
		organization: one(organization, {
			fields: [slackConversation.organizationId],
			references: [organization.id],
		}),
		user: one(user, {
			fields: [slackConversation.userId],
			references: [user.id],
		}),
	}),
);

export const slackLinkCodeRelations = relations(slackLinkCode, ({ one }) => ({
	user: one(user, {
		fields: [slackLinkCode.userId],
		references: [user.id],
	}),
	organization: one(organization, {
		fields: [slackLinkCode.organizationId],
		references: [organization.id],
	}),
}));

export const slackApprovalMessageRelations = relations(
	slackApprovalMessage,
	({ one }) => ({
		organization: one(organization, {
			fields: [slackApprovalMessage.organizationId],
			references: [organization.id],
		}),
		approvalRequest: one(approvalRequest, {
			fields: [slackApprovalMessage.approvalRequestId],
			references: [approvalRequest.id],
		}),
		recipient: one(user, {
			fields: [slackApprovalMessage.recipientUserId],
			references: [user.id],
		}),
	}),
);

export const slackEscalationRelations = relations(
	slackEscalation,
	({ one }) => ({
		organization: one(organization, {
			fields: [slackEscalation.organizationId],
			references: [organization.id],
		}),
		approvalRequest: one(approvalRequest, {
			fields: [slackEscalation.approvalRequestId],
			references: [approvalRequest.id],
		}),
		originalApprover: one(employee, {
			fields: [slackEscalation.originalApproverId],
			references: [employee.id],
			relationName: "slack_escalation_original_approver",
		}),
		escalatedToApprover: one(employee, {
			fields: [slackEscalation.escalatedToApproverId],
			references: [employee.id],
			relationName: "slack_escalation_escalated_to",
		}),
	}),
);
