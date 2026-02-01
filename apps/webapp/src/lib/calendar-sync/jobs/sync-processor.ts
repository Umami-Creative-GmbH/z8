/**
 * Calendar Sync Job Processor
 *
 * Processes background jobs for syncing absences to external calendars.
 * Triggered when an absence is approved, updated, or cancelled.
 */

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { absenceCategory, absenceEntry, calendarConnection, employee, syncedAbsence } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { CalendarSyncJobData, JobResult } from "@/lib/queue";
import { mapAbsenceToCalendarEvent } from "../domain";
import { getCalendarProvider, isTokenExpired } from "../providers";

const logger = createLogger("CalendarSyncProcessor");

// ============================================
// JOB PROCESSOR
// ============================================

/**
 * Process a calendar sync job
 */
export async function processCalendarSyncJob(data: CalendarSyncJobData): Promise<JobResult> {
	const { absenceId, employeeId, action } = data;

	logger.info({ absenceId, employeeId, action }, "Processing calendar sync job");

	try {
		// Get calendar connection for the employee
		const connection = await db.query.calendarConnection.findFirst({
			where: and(
				eq(calendarConnection.employeeId, employeeId),
				eq(calendarConnection.isActive, true),
				eq(calendarConnection.pushEnabled, true),
			),
		});

		if (!connection) {
			return {
				success: true,
				message: "No calendar connection found, skipping sync",
			};
		}

		// Handle different actions
		switch (action) {
			case "create":
				return await handleCreate(absenceId, connection);
			case "update":
				return await handleUpdate(absenceId, connection);
			case "delete":
				return await handleDelete(absenceId, connection);
			default:
				return {
					success: false,
					error: `Unknown action: ${action}`,
				};
		}
	} catch (error) {
		logger.error({ absenceId, employeeId, action, error }, "Calendar sync job failed");
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
		};
	}
}

// ============================================
// ACTION HANDLERS
// ============================================

async function handleCreate(
	absenceId: string,
	connection: typeof calendarConnection.$inferSelect,
): Promise<JobResult> {
	// Get absence with category and employee details
	const absence = await db
		.select({
			absence: absenceEntry,
			category: absenceCategory,
			employee: employee,
			user: user,
		})
		.from(absenceEntry)
		.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
		.innerJoin(employee, eq(absenceEntry.employeeId, employee.id))
		.innerJoin(user, eq(employee.userId, user.id))
		.where(eq(absenceEntry.id, absenceId))
		.limit(1)
		.then((rows) => rows[0]);

	if (!absence) {
		return {
			success: false,
			error: "Absence not found",
		};
	}

	// Check if already synced
	const existingSync = await db.query.syncedAbsence.findFirst({
		where: and(
			eq(syncedAbsence.absenceEntryId, absenceId),
			eq(syncedAbsence.calendarConnectionId, connection.id),
		),
	});

	if (existingSync && existingSync.syncStatus === "synced") {
		return {
			success: true,
			message: "Already synced",
		};
	}

	// Ensure tokens are valid
	const credentials = await ensureValidCredentials(connection);
	if (!credentials) {
		return {
			success: false,
			error: "Failed to refresh tokens",
		};
	}

	// Map absence to calendar event
	const eventToCreate = mapAbsenceToCalendarEvent(
		{
			id: absence.absence.id,
			employeeId: absence.absence.employeeId,
			startDate: absence.absence.startDate,
			startPeriod: absence.absence.startPeriod,
			endDate: absence.absence.endDate,
			endPeriod: absence.absence.endPeriod,
			status: absence.absence.status as "pending" | "approved" | "rejected",
			notes: absence.absence.notes,
			category: {
				id: absence.category.id,
				name: absence.category.name,
				type: absence.category.type,
				color: absence.category.color,
				countsAgainstVacation: absence.category.countsAgainstVacation,
			},
			approvedBy: absence.absence.approvedBy,
			approvedAt: absence.absence.approvedAt,
			rejectionReason: absence.absence.rejectionReason,
			createdAt: absence.absence.createdAt,
		},
		{
			organizationId: connection.organizationId,
			employeeName: absence.user.name,
		},
	);

	// Create event in external calendar
	const provider = getCalendarProvider(connection.provider);
	const createEffect = provider.createEvent(
		credentials,
		connection.calendarId,
		eventToCreate,
	);

	const result = await Effect.runPromise(createEffect);

	// Record sync in database
	if (existingSync) {
		await db
			.update(syncedAbsence)
			.set({
				externalEventId: result.id,
				externalEventEtag: result.etag,
				syncStatus: "synced",
				lastAction: "create",
				lastSyncedAt: new Date(),
				syncError: null,
				updatedAt: new Date(),
			})
			.where(eq(syncedAbsence.id, existingSync.id));
	} else {
		await db.insert(syncedAbsence).values({
			absenceEntryId: absenceId,
			calendarConnectionId: connection.id,
			externalEventId: result.id,
			externalCalendarId: connection.calendarId,
			externalEventEtag: result.etag,
			syncStatus: "synced",
			lastAction: "create",
			lastSyncedAt: new Date(),
			updatedAt: new Date(),
		});
	}

	// Update connection last sync time
	await db
		.update(calendarConnection)
		.set({
			lastSyncAt: new Date(),
			lastSyncError: null,
			consecutiveFailures: 0,
		})
		.where(eq(calendarConnection.id, connection.id));

	logger.info(
		{ absenceId, externalEventId: result.id, provider: connection.provider },
		"Created calendar event",
	);

	return {
		success: true,
		message: "Event created in external calendar",
		data: { externalEventId: result.id },
	};
}

