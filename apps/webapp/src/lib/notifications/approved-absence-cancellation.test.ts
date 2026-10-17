import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmailNotification } from "./email-notifications";

const { sendEmail, settings, findOverride } = vi.hoisted(() => ({
	sendEmail: vi.fn(),
	settings: { locale: "en" as string | undefined },
	findOverride: vi.fn(),
}));

// Keep routing, recipient-language resolution, catalogs, dates and HTML rendering real.
// Only the database and outbound mail transport are replaced.
vi.mock("@/db", () => ({
	db: {
		query: {
			user: {
				findFirst: async () => ({
					email: "manager@example.com",
					name: "Morgan Manager",
				}),
			},
			userSettings: { findFirst: async () => ({ locale: settings.locale }) },
			organizationNotificationSettings: { findFirst: async () => null },
			organizationDomain: {
				findFirst: async () => ({
					domain: "org.example.com",
					domainVerified: true,
				}),
			},
			organizationEmailTemplate: { findFirst: findOverride },
		},
	},
}));

vi.mock("@/lib/email/email-service", () => ({ sendEmail }));

const cancellation = {
	userId: "manager-1",
	organizationId: "org-1",
	type: "approved_absence_cancelled" as const,
	title: "Approved absence cancelled",
	message: "Avery Employee cancelled approved Vacation for Oct 24 – 26, 2026.",
	actionUrl: "/team/absences",
	metadata: {
		approvedAbsenceCancelled: true,
		employeeName: "Avery Employee",
		absenceType: "Vacation",
		i18n: {
			titleKey: "common:notifications.content.approvedAbsenceCancelled.title",
			titleDefault: "Approved absence cancelled",
			messageKey: "common:notifications.content.approvedAbsenceCancelled.message",
			messageDefault: "{employeeName} cancelled approved {categoryName} for {dateRange}.",
			params: {
				employeeName: "Avery Employee",
				categoryName: "Vacation",
				dateRange: {
					kind: "plainDateRange",
					start: "2026-10-24",
					end: "2026-10-26",
				},
			},
		},
	},
};

describe("approved absence cancellation email", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sendEmail.mockResolvedValue({ success: true });
		findOverride.mockResolvedValue({
			subject: "Absence Request Approved",
			html: "<p>{{employeeName}} requested {{absenceType}}; approver {{approverName}}</p>",
			plainText: null,
		});
	});

	it("falls back to English when the recipient and organization have no saved language", async () => {
		settings.locale = undefined;
		expect(await sendEmailNotification(cancellation)).toBe(true);
		const sent = sendEmail.mock.lastCall?.[0];
		expect(sent.subject).toBe("Approved absence cancelled");
		expect(sent.html).toContain("Avery Employee cancelled approved Vacation");
		expect(sent.html).toMatch(/Oct 24\s*–\s*26, 2026/);
	});
	it.each([
		[
			"en",
			"Approved absence cancelled",
			"Avery Employee cancelled approved Vacation",
			/Oct 24\s*–\s*26, 2026/,
		],
		[
			"de",
			"Genehmigte Abwesenheit storniert",
			"Avery Employee hat genehmigte Abwesenheit (Vacation)",
			/24\.?\s*–\s*26\. Okt\. 2026/,
		],
	])(
		"sends cancellation copy in %s even with an enabled approval override",
		async (locale, subject, text, dates) => {
			settings.locale = locale;
			// Prove the organization's approval override is active for genuine approvals.
			await sendEmailNotification({
				...cancellation,
				type: "absence_request_approved",
				metadata: { absenceType: "Vacation", approverName: "Sam Approver" },
			});
			expect(sendEmail).toHaveBeenLastCalledWith(
				expect.objectContaining({
					subject: "Absence Request Approved",
					html: expect.stringContaining("Morgan Manager requested Vacation; approver Sam Approver"),
				}),
			);

			expect(await sendEmailNotification(cancellation)).toBe(true);
			const sent = sendEmail.mock.lastCall?.[0];
			expect(sent).toMatchObject({
				to: "manager@example.com",
				organizationId: "org-1",
				subject,
			});
			expect(sent.html).toContain(text);
			expect(sent.html).toMatch(dates);
			expect(sent.html).toContain('href="https://org.example.com/team/absences"');
			expect(sent.html).not.toContain("Morgan Manager requested");
			expect(sent.html).not.toContain("approver");
		},
	);
});
