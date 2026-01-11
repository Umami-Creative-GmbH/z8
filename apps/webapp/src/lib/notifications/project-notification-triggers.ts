/**
 * Project Notification Triggers
 *
 * Functions to create notifications for project budget and deadline warnings.
 * These are fire-and-forget - they don't throw on failure.
 */

import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, project, projectManager, projectNotificationState } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { createNotification } from "./notification-service";
import type { NotificationType } from "./types";

const logger = createLogger("ProjectNotificationTriggers");

// =============================================================================
// Budget Warning Notifications
// =============================================================================

const BUDGET_THRESHOLDS = [70, 90, 100] as const;
type BudgetThreshold = (typeof BUDGET_THRESHOLDS)[number];

const BUDGET_NOTIFICATION_TYPES: Record<BudgetThreshold, NotificationType> = {
	70: "project_budget_warning_70",
	90: "project_budget_warning_90",
	100: "project_budget_warning_100",
};

interface BudgetWarningParams {
	projectId: string;
	projectName: string;
	organizationId: string;
	budgetHours: number;
	usedHours: number;
}

/**
 * Check and send budget warning notifications for a project
 * Called after time is booked to a project
 */
export async function checkProjectBudgetWarnings(params: BudgetWarningParams): Promise<void> {
	try {
		const percentUsed = (params.usedHours / params.budgetHours) * 100;

		// Find which thresholds have been crossed
		const crossedThresholds = BUDGET_THRESHOLDS.filter((t) => percentUsed >= t);

		if (crossedThresholds.length === 0) {
			return; // No thresholds crossed
		}

		// Get the notification state to check which thresholds were already notified
		let state = await db.query.projectNotificationState.findFirst({
			where: eq(projectNotificationState.projectId, params.projectId),
		});

		// Create state if it doesn't exist
		if (!state) {
			const [newState] = await db
				.insert(projectNotificationState)
				.values({
					projectId: params.projectId,
					budgetThresholdsNotified: [],
					deadlineThresholdsNotified: [],
				})
				.returning();
			state = newState;
		}

		const notifiedThresholds = (state.budgetThresholdsNotified as number[]) || [];

		// Find thresholds that haven't been notified yet
		const newThresholds = crossedThresholds.filter((t) => !notifiedThresholds.includes(t));

		if (newThresholds.length === 0) {
			return; // All crossed thresholds already notified
		}

		// Get project managers to notify
		const managers = await getProjectManagers(params.projectId);

		if (managers.length === 0) {
			logger.warn(
				{ projectId: params.projectId },
				"No managers to notify for project budget warning",
			);
			return;
		}

		// Send notifications for each new threshold
		for (const threshold of newThresholds) {
			const notificationType = BUDGET_NOTIFICATION_TYPES[threshold];
			const title = getBudgetWarningTitle(threshold);
			const message = getBudgetWarningMessage(
				threshold,
				params.projectName,
				params.usedHours,
				params.budgetHours,
			);

			for (const manager of managers) {
				await createNotification({
					userId: manager.userId,
					organizationId: params.organizationId,
					type: notificationType,
					title,
					message,
					entityType: "project",
					entityId: params.projectId,
					actionUrl: "/settings/projects",
					metadata: {
						projectName: params.projectName,
						threshold,
						usedHours: params.usedHours,
						budgetHours: params.budgetHours,
						percentUsed: Math.round(percentUsed),
					},
				});
			}
		}

		// Update notification state with newly notified thresholds
		const updatedThresholds = [...notifiedThresholds, ...newThresholds];
		await db
			.update(projectNotificationState)
			.set({
				budgetThresholdsNotified: updatedThresholds,
				updatedAt: new Date(),
			})
			.where(eq(projectNotificationState.projectId, params.projectId));

		logger.info(
			{ projectId: params.projectId, newThresholds, percentUsed },
			"Sent project budget warning notifications",
		);
	} catch (error) {
		logger.error({ error, params }, "Failed to check project budget warnings");
	}
}

