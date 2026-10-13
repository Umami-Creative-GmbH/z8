import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { DeliveryConfig, ExecutionResult } from "../domain/types";

const {
	sendEmail,
	findMemberUserIdsByEmail,
	resolveRecipientNotificationLocale,
	resolveOrganizationNotificationLocale,
	loadOrganizationTimezone,
	loadNamespaces,
} = vi.hoisted(() => ({
	sendEmail: vi.fn(),
	findMemberUserIdsByEmail: vi.fn(),
	resolveRecipientNotificationLocale: vi.fn(),
	resolveOrganizationNotificationLocale: vi.fn(),
	loadOrganizationTimezone: vi.fn(),
	loadNamespaces: vi.fn(),
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/email/email-service", () => ({ sendEmail }));
vi.mock("./member-recipients", () => ({ findMemberUserIdsByEmail }));
vi.mock("@/lib/notifications/recipient-locale", () => ({
	resolveRecipientNotificationLocale,
	resolveOrganizationNotificationLocale,
}));
vi.mock("@/lib/timezone/load-organization-timezone", () => ({ loadOrganizationTimezone }));
vi.mock("@/tolgee/shared", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/tolgee/shared")>()),
	loadNamespaces,
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { DeliveryService } = await import("./delivery-service");

/** The German `emails` catalog a Tolgee sync would deliver. */
const germanCatalog = {
	emails: {
		scheduledExport: {
			subject: "Geplanter Export: {scheduleName} ({dateRange})",
			dateRangeLabel: "Zeitraum",
			recordsLabel: "Datensätze",
			ready: {
				title: "Geplanter Export bereit",
				body: "Ihr geplanter Export {scheduleName} ist fertig.",
				action: "Export herunterladen",
				linkExpiry: "Dieser Link ist {lifetime} gültig und läuft am {expiresAt} ab.",
			},
		},
	},
};

const emailDelivery: DeliveryConfig = {
	method: "s3_and_email",
	emailRecipients: ["admin@example.com"],
	useOrgS3Config: false,
};

const payrollFile: ExecutionResult = {
	success: true,
	s3Key: "payroll-exports/org-1/job-1/export.csv",
	recordCount: 1234,
	fileUrl: {
		url: "https://s3.example/export.csv?signature",
		lifetimeSeconds: 900,
		expiresAt: parseInstant("2026-10-10T12:15:00Z"),
	},
};

function deliver(exportResult: ExecutionResult, deliveryConfig: DeliveryConfig = emailDelivery) {
	return new DeliveryService().deliver({
		organizationId: "org-1",
		scheduleName: "Monthly payroll",
		// Fixtures for the delivery's existing Luxon boundary; no date calculations.
		dateRange: {
			start: DateTime.fromISO("2026-09-01T00:00:00", { zone: "Europe/Berlin" }),
			end: DateTime.fromISO("2026-09-30T23:59:59", { zone: "Europe/Berlin" }),
		},
		deliveryConfig,
		exportResult,
	});
}

function deliverTo(recipients: string[]) {
	return deliver(
		{ success: true },
		{ method: "email_only", emailRecipients: recipients, useOrgS3Config: true },
	);
}

function sentTo(recipient: string): { subject: string; html: string } {
	const call = sendEmail.mock.calls.find(([params]) => params.to === recipient);
	expect(call).toBeDefined();
	return call?.[0];
}

/** Intl separates some parts with no-break, thin or narrow spaces; compare with plain ones. */
function plain(text: string): string {
	return text.replaceAll(/[   ]/g, " ");
}

beforeEach(() => {
	vi.clearAllMocks();
	sendEmail.mockResolvedValue({ success: true, messageId: "msg-1" });
	findMemberUserIdsByEmail.mockResolvedValue(new Map());
	resolveOrganizationNotificationLocale.mockResolvedValue("en");
	resolveRecipientNotificationLocale.mockResolvedValue("en");
	loadOrganizationTimezone.mockResolvedValue("Europe/Berlin");
	loadNamespaces.mockImplementation(async (locale: string) => ({
		[locale]: locale === "de" ? germanCatalog : {},
	}));
});

describe("scheduled export email language", () => {
	it("writes to an approved external recipient in the organization's default language", async () => {
		resolveOrganizationNotificationLocale.mockResolvedValue("de");

		await deliver(payrollFile, {
			...emailDelivery,
			emailRecipients: ["payroll@tax-office.example"],
		});

		expect(findMemberUserIdsByEmail).toHaveBeenCalledWith("org-1", ["payroll@tax-office.example"]);
		expect(resolveRecipientNotificationLocale).not.toHaveBeenCalled();
		const email = sentTo("payroll@tax-office.example");
		expect(plain(email.subject)).toBe("Geplanter Export: Monthly payroll (1.–30. Sept. 2026)");
		const html = plain(email.html);
		expect(html).toContain('lang="de"');
		expect(html).toContain("Ihr geplanter Export Monthly payroll ist fertig.");
		expect(html).toContain("1.–30. Sept. 2026");
		expect(html).toContain("1.234");
		expect(html).toContain("Export herunterladen");
		expect(html).toContain(
			"Dieser Link ist 15 Minuten gültig und läuft am 10. Okt. 2026, 14:15 (Europe/Berlin) ab.",
		);
	});

	it("writes to an org member in their own recipient language", async () => {
		resolveOrganizationNotificationLocale.mockResolvedValue("en");
		findMemberUserIdsByEmail.mockResolvedValue(new Map([["admin@example.com", "user-admin"]]));
		resolveRecipientNotificationLocale.mockResolvedValue("de");

		await deliver(payrollFile, {
			...emailDelivery,
			emailRecipients: ["admin@example.com", "payroll@tax-office.example"],
		});

		expect(resolveRecipientNotificationLocale).toHaveBeenCalledWith({
			userId: "user-admin",
			organizationId: "org-1",
		});
		expect(sentTo("admin@example.com").subject).toMatch(/^Geplanter Export/);
		expect(plain(sentTo("payroll@tax-office.example").subject)).toBe(
			"Scheduled Export: Monthly payroll (Sep 1 – 30, 2026)",
		);
	});

	it("keeps a schedule's own subject as written, with the date range in the recipient's language", async () => {
		resolveOrganizationNotificationLocale.mockResolvedValue("de");

		await deliver(payrollFile, {
			...emailDelivery,
			emailSubjectTemplate: "Lohn-Export {scheduleName} / {dateRange}",
		});

		expect(plain(sentTo("admin@example.com").subject)).toBe(
			"Lohn-Export Monthly payroll / 1.–30. Sept. 2026",
		);
	});
});

describe("scheduled export email link expiry", () => {
	it("states the 15-minute lifetime a payroll link was signed with, in the organization's timezone", async () => {
		const result = await deliver(payrollFile);

		const html = plain(sentTo("admin@example.com").html);
		expect(html).toContain('href="https://s3.example/export.csv?signature"');
		expect(html).toContain("valid for 15 minutes");
		expect(html).toContain("Oct 10, 2026, 2:15 PM (Europe/Berlin)");
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

		const html = plain(sentTo("admin@example.com").html);
		expect(html).toContain('href="https://s3.example/data.zip?signature"');
		expect(html).toContain("valid for 7 days");
		expect(html).toContain("Oct 17, 2026, 2:00 PM (Europe/Berlin)");
	});

	it("says no file was produced, without a download button, when the run has no output", async () => {
		const result = await deliver({ success: true, underlyingJobType: "payroll_export" });

		const html = sentTo("admin@example.com").html;
		expect(html).toContain("No file was produced");
		expect(html).not.toContain("Download export");
		expect(html).not.toContain("expire");
		expect(html).not.toContain("completed successfully");
		expect(result.s3Url).toBeUndefined();
	});
});

describe("DeliveryService email delivery", () => {
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
		const result = await deliverTo(["a@example.com", "b@example.com"]);

		expect(result.emailsSent).toBe(2);
		expect(result.emailsFailed).toBe(0);
		expect(result.emailErrors).toEqual([]);
	});

	it("still sends in the organization's default language when the member lookup fails", async () => {
		findMemberUserIdsByEmail.mockRejectedValue(new Error("connection reset"));
		resolveOrganizationNotificationLocale.mockResolvedValue("de");

		const result = await deliverTo(["admin@example.com"]);

		expect(result.emailsSent).toBe(1);
		expect(sentTo("admin@example.com").subject).toMatch(/^Geplanter Export/);
	});
});
