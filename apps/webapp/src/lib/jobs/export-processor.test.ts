import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { sendEmail } from "@/lib/email/email-service";
import { renderOrganizationEmailTemplate } from "@/lib/email/template-renderer";
import {
	cleanupExpiredExports,
	getPendingExports,
	processExport,
} from "@/lib/export/export-service";
import { resolveOrganizationNotificationLocale } from "@/lib/notifications/recipient-locale";
import { runExportProcessor } from "./export-processor";

const { infoMock, warnMock, errorMock } = vi.hoisted(() => ({
	infoMock: vi.fn(),
	warnMock: vi.fn(),
	errorMock: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	eq: vi.fn((field, value) => ({ field, value })),
}));

vi.mock("@/db", () => ({
	dataExport: { id: "dataExport.id" },
	employee: { id: "employee.id" },
	organization: { id: "organization.id" },
	db: {
		query: {
			dataExport: { findFirst: vi.fn() },
			employee: { findFirst: vi.fn() },
			organization: { findFirst: vi.fn() },
		},
	},
}));

vi.mock("@/lib/app-url", () => ({
	getDefaultAppBaseUrl: () => "https://app.example.com",
}));

vi.mock("@/lib/email/email-service", () => ({
	sendEmail: vi.fn(),
}));

vi.mock("@/lib/email/template-renderer", () => ({
	renderOrganizationEmailTemplate: vi.fn(),
}));

vi.mock("@/lib/export/export-service", () => ({
	cleanupExpiredExports: vi.fn(),
	formatFileSize: (bytes: number | null) => `${bytes ?? 0} B`,
	getPendingExports: vi.fn(),
	processExport: vi.fn(),
}));

vi.mock("@/lib/notifications/recipient-locale", () => ({
	resolveOrganizationNotificationLocale: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: infoMock,
		warn: warnMock,
		error: errorMock,
	}),
}));

const sendEmailMock = vi.mocked(sendEmail);
const renderOrganizationEmailTemplateMock = vi.mocked(renderOrganizationEmailTemplate);
const getPendingExportsMock = vi.mocked(getPendingExports);
const processExportMock = vi.mocked(processExport);
const cleanupExpiredExportsMock = vi.mocked(cleanupExpiredExports);

const findDataExportMock = vi.mocked(db.query.dataExport.findFirst);
const findEmployeeMock = vi.mocked(db.query.employee.findFirst);
const findOrganizationMock = vi.mocked(db.query.organization.findFirst);
const resolveOrganizationLocaleMock = vi.mocked(resolveOrganizationNotificationLocale);

