import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	absenceCategory,
	absenceEntry,
	calendarConnection,
	employee,
	syncedAbsence,
} from "@/db/schema";
import { generateZ8EventId } from "../providers/base";

const mocks = vi.hoisted(() => {
	const selectQuery = {
		from: vi.fn(),
		innerJoin: vi.fn(),
		where: vi.fn(),
		limit: vi.fn(),
	};

	return {
		calendarConnectionFindFirst: vi.fn(),
		createEvent: vi.fn(),
		dbInsert: vi.fn(),
		dbSelect: vi.fn(),
		dbUpdate: vi.fn(),
		getCalendarProvider: vi.fn(),
		getCalendarTokens: vi.fn(),
		insertValues: vi.fn(),
		isTokenExpired: vi.fn(),
		loggerError: vi.fn(),
		loggerInfo: vi.fn(),
		loggerWarn: vi.fn(),
		onConflictDoUpdate: vi.fn(),
		selectQuery,
		selectRows: [] as unknown[],
		storeCalendarTokens: vi.fn(),
		syncedAbsenceFindFirst: vi.fn(),
		updateSet: vi.fn(),
		updateWhere: vi.fn(),
	};
});

vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	and: vi.fn((...predicates: unknown[]) => ({ and: predicates })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			calendarConnection: { findFirst: mocks.calendarConnectionFindFirst },
			syncedAbsence: { findFirst: mocks.syncedAbsenceFindFirst },
		},
		insert: mocks.dbInsert,
		select: mocks.dbSelect,
		update: mocks.dbUpdate,
	},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: mocks.loggerError,
		info: mocks.loggerInfo,
		warn: mocks.loggerWarn,
	}),
}));

vi.mock("../providers", async () => {
	const { generateZ8EventId: actualGenerateZ8EventId } =
		await vi.importActual<typeof import("../providers/base")>("../providers/base");

	return {
		generateZ8EventId: actualGenerateZ8EventId,
		getCalendarProvider: mocks.getCalendarProvider,
		isTokenExpired: mocks.isTokenExpired,
	};
});

vi.mock("../token-store", () => ({
	getCalendarTokens: mocks.getCalendarTokens,
	storeCalendarTokens: mocks.storeCalendarTokens,
}));

import { processCalendarSyncJob } from "./sync-processor";

const job = {
	type: "calendar-sync" as const,
	organizationId: "org-1",
	employeeId: "employee-1",
	absenceId: "absence-1",
	action: "create" as const,
};

const connection = {
	id: "connection-1",
	organizationId: "org-1",
	employeeId: "employee-1",
	provider: "google" as const,
	calendarId: "calendar-1",
	accessToken: "vault:managed",
	refreshToken: "vault:managed",
	expiresAt: null,
	scope: null,
	isActive: true,
	pushEnabled: true,
	consecutiveFailures: 0,
};

const absenceRow = {
	absence: {
		id: "absence-1",
		organizationId: "org-1",
		employeeId: "employee-1",
		startDate: "2026-07-13",
		startPeriod: "full_day",
		endDate: "2026-07-14",
		endPeriod: "full_day",
		status: "approved",
		notes: null,
		sickDetail: null,
		approvedBy: "manager-1",
		approvedAt: new Date("2026-07-10T08:00:00.000Z"),
		rejectionReason: null,
		createdAt: new Date("2026-07-09T08:00:00.000Z"),
	},
	category: {
		id: "category-1",
		organizationId: "org-1",
		name: "Vacation",
		type: "vacation",
		color: "#2563eb",
		countsAgainstVacation: true,
	},
	employee: {
		id: "employee-1",
		organizationId: "org-1",
	},
	user: {
		name: "Ada Lovelace",
	},
};

