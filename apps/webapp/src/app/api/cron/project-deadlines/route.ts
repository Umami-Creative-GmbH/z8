/**
 * Project Deadline Warning Cron Endpoint
 *
 * Daily job that checks all projects with upcoming deadlines
 * and sends warning notifications to project managers.
 *
 * Thresholds: 14 days, 7 days, 1 day, due today, overdue
 */

import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { createLogger } from "@/lib/logger";
import {
	checkProjectDeadlineWarnings,
	getProjectsWithUpcomingDeadlines,
} from "@/lib/notifications/project-notification-triggers";

const logger = createLogger("cron-project-deadlines");

// Secret for cron job authentication
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Verify the request is from a valid cron source
 */
async function verifyCronAuth(request: NextRequest): Promise<boolean> {
	// Check for Vercel Cron header
	const headersList = await headers();
	const authHeader = headersList.get("authorization");

	if (authHeader === `Bearer ${CRON_SECRET}`) {
		return true;
	}

	// Check for cron secret in query params (for external schedulers)
	const { searchParams } = new URL(request.url);
	const secret = searchParams.get("secret");

	if (secret === CRON_SECRET) {
		return true;
	}

	// In development, allow without auth
	if (process.env.NODE_ENV === "development") {
		logger.warn("Allowing cron request without auth in development");
		return true;
	}

	return false;
}

/**
 * GET /api/cron/project-deadlines
 *
 * Checks all projects with deadlines and sends warning notifications
 */
export async function GET(request: NextRequest) {
	await connection();
	const isAuthorized = await verifyCronAuth(request);

	if (!isAuthorized) {
		logger.warn("Unauthorized cron request");
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	logger.info("Starting project deadline check cron job");

	try {
		// Get all projects with deadlines
		const projects = await getProjectsWithUpcomingDeadlines();

		logger.info({ projectCount: projects.length }, "Found projects with deadlines to check");

		const now = new Date();
		now.setHours(0, 0, 0, 0); // Start of today

		const results = {
			projectsChecked: 0,
			notificationsSent: 0,
			errors: [] as string[],
		};

		// Check each project
		for (const project of projects) {
			try {
				// Calculate days until deadline
				const deadline = new Date(project.deadline);
				deadline.setHours(0, 0, 0, 0); // Normalize to start of day

				const diffMs = deadline.getTime() - now.getTime();
				const daysUntilDeadline = Math.floor(diffMs / (1000 * 60 * 60 * 24));

				// Only check if within notification range (14 days before to overdue)
				if (daysUntilDeadline <= 14) {
					await checkProjectDeadlineWarnings({
						projectId: project.id,
						projectName: project.name,
						organizationId: project.organizationId,
						deadline: project.deadline,
						daysUntilDeadline,
					});

					results.notificationsSent++;
				}

				results.projectsChecked++;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error";
				logger.error(
					{ error: errorMessage, projectId: project.id },
					"Failed to check deadline for project",
				);
				results.errors.push(`Project ${project.id}: ${errorMessage}`);
			}
		}

		logger.info(results, "Project deadline check cron job completed");

		return NextResponse.json({
			success: true,
			timestamp: new Date().toISOString(),
			results,
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ error: errorMessage }, "Project deadline check cron job failed");

		return NextResponse.json(
			{
				success: false,
				error: errorMessage,
				timestamp: new Date().toISOString(),
			},
			{ status: 500 },
		);
	}
}