describe("runExportProcessor", () => {
	beforeEach(() => {
		infoMock.mockReset();
		warnMock.mockReset();
		errorMock.mockReset();
		sendEmailMock.mockReset();
		renderOrganizationEmailTemplateMock.mockReset();
		getPendingExportsMock.mockReset();
		processExportMock.mockReset();
		cleanupExpiredExportsMock.mockReset();
		findDataExportMock.mockReset();
		findEmployeeMock.mockReset();
		findOrganizationMock.mockReset();
		resolveOrganizationLocaleMock.mockReset();

		cleanupExpiredExportsMock.mockResolvedValue(0);
		findEmployeeMock.mockResolvedValue({
			firstName: "Alex",
			user: { email: "alex@example.com", name: "Alex Morgan" },
		});
		findOrganizationMock.mockResolvedValue({ name: "Acme Operations" });
		resolveOrganizationLocaleMock.mockResolvedValue("en");
		sendEmailMock.mockResolvedValue({ success: true, messageId: "msg_123" });
	});

	it("renders completed export emails through organization templates before sending", async () => {
		const exportRecord = {
			id: "export_123",
			organizationId: "org_123",
			requestedById: "employee_123",
			categories: ["time_entries"],
			status: "pending" as const,
			errorMessage: null,
			s3Key: "exports/export_123.zip",
			fileSizeBytes: 2048,
			createdAt: new Date("2026-04-30T08:00:00.000Z"),
			completedAt: null,
			expiresAt: null,
		};
		const completedRecord = {
			...exportRecord,
			status: "completed" as const,
			expiresAt: new Date("2026-05-30T08:00:00.000Z"),
		};

		getPendingExportsMock.mockResolvedValue([exportRecord]);
		findDataExportMock.mockResolvedValue(completedRecord);
		renderOrganizationEmailTemplateMock.mockResolvedValue({
			subject: "Custom export ready",
			html: "<p>Custom ready body</p>",
			usedOverride: true,
		});

		await runExportProcessor();

		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith({
			organizationId: "org_123",
			templateKey: "export-ready",
			data: expect.objectContaining({
				recipientName: "Alex Morgan",
				organizationName: "Acme Operations",
				categories: ["Time Tracking"],
				fileSize: "2048 B",
				downloadUrl: "https://app.example.com/en/settings/export/history/org_123",
			}),
			subjectOverride: "Your data export is ready - Acme Operations",
		});
		expect(sendEmailMock).toHaveBeenCalledWith({
			to: "alex@example.com",
			subject: "Custom export ready",
			html: "<p>Custom ready body</p>",
			organizationId: "org_123",
		});
		expect(infoMock.mock.calls).not.toContainEqual(
			expect.arrayContaining([expect.objectContaining({ email: "alex@example.com" })]),
		);
	});

	it("links the export-ready email to its organization's export history and states the file's expiry", async () => {
		const exportRecord = {
			id: "export_789",
			organizationId: "org_789",
			requestedById: "employee_789",
			categories: ["absences"],
			status: "pending" as const,
			errorMessage: null,
			s3Key: "exports/export_789.zip",
			fileSizeBytes: 4096,
			createdAt: new Date("2026-04-30T08:00:00.000Z"),
			completedAt: null,
			expiresAt: null,
		};
		const completedRecord = {
			...exportRecord,
			status: "completed" as const,
			completedAt: new Date("2026-04-30T08:05:00.000Z"),
			expiresAt: new Date("2026-05-30T08:05:00.000Z"),
		};

		getPendingExportsMock.mockResolvedValue([exportRecord]);
		findDataExportMock.mockResolvedValue(completedRecord);
		findOrganizationMock.mockResolvedValue({
			name: "Acme Operations",
			timezone: "Europe/Berlin",
		});
		resolveOrganizationLocaleMock.mockResolvedValue("de");
		renderOrganizationEmailTemplateMock.mockResolvedValue({
			subject: "Export ready",
			html: "<p>Ready</p>",
			usedOverride: false,
		});

		await runExportProcessor();

		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				templateKey: "export-ready",
				data: expect.objectContaining({
					downloadUrl: "https://app.example.com/de/settings/export/history/org_789",
					expiresAt: "May 30, 2026, 10:05 (Europe/Berlin)",
				}),
			}),
		);
	});

	it("states the file's expiry in UTC when the organization has no timezone", async () => {
		const completedRecord = {
			id: "export_790",
			organizationId: "org_790",
			requestedById: "employee_790",
			categories: ["absences"],
			status: "completed" as const,
			errorMessage: null,
			s3Key: "exports/export_790.zip",
			fileSizeBytes: 4096,
			createdAt: new Date("2026-04-30T08:00:00.000Z"),
			completedAt: new Date("2026-04-30T08:05:00.000Z"),
			expiresAt: new Date("2026-05-30T08:05:00.000Z"),
		};

		getPendingExportsMock.mockResolvedValue([{ ...completedRecord, status: "pending" as const }]);
		findDataExportMock.mockResolvedValue(completedRecord);
		findOrganizationMock.mockResolvedValue({ name: "Acme Operations", timezone: null });
		renderOrganizationEmailTemplateMock.mockResolvedValue({
			subject: "Export ready",
			html: "<p>Ready</p>",
			usedOverride: false,
		});

		await runExportProcessor();

		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					downloadUrl: "https://app.example.com/en/settings/export/history/org_790",
					expiresAt: "May 30, 2026, 08:05 (UTC)",
				}),
			}),
		);
	});

	it("renders failed export emails through organization templates before sending", async () => {
		const exportRecord = {
			id: "export_456",
			organizationId: "org_456",
			requestedById: "employee_456",
			categories: ["absences"],
			status: "pending" as const,
			errorMessage: null,
			s3Key: null,
			fileSizeBytes: null,
			createdAt: new Date("2026-04-30T08:00:00.000Z"),
			completedAt: null,
			expiresAt: null,
		};
		const failedRecord = {
			...exportRecord,
			status: "failed" as const,
			errorMessage: "Source timeout",
		};

		getPendingExportsMock.mockResolvedValue([exportRecord]);
		processExportMock.mockRejectedValue(new Error("Processing failed"));
		findDataExportMock.mockResolvedValue(failedRecord);
		renderOrganizationEmailTemplateMock.mockResolvedValue({
			subject: "Custom export failed",
			html: "<p>Custom failed body</p>",
			usedOverride: true,
		});

		await runExportProcessor();

		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith({
			organizationId: "org_456",
			templateKey: "export-failed",
			data: {
				recipientName: "Alex Morgan",
				organizationName: "Acme Operations",
				categories: ["Absences"],
				errorMessage: "Source timeout",
				retryUrl: "https://app.example.com/settings/export",
			},
			subjectOverride: "Data export failed - Acme Operations",
		});
		expect(sendEmailMock).toHaveBeenCalledWith({
			to: "alex@example.com",
			subject: "Custom export failed",
			html: "<p>Custom failed body</p>",
			organizationId: "org_456",
		});
		expect(infoMock.mock.calls).not.toContainEqual(
			expect.arrayContaining([expect.objectContaining({ email: "alex@example.com" })]),
		);
	});
});
