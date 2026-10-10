import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { DeliveryConfig, ExecutionResult } from "../domain/types";

const mocks = vi.hoisted(() => ({
	sendEmail: vi.fn(),
	getPresignedUrl: vi.fn(),
}));

vi.mock("@/lib/email/email-service", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/storage/export-s3-client", () => ({
	getPresignedUrl: mocks.getPresignedUrl,
	getDefaultPresignedUrlTtlSeconds: () => 900,
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { DeliveryService } = await import("./delivery-service");

const clock = { nowInstant: () => parseInstant("2026-10-10T12:00:00Z") };

const emailDelivery: DeliveryConfig = {
	method: "s3_and_email",
	emailRecipients: ["admin@example.com"],
	useOrgS3Config: false,
};

function deliver(exportResult: ExecutionResult) {
	return new DeliveryService(clock).deliver({
		organizationId: "org-1",
		scheduleName: "Monthly payroll",
		// Fixtures for the delivery's existing Luxon boundary; no date calculations.
		dateRange: {
			start: DateTime.fromISO("2026-09-01T00:00:00Z", { zone: "UTC" }),
			end: DateTime.fromISO("2026-09-30T23:59:59Z", { zone: "UTC" }),
		},
		deliveryConfig: emailDelivery,
		exportResult,
	});
}

function sentHtml(): string {
	expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
	return mocks.sendEmail.mock.calls[0][0].html;
}

describe("scheduled export email link expiry", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.sendEmail.mockResolvedValue(undefined);
		mocks.getPresignedUrl.mockResolvedValue("https://s3.example/data.zip?signature");
	});

	it("states the 15-minute lifetime a payroll link was signed with", async () => {
		const result = await deliver({
			success: true,
			s3Key: "payroll-exports/org-1/job-1/export.csv",
			downloadLink: {
				url: "https://s3.example/export.csv?signature",
				lifetimeSeconds: 900,
				expiresAt: parseInstant("2026-10-10T12:15:00Z"),
			},
		});

		const html = sentHtml();
		expect(html).toContain('href="https://s3.example/export.csv?signature"');
		expect(html).toContain("valid for 15 minutes");
		expect(html).toContain("October 10, 2026 at 12:15 PM UTC");
		expect(html).not.toContain("7 days");
		expect(result.s3Url).toBe("https://s3.example/export.csv?signature");
		expect(mocks.getPresignedUrl).not.toHaveBeenCalled();
	});

	it("states the 7-day lifetime of a data export link it signs itself", async () => {
		const result = await deliver({
			success: true,
			s3Key: "exports/org-1/export-1.zip",
		});

		expect(mocks.getPresignedUrl).toHaveBeenCalledWith(
			"org-1",
			"exports/org-1/export-1.zip",
			604800,
		);
		const html = sentHtml();
		expect(html).toContain('href="https://s3.example/data.zip?signature"');
		expect(html).toContain("valid for 7 days");
		expect(html).toContain("October 17, 2026 at 12:00 PM UTC");
		expect(result).toMatchObject({
			s3Key: "exports/org-1/export-1.zip",
			s3Url: "https://s3.example/data.zip?signature",
		});
	});

	it("says no file was produced, without a download button, when the run has no output", async () => {
		const result = await deliver({ success: true, underlyingJobType: "payroll_export" });

		const html = sentHtml();
		expect(html).toContain("No file was produced");
		expect(html).not.toContain("Download Export");
		expect(html).not.toContain("expire");
		expect(html).not.toContain("completed successfully");
		expect(result.s3Url).toBeUndefined();
	});
});