describe("processCalendarSyncJob", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.selectRows = [];
		mocks.selectQuery.from.mockReturnValue(mocks.selectQuery);
		mocks.selectQuery.innerJoin.mockReturnValue(mocks.selectQuery);
		mocks.selectQuery.where.mockReturnValue(mocks.selectQuery);
		mocks.selectQuery.limit.mockImplementation(() => Promise.resolve(mocks.selectRows));
		mocks.dbSelect.mockReturnValue(mocks.selectQuery);
		mocks.dbInsert.mockReturnValue({ values: mocks.insertValues });
		mocks.insertValues.mockReturnValue({ onConflictDoUpdate: mocks.onConflictDoUpdate });
		mocks.onConflictDoUpdate.mockResolvedValue(undefined);
		mocks.dbUpdate.mockReturnValue({ set: mocks.updateSet });
		mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
		mocks.updateWhere.mockResolvedValue(undefined);
		mocks.syncedAbsenceFindFirst.mockResolvedValue(null);
		mocks.getCalendarTokens.mockResolvedValue({
			accessToken: "access-token",
			refreshToken: "refresh-token",
		});
		mocks.isTokenExpired.mockReturnValue(false);
		mocks.getCalendarProvider.mockReturnValue({ createEvent: mocks.createEvent });
		mocks.createEvent.mockReturnValue(Effect.succeed({ id: "external-event-1", etag: "etag-1" }));
	});

	it("scopes connection lookup and skips safely when no scoped connection exists", async () => {
		mocks.calendarConnectionFindFirst.mockResolvedValue(null);

		await expect(processCalendarSyncJob(job)).resolves.toEqual({
			success: true,
			message: "No calendar connection found, skipping sync",
		});

		expect(mocks.calendarConnectionFindFirst).toHaveBeenCalledWith({
			where: {
				and: [
					{ eq: [calendarConnection.organizationId, "org-1"] },
					{ eq: [calendarConnection.employeeId, "employee-1"] },
					{ eq: [calendarConnection.isActive, true] },
					{ eq: [calendarConnection.pushEnabled, true] },
				],
			},
		});
		expect(mocks.getCalendarTokens).not.toHaveBeenCalled();
		expect(mocks.getCalendarProvider).not.toHaveBeenCalled();
		expect(mocks.createEvent).not.toHaveBeenCalled();
		expect(mocks.loggerInfo).toHaveBeenCalledWith(
			{
				absenceId: "absence-1",
				action: "create",
				employeeId: "employee-1",
				organizationId: "org-1",
			},
			"Processing calendar sync job",
		);
	});

	it("rejects create when no fully tenant-scoped absence exists", async () => {
		mocks.calendarConnectionFindFirst.mockResolvedValue(connection);

		await expect(processCalendarSyncJob(job)).resolves.toEqual({
			success: false,
			error: "Absence not found",
		});

		expect(mocks.selectQuery.where).toHaveBeenCalledWith({
			and: [
				{ eq: [absenceEntry.id, "absence-1"] },
				{ eq: [absenceEntry.organizationId, "org-1"] },
				{ eq: [absenceEntry.employeeId, "employee-1"] },
				{ eq: [absenceCategory.organizationId, "org-1"] },
				{ eq: [employee.organizationId, "org-1"] },
			],
		});
		expect(eq).toHaveBeenCalledWith(absenceEntry.organizationId, "org-1");
		expect(and).toHaveBeenCalled();
		expect(mocks.getCalendarTokens).not.toHaveBeenCalled();
		expect(mocks.getCalendarProvider).not.toHaveBeenCalled();
		expect(mocks.createEvent).not.toHaveBeenCalled();
	});

	it("passes the deterministic organization-scoped key to provider create", async () => {
		mocks.calendarConnectionFindFirst.mockResolvedValue(connection);
		mocks.selectRows = [absenceRow];

		await expect(processCalendarSyncJob(job)).resolves.toEqual({
			success: true,
			message: "Event created in external calendar",
			data: { externalEventId: "external-event-1" },
		});

		expect(mocks.createEvent).toHaveBeenCalledWith(
			expect.objectContaining({ accessToken: "access-token" }),
			"calendar-1",
			expect.objectContaining({
				idempotencyKey: generateZ8EventId({
					organizationId: "org-1",
					calendarConnectionId: "connection-1",
					absenceId: "absence-1",
				}),
			}),
		);
	});

	it("upserts local sync state on the schema unique key", async () => {
		mocks.calendarConnectionFindFirst.mockResolvedValue(connection);
		mocks.selectRows = [absenceRow];

		await processCalendarSyncJob(job);

		expect(mocks.dbInsert).toHaveBeenCalledWith(syncedAbsence);
		const values = mocks.insertValues.mock.calls[0]?.[0];
		expect(values).toEqual({
			absenceEntryId: "absence-1",
			calendarConnectionId: "connection-1",
			externalEventId: "external-event-1",
			externalCalendarId: "calendar-1",
			externalEventEtag: "etag-1",
			syncStatus: "synced",
			lastAction: "create",
			lastSyncedAt: expect.any(Date),
			syncError: null,
			updatedAt: expect.any(Date),
		});
		expect(values.lastSyncedAt).toBe(values.updatedAt);

		const conflict = mocks.onConflictDoUpdate.mock.calls[0]?.[0];
		expect(conflict).toEqual({
			target: [syncedAbsence.absenceEntryId, syncedAbsence.calendarConnectionId],
			set: {
				externalEventId: "external-event-1",
				externalCalendarId: "calendar-1",
				externalEventEtag: "etag-1",
				syncStatus: "synced",
				lastAction: "create",
				lastSyncedAt: expect.any(Date),
				syncError: null,
				updatedAt: expect.any(Date),
			},
		});
		expect(conflict.set.lastSyncedAt).toBe(values.lastSyncedAt);
		expect(conflict.set.updatedAt).toBe(values.updatedAt);
	});

	it("scopes update absence lookup to the job organization and employee", async () => {
		mocks.calendarConnectionFindFirst.mockResolvedValue(connection);
		mocks.syncedAbsenceFindFirst.mockResolvedValue({
			id: "sync-1",
			externalEventId: "external-event-1",
			syncStatus: "synced",
		});

		await expect(processCalendarSyncJob({ ...job, action: "update" })).resolves.toEqual({
			success: false,
			error: "Absence not found",
		});

		expect(mocks.selectQuery.where).toHaveBeenCalledWith({
			and: [
				{ eq: [absenceEntry.id, "absence-1"] },
				{ eq: [absenceEntry.organizationId, "org-1"] },
				{ eq: [absenceEntry.employeeId, "employee-1"] },
				{ eq: [absenceCategory.organizationId, "org-1"] },
			],
		});
		expect(mocks.getCalendarTokens).not.toHaveBeenCalled();
		expect(mocks.getCalendarProvider).not.toHaveBeenCalled();
	});

	it("includes organization context in failure logs", async () => {
		const error = new Error("database unavailable");
		mocks.calendarConnectionFindFirst.mockRejectedValue(error);

		await expect(processCalendarSyncJob(job)).resolves.toEqual({
			success: false,
			error: "database unavailable",
		});
		expect(mocks.loggerError).toHaveBeenCalledWith(
			{
				absenceId: "absence-1",
				action: "create",
				employeeId: "employee-1",
				error,
				organizationId: "org-1",
			},
			"Calendar sync job failed",
		);
	});
});