function getBudgetWarningTitle(threshold: BudgetThreshold): string {
	switch (threshold) {
		case 70:
			return "Project approaching budget limit";
		case 90:
			return "Project near budget limit";
		case 100:
			return "Project budget exceeded";
	}
}

function getBudgetWarningMessage(
	threshold: BudgetThreshold,
	projectName: string,
	usedHours: number,
	budgetHours: number,
): string {
	const percentUsed = Math.round((usedHours / budgetHours) * 100);

	switch (threshold) {
		case 70:
			return `"${projectName}" has used ${percentUsed}% of its budget (${usedHours.toFixed(1)}h of ${budgetHours}h).`;
		case 90:
			return `"${projectName}" has used ${percentUsed}% of its budget (${usedHours.toFixed(1)}h of ${budgetHours}h). Consider reviewing time allocations.`;
		case 100:
			return `"${projectName}" has exceeded its budget (${usedHours.toFixed(1)}h of ${budgetHours}h budgeted). Review and adjust as needed.`;
	}
}

// =============================================================================
// Deadline Warning Notifications
// =============================================================================

const DEADLINE_THRESHOLDS = [14, 7, 1, 0, -1] as const; // -1 means overdue
type DeadlineThreshold = (typeof DEADLINE_THRESHOLDS)[number];

const DEADLINE_NOTIFICATION_TYPES: Record<DeadlineThreshold, NotificationType> = {
	14: "project_deadline_warning_14d",
	7: "project_deadline_warning_7d",
	1: "project_deadline_warning_1d",
	0: "project_deadline_warning_0d",
	"-1": "project_deadline_overdue",
};

interface DeadlineWarningParams {
	projectId: string;
	projectName: string;
	organizationId: string;
	deadline: Date;
	daysUntilDeadline: number;
}

/**
 * Check and send deadline warning notifications for a project
 * Called by the daily cron job
 */
export async function checkProjectDeadlineWarnings(params: DeadlineWarningParams): Promise<void> {
	try {
		// Determine which threshold we're at
		let matchedThreshold: DeadlineThreshold | null = null;

		if (params.daysUntilDeadline < 0) {
			matchedThreshold = -1; // Overdue
		} else if (params.daysUntilDeadline === 0) {
			matchedThreshold = 0;
		} else if (params.daysUntilDeadline <= 1) {
			matchedThreshold = 1;
		} else if (params.daysUntilDeadline <= 7) {
			matchedThreshold = 7;
		} else if (params.daysUntilDeadline <= 14) {
			matchedThreshold = 14;
		}

		if (matchedThreshold === null) {
			return; // No threshold matched
		}

		// Get the notification state
		let state = await db.query.projectNotificationState.findFirst({
			where: eq(projectNotificationState.projectId, params.projectId),
		});

		// Create state if it doesn't exist
		if (!state) {
			const [newState] = await db
				.insert(projectNotificationState)
				.values({
					projectId: params.projectId,
					budgetThresholdsNotified: [],
					deadlineThresholdsNotified: [],
				})
				.returning();
			state = newState;
		}

		const notifiedThresholds = (state.deadlineThresholdsNotified as number[]) || [];

		// Check if this threshold was already notified
		if (notifiedThresholds.includes(matchedThreshold)) {
			return; // Already notified for this threshold
		}

		// Get project managers to notify
		const managers = await getProjectManagers(params.projectId);

		if (managers.length === 0) {
			logger.warn(
				{ projectId: params.projectId },
				"No managers to notify for project deadline warning",
			);
			return;
		}

		// Send notifications
		const notificationType = DEADLINE_NOTIFICATION_TYPES[matchedThreshold];
		const title = getDeadlineWarningTitle(matchedThreshold);
		const message = getDeadlineWarningMessage(
			matchedThreshold,
			params.projectName,
			params.deadline,
		);

		for (const manager of managers) {
			await createNotification({
				userId: manager.userId,
				organizationId: params.organizationId,
				type: notificationType,
				title,
				message,
				entityType: "project",
				entityId: params.projectId,
				actionUrl: "/settings/projects",
				metadata: {
					projectName: params.projectName,
					deadline: params.deadline.toISOString(),
					daysUntilDeadline: params.daysUntilDeadline,
					threshold: matchedThreshold,
				},
			});
		}

		// Update notification state
		const updatedThresholds = [...notifiedThresholds, matchedThreshold];
		await db
			.update(projectNotificationState)
			.set({
				deadlineThresholdsNotified: updatedThresholds,
				updatedAt: new Date(),
			})
			.where(eq(projectNotificationState.projectId, params.projectId));

		logger.info(
			{
				projectId: params.projectId,
				matchedThreshold,
				daysUntilDeadline: params.daysUntilDeadline,
			},
			"Sent project deadline warning notification",
		);
	} catch (error) {
		logger.error({ error, params }, "Failed to check project deadline warnings");
	}
}

