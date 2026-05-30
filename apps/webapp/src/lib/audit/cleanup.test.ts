import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog } from "@/db";
import { deleteOldAuditLogs } from "./cleanup";

const { deleteMock, whereMock, returningMock, infoMock, errorMock, sqlMock } = vi.hoisted(() => ({
	deleteMock: vi.fn(),
	whereMock: vi.fn(),
	returningMock: vi.fn(),
	infoMock: vi.fn(),
	errorMock: vi.fn(),
	sqlMock: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

vi.mock("drizzle-orm", () => ({
	sql: sqlMock,
}));

vi.mock("@/db", () => ({
	auditLog: {
		id: "auditLog.id",
		timestamp: "auditLog.timestamp",
	},
	db: {
		delete: deleteMock,
	},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: infoMock,
		error: errorMock,
	}),
}));

describe("deleteOldAuditLogs", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-24T12:00:00.000Z"));

		deleteMock.mockReset();
		whereMock.mockReset();
		returningMock.mockReset();
		infoMock.mockReset();
		errorMock.mockReset();
		sqlMock.mockClear();

		deleteMock.mockReturnValue({ where: whereMock });
		whereMock.mockReturnValue({ returning: returningMock });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("deletes audit logs older than the retention cutoff and returns the deleted count", async () => {
		returningMock.mockResolvedValue([{ id: "audit-1" }, { id: "audit-2" }]);

		const result = await deleteOldAuditLogs(365);

		expect(result).toBe(2);
		expect(deleteMock).toHaveBeenCalledWith(auditLog);
		expect(sql).toHaveBeenCalledWith(
			expect.arrayContaining(["", " < ", ""]),
			auditLog.timestamp,
			new Date("2025-05-24T12:00:00.000Z"),
		);
		expect(whereMock).toHaveBeenCalledWith({
			strings: expect.arrayContaining(["", " < ", ""]),
			values: [auditLog.timestamp, new Date("2025-05-24T12:00:00.000Z")],
		});
		expect(returningMock).toHaveBeenCalledWith({ id: auditLog.id });
		expect(infoMock).toHaveBeenCalledWith(
			{ deletedCount: 2, olderThanDays: 365 },
			"Old audit logs cleaned up",
		);
	});

	it("uses 365 days as the default retention period", async () => {
		returningMock.mockResolvedValue([{ id: "audit-1" }]);

		const result = await deleteOldAuditLogs();

		expect(result).toBe(1);
		expect(sql).toHaveBeenCalledWith(
			expect.any(Array),
			auditLog.timestamp,
			new Date("2025-05-24T12:00:00.000Z"),
		);
	});

	it("logs cleanup failures and returns zero", async () => {
		const error = new Error("delete failed");
		returningMock.mockRejectedValue(error);

		const result = await deleteOldAuditLogs(30);

		expect(result).toBe(0);
		expect(errorMock).toHaveBeenCalledWith(
			{ error, olderThanDays: 30 },
			"Failed to delete old audit logs",
		);
	});
});
