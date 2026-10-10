import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));

vi.mock("@/lib/email/email-service", () => ({ sendEmail }));
vi.mock("@/lib/storage/export-s3-client", () => ({ getPresignedUrl: vi.fn() }));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));

const { DeliveryService } = await import("./delivery-service");

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
