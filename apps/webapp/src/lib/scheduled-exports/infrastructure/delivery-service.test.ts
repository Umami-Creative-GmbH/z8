import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { DeliveryConfig, ExecutionResult } from "../domain/types";

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));

vi.mock("@/lib/email/email-service", () => ({ sendEmail }));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { DeliveryService } = await import("./delivery-service");

const emailDelivery: DeliveryConfig = {
	method: "s3_and_email",
	emailRecipients: ["admin@example.com"],
	useOrgS3Config: false,
};

function deliver(exportResult: ExecutionResult) {
	return new DeliveryService().deliver({
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

function deliverTo(recipients: string[]) {
	return new DeliveryService().deliver({
		organizationId: "org-1",
		scheduleName: "Monthly payroll",
		dateRange: {
			start: DateTime.fromISO("2026-09-01T00:00:00Z"),
			end: DateTime.fromISO("2026-09-30T23:59:59Z"),
		},
		deliveryConfig: {
			method: "email_only",
			emailRecipients: recipients,
			useOrgS3Config: true,
		},
		exportResult: { success: true },
	});
}

function sentHtml(): string {
	expect(sendEmail).toHaveBeenCalledTimes(1);
	return sendEmail.mock.calls[0][0].html;
}

describe("scheduled export email link expiry", () => {
	beforeEach(() => {
		sendEmail.mockReset();
		sendEmail.mockResolvedValue({ success: true, messageId: "msg-1" });
	});

	it("states the 15-minute lifetime a payroll link was signed with", async () => {
		const result = await deliver({
			success: true,
			s3Key: "payroll-exports/org-1/job-1/export.csv",
			fileUrl: {
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
		expect(result).toMatchObject({
			s3Key: "payroll-exports/org-1/job-1/export.csv",
			s3Url: "https://s3.example/export.csv?signature",
		});
	});

	it("states the 7-day lifetime a data export link was signed with", async () => {
		await deliver({
			success: true,
			s3Key: "exports/org-1/export-1.zip",
			fileUrl: {
				url: "https://s3.example/data.zip?signature",
				lifetimeSeconds: 604800,
				expiresAt: parseInstant("2026-10-17T12:00:00Z"),
			},
		});

		const html = sentHtml();
		expect(html).toContain('href="https://s3.example/data.zip?signature"');
		expect(html).toContain("valid for 7 days");
		expect(html).toContain("October 17, 2026 at 12:00 PM UTC");
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

describe("DeliveryService email delivery", () => {
	beforeEach(() => {
		sendEmail.mockReset();
	});

	it("counts a recipient whose transport reports failure as failed", async () => {
		sendEmail.mockImplementation(async ({ to }: { to: string }) =>
			to === "bounce@example.com"
				? { success: false, error: "SMTP 550 mailbox unavailable" }
				: { success: true, messageId: "msg-1" },
		);

		const result = await deliverTo(["ok@example.com", "bounce@example.com"]);

		expect(result.emailsSent).toBe(1);
		expect(result.emailsFailed).toBe(1);
		expect(result.emailErrors).toEqual([
			{
				recipient: "bounce@example.com",
				error: "SMTP 550 mailbox unavailable",
				timestamp: expect.any(String),
			},
		]);
	});

	it("records a failure without a transport message", async () => {
		sendEmail.mockResolvedValue({ success: false });

		const result = await deliverTo(["ok@example.com"]);

		expect(result.emailsSent).toBe(0);
		expect(result.emailsFailed).toBe(1);
		expect(result.emailErrors).toEqual([
			{ recipient: "ok@example.com", error: expect.any(String), timestamp: expect.any(String) },
		]);
	});

	it("records a thrown send as failed", async () => {
		sendEmail.mockImplementation(async ({ to }: { to: string }) => {
			if (to === "broken@example.com") throw new Error("Transport misconfigured");
			return { success: true };
		});

		const result = await deliverTo(["ok@example.com", "broken@example.com"]);

		expect(result.emailsSent).toBe(1);
		expect(result.emailsFailed).toBe(1);
		expect(result.emailErrors).toEqual([
			{
				recipient: "broken@example.com",
				error: "Transport misconfigured",
				timestamp: expect.any(String),
			},
		]);
	});

	it("reports no failures when every send succeeds", async () => {
		sendEmail.mockResolvedValue({ success: true, messageId: "msg-1" });

		const result = await deliverTo(["a@example.com", "b@example.com"]);

		expect(result.emailsSent).toBe(2);
		expect(result.emailsFailed).toBe(0);
		expect(result.emailErrors).toEqual([]);
	});
});