async function handleUpdate(
	absenceId: string,
	connection: typeof calendarConnection.$inferSelect,
): Promise<JobResult> {
	// Get sync record
	const syncRecord = await db.query.syncedAbsence.findFirst({
		where: and(
			eq(syncedAbsence.absenceEntryId, absenceId),
			eq(syncedAbsence.calendarConnectionId, connection.id),
		),
	});

	if (!syncRecord || syncRecord.syncStatus === "deleted") {
		// No existing sync, create instead
		return handleCreate(absenceId, connection);
	}

	// Get updated absence
	const absence = await db
		.select({
			absence: absenceEntry,
			category: absenceCategory,
		})
		.from(absenceEntry)
		.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
		.where(eq(absenceEntry.id, absenceId))
		.limit(1)
		.then((rows) => rows[0]);

	if (!absence) {
		return {
			success: false,
			error: "Absence not found",
		};
	}

	// Ensure tokens are valid
	const credentials = await ensureValidCredentials(connection);
	if (!credentials) {
		return {
			success: false,
			error: "Failed to refresh tokens",
		};
	}

	// Update event in external calendar
	const provider = getCalendarProvider(connection.provider);
	const updateEffect = provider.updateEvent(credentials, connection.calendarId, {
		id: syncRecord.externalEventId,
		title: `Out of Office - ${absence.category.name}`,
		startDate: new Date(absence.absence.startDate),
		endDate: new Date(absence.absence.endDate),
		status: absence.absence.status === "rejected" ? "cancelled" : "confirmed",
	});

	await Effect.runPromise(updateEffect);

	// Update sync record
	await db
		.update(syncedAbsence)
		.set({
			lastAction: "update",
			lastSyncedAt: new Date(),
			syncError: null,
			updatedAt: new Date(),
		})
		.where(eq(syncedAbsence.id, syncRecord.id));

	// Update connection last sync time
	await db
		.update(calendarConnection)
		.set({
			lastSyncAt: new Date(),
			lastSyncError: null,
			consecutiveFailures: 0,
		})
		.where(eq(calendarConnection.id, connection.id));

	logger.info(
		{ absenceId, externalEventId: syncRecord.externalEventId, provider: connection.provider },
		"Updated calendar event",
	);

	return {
		success: true,
		message: "Event updated in external calendar",
	};
}

async function handleDelete(
	absenceId: string,
	connection: typeof calendarConnection.$inferSelect,
): Promise<JobResult> {
	// Get sync record
	const syncRecord = await db.query.syncedAbsence.findFirst({
		where: and(
			eq(syncedAbsence.absenceEntryId, absenceId),
			eq(syncedAbsence.calendarConnectionId, connection.id),
		),
	});

	if (!syncRecord || syncRecord.syncStatus === "deleted") {
		return {
			success: true,
			message: "No sync record found or already deleted",
		};
	}

	// Ensure tokens are valid
	const credentials = await ensureValidCredentials(connection);
	if (!credentials) {
		return {
			success: false,
			error: "Failed to refresh tokens",
		};
	}

	// Delete event from external calendar
	const provider = getCalendarProvider(connection.provider);
	const deleteEffect = provider.deleteEvent(
		credentials,
		connection.calendarId,
		syncRecord.externalEventId,
	);

	try {
		await Effect.runPromise(deleteEffect);
	} catch (error) {
		// If event not found, that's OK - it's already deleted
		if (!(error instanceof Error) || !error.message.includes("NOT_FOUND")) {
			throw error;
		}
	}

	// Update sync record
	await db
		.update(syncedAbsence)
		.set({
			syncStatus: "deleted",
			lastAction: "delete",
			lastSyncedAt: new Date(),
			syncError: null,
			updatedAt: new Date(),
		})
		.where(eq(syncedAbsence.id, syncRecord.id));

	logger.info(
		{ absenceId, externalEventId: syncRecord.externalEventId, provider: connection.provider },
		"Deleted calendar event",
	);

	return {
		success: true,
		message: "Event deleted from external calendar",
	};
}

// ============================================
// TOKEN MANAGEMENT
// ============================================

async function ensureValidCredentials(
	connection: typeof calendarConnection.$inferSelect,
): Promise<{
	accessToken: string;
	refreshToken: string | null;
	expiresAt: Date | null;
	scope: string | null;
} | null> {
	if (!isTokenExpired(connection.expiresAt)) {
		return {
			accessToken: connection.accessToken,
			refreshToken: connection.refreshToken,
			expiresAt: connection.expiresAt,
			scope: connection.scope,
		};
	}

	if (!connection.refreshToken) {
		logger.warn(
			{ connectionId: connection.id },
			"Token expired and no refresh token available",
		);
		return null;
	}

	try {
		const provider = getCalendarProvider(connection.provider);
		const refreshResult = await Effect.runPromise(
			provider.refreshAccessToken(connection.refreshToken),
		);

		// Update tokens in database
		await db
			.update(calendarConnection)
			.set({
				accessToken: refreshResult.accessToken,
				expiresAt: refreshResult.expiresAt,
				refreshToken: refreshResult.refreshToken ?? connection.refreshToken,
				updatedAt: new Date(),
			})
			.where(eq(calendarConnection.id, connection.id));

		return {
			accessToken: refreshResult.accessToken,
			refreshToken: refreshResult.refreshToken ?? connection.refreshToken,
			expiresAt: refreshResult.expiresAt,
			scope: connection.scope,
		};
	} catch (error) {
		logger.error({ connectionId: connection.id, error }, "Failed to refresh tokens");

		// Mark connection as having an error
		await db
			.update(calendarConnection)
			.set({
				lastSyncError: "Token refresh failed",
				consecutiveFailures: connection.consecutiveFailures + 1,
			})
			.where(eq(calendarConnection.id, connection.id));

		return null;
	}
}
