/**
 * Tests for Audit Logger
 *
 * Tests audit log entry creation, external service integration,
 * and helper functions.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import {
	AuditAction,
	type AuditLogEntry,
} from "../audit-logger";

// Mock the database module
const mockInsert = mock(() => ({
	values: mock(() => Promise.resolve()),
}));

mock.module("@/db", () => ({
	db: {
		insert: mockInsert,
	},
}));

mock.module("@/db/schema", () => ({
	auditLog: { id: "audit_log" },
}));

// Mock the logger
const mockLoggerInfo = mock(() => {});
const mockLoggerError = mock(() => {});

mock.module("@/lib/logger", () => ({
	createLogger: () => ({
		info: mockLoggerInfo,
		error: mockLoggerError,
	}),
}));

// Mock fetch for external service tests
const originalFetch = globalThis.fetch;

describe("Audit Logger", () => {
	beforeEach(() => {
		mockInsert.mockClear();
		mockLoggerInfo.mockClear();
		mockLoggerError.mockClear();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	describe("AuditAction enum", () => {
		test("should have all manager operations", () => {
			expect(AuditAction.MANAGER_ASSIGNED).toBe("manager.assigned");
			expect(AuditAction.MANAGER_REMOVED).toBe("manager.removed");
			expect(AuditAction.MANAGER_PRIMARY_CHANGED).toBe("manager.primary_changed");
		});

		test("should have all permission operations", () => {
			expect(AuditAction.PERMISSION_GRANTED).toBe("permission.granted");
			expect(AuditAction.PERMISSION_REVOKED).toBe("permission.revoked");
		});

		test("should have all time entry operations", () => {
			expect(AuditAction.TIME_ENTRY_CREATED).toBe("time_entry.created");
			expect(AuditAction.TIME_ENTRY_CORRECTED).toBe("time_entry.corrected");
			expect(AuditAction.TIME_ENTRY_CHAIN_VERIFIED).toBe("time_entry.chain_verified");
		});

		test("should have all absence operations", () => {
			expect(AuditAction.ABSENCE_REQUESTED).toBe("absence.requested");
			expect(AuditAction.ABSENCE_APPROVED).toBe("absence.approved");
			expect(AuditAction.ABSENCE_REJECTED).toBe("absence.rejected");
			expect(AuditAction.ABSENCE_CANCELLED).toBe("absence.cancelled");
		});

		test("should have all authentication operations", () => {
			expect(AuditAction.LOGIN_SUCCESS).toBe("auth.login_success");
			expect(AuditAction.LOGIN_FAILED).toBe("auth.login_failed");
			expect(AuditAction.LOGOUT).toBe("auth.logout");
			expect(AuditAction.PASSWORD_CHANGED).toBe("auth.password_changed");
		});

		test("should have vacation operations", () => {
			expect(AuditAction.VACATION_CARRYOVER_APPLIED).toBe("vacation.carryover_applied");
			expect(AuditAction.VACATION_CARRYOVER_EXPIRED).toBe("vacation.carryover_expired");
			expect(AuditAction.VACATION_ALLOWANCE_UPDATED).toBe("vacation.allowance_updated");
		});
	});

	describe("AuditLogEntry interface", () => {
		test("should accept valid entry structure", () => {
			const entry: AuditLogEntry = {
				action: AuditAction.EMPLOYEE_CREATED,
				actorId: "user-123",
				actorEmail: "admin@example.com",
				employeeId: "emp-456",
				targetId: "emp-456",
				targetType: "employee",
				organizationId: "org-789",
				metadata: { name: "John Doe" },
				changes: { before: null, after: { role: "employee" } },
				timestamp: new Date(),
				ipAddress: "192.168.1.1",
				userAgent: "Mozilla/5.0",
			};

			expect(entry.action).toBe(AuditAction.EMPLOYEE_CREATED);
			expect(entry.targetType).toBe("employee");
		});

		test("should allow optional fields to be omitted", () => {
			const minimalEntry: AuditLogEntry = {
				action: AuditAction.LOGIN_SUCCESS,
				actorId: "user-123",
				organizationId: "org-789",
				timestamp: new Date(),
			};

			expect(minimalEntry.actorEmail).toBeUndefined();
			expect(minimalEntry.targetId).toBeUndefined();
			expect(minimalEntry.ipAddress).toBeUndefined();
		});
	});
});

describe("Audit Context Middleware", () => {
	// These tests are for the pure functions that don't need mocking

	test("parseUserAgent should detect Chrome browser", async () => {
		const { parseUserAgent } = await import("../middleware/audit-context");

		const result = parseUserAgent(
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
		);

		expect(result.browser).toBe("Chrome");
		expect(result.os).toBe("Windows");
		expect(result.device).toBe("Desktop");
	});

	test("parseUserAgent should detect Firefox browser", async () => {
		const { parseUserAgent } = await import("../middleware/audit-context");

		const result = parseUserAgent(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0"
		);

		expect(result.browser).toBe("Firefox");
		expect(result.os).toBe("macOS");
		expect(result.device).toBe("Desktop");
	});

	test("parseUserAgent should detect Safari browser", async () => {
		const { parseUserAgent } = await import("../middleware/audit-context");

		const result = parseUserAgent(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
		);

		expect(result.browser).toBe("Safari");
		expect(result.os).toBe("macOS");
	});

	test("parseUserAgent should detect mobile devices", async () => {
		const { parseUserAgent } = await import("../middleware/audit-context");

		const result = parseUserAgent(
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
		);

		expect(result.os).toBe("iOS");
		expect(result.device).toBe("Mobile");
	});

	test("parseUserAgent should handle undefined input", async () => {
		const { parseUserAgent } = await import("../middleware/audit-context");

		const result = parseUserAgent(undefined);

		expect(result.browser).toBeUndefined();
		expect(result.os).toBeUndefined();
		expect(result.device).toBeUndefined();
	});

	test("maskIpAddress should mask IPv4 addresses", async () => {
		const { maskIpAddress } = await import("../middleware/audit-context");

		expect(maskIpAddress("192.168.1.100")).toBe("192.168.xxx.xxx");
		expect(maskIpAddress("10.0.0.1")).toBe("10.0.xxx.xxx");
	});

	test("maskIpAddress should mask IPv6 addresses", async () => {
		const { maskIpAddress } = await import("../middleware/audit-context");

		const result = maskIpAddress("2001:0db8:85a3:0000:0000:8a2e:0370:7334");
		expect(result).toContain("xxxx");
	});

	test("maskIpAddress should handle undefined input", async () => {
		const { maskIpAddress } = await import("../middleware/audit-context");

		expect(maskIpAddress(undefined)).toBeUndefined();
	});

	test("getAuditContextFromRequest should extract headers", async () => {
		const { getAuditContextFromRequest } = await import("../middleware/audit-context");

		const mockRequest = new Request("https://example.com", {
			headers: {
				"x-forwarded-for": "1.2.3.4, 5.6.7.8",
				"user-agent": "Test Browser/1.0",
			},
		});

		const context = getAuditContextFromRequest(mockRequest);

		expect(context.ipAddress).toBe("1.2.3.4");
		expect(context.userAgent).toBe("Test Browser/1.0");
	});

	test("getAuditContextFromRequest should handle x-real-ip header", async () => {
		const { getAuditContextFromRequest } = await import("../middleware/audit-context");

		const mockRequest = new Request("https://example.com", {
			headers: {
				"x-real-ip": "10.20.30.40",
			},
		});

		const context = getAuditContextFromRequest(mockRequest);

		expect(context.ipAddress).toBe("10.20.30.40");
	});

	test("getAuditContextFromRequest should handle cf-connecting-ip header (Cloudflare)", async () => {
		const { getAuditContextFromRequest } = await import("../middleware/audit-context");

		const mockRequest = new Request("https://example.com", {
			headers: {
				"cf-connecting-ip": "203.0.113.50",
			},
		});

		const context = getAuditContextFromRequest(mockRequest);

		expect(context.ipAddress).toBe("203.0.113.50");
	});
});

describe("Audit Report Generator", () => {
	test("exportComplianceReportAsCsv should generate valid CSV", async () => {
		const { exportComplianceReportAsCsv } = await import("../reporting/audit-report");
		type ComplianceReport = Awaited<ReturnType<typeof import("../reporting/audit-report").generateComplianceReport>>;

		const mockReport: ComplianceReport = {
			reportPeriod: { start: "2024-01-01", end: "2024-01-31" },
			summary: { totalEvents: 100, uniqueUsers: 5, uniqueEntities: 20 },
			dailySummaries: [
				{ date: "2024-01-15", totalEvents: 50, uniqueUsers: 3, byAction: {} },
			],
			topUsers: [
				{
					userId: "user-1",
					userName: "John Doe",
					userEmail: "john@example.com",
					totalActions: 25,
					actionBreakdown: {},
					firstAction: new Date("2024-01-01"),
					lastAction: new Date("2024-01-31"),
					ipAddresses: ["1.2.3.4"],
				},
			],
			actionBreakdown: [{ action: "employee.created", count: 10, percentage: 10 }],
			entityBreakdown: [{ entityType: "employee", count: 50, percentage: 50 }],
			securityEvents: [],
			warnings: ["Test warning"],
		};

		const csv = exportComplianceReportAsCsv(mockReport);

		expect(csv).toContain("Audit Compliance Report");
		expect(csv).toContain("2024-01-01");
		expect(csv).toContain("2024-01-31");
		expect(csv).toContain("Total Events,100");
		expect(csv).toContain("Test warning");
		expect(csv).toContain("John Doe");
	});

	test("formatComplianceReportAsHtml should generate valid HTML", async () => {
		const { formatComplianceReportAsHtml } = await import("../reporting/audit-report");
		type ComplianceReport = Awaited<ReturnType<typeof import("../reporting/audit-report").generateComplianceReport>>;

		const mockReport: ComplianceReport = {
			reportPeriod: { start: "2024-01-01", end: "2024-01-31" },
			summary: { totalEvents: 100, uniqueUsers: 5, uniqueEntities: 20 },
			dailySummaries: [],
			topUsers: [],
			actionBreakdown: [],
			entityBreakdown: [],
			securityEvents: [],
			warnings: [],
		};

		const html = formatComplianceReportAsHtml(mockReport);

		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("Audit Compliance Report");
		expect(html).toContain("100");
		expect(html).toContain("</html>");
	});
});
