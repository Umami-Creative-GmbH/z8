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
import {
	type Clock,
	instantFromDate,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { daysUntilProjectDeadline } from "@/lib/projects/project-deadline-days";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { type NotificationCopy, translatedContent } from "./notification-copy";
import { notificationParam } from "./notification-params";
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
export async function checkProjectBudgetWarnings(
	params: BudgetWarningParams,
	options: { throwOnError?: boolean } = {},
): Promise<void> {
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
		const notifiedThresholdSet = new Set(notifiedThresholds);

		// Find thresholds that haven't been notified yet
		const newThresholds = crossedThresholds.filter((t) => !notifiedThresholdSet.has(t));

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

		const i18nParams = {
			projectName: params.projectName,
			percent: Math.round(percentUsed),
			used: notificationParam.duration(Math.round(params.usedHours * 60)),
			budget: notificationParam.duration(Math.round(params.budgetHours * 60)),
		};

		await Promise.all(
			newThresholds.map(async (threshold) => {
				const notificationType = BUDGET_NOTIFICATION_TYPES[threshold];
				const content = translatedContent(BUDGET_WARNING_COPY[threshold], i18nParams);

				await Promise.all(
					managers.map((manager) =>
						createNotification(
							{
								userId: manager.userId,
								organizationId: params.organizationId,
								type: notificationType,
								title: content.title,
								message: content.message,
								entityType: "project",
								entityId: params.projectId,
								actionUrl: "/settings/projects",
								metadata: {
									projectName: params.projectName,
									threshold,
									usedHours: params.usedHours,
									budgetHours: params.budgetHours,
									percentUsed: Math.round(percentUsed),
									i18n: content.i18n,
								},
							},
							options,
						),
					),
				);
			}),
		);

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
		if (options.throwOnError) throw error;
	}
}

/** Hours are typed durations, so every channel formats them in the recipient's language. */
const BUDGET_WARNING_COPY: Record<BudgetThreshold, NotificationCopy> = {
	70: {
		titleKey: "common:notifications.content.projectBudgetWarning70.title",
		titleDefault: "Project approaching budget limit",
		messageKey: "common:notifications.content.projectBudgetWarning70.message",
		messageDefault: '"{projectName}" has used {percent}% of its budget ({used} of {budget}).',
	},
	90: {
		titleKey: "common:notifications.content.projectBudgetWarning90.title",
		titleDefault: "Project near budget limit",
		messageKey: "common:notifications.content.projectBudgetWarning90.message",
		messageDefault:
			'"{projectName}" has used {percent}% of its budget ({used} of {budget}). Consider reviewing time allocations.',
	},
	100: {
		titleKey: "common:notifications.content.projectBudgetWarning100.title",
		titleDefault: "Project budget exceeded",
		messageKey: "common:notifications.content.projectBudgetWarning100.message",
		messageDefault:
			'"{projectName}" has exceeded its budget ({used} of {budget} budgeted). Review and adjust as needed.',
	},
};

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
		const content = translatedContent(DEADLINE_WARNING_COPY[matchedThreshold], {
			projectName: params.projectName,
			// The deadline day is stored as its UTC midnight.
			deadline: notificationParam.plainDate(
				plainDateAt(instantFromDate(params.deadline), "UTC"),
				"dateMedium",
			),
		});

		await Promise.all(
			managers.map((manager) =>
				createNotification({
					userId: manager.userId,
					organizationId: params.organizationId,
					type: notificationType,
					title: content.title,
					message: content.message,
					entityType: "project",
					entityId: params.projectId,
					actionUrl: "/settings/projects",
					metadata: {
						projectName: params.projectName,
						deadline: params.deadline.toISOString(),
						daysUntilDeadline: params.daysUntilDeadline,
						threshold: matchedThreshold,
						i18n: content.i18n,
					},
				}),
			),
		);

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

