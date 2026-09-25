/**
 * Organization Cleanup Job
 *
 * Permanently deletes organizations that have been soft-deleted for more than 5 days.
 * This job should be run daily via cron.
 */

import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { employee, pushSubscription, waterIntakeLog } from "@/db/schema";
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
					const errorMessage =
						error instanceof Error ? error.message : "Unknown error";
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

		result.organizationsDeleted = deletionResults.filter(
			(item) => item.success,
		).length;
		result.errors.push(
			...deletionResults.flatMap((item) => (item.success ? [] : [item.error])),
		);

		if (result.errors.length > 0) {
			result.success = false;
		}

		return result;
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		logger.error({ error: errorMessage }, "Organization cleanup job failed");
		result.success = false;
		result.errors.push(errorMessage);
		return result;
	}
}

/**
 * Permanently delete an organization and all its related data.
 * This is called after the 5-day grace period has passed.
 *
 * Topology (#306): every organization-scoped table cascades from `organization`,
 * directly or through a parent that does (employees, workflows, periods, ...),
 * so one delete removes the whole tenant, including adopted lifecycle state:
 * approval evidence, bindings, invocations, delivery work/messages/intents,
 * escalation journals and attention, work receipts, append positions and every
 * adoption control. Rows that reference employees (or periods, workflows) without
 * cascade are all direct organization children, so the same statement removes
 * them before those references are checked; explicit deletes of employees or
 * entries first would be blocked by them. Only rows outside the cascade are
 * handled here first. Everything runs in one transaction: a failure, including a
 * future non-cascading reference, rolls the whole tenant back.
 *
 * Staged receipt uploads (`travel_expense_receipt_upload`) are kept by value on
 * purpose: they are outstanding storage cleanup work that must outlive the
 * tenant until the stored object is deleted (#295).
 */
async function permanentlyDeleteOrganization(
	organizationId: string,
): Promise<void> {
	logger.info(
		{ organizationId },
		"Starting permanent deletion of organization",
	);

	await db.transaction(async (tx) => {
		const employees = await tx.query.employee.findMany({
			where: eq(employee.organizationId, organizationId),
			columns: { userId: true },
		});
		const employeeUserIds = employees.flatMap((e) =>
			e.userId ? [e.userId] : [],
		);

		// User-level rows of the tenant's users (no organization reference).
		if (employeeUserIds.length > 0) {
			await tx
				.delete(waterIntakeLog)
				.where(inArray(waterIntakeLog.userId, employeeUserIds));
			await tx
				.delete(pushSubscription)
				.where(inArray(pushSubscription.userId, employeeUserIds));
		}

		// Clear active organization from sessions
		await tx
			.update(authSchema.session)
			.set({ activeOrganizationId: null })
			.where(eq(authSchema.session.activeOrganizationId, organizationId));

		// SSO providers carry the organization without a foreign key.
		await tx
			.delete(authSchema.ssoProvider)
			.where(eq(authSchema.ssoProvider.organizationId, organizationId));

		// Finally, delete the organization itself; everything else cascades.
		await tx
			.delete(authSchema.organization)
			.where(eq(authSchema.organization.id, organizationId));
	});

	logger.info(
		{ organizationId },
		"Organization and all related data permanently deleted",
	);
}
