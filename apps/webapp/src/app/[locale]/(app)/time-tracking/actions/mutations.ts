"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { timeEntry, workPeriod } from "@/db/schema";
import type { ServerActionResult } from "@/lib/effect/result";
import { validateTimeEntryRange } from "@/lib/time-tracking/validation";
import { getCurrentEmployee, getCurrentSession } from "./auth";
import { createTimeEntry, validateProjectAssignment } from "./entry-helpers";
import { logger } from "./shared";
import { calculateDurationMinutes, setTimeOnStoredDate } from "./time-utils";

export async function updateWorkPeriodNotes(
	workPeriodId: string,
	notes: string,
): Promise<ServerActionResult<{ workPeriodId: string }>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		const [selectedWorkPeriod] = await db
			.select()
			.from(workPeriod)
			.where(eq(workPeriod.id, workPeriodId))
			.limit(1);

		if (!selectedWorkPeriod) {
			return { success: false, error: "Work period not found" };
		}

		if (selectedWorkPeriod.employeeId !== currentEmployee.id) {
			return { success: false, error: "You can only update your own work periods" };
		}

		if (!selectedWorkPeriod.clockOutId) {
			return { success: false, error: "Cannot add notes to an active work period" };
		}

		await db
			.update(timeEntry)
			.set({ notes })
			.where(eq(timeEntry.id, selectedWorkPeriod.clockOutId));
		return { success: true, data: { workPeriodId } };
	} catch (error) {
		logger.error({ error }, "Update work period notes error");
		return { success: false, error: "Failed to update notes. Please try again." };
	}
}

export async function deleteWorkPeriod(
	workPeriodId: string,
): Promise<ServerActionResult<{ deleted: boolean }>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		const [selectedWorkPeriod] = await db
			.select()
			.from(workPeriod)
			.where(eq(workPeriod.id, workPeriodId))
			.limit(1);

		if (!selectedWorkPeriod) {
			return { success: false, error: "Work period not found" };
		}

		if (selectedWorkPeriod.employeeId !== currentEmployee.id) {
			return { success: false, error: "You can only delete your own work periods" };
		}

		if (!selectedWorkPeriod.endTime || !selectedWorkPeriod.clockOutId) {
			return {
				success: false,
				error: "Cannot delete an active work period. Please clock out first.",
			};
		}

		const deletionNote = `[Deleted - converted to break by ${session.user.name || session.user.email}]`;
		await db
			.update(timeEntry)
			.set({ isSuperseded: true, notes: deletionNote })
			.where(eq(timeEntry.id, selectedWorkPeriod.clockInId));
		await db
			.update(timeEntry)
			.set({ isSuperseded: true, notes: deletionNote })
			.where(eq(timeEntry.id, selectedWorkPeriod.clockOutId));
		await db.delete(workPeriod).where(eq(workPeriod.id, workPeriodId));

		logger.info(
			{
				workPeriodId,
				employeeId: currentEmployee.id,
				deletedBy: session.user.id,
			},
			"Work period deleted (converted to break)",
		);

		return { success: true, data: { deleted: true } };
	} catch (error) {
		logger.error({ error }, "Delete work period error");
		return { success: false, error: "Failed to delete work period. Please try again." };
	}
}

