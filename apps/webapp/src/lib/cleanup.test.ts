import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupExpiredExports } from "@/lib/export/export-service";
import { deleteOldAuditLogs } from "@/lib/audit/cleanup";
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

describe("runCleanup", () => {
	beforeEach(() => {
		infoMock.mockReset();
		warnMock.mockReset();
		debugMock.mockReset();
		cleanupExpiredExportsMock.mockReset();
		deleteOldAuditLogsMock.mockReset();
		deleteOldNotificationsMock.mockReset();
	});

	it("routes expired export cleanup to cleanupExpiredExports", async () => {
		cleanupExpiredExportsMock.mockResolvedValue(3);

		const result = await runCleanup({ type: "cleanup", task: "expired_exports" });

		expect(cleanupExpiredExportsMock).toHaveBeenCalledOnce();
		expect(result).toEqual({ deletedCount: 3 });
	});

	it("routes old notification cleanup with 90 day retention", async () => {
		deleteOldNotificationsMock.mockResolvedValue(7);

		const result = await runCleanup({ type: "cleanup", task: "old_notifications" });

		expect(deleteOldNotificationsMock).toHaveBeenCalledWith(90);
		expect(result).toEqual({ deletedCount: 7 });
		expect(infoMock).toHaveBeenCalledWith({ count: 7 }, "Cleaned up old notifications");
	});

	it("routes old audit log cleanup with 365 day retention", async () => {
		deleteOldAuditLogsMock.mockResolvedValue(11);

		const result = await runCleanup({ type: "cleanup", task: "old_audit_logs" });

		expect(deleteOldAuditLogsMock).toHaveBeenCalledWith(365);
		expect(result).toEqual({ deletedCount: 11 });
		expect(infoMock).toHaveBeenCalledWith({ count: 11 }, "Cleaned up old audit logs");
	});
});
