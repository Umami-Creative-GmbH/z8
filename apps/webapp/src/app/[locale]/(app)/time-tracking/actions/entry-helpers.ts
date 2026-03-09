"use server";

import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { project, projectAssignment, timeEntry, workPeriod } from "@/db/schema";
import {
	checkProjectBudgetWarnings,
	getProjectTotalHours,
} from "@/lib/notifications/project-notification-triggers";
import { calculateHash } from "@/lib/time-tracking/blockchain";
import { getRequestMetadata } from "./auth";
import { BOOKABLE_PROJECT_STATUSES } from "./shared";

export async function createTimeEntry(params: {
	employeeId: string;
	organizationId: string;
	type: "clock_in" | "clock_out" | "correction";
	timestamp: Date;
	createdBy: string;
	replacesEntryId?: string;
	notes?: string;
}): Promise<typeof timeEntry.$inferSelect> {
	const { employeeId, organizationId, type, timestamp, createdBy, replacesEntryId, notes } = params;

	const [previousEntry] = await db
		.select()
		.from(timeEntry)
		.where(and(eq(timeEntry.employeeId, employeeId), eq(timeEntry.organizationId, organizationId)))
		.orderBy(desc(timeEntry.createdAt))
		.limit(1);

	const { ipAddress, userAgent } = await getRequestMetadata();
	const previousHash = previousEntry?.hash || null;
	const hash = calculateHash({
		employeeId,
		type,
		timestamp: timestamp.toISOString(),
		previousHash,
	});

	const [entry] = await db
		.insert(timeEntry)
		.values({
			employeeId,
			organizationId,
			type,
			timestamp,
			hash,
			previousHash,
			ipAddress,
			deviceInfo: userAgent,
			createdBy,
			replacesEntryId,
			notes,
		})
		.returning();

	return entry;
}

export async function markTimeEntrySuperseded(
	entryId: string,
	supersededById: string,
): Promise<void> {
	await db
		.update(timeEntry)
		.set({
			isSuperseded: true,
			supersededById,
		})
		.where(eq(timeEntry.id, entryId));
}

export async function validateProjectAssignment(
	projectId: string,
	employeeId: string,
	teamId: string | null,
): Promise<{ isValid: boolean; error?: string }> {
	const assignedProject = await db.query.project.findFirst({
		where: eq(project.id, projectId),
	});

	if (!assignedProject) {
		return { isValid: false, error: "Project not found" };
	}

	if (
		!BOOKABLE_PROJECT_STATUSES.includes(
			assignedProject.status as (typeof BOOKABLE_PROJECT_STATUSES)[number],
		)
	) {
		return {
			isValid: false,
			error: `Cannot book time to ${assignedProject.status} projects. Project must be planned, active, or paused.`,
		};
	}

	const assignment = await db.query.projectAssignment.findFirst({
		where: teamId
			? or(
					and(
						eq(projectAssignment.projectId, projectId),
						eq(projectAssignment.employeeId, employeeId),
					),
					and(eq(projectAssignment.projectId, projectId), eq(projectAssignment.teamId, teamId)),
				)
			: and(
					eq(projectAssignment.projectId, projectId),
					eq(projectAssignment.employeeId, employeeId),
				),
	});

	if (!assignment) {
		return {
			isValid: false,
			error: "You are not assigned to this project. Contact your administrator.",
		};
	}

	return { isValid: true };
}

export async function getAssignedProjectsWithHours(
	employeeId: string,
	organizationId: string,
	teamId: string | null,
) {
	const [directAssignments, teamAssignments] = await Promise.all([
		db.query.projectAssignment.findMany({
			where: eq(projectAssignment.employeeId, employeeId),
			with: { project: true },
		}),
		teamId
			? db.query.projectAssignment.findMany({
					where: eq(projectAssignment.teamId, teamId),
					with: { project: true },
				})
			: Promise.resolve([]),
	]);

	const projectsById = new Map<
		string,
		{
			id: string;
			name: string;
			color: string | null;
			status: string;
			budgetHours: string | null;
			deadline: Date | null;
		}
	>();

	for (const assignment of [...directAssignments, ...teamAssignments]) {
		const assignedProject = assignment.project;
		if (
			assignedProject &&
			BOOKABLE_PROJECT_STATUSES.includes(
				assignedProject.status as (typeof BOOKABLE_PROJECT_STATUSES)[number],
			) &&
			!projectsById.has(assignedProject.id)
		) {
			projectsById.set(assignedProject.id, {
				id: assignedProject.id,
				name: assignedProject.name,
				color: assignedProject.color,
				status: assignedProject.status,
				budgetHours: assignedProject.budgetHours,
				deadline: assignedProject.deadline,
			});
		}
	}

	const projectIds = Array.from(projectsById.keys());
	const hoursByProjectId = new Map<string, number>();

	if (projectIds.length > 0) {
		const totalHoursByProject = await db
			.select({
				projectId: workPeriod.projectId,
				totalMinutes: sql<number>`COALESCE(SUM(${workPeriod.durationMinutes}), 0)`,
			})
			.from(workPeriod)
			.where(
				and(
					inArray(workPeriod.projectId, projectIds),
					eq(workPeriod.organizationId, organizationId),
				),
			)
			.groupBy(workPeriod.projectId);

		for (const row of totalHoursByProject) {
			if (row.projectId) {
				hoursByProjectId.set(row.projectId, row.totalMinutes / 60);
			}
		}
	}

	return { projectsById, hoursByProjectId };
}

export async function checkProjectBudgetAfterClockOut(
	projectId: string,
	organizationId: string,
): Promise<void> {
	const assignedProject = await db.query.project.findFirst({
		where: eq(project.id, projectId),
		columns: {
			id: true,
			name: true,
			budgetHours: true,
		},
	});

	if (!assignedProject?.budgetHours) {
		return;
	}

	const budgetHours = Number.parseFloat(assignedProject.budgetHours);
	if (Number.isNaN(budgetHours) || budgetHours <= 0) {
		return;
	}

	const totalHours = await getProjectTotalHours(projectId);

	await checkProjectBudgetWarnings({
		projectId,
		projectName: assignedProject.name,
		organizationId,
		budgetHours,
		usedHours: totalHours,
	});
}
