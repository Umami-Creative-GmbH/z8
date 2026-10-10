import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteOldAuditLogs } from "@/lib/audit/cleanup";
import { cleanupExpiredExports } from "@/lib/export/export-service";
import { runClockingReminderOccasionRetention } from "@/lib/jobs/clocking-reminder-occasion-retention";
import { runPositionRecordRetention } from "@/lib/jobs/position-record-retention";
import { deleteOldNotifications } from "@/lib/notifications/notification-service";
import { runCleanup } from "./cleanup";

const { infoMock, warnMock, debugMock } = vi.hoisted(() => ({
	infoMock: vi.fn(),
	warnMock: vi.fn(),
	debugMock: vi.fn(),
}));

vi.mock("@/lib/export/export-service", () => ({
	cleanupExpiredExports: vi.fn(),
}));

vi.mock("@/lib/audit/cleanup", () => ({
	deleteOldAuditLogs: vi.fn(),
}));

vi.mock("@/lib/notifications/notification-service", () => ({
	deleteOldNotifications: vi.fn(),
}));

vi.mock("@/lib/jobs/position-record-retention", () => ({
	runPositionRecordRetention: vi.fn(),
}));

vi.mock("@/lib/jobs/clocking-reminder-occasion-retention", () => ({
	runClockingReminderOccasionRetention: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: infoMock,
		warn: warnMock,
		debug: debugMock,
	}),
}));

const cleanupExpiredExportsMock = vi.mocked(cleanupExpiredExports);
const deleteOldAuditLogsMock = vi.mocked(deleteOldAuditLogs);
const deleteOldNotificationsMock = vi.mocked(deleteOldNotifications);
const runPositionRecordRetentionMock = vi.mocked(runPositionRecordRetention);
const runClockingReminderOccasionRetentionMock = vi.mocked(runClockingReminderOccasionRetention);

describe("runCleanup", () => {
	beforeEach(() => {
		infoMock.mockReset();
		warnMock.mockReset();
		debugMock.mockReset();
		cleanupExpiredExportsMock.mockReset();
		deleteOldAuditLogsMock.mockReset();
		deleteOldNotificationsMock.mockReset();
		runPositionRecordRetentionMock.mockReset();
		runClockingReminderOccasionRetentionMock.mockReset();
	});

	it("routes expired export cleanup to cleanupExpiredExports", async () => {
		cleanupExpiredExportsMock.mockResolvedValue(3);

		const result = await runCleanup({ type: "cleanup", task: "expired_exports" });

		expect(cleanupExpiredExportsMock).toHaveBeenCalledOnce();
		expect(result).toEqual({ deletedCount: 3 });
	});

	it("routes old notification cleanup with 90 day retention", async () => {
		deleteOldNotificationsMock.mockResolvedValue(7);
		runClockingReminderOccasionRetentionMock.mockResolvedValue(0);

		const result = await runCleanup({ type: "cleanup", task: "old_notifications" });

		expect(deleteOldNotificationsMock).toHaveBeenCalledWith(90);
		expect(result).toEqual({ deletedCount: 7 });
		expect(infoMock).toHaveBeenCalledWith({ count: 7 }, "Cleaned up old notifications");
	});

	it("deletes clocking reminder occasions older than 7 days with the old notifications", async () => {
		deleteOldNotificationsMock.mockResolvedValue(7);
		runClockingReminderOccasionRetentionMock.mockResolvedValue(5);

		const result = await runCleanup({ type: "cleanup", task: "old_notifications" });

		expect(runClockingReminderOccasionRetentionMock).toHaveBeenCalledWith(7);
		expect(result).toEqual({ deletedCount: 12 });
		expect(infoMock).toHaveBeenCalledWith(
			{ count: 5 },
			"Cleaned up clocking reminder occasions past retention",
		);
	});

	it("routes old audit log cleanup with 365 day retention", async () => {
		deleteOldAuditLogsMock.mockResolvedValue(11);
		runPositionRecordRetentionMock.mockResolvedValue({
			accessLogEntries: 0,
			consents: 0,
			declines: 0,
		});

		const result = await runCleanup({ type: "cleanup", task: "old_audit_logs" });

		expect(deleteOldAuditLogsMock).toHaveBeenCalledWith(365);
		expect(result).toEqual({ deletedCount: 11 });
		expect(infoMock).toHaveBeenCalledWith({ count: 11 }, "Cleaned up old audit logs");
	});

	it("deletes position consent and access-log records past the same audit-log lifetime", async () => {
		deleteOldAuditLogsMock.mockResolvedValue(11);
		runPositionRecordRetentionMock.mockResolvedValue({
			accessLogEntries: 4,
			consents: 2,
			declines: 1,
		});

		const result = await runCleanup({ type: "cleanup", task: "old_audit_logs" });

		expect(runPositionRecordRetentionMock).toHaveBeenCalledWith(365);
		expect(result).toEqual({ deletedCount: 18 });
		expect(infoMock).toHaveBeenCalledWith(
			{ accessLogEntries: 4, consents: 2, declines: 1 },
			"Cleaned up position records past the audit-log lifetime",
		);
	});
});
