import { relations } from "drizzle-orm";

// Import auth tables
import { invitation, member, organization, user } from "../auth-schema";
import { absenceCategory, absenceEntry } from "./absence";
import { approvalRequest } from "./approval";
import { auditLog } from "./audit";
import { changePolicy, changePolicyAssignment } from "./change-policy";
import {
	organizationBranding,
	organizationDomain,
	organizationEmailConfig,
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
import {
	inviteCode,
	inviteCodeUsage,
	memberApproval,
} from "./invite-code";
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
	project,
	projectAssignment,
	projectManager,
	projectNotificationState,
} from "./project";
import { shift, shiftRecurrence, shiftRequest, shiftTemplate } from "./shift";
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

export const workCategoryRelations = relations(workCategory, ({ one, many }) => ({
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
}));

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

export const inviteCodeUsageRelations = relations(inviteCodeUsage, ({ one }) => ({
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
}));

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
