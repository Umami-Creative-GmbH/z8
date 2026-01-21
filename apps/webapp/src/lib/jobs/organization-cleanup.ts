/**
 * Organization Cleanup Job
 *
 * Permanently deletes organizations that have been soft-deleted for more than 5 days.
 * This job should be run daily via cron.
 */

import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import {
	absenceCategory,
	absenceEntry,
	approvalRequest,
	auditLog,
	dataExport,
	employee,
	employeeManagers,
	employeeVacationAllowance,
	exportStorageConfig,
	holidayCategory,
	holiday,
	holidayPreset,
	holidayPresetHoliday,
	holidayPresetAssignment,
	holidayAssignment,
	location,
	locationEmployee,
	locationSubarea,
	notification,
	notificationPreference,
	organizationDomain,
	organizationBranding,
	organizationEmailConfig,
	project,
	projectManager,
	projectAssignment,
	pushSubscription,
	shiftTemplate,
	shift,
	shiftRequest,
	surchargeModel,
	surchargeRule,
	surchargeModelAssignment,
	team,
	timeEntry,
	vacationAllowance,
	waterIntakeLog,
	workPeriod,
	workPolicy,
	workPolicyAssignment,
	workPolicyBreakOption,
	workPolicyBreakRule,
	workPolicyRegulation,
	workPolicySchedule,
	workPolicyScheduleDay,
	workPolicyViolation,
} from "@/db/schema";
import { createLogger } from "@/lib/logger";

const logger = createLogger("organization-cleanup");

// 5 days in milliseconds
const DELETION_GRACE_PERIOD_MS = 5 * 24 * 60 * 60 * 1000;

export interface OrganizationCleanupResult {
	success: boolean;
	organizationsDeleted: number;
	errors: string[];
}

/**
 * Find and permanently delete organizations that have been soft-deleted for more than 5 days
 */
export async function runOrganizationCleanup(): Promise<OrganizationCleanupResult> {
	const result: OrganizationCleanupResult = {
		success: true,
		organizationsDeleted: 0,
		errors: [],
	};

	try {
		// Find organizations that have been soft-deleted for more than 5 days
		const cutoffDate = new Date(Date.now() - DELETION_GRACE_PERIOD_MS);

		const organizationsToDelete = await db.query.organization.findMany({
			where: and(
				isNotNull(authSchema.organization.deletedAt),
				lt(authSchema.organization.deletedAt, cutoffDate)
			),
		});

		if (organizationsToDelete.length === 0) {
			logger.info("No organizations ready for permanent deletion");
			return result;
		}

		logger.info(
			{ count: organizationsToDelete.length },
			"Found organizations ready for permanent deletion"
		);

		for (const org of organizationsToDelete) {
			try {
				await permanentlyDeleteOrganization(org.id);
				result.organizationsDeleted++;
				logger.info(
					{ organizationId: org.id, organizationName: org.name },
					"Organization permanently deleted"
				);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error";
				result.errors.push(`Failed to delete org ${org.id}: ${errorMessage}`);
				logger.error(
					{ error: errorMessage, organizationId: org.id },
					"Failed to permanently delete organization"
				);
			}
		}

		if (result.errors.length > 0) {
			result.success = false;
		}

		return result;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ error: errorMessage }, "Organization cleanup job failed");
		result.success = false;
		result.errors.push(errorMessage);
		return result;
	}
}

/**
 * Permanently delete an organization and all its related data
 * This is called after the 5-day grace period has passed
 */
