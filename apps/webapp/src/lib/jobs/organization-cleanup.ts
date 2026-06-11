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
	holiday,
	holidayAssignment,
	holidayCategory,
	holidayPreset,
	holidayPresetAssignment,
	holidayPresetHoliday,
	location,
	locationEmployee,
	locationSubarea,
	notification,
	notificationPreference,
	organizationBranding,
	organizationDomain,
	organizationEmailConfig,
	project,
	projectAssignment,
	projectManager,
	pushSubscription,
	shift,
	shiftRequest,
	shiftTemplate,
	surchargeModel,
	surchargeModelAssignment,
	surchargeRule,
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
				lt(authSchema.organization.deletedAt, cutoffDate),
			),
		});

		if (organizationsToDelete.length === 0) {
			logger.info("No organizations ready for permanent deletion");
			return result;
		}

		logger.info(
			{ count: organizationsToDelete.length },
			"Found organizations ready for permanent deletion",
		);

		const deletionResults = await Promise.all(
			organizationsToDelete.map(async (org) => {
				try {
					await permanentlyDeleteOrganization(org.id);
					logger.info(
						{ organizationId: org.id, organizationName: org.name },
						"Organization permanently deleted",
					);
					return { success: true as const };
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error";
					logger.error(
						{ error: errorMessage, organizationId: org.id },
						"Failed to permanently delete organization",
					);
					return {
						success: false as const,
						error: `Failed to delete org ${org.id}: ${errorMessage}`,
					};
				}
			}),
		);

		result.organizationsDeleted = deletionResults.filter((item) => item.success).length;
		result.errors.push(...deletionResults.flatMap((item) => (item.success ? [] : [item.error])));

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
		const employeeUserIds = employees.flatMap((e) => (e.userId ? [e.userId] : []));

		// Delete in order (most dependent first)

		// 1. Time tracking data
		if (employeeIds.length > 0) {
			await tx.delete(timeEntry).where(inArray(timeEntry.employeeId, employeeIds));
			await tx.delete(workPeriod).where(inArray(workPeriod.employeeId, employeeIds));
		}
		if (employeeUserIds.length > 0) {
			await tx.delete(waterIntakeLog).where(inArray(waterIntakeLog.userId, employeeUserIds));
		}

		// 2. Absence data
		if (employeeIds.length > 0) {
			await tx.delete(absenceEntry).where(inArray(absenceEntry.employeeId, employeeIds));
		}
		await tx.delete(absenceCategory).where(eq(absenceCategory.organizationId, organizationId));

		// 3. Approval requests (by employee)
		if (employeeIds.length > 0) {
			await tx.delete(approvalRequest).where(inArray(approvalRequest.requestedBy, employeeIds));
		}

		// 4. Vacation data
		if (employeeIds.length > 0) {
			await tx
				.delete(employeeVacationAllowance)
				.where(inArray(employeeVacationAllowance.employeeId, employeeIds));
		}
		await tx.delete(vacationAllowance).where(eq(vacationAllowance.organizationId, organizationId));

		// 5. Holiday data
		await tx
			.delete(holidayPresetAssignment)
			.where(eq(holidayPresetAssignment.organizationId, organizationId));
		await tx.delete(holidayAssignment).where(eq(holidayAssignment.organizationId, organizationId));

		const presets = await tx.query.holidayPreset.findMany({
			where: eq(holidayPreset.organizationId, organizationId),
		});
		const presetIds = presets.map((preset) => preset.id);
		if (presetIds.length > 0) {
			await tx
				.delete(holidayPresetHoliday)
				.where(inArray(holidayPresetHoliday.presetId, presetIds));
		}
		await tx.delete(holidayPreset).where(eq(holidayPreset.organizationId, organizationId));
		await tx.delete(holiday).where(eq(holiday.organizationId, organizationId));
		await tx.delete(holidayCategory).where(eq(holidayCategory.organizationId, organizationId));

		// 6. Project data
		const projects = await tx.query.project.findMany({
			where: eq(project.organizationId, organizationId),
		});
		const projectIds = projects.map((proj) => proj.id);
		if (projectIds.length > 0) {
			await tx.delete(projectManager).where(inArray(projectManager.projectId, projectIds));
			await tx.delete(projectAssignment).where(inArray(projectAssignment.projectId, projectIds));
		}
		await tx.delete(project).where(eq(project.organizationId, organizationId));

		// 7. Shift data
		const shifts = await tx.query.shift.findMany({
			where: eq(shift.organizationId, organizationId),
		});
		const shiftIds = shifts.map((s) => s.id);
		if (shiftIds.length > 0) {
			await tx.delete(shiftRequest).where(inArray(shiftRequest.shiftId, shiftIds));
		}
		await tx.delete(shift).where(eq(shift.organizationId, organizationId));
		await tx.delete(shiftTemplate).where(eq(shiftTemplate.organizationId, organizationId));

		// 8. Surcharge data
		const surchargeModels = await tx.query.surchargeModel.findMany({
			where: eq(surchargeModel.organizationId, organizationId),
		});
		const surchargeModelIds = surchargeModels.map((model) => model.id);
		if (surchargeModelIds.length > 0) {
			await tx.delete(surchargeRule).where(inArray(surchargeRule.modelId, surchargeModelIds));
			await tx
				.delete(surchargeModelAssignment)
				.where(inArray(surchargeModelAssignment.modelId, surchargeModelIds));
		}
		await tx.delete(surchargeModel).where(eq(surchargeModel.organizationId, organizationId));

		// 9. Work policy data (unified schedules + regulations)
		const policies = await tx.query.workPolicy.findMany({
			where: eq(workPolicy.organizationId, organizationId),
		});
		const policyIds = policies.map((policy) => policy.id);
		if (policyIds.length > 0) {
			// Delete schedule data
			const schedules = await tx.query.workPolicySchedule.findMany({
				where: inArray(workPolicySchedule.policyId, policyIds),
			});
			const scheduleIds = schedules.map((schedule) => schedule.id);
			if (scheduleIds.length > 0) {
				await tx
					.delete(workPolicyScheduleDay)
					.where(inArray(workPolicyScheduleDay.scheduleId, scheduleIds));
				await tx.delete(workPolicySchedule).where(inArray(workPolicySchedule.id, scheduleIds));
			}

			// Delete regulation data
			const regulations = await tx.query.workPolicyRegulation.findMany({
				where: inArray(workPolicyRegulation.policyId, policyIds),
			});
			const regulationIds = regulations.map((regulation) => regulation.id);
			if (regulationIds.length > 0) {
				const breakRules = await tx.query.workPolicyBreakRule.findMany({
					where: inArray(workPolicyBreakRule.regulationId, regulationIds),
				});
				const breakRuleIds = breakRules.map((rule) => rule.id);
				if (breakRuleIds.length > 0) {
					await tx
						.delete(workPolicyBreakOption)
						.where(inArray(workPolicyBreakOption.breakRuleId, breakRuleIds));
				}
				await tx
					.delete(workPolicyBreakRule)
					.where(inArray(workPolicyBreakRule.regulationId, regulationIds));
				await tx
					.delete(workPolicyRegulation)
					.where(inArray(workPolicyRegulation.id, regulationIds));
			}

			// Delete assignments
			await tx
				.delete(workPolicyAssignment)
				.where(inArray(workPolicyAssignment.policyId, policyIds));
		}
		await tx
			.delete(workPolicyViolation)
			.where(eq(workPolicyViolation.organizationId, organizationId));
		await tx.delete(workPolicy).where(eq(workPolicy.organizationId, organizationId));

		// 11. Location data
		const locations = await tx.query.location.findMany({
			where: eq(location.organizationId, organizationId),
		});
		const locationIds = locations.map((loc) => loc.id);
		if (locationIds.length > 0) {
			await tx.delete(locationEmployee).where(inArray(locationEmployee.locationId, locationIds));
			await tx.delete(locationSubarea).where(inArray(locationSubarea.locationId, locationIds));
		}
		await tx.delete(location).where(eq(location.organizationId, organizationId));

		// 12. Employee manager assignments
		if (employeeIds.length > 0) {
			await tx.delete(employeeManagers).where(inArray(employeeManagers.employeeId, employeeIds));
			await tx.delete(employeeManagers).where(inArray(employeeManagers.managerId, employeeIds));
		}

		// 13. Notification data
		await tx
			.delete(notificationPreference)
			.where(eq(notificationPreference.organizationId, organizationId));
		await tx.delete(notification).where(eq(notification.organizationId, organizationId));

		// 14. Export data
		await tx.delete(dataExport).where(eq(dataExport.organizationId, organizationId));
		await tx
			.delete(exportStorageConfig)
			.where(eq(exportStorageConfig.organizationId, organizationId));

		// 15. Audit log (by employee)
		if (employeeIds.length > 0) {
			await tx.delete(auditLog).where(inArray(auditLog.employeeId, employeeIds));
		}

		// 16. Enterprise data
		await tx
			.delete(organizationDomain)
			.where(eq(organizationDomain.organizationId, organizationId));
		await tx
			.delete(organizationBranding)
			.where(eq(organizationBranding.organizationId, organizationId));
		await tx
			.delete(organizationEmailConfig)
			.where(eq(organizationEmailConfig.organizationId, organizationId));

		// 17. Push subscriptions
		if (employeeUserIds.length > 0) {
			await tx.delete(pushSubscription).where(inArray(pushSubscription.userId, employeeUserIds));
		}

		// 18. Teams
		await tx.delete(team).where(eq(team.organizationId, organizationId));

		// 20. Employees
		await tx.delete(employee).where(eq(employee.organizationId, organizationId));

		// 21. Better Auth data (members, invitations, sessions)
		// Members and invitations have cascade delete from organization
		await tx.delete(authSchema.member).where(eq(authSchema.member.organizationId, organizationId));
		await tx
			.delete(authSchema.invitation)
			.where(eq(authSchema.invitation.organizationId, organizationId));

		// Clear active organization from sessions
		await tx
			.update(authSchema.session)
			.set({ activeOrganizationId: null })
			.where(eq(authSchema.session.activeOrganizationId, organizationId));

		// 22. SSO providers
		await tx
			.delete(authSchema.ssoProvider)
			.where(eq(authSchema.ssoProvider.organizationId, organizationId));

		// 23. Finally, delete the organization itself
		await tx.delete(authSchema.organization).where(eq(authSchema.organization.id, organizationId));
	});

	logger.info({ organizationId }, "Organization and all related data permanently deleted");
}
