"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { project, timeEntry, workPeriod } from "@/db/schema";
import {
	checkProjectBudgetWarnings,
	getProjectTotalHours,
} from "@/lib/notifications/project-notification-triggers";
import { calculateHash } from "@/lib/time-tracking/blockchain";
import { isProjectEligible, listEligibleProjects } from "@/lib/time-tracking/project-eligibility";
import type { TimeEntryTimezoneSource } from "@/lib/time-tracking/timezone-capture";
import { getRequestMetadata } from "./auth";
import { BOOKABLE_PROJECT_STATUSES } from "./shared";

type TimeEntryDbClient = Pick<typeof db, "insert" | "select">;
type TimeEntryUpdateDbClient = Pick<typeof db, "update">;

export async function createTimeEntry(
	params: {
		employeeId: string;
		organizationId: string;
		type: "clock_in" | "clock_out" | "correction";
		timestamp: Date;
		createdBy: string;
		utcOffsetMinutes: number;
		timezone: string;
		timezoneSource: TimeEntryTimezoneSource;
		replacesEntryId?: string;
		notes?: string;
		location?: string;
		isSuperseded?: boolean;
		chainAfter?: Pick<
			typeof timeEntry.$inferSelect,
			"id" | "hash" | "employeeId" | "organizationId"
		>;
	},
	client: TimeEntryDbClient = db,
): Promise<typeof timeEntry.$inferSelect> {
	const {
		employeeId,
		organizationId,
		type,
		timestamp,
		createdBy,
		utcOffsetMinutes,
		timezone,
		timezoneSource,
		replacesEntryId,
		notes,
		location,
		isSuperseded,
		chainAfter,
	} = params;

	if (
		chainAfter &&
		(chainAfter.employeeId !== employeeId || chainAfter.organizationId !== organizationId)
	) {
		throw new Error(
			"Time entry chain predecessor must belong to the same employee and organization",
		);
	}

	const [previousEntry, { ipAddress, userAgent }] = await Promise.all([
		chainAfter ??
			client
				.select()
				.from(timeEntry)
				.where(
					and(eq(timeEntry.employeeId, employeeId), eq(timeEntry.organizationId, organizationId)),
				)
				.orderBy(desc(timeEntry.createdAt))
				.limit(1)
				.then(([entry]) => entry),
		getRequestMetadata(),
	]);
	const previousHash = previousEntry?.hash || null;
	const hash = calculateHash({
		employeeId,
		type,
		timestamp: timestamp.toISOString(),
		previousHash,
	});

	const [entry] = await client
		.insert(timeEntry)
		.values({
			employeeId,
			organizationId,
			type,
			timestamp,
			hash,
			previousHash,
			previousEntryId: previousEntry?.id ?? null,
			ipAddress,
			deviceInfo: userAgent,
			createdBy,
			utcOffsetMinutes,
			timezone,
			timezoneSource,
			replacesEntryId,
			notes,
			location,
			...(isSuperseded === undefined ? {} : { isSuperseded }),
		})
		.returning();

	return entry;
}

export async function markTimeEntrySuperseded(
	entryId: string,
	supersededById: string,
	client: TimeEntryUpdateDbClient = db,
): Promise<void> {
	await client
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
	organizationId: string,
	/** A protected operation passes its transaction; defaults to the global client. */
	reader: Pick<typeof db, "query" | "select"> = db,
): Promise<{ isValid: boolean; error?: string }> {
	// Validity is the shared eligibility rule; the reads below only explain a refusal.
	if (await isProjectEligible({ employeeId, teamId, organizationId }, projectId, reader)) {
		return { isValid: true };
	}

	const assignedProject = await reader.query.project.findFirst({
		where: and(eq(project.id, projectId), eq(project.organizationId, organizationId)),
	});

	if (!assignedProject) {
		return { isValid: false, error: "Project not found" };
	}

	if (!assignedProject.isActive) {
		return { isValid: false, error: "Cannot book time to an inactive project" };
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

	return {
		isValid: false,
		error: "You are not assigned to this project. Contact your administrator.",
	};
}

/** Eligible projects (`listEligibleProjects`) with their booked hours in the organization. */
export async function getAssignedProjectsWithHours(
	employeeId: string,
	organizationId: string,
	teamId: string | null,
) {
	const eligible = await listEligibleProjects({ employeeId, teamId, organizationId });
	const projectsById = new Map(eligible.map((row) => [row.id, row]));

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
		where: and(eq(project.id, projectId), eq(project.organizationId, organizationId)),
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

	const totalHours = await getProjectTotalHours(projectId, organizationId);

	await checkProjectBudgetWarnings({
		projectId,
		projectName: assignedProject.name,
		organizationId,
		budgetHours,
		usedHours: totalHours,
	});
}
