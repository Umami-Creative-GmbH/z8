import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { sendEmail } from "@/lib/email/email-service";
import { renderOrganizationEmailTemplate } from "@/lib/email/template-renderer";
import {
	cleanupExpiredExports,
	getPendingExports,
	processExport,
	regeneratePresignedUrl,
} from "@/lib/export/export-service";
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
	regeneratePresignedUrl: vi.fn(),
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
const regeneratePresignedUrlMock = vi.mocked(regeneratePresignedUrl);

const findDataExportMock = vi.mocked(db.query.dataExport.findFirst);
const findEmployeeMock = vi.mocked(db.query.employee.findFirst);
const findOrganizationMock = vi.mocked(db.query.organization.findFirst);

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
		regeneratePresignedUrlMock.mockReset();
		findDataExportMock.mockReset();
		findEmployeeMock.mockReset();
		findOrganizationMock.mockReset();

		cleanupExpiredExportsMock.mockResolvedValue(0);
		findEmployeeMock.mockResolvedValue({
			firstName: "Alex",
			user: { email: "alex@example.com", name: "Alex Morgan" },
		});
		findOrganizationMock.mockResolvedValue({ name: "Acme Operations" });
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
		const completedRecord = { ...exportRecord, status: "completed" as const };

		getPendingExportsMock.mockResolvedValue([exportRecord]);
		findDataExportMock.mockResolvedValue(completedRecord);
		regeneratePresignedUrlMock.mockResolvedValue("https://download.example.com/export_123.zip");
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
				downloadUrl: "https://download.example.com/export_123.zip",
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