const DEADLINE_WARNING_COPY: Record<DeadlineThreshold, NotificationCopy> = {
	14: {
		titleKey: "common:notifications.content.projectDeadlineWarning14d.title",
		titleDefault: "Project deadline in 2 weeks",
		messageKey: "common:notifications.content.projectDeadlineWarning14d.message",
		messageDefault:
			'"{projectName}" deadline is in 2 weeks ({deadline}). Plan ahead to meet the deadline.',
	},
	7: {
		titleKey: "common:notifications.content.projectDeadlineWarning7d.title",
		titleDefault: "Project deadline in 1 week",
		messageKey: "common:notifications.content.projectDeadlineWarning7d.message",
		messageDefault:
			"\"{projectName}\" deadline is in 1 week ({deadline}). Make sure you're on track.",
	},
	1: {
		titleKey: "common:notifications.content.projectDeadlineWarning1d.title",
		titleDefault: "Project deadline tomorrow",
		messageKey: "common:notifications.content.projectDeadlineWarning1d.message",
		messageDefault: '"{projectName}" deadline is tomorrow ({deadline}). Final push to complete!',
	},
	0: {
		titleKey: "common:notifications.content.projectDeadlineWarning0d.title",
		titleDefault: "Project deadline today",
		messageKey: "common:notifications.content.projectDeadlineWarning0d.message",
		messageDefault: '"{projectName}" deadline is today ({deadline}). Wrap up remaining work.',
	},
	"-1": {
		titleKey: "common:notifications.content.projectDeadlineOverdue.title",
		titleDefault: "Project deadline overdue",
		messageKey: "common:notifications.content.projectDeadlineOverdue.message",
		messageDefault:
			'"{projectName}" is past its deadline ({deadline}). Update status or extend the deadline.',
	},
};

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
	return projects.flatMap((p) =>
		p.deadline !== null && bookableStatuses.includes(p.status)
			? [
					{
						id: p.id,
						name: p.name,
						organizationId: p.organizationId,
						deadline: p.deadline,
					},
				]
			: [],
	);
}

/**
 * Calculate total hours booked to a project
 */
export async function getProjectTotalHours(
	projectId: string,
	organizationId: string,
): Promise<number> {
	const [schema, drizzle, completedWork] = await Promise.all([
		import("@/db/schema"),
		import("drizzle-orm"),
		import("@/lib/reports/completed-work"),
	]);
	const { workPeriod } = schema;
	const { and, eq, sql } = drizzle;

	const result = await db
		.select({
			totalMinutes: sql<number>`COALESCE(SUM(${workPeriod.durationMinutes}), 0)`,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.projectId, projectId),
				eq(workPeriod.organizationId, organizationId),
				// Completed work only, as the project report counts it (#794).
				completedWork.completedWorkPeriodCondition(),
			),
		);

	const totalMinutes = result[0]?.totalMinutes ?? 0;
	return totalMinutes / 60;
}

// =============================================================================
// Cron Job Runner for Deadline Notifications
// =============================================================================

/**
 * Check and send deadline notifications for all projects.
 * Called by cron job to process all projects with upcoming deadlines.
 *
 * @returns Summary of processed projects
 */
export async function checkAndSendDeadlineNotifications(clock: Clock = systemClock): Promise<{
	checked: number;
	notificationsSent: number;
}> {
	const projects = await getProjectsWithUpcomingDeadlines();
	let notificationsSent = 0;

	const now = clock.nowInstant();
	// Today is the organization's calendar date, as in the project reports.
	const timeZones = new Map<string, Promise<string>>();
	const organizationTimeZone = (organizationId: string) => {
		let timeZone = timeZones.get(organizationId);
		if (!timeZone) {
			timeZone = loadOrganizationTimezone(db, organizationId);
			timeZones.set(organizationId, timeZone);
		}
		return timeZone;
	};

	const results = await Promise.all(
		projects.map(async (project) => {
			try {
				const daysUntilDeadline = daysUntilProjectDeadline({
					deadline: project.deadline,
					now,
					timeZone: await organizationTimeZone(project.organizationId),
				});

				await checkProjectDeadlineWarnings({
					projectId: project.id,
					projectName: project.name,
					organizationId: project.organizationId,
					deadline: project.deadline,
					daysUntilDeadline,
				});
				// Note: We don't track exactly how many were sent since checkProjectDeadlineWarnings
				// is fire-and-forget. We increment optimistically for projects that had deadlines processed.
				return true;
			} catch (error) {
				logger.error({ error, projectId: project.id }, "Failed to check deadline for project");
				return false;
			}
		}),
	);
	notificationsSent = results.filter(Boolean).length;

	logger.info(
		{ checked: projects.length, notificationsSent },
		"Deadline notification check complete",
	);

	return {
		checked: projects.length,
		notificationsSent,
	};
}
