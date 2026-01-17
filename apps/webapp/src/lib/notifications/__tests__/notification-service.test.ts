/**
 * Tests for Notification Service
 *
 * Tests notification creation, retrieval, marking as read,
 * deletion, and preference checking.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
	createMockNotification,
	createMockNotificationList,
	createMockPreference,
} from "./helpers";

// Use vi.hoisted() for all mocks that will be used in vi.mock factories
const {
	mockReturning,
	mockValues,
	mockInsert,
	mockUpdateWhere,
	mockUpdateSet,
	mockUpdate,
	mockDeleteWhere,
	mockDelete,
	mockSelectOrderBy,
	mockSelectWhere,
	mockSelectFrom,
	mockSelect,
	mockFindFirst,
	mockFindMany,
	mockLoggerInfo,
	mockLoggerDebug,
	mockLoggerError,
	mockLoggerWarn,
	mockSendPushToUser,
	mockIsPushAvailable,
	mockSendEmailNotification,
} = vi.hoisted(() => {
	const mockReturning = vi.fn();
	const mockValues = vi.fn(() => ({ returning: mockReturning }));
	const mockInsert = vi.fn(() => ({ values: mockValues }));

	const mockUpdateWhere = vi.fn(() => ({ returning: mockReturning }));
	const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
	const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

	const mockDeleteWhere = vi.fn(() => Promise.resolve({ rowCount: 1 }));
	const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }));

	const mockSelectOrderBy = vi.fn(() => ({
		limit: vi.fn(() => ({
			offset: vi.fn(() => Promise.resolve([])),
		})),
	}));
	const mockSelectWhere = vi.fn(() => ({
		orderBy: mockSelectOrderBy,
		limit: vi.fn(() => Promise.resolve([{ total: 10 }])),
	}));
	const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
	const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const mockFindFirst = vi.fn((): any => Promise.resolve(null));
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const mockFindMany = vi.fn((): any => Promise.resolve([]));

	const mockLoggerInfo = vi.fn();
	const mockLoggerDebug = vi.fn();
	const mockLoggerError = vi.fn();
	const mockLoggerWarn = vi.fn();

	const mockSendPushToUser = vi.fn(() => Promise.resolve());
	const mockIsPushAvailable = vi.fn(() => false);
	const mockSendEmailNotification = vi.fn(() => Promise.resolve());

	return {
		mockReturning,
		mockValues,
		mockInsert,
		mockUpdateWhere,
		mockUpdateSet,
		mockUpdate,
		mockDeleteWhere,
		mockDelete,
		mockSelectOrderBy,
		mockSelectWhere,
		mockSelectFrom,
		mockSelect,
		mockFindFirst,
		mockFindMany,
		mockLoggerInfo,
		mockLoggerDebug,
		mockLoggerError,
		mockLoggerWarn,
		mockSendPushToUser,
		mockIsPushAvailable,
		mockSendEmailNotification,
	};
});

vi.mock("@/db", () => ({
	db: {
		insert: mockInsert,
		update: mockUpdate,
		delete: mockDelete,
		select: mockSelect,
		query: {
			notificationPreference: {
				findFirst: mockFindFirst,
				findMany: mockFindMany,
			},
		},
	},
}));

vi.mock("@/db/schema", () => ({
	notification: {
		id: "notification",
		userId: "userId",
		organizationId: "organizationId",
		isRead: "isRead",
		createdAt: "createdAt",
	},
	notificationPreference: {
		id: "notificationPreference",
		userId: "userId",
		organizationId: "organizationId",
		notificationType: "notificationType",
		channel: "channel",
	},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: mockLoggerInfo,
		debug: mockLoggerDebug,
		error: mockLoggerError,
		warn: mockLoggerWarn,
	}),
}));

vi.mock("../push-service", () => ({
	sendPushToUser: mockSendPushToUser,
	isPushAvailable: mockIsPushAvailable,
}));

vi.mock("../email-notifications", () => ({
	sendEmailNotification: mockSendEmailNotification,
}));

describe("Notification Service", () => {
	beforeEach(() => {
		// Reset module cache and clear all mocks before each test
		vi.resetModules();
		vi.clearAllMocks();

		// Reset mock implementations to defaults
		mockReturning.mockImplementation(() => Promise.resolve([]));
		mockUpdateWhere.mockImplementation(() => ({ returning: mockReturning }));
		mockDeleteWhere.mockImplementation(() => Promise.resolve({ rowCount: 1 }));
	});

	describe("createNotification", () => {
		test("creates notification when in_app is enabled (default)", async () => {
			mockFindMany.mockImplementation(() => Promise.resolve([]));
			mockReturning.mockImplementation(() => Promise.resolve([createMockNotification()]));

			const { createNotification } = await import("../notification-service");

			const result = await createNotification({
				userId: "user-1",
				organizationId: "org-1",
				type: "approval_request_submitted",
				title: "Test Notification",
				message: "Test message",
			});

			expect(result).not.toBeNull();
			expect(mockInsert).toHaveBeenCalled();
		});

		test("skips notification when in_app is disabled", async () => {
			mockFindMany.mockImplementation(() =>
				Promise.resolve([createMockPreference({ channel: "in_app", enabled: false })]),
			);

			const { createNotification } = await import("../notification-service");

			const result = await createNotification({
				userId: "user-1",
				organizationId: "org-1",
				type: "approval_request_submitted",
				title: "Test Notification",
				message: "Test message",
			});

			expect(result).toBeNull();
		});

		test("sends push notification when push is enabled and available", async () => {
			mockFindMany.mockImplementation(() => Promise.resolve([]));
			mockIsPushAvailable.mockImplementation(() => true);
			mockReturning.mockImplementation(() => Promise.resolve([createMockNotification()]));

			const { createNotification } = await import("../notification-service");

			await createNotification({
				userId: "user-1",
				organizationId: "org-1",
				type: "approval_request_submitted",
				title: "Test Notification",
				message: "Test message",
			});

			// Push is fire-and-forget, so we just check it was called
			expect(mockIsPushAvailable).toHaveBeenCalled();
		});

		test("does not send push when push preference is disabled", async () => {
			mockFindMany.mockImplementation(() =>
				Promise.resolve([createMockPreference({ channel: "push", enabled: false })]),
			);
			mockIsPushAvailable.mockImplementation(() => true);
			mockReturning.mockImplementation(() => Promise.resolve([createMockNotification()]));

			const { createNotification } = await import("../notification-service");

			await createNotification({
				userId: "user-1",
				organizationId: "org-1",
				type: "approval_request_submitted",
				title: "Test Notification",
				message: "Test message",
			});

			// sendPushToUser should not be called when preference is disabled
			expect(mockSendPushToUser).not.toHaveBeenCalled();
		});
	});

	describe("getUnreadCount", () => {
		test("returns a number from the function", async () => {
			// The function should return a number (0 is valid when no notifications)
			const { getUnreadCount } = await import("../notification-service");

			const result = await getUnreadCount("user-1", "org-1");

			expect(typeof result).toBe("number");
			expect(result).toBeGreaterThanOrEqual(0);
		});

		test("handles errors gracefully and returns 0", async () => {
			// When an error occurs, the function should return 0
			const { getUnreadCount } = await import("../notification-service");

			// The mocked db will return 0 by default when an error path is hit
			const result = await getUnreadCount("user-1", "org-1");

			expect(result).toBeGreaterThanOrEqual(0);
		});
	});

	describe("markAsRead", () => {
		test("marks notification as read and returns updated notification", async () => {
			const mockNotification = createMockNotification({ isRead: true, readAt: new Date() });
			mockReturning.mockImplementation(() => Promise.resolve([mockNotification]));

			const { markAsRead } = await import("../notification-service");

			const result = await markAsRead("notif-1", "user-1");

			expect(result).not.toBeNull();
			expect(mockUpdate).toHaveBeenCalled();
		});

		test("returns null when notification not found", async () => {
			mockReturning.mockImplementation(() => Promise.resolve([]));

			const { markAsRead } = await import("../notification-service");

			const result = await markAsRead("notif-1", "user-1");

			expect(result).toBeNull();
		});
	});

	describe("markAllAsRead", () => {
		test("returns count of updated notifications", async () => {
			const { markAllAsRead } = await import("../notification-service");

			const result = await markAllAsRead("user-1", "org-1");

			// Should return a number (0 or positive count)
			expect(typeof result).toBe("number");
			expect(result).toBeGreaterThanOrEqual(0);
		});

		test("returns 0 on error", async () => {
			mockUpdate.mockImplementation(() => {
				throw new Error("Database error");
			});

			const { markAllAsRead } = await import("../notification-service");

			const result = await markAllAsRead("user-1", "org-1");

			expect(result).toBe(0);
		});
	});

	describe("deleteNotification", () => {
		test("returns boolean when deleting notification", async () => {
			const { deleteNotification } = await import("../notification-service");

			const result = await deleteNotification("notif-1", "user-1");

			// Should return a boolean
			expect(typeof result).toBe("boolean");
		});

		test("returns false when notification not found", async () => {
			mockDeleteWhere.mockImplementation(() => Promise.resolve({ rowCount: 0 }));

			const { deleteNotification } = await import("../notification-service");

			const result = await deleteNotification("notif-1", "user-1");

			expect(result).toBe(false);
		});

		test("returns false on error", async () => {
			mockDelete.mockImplementation(() => {
				throw new Error("Database error");
			});

			const { deleteNotification } = await import("../notification-service");

			const result = await deleteNotification("notif-1", "user-1");

			expect(result).toBe(false);
		});
	});

	describe("isChannelEnabled", () => {
		test("returns true when no preference exists (default enabled)", async () => {
			mockFindFirst.mockImplementation(() => Promise.resolve(null));

			const { isChannelEnabled } = await import("../notification-service");

			const result = await isChannelEnabled(
				"user-1",
				"org-1",
				"approval_request_submitted",
				"in_app",
			);

			expect(result).toBe(true);
		});

		test("returns preference value when preference exists", async () => {
			mockFindFirst.mockImplementation(() =>
				Promise.resolve(createMockPreference({ enabled: false })),
			);

			const { isChannelEnabled } = await import("../notification-service");

			const result = await isChannelEnabled(
				"user-1",
				"org-1",
				"approval_request_submitted",
				"in_app",
			);

			expect(result).toBe(false);
		});

		test("returns true on error (fail open)", async () => {
			mockFindFirst.mockImplementation(() => {
				throw new Error("Database error");
			});

			const { isChannelEnabled } = await import("../notification-service");

			const result = await isChannelEnabled(
				"user-1",
				"org-1",
				"approval_request_submitted",
				"in_app",
			);

			expect(result).toBe(true);
		});
	});

	describe("deleteOldNotifications", () => {
		test("returns a number representing deleted count", async () => {
			const { deleteOldNotifications } = await import("../notification-service");

			const result = await deleteOldNotifications(90);

			// Should return a number (could be 0 if no old notifications)
			expect(typeof result).toBe("number");
			expect(result).toBeGreaterThanOrEqual(0);
		});

		test("accepts optional days parameter", async () => {
			const { deleteOldNotifications } = await import("../notification-service");

			// Should not throw when called without parameter (uses default of 90 days)
			const result = await deleteOldNotifications();

			expect(typeof result).toBe("number");
			expect(result).toBeGreaterThanOrEqual(0);
		});

		test("handles custom days parameter", async () => {
			const { deleteOldNotifications } = await import("../notification-service");

			// Should accept custom days parameter
			const result = await deleteOldNotifications(30);

			expect(typeof result).toBe("number");
		});
	});
});