function getDeadlineWarningTitle(threshold: DeadlineThreshold): string {
	switch (threshold) {
		case 14:
			return "Project deadline in 2 weeks";
		case 7:
			return "Project deadline in 1 week";
		case 1:
			return "Project deadline tomorrow";
		case 0:
			return "Project deadline today";
		case -1:
			return "Project deadline overdue";
	}
}

function getDeadlineWarningMessage(
	threshold: DeadlineThreshold,
	projectName: string,
	deadline: Date,
): string {
	const dateStr = deadline.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});

	switch (threshold) {
		case 14:
			return `"${projectName}" deadline is in 2 weeks (${dateStr}). Plan ahead to meet the deadline.`;
		case 7:
			return `"${projectName}" deadline is in 1 week (${dateStr}). Make sure you're on track.`;
		case 1:
			return `"${projectName}" deadline is tomorrow (${dateStr}). Final push to complete!`;
		case 0:
			return `"${projectName}" deadline is today (${dateStr}). Wrap up remaining work.`;
		case -1:
			return `"${projectName}" is past its deadline (${dateStr}). Update status or extend the deadline.`;
	}
}

// =============================================================================
// Helper Functions
// =============================================================================

interface ProjectManagerInfo {
	userId: string;
	employeeId: string;
	name: string;
}

/**
 * Get all managers for a project
 */
async function getProjectManagers(projectId: string): Promise<ProjectManagerInfo[]> {
	const managers = await db
		.select({
			userId: user.id,
			employeeId: employee.id,
			name: user.name,
		})
		.from(projectManager)
		.innerJoin(employee, eq(projectManager.employeeId, employee.id))
		.innerJoin(user, eq(employee.userId, user.id))
		.where(eq(projectManager.projectId, projectId));

	return managers;
}

/**
 * Get all active projects with deadlines for deadline checking
 */
export async function getProjectsWithUpcomingDeadlines(): Promise<
	Array<{
		id: string;
		name: string;
		organizationId: string;
		deadline: Date;
	}>
> {
	const bookableStatuses = ["planned", "active", "paused"];

	const projects = await db.query.project.findMany({
		where: and(notInArray(project.status, ["completed", "archived"])),
		columns: {
			id: true,
			name: true,
			organizationId: true,
			deadline: true,
			status: true,
		},
	});

	// Filter to only include projects with deadlines and bookable status
	return projects
		.filter((p) => p.deadline !== null && bookableStatuses.includes(p.status))
		.map((p) => ({
			id: p.id,
			name: p.name,
			organizationId: p.organizationId,
			deadline: p.deadline!,
		}));
}

/**
 * Calculate total hours booked to a project
 */
export async function getProjectTotalHours(projectId: string): Promise<number> {
	const { workPeriod } = await import("@/db/schema");
	const { eq, sql } = await import("drizzle-orm");

	const result = await db
		.select({
			totalMinutes: sql<number>`COALESCE(SUM(${workPeriod.durationMinutes}), 0)`,
		})
		.from(workPeriod)
		.where(eq(workPeriod.projectId, projectId));

	const totalMinutes = result[0]?.totalMinutes ?? 0;
	return totalMinutes / 60;
}