export async function splitWorkPeriod(
	workPeriodId: string,
	splitTime: string,
	beforeNotes?: string,
	afterNotes?: string,
): Promise<ServerActionResult<{ firstPeriodId: string; secondPeriodId: string }>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		const [selectedWorkPeriod] = await db
			.select()
			.from(workPeriod)
			.where(eq(workPeriod.id, workPeriodId))
			.limit(1);

		if (!selectedWorkPeriod) {
			return { success: false, error: "Work period not found" };
		}

		if (selectedWorkPeriod.employeeId !== currentEmployee.id) {
			return { success: false, error: "You can only split your own work periods" };
		}

		if (!selectedWorkPeriod.endTime || !selectedWorkPeriod.clockOutId) {
			return { success: false, error: "Cannot split an active work period" };
		}

		const splitDate = setTimeOnStoredDate(selectedWorkPeriod.startTime, splitTime);
		if (!splitDate) {
			return { success: false, error: "Invalid split time" };
		}

		if (splitDate <= selectedWorkPeriod.startTime || splitDate >= selectedWorkPeriod.endTime) {
			return {
				success: false,
				error: "Split time must be between work period start and end times",
			};
		}

		const validation = await validateTimeEntryRange(
			currentEmployee.organizationId,
			selectedWorkPeriod.startTime,
			selectedWorkPeriod.endTime,
		);
		if (!validation.isValid) {
			return {
				success: false,
				error: validation.error || "Cannot split work period",
				holidayName: validation.holidayName,
			};
		}

		const firstClockOut = await createTimeEntry({
			employeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			type: "clock_out",
			timestamp: splitDate,
			createdBy: session.user.id,
			notes: beforeNotes,
		});
		const secondClockIn = await createTimeEntry({
			employeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			type: "clock_in",
			timestamp: splitDate,
			createdBy: session.user.id,
			notes: afterNotes,
		});

		if (beforeNotes && selectedWorkPeriod.clockOutId) {
			await db
				.update(timeEntry)
				.set({ isSuperseded: true, supersededById: firstClockOut.id })
				.where(eq(timeEntry.id, selectedWorkPeriod.clockOutId));
		}

		await db
			.update(workPeriod)
			.set({
				clockOutId: firstClockOut.id,
				endTime: splitDate,
				durationMinutes: calculateDurationMinutes(selectedWorkPeriod.startTime, splitDate),
				updatedAt: new Date(),
			})
			.where(eq(workPeriod.id, selectedWorkPeriod.id));

		const [secondWorkPeriod] = await db
			.insert(workPeriod)
			.values({
				employeeId: currentEmployee.id,
				organizationId: currentEmployee.organizationId,
				clockInId: secondClockIn.id,
				clockOutId: selectedWorkPeriod.clockOutId,
				startTime: splitDate,
				endTime: selectedWorkPeriod.endTime,
				durationMinutes: calculateDurationMinutes(splitDate, selectedWorkPeriod.endTime),
				isActive: false,
			})
			.returning();

		if (afterNotes && selectedWorkPeriod.clockOutId) {
			await db
				.update(timeEntry)
				.set({ notes: afterNotes })
				.where(eq(timeEntry.id, selectedWorkPeriod.clockOutId));
		}

		logger.info(
			{
				originalPeriodId: workPeriodId,
				firstPeriodId: selectedWorkPeriod.id,
				secondPeriodId: secondWorkPeriod.id,
				splitTime,
			},
			"Work period split successfully",
		);

		return {
			success: true,
			data: { firstPeriodId: selectedWorkPeriod.id, secondPeriodId: secondWorkPeriod.id },
		};
	} catch (error) {
		logger.error({ error }, "Split work period error");
		return { success: false, error: "Failed to split work period. Please try again." };
	}
}

export async function updateTimeEntryNotes(
	entryId: string,
	notes: string,
): Promise<ServerActionResult<{ entryId: string }>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		const [selectedEntry] = await db
			.select()
			.from(timeEntry)
			.where(eq(timeEntry.id, entryId))
			.limit(1);

		if (!selectedEntry) {
			return { success: false, error: "Time entry not found" };
		}

		if (selectedEntry.employeeId !== currentEmployee.id) {
			return { success: false, error: "You can only update your own time entries" };
		}

		await db.update(timeEntry).set({ notes }).where(eq(timeEntry.id, entryId));
		return { success: true, data: { entryId } };
	} catch (error) {
		logger.error({ error }, "Update time entry notes error");
		return { success: false, error: "Failed to update notes. Please try again." };
	}
}

export async function updateWorkPeriodProject(
	workPeriodId: string,
	projectId: string | null,
): Promise<ServerActionResult<{ workPeriodId: string; projectId: string | null }>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		const [selectedWorkPeriod] = await db
			.select()
			.from(workPeriod)
			.where(eq(workPeriod.id, workPeriodId))
			.limit(1);

		if (!selectedWorkPeriod) {
			return { success: false, error: "Work period not found" };
		}

		if (selectedWorkPeriod.employeeId !== currentEmployee.id) {
			return { success: false, error: "You can only update your own work periods" };
		}

		if (projectId) {
			const projectValidation = await validateProjectAssignment(
				projectId,
				currentEmployee.id,
				currentEmployee.teamId,
			);
			if (!projectValidation.isValid) {
				return {
					success: false,
					error: projectValidation.error || "Cannot assign to this project",
				};
			}
		}

		await db
			.update(workPeriod)
			.set({
				projectId,
				updatedAt: new Date(),
			})
			.where(eq(workPeriod.id, workPeriodId));

		return { success: true, data: { workPeriodId, projectId } };
	} catch (error) {
		logger.error({ error }, "Failed to update work period project");
		return { success: false, error: "Failed to update project assignment" };
	}
}