async function permanentlyDeleteOrganization(organizationId: string): Promise<void> {
	logger.info({ organizationId }, "Starting permanent deletion of organization");

	// Use a transaction to ensure all data is deleted atomically
	await db.transaction(async (tx) => {
		// Get all employees for this organization (needed for cascade deletes)
		const employees = await tx.query.employee.findMany({
			where: eq(employee.organizationId, organizationId),
		});
		const employeeIds = employees.map((e) => e.id);

		// Delete in order (most dependent first)

		// 1. Time tracking data
		if (employees.length > 0) {
			for (const emp of employees) {
				await tx.delete(timeEntry).where(eq(timeEntry.employeeId, emp.id));
				await tx.delete(workPeriod).where(eq(workPeriod.employeeId, emp.id));
				await tx.delete(waterIntakeLog).where(eq(waterIntakeLog.userId, emp.userId));
			}
		}

		// 2. Absence data
		if (employeeIds.length > 0) {
			for (const empId of employeeIds) {
				await tx.delete(absenceEntry).where(eq(absenceEntry.employeeId, empId));
			}
		}
		await tx.delete(absenceCategory).where(eq(absenceCategory.organizationId, organizationId));

		// 3. Approval requests (by employee)
		if (employeeIds.length > 0) {
			await tx.delete(approvalRequest).where(inArray(approvalRequest.requestedBy, employeeIds));
		}

		// 4. Vacation data
		if (employeeIds.length > 0) {
			for (const empId of employeeIds) {
				await tx.delete(employeeVacationAllowance).where(eq(employeeVacationAllowance.employeeId, empId));
			}
		}
		await tx.delete(vacationAllowance).where(eq(vacationAllowance.organizationId, organizationId));

		// 5. Holiday data
		await tx.delete(holidayPresetAssignment).where(eq(holidayPresetAssignment.organizationId, organizationId));
		await tx.delete(holidayAssignment).where(eq(holidayAssignment.organizationId, organizationId));

		const presets = await tx.query.holidayPreset.findMany({
			where: eq(holidayPreset.organizationId, organizationId),
		});
		for (const preset of presets) {
			await tx.delete(holidayPresetHoliday).where(eq(holidayPresetHoliday.presetId, preset.id));
		}
		await tx.delete(holidayPreset).where(eq(holidayPreset.organizationId, organizationId));
		await tx.delete(holiday).where(eq(holiday.organizationId, organizationId));
		await tx.delete(holidayCategory).where(eq(holidayCategory.organizationId, organizationId));

		// 6. Project data
		const projects = await tx.query.project.findMany({
			where: eq(project.organizationId, organizationId),
		});
		for (const proj of projects) {
			await tx.delete(projectManager).where(eq(projectManager.projectId, proj.id));
			await tx.delete(projectAssignment).where(eq(projectAssignment.projectId, proj.id));
		}
		await tx.delete(project).where(eq(project.organizationId, organizationId));

		// 7. Shift data
		const shifts = await tx.query.shift.findMany({
			where: eq(shift.organizationId, organizationId),
		});
		for (const s of shifts) {
			await tx.delete(shiftRequest).where(eq(shiftRequest.shiftId, s.id));
		}
		await tx.delete(shift).where(eq(shift.organizationId, organizationId));
		await tx.delete(shiftTemplate).where(eq(shiftTemplate.organizationId, organizationId));

		// 8. Surcharge data
		const surchargeModels = await tx.query.surchargeModel.findMany({
			where: eq(surchargeModel.organizationId, organizationId),
		});
		for (const model of surchargeModels) {
			await tx.delete(surchargeRule).where(eq(surchargeRule.modelId, model.id));
			await tx.delete(surchargeModelAssignment).where(eq(surchargeModelAssignment.modelId, model.id));
		}
		await tx.delete(surchargeModel).where(eq(surchargeModel.organizationId, organizationId));

		// 9. Work policy data (unified schedules + regulations)
		const policies = await tx.query.workPolicy.findMany({
			where: eq(workPolicy.organizationId, organizationId),
		});
		for (const policy of policies) {
			// Delete schedule data
			const schedule = await tx.query.workPolicySchedule.findFirst({
				where: eq(workPolicySchedule.policyId, policy.id),
			});
			if (schedule) {
				await tx.delete(workPolicyScheduleDay).where(eq(workPolicyScheduleDay.scheduleId, schedule.id));
				await tx.delete(workPolicySchedule).where(eq(workPolicySchedule.id, schedule.id));
			}

			// Delete regulation data
			const regulation = await tx.query.workPolicyRegulation.findFirst({
				where: eq(workPolicyRegulation.policyId, policy.id),
			});
			if (regulation) {
				const breakRules = await tx.query.workPolicyBreakRule.findMany({
					where: eq(workPolicyBreakRule.regulationId, regulation.id),
				});
				for (const rule of breakRules) {
					await tx.delete(workPolicyBreakOption).where(eq(workPolicyBreakOption.breakRuleId, rule.id));
				}
				await tx.delete(workPolicyBreakRule).where(eq(workPolicyBreakRule.regulationId, regulation.id));
				await tx.delete(workPolicyRegulation).where(eq(workPolicyRegulation.id, regulation.id));
			}

			// Delete assignments
			await tx.delete(workPolicyAssignment).where(eq(workPolicyAssignment.policyId, policy.id));
		}
		await tx.delete(workPolicyViolation).where(eq(workPolicyViolation.organizationId, organizationId));
		await tx.delete(workPolicy).where(eq(workPolicy.organizationId, organizationId));

		// 11. Location data
		const locations = await tx.query.location.findMany({
			where: eq(location.organizationId, organizationId),
		});
		for (const loc of locations) {
			await tx.delete(locationEmployee).where(eq(locationEmployee.locationId, loc.id));
			await tx.delete(locationSubarea).where(eq(locationSubarea.locationId, loc.id));
		}
		await tx.delete(location).where(eq(location.organizationId, organizationId));

		// 12. Employee manager assignments
		if (employeeIds.length > 0) {
			for (const empId of employeeIds) {
				await tx.delete(employeeManagers).where(eq(employeeManagers.employeeId, empId));
				await tx.delete(employeeManagers).where(eq(employeeManagers.managerId, empId));
			}
		}

		// 13. Notification data
		await tx.delete(notificationPreference).where(eq(notificationPreference.organizationId, organizationId));
		await tx.delete(notification).where(eq(notification.organizationId, organizationId));

		// 14. Export data
		await tx.delete(dataExport).where(eq(dataExport.organizationId, organizationId));
		await tx.delete(exportStorageConfig).where(eq(exportStorageConfig.organizationId, organizationId));

		// 15. Audit log (by employee)
		if (employeeIds.length > 0) {
			await tx.delete(auditLog).where(inArray(auditLog.employeeId, employeeIds));
		}

		// 16. Enterprise data
		await tx.delete(organizationDomain).where(eq(organizationDomain.organizationId, organizationId));
		await tx.delete(organizationBranding).where(eq(organizationBranding.organizationId, organizationId));
		await tx.delete(organizationEmailConfig).where(eq(organizationEmailConfig.organizationId, organizationId));

		// 17. Push subscriptions
		for (const emp of employees) {
			if (emp.userId) {
				await tx.delete(pushSubscription).where(eq(pushSubscription.userId, emp.userId));
			}
		}

		// 18. Teams
		await tx.delete(team).where(eq(team.organizationId, organizationId));

		// 20. Employees
		await tx.delete(employee).where(eq(employee.organizationId, organizationId));

		// 21. Better Auth data (members, invitations, sessions)
		// Members and invitations have cascade delete from organization
		await tx.delete(authSchema.member).where(eq(authSchema.member.organizationId, organizationId));
		await tx.delete(authSchema.invitation).where(eq(authSchema.invitation.organizationId, organizationId));

		// Clear active organization from sessions
		await tx
			.update(authSchema.session)
			.set({ activeOrganizationId: null })
			.where(eq(authSchema.session.activeOrganizationId, organizationId));

		// 22. SSO providers
		await tx.delete(authSchema.ssoProvider).where(eq(authSchema.ssoProvider.organizationId, organizationId));

		// 23. Finally, delete the organization itself
		await tx.delete(authSchema.organization).where(eq(authSchema.organization.id, organizationId));
	});

	logger.info({ organizationId }, "Organization and all related data permanently deleted");
}
