import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/email/email-service";
import { renderOrganizationEmailTemplate } from "@/lib/email/template-renderer";
import { sendEmailNotification } from "./email-notifications";

const {
	debugMock,
	errorMock,
	infoMock,
	warnMock,
	findUserMock,
	getOrganizationBaseUrlMock,
	localizeOutboundNotificationMock,
} =
	vi.hoisted(() => ({
		debugMock: vi.fn(),
		errorMock: vi.fn(),
		infoMock: vi.fn(),
		warnMock: vi.fn(),
		findUserMock: vi.fn(),
		getOrganizationBaseUrlMock: vi.fn(),
		localizeOutboundNotificationMock: vi.fn(),
	}));

vi.mock("@/db", () => ({
	db: {
		query: {
			user: {
				findFirst: findUserMock,
			},
		},
	},
}));

vi.mock("@/db/auth-schema", () => ({
	user: {
		id: "id",
	},
}));

vi.mock("@/lib/app-url", () => ({
	getOrganizationBaseUrl: getOrganizationBaseUrlMock,
}));

vi.mock("@/lib/email/email-service", () => ({
	sendEmail: vi.fn(),
}));

vi.mock("@/lib/email/template-renderer", () => ({
	renderOrganizationEmailTemplate: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		debug: debugMock,
		error: errorMock,
		info: infoMock,
		warn: warnMock,
	}),
}));

vi.mock("./outbound-localization", () => ({
	localizeOutboundNotification: localizeOutboundNotificationMock,
}));

const sendEmailMock = vi.mocked(sendEmail);
const renderOrganizationEmailTemplateMock = vi.mocked(renderOrganizationEmailTemplate);

describe("sendEmailNotification", () => {
	beforeEach(() => {
		debugMock.mockReset();
		errorMock.mockReset();
		infoMock.mockReset();
		warnMock.mockReset();
		findUserMock.mockReset();
		getOrganizationBaseUrlMock.mockReset();
		localizeOutboundNotificationMock.mockReset();
		sendEmailMock.mockReset();
		renderOrganizationEmailTemplateMock.mockReset();
		findUserMock
			.mockResolvedValueOnce({ email: "alex@example.com" })
			.mockResolvedValueOnce({ name: "Alex" });
		getOrganizationBaseUrlMock.mockResolvedValue("https://org.example.com");
		localizeOutboundNotificationMock.mockResolvedValue({
			locale: "en",
			title: "Original title",
			message: "Original message",
		});
		renderOrganizationEmailTemplateMock.mockResolvedValue({
			subject: "Custom absence subject",
			html: "<p>Custom absence body</p>",
			usedOverride: true,
		});
		sendEmailMock.mockResolvedValue({ success: true, messageId: "msg_123" });
	});

	it("renders notification email content through organization template overrides before sending", async () => {
		const result = await sendEmailNotification({
			userId: "user_123",
			type: "absence_request_approved",
			title: "Original title",
			message: "Original message",
			organizationId: "org_123",
			metadata: {
				approverName: "Morgan",
				startDate: "2026-05-01",
				endDate: "2026-05-02",
				absenceType: "Vacation",
				days: 2,
			},
		});

		expect(result).toBe(true);
		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith({
			organizationId: "org_123",
			templateKey: "absence-request-approved",
			data: {
				employeeName: "Alex",
				approverName: "Morgan",
				startDate: "2026-05-01",
				endDate: "2026-05-02",
				absenceType: "Vacation",
				days: 2,
				appUrl: "https://org.example.com",
			},
			subjectOverride: "Absence Request Approved",
		});
		expect(sendEmailMock).toHaveBeenCalledWith({
			to: "alex@example.com",
			subject: "Custom absence subject",
			html: "<p>Custom absence body</p>",
			organizationId: "org_123",
		});
		expect(localizeOutboundNotificationMock).not.toHaveBeenCalled();
	});

	it("does not localize skipped notification types even with i18n title metadata", async () => {
		const result = await sendEmailNotification({
			userId: "user_123",
			type: "birthday_reminder",
			title: "Original title",
			message: "Original message",
			organizationId: "org_123",
			metadata: {
				i18n: {
					titleKey: "notifications.birthday.title",
				},
			},
		});

		expect(result).toBe(false);
		expect(localizeOutboundNotificationMock).not.toHaveBeenCalled();
		expect(renderOrganizationEmailTemplateMock).not.toHaveBeenCalled();
		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	it("preserves default subject when organization is missing even with i18n title metadata", async () => {
		const result = await sendEmailNotification({
			userId: "user_123",
			type: "absence_request_approved",
			title: "Original title",
			message: "Original message",
			metadata: {
				approverName: "Morgan",
				startDate: "2026-05-01",
				endDate: "2026-05-02",
				absenceType: "Vacation",
				days: 2,
				i18n: {
					titleKey: "notifications.absence.requestApproved.title",
				},
			},
		});

		expect(result).toBe(true);
		expect(localizeOutboundNotificationMock).not.toHaveBeenCalled();
		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: undefined,
				templateKey: "absence-request-approved",
				subjectOverride: "Absence Request Approved",
			}),
		);
	});

	it("uses localized notification title as subject override when notification metadata has an i18n title key", async () => {
		localizeOutboundNotificationMock.mockResolvedValue({
			locale: "de",
			title: "Abwesenheitsanfrage genehmigt",
			message: "Original message",
		});

		const result = await sendEmailNotification({
			userId: "user_123",
			type: "absence_request_approved",
			title: "Original title",
			message: "Original message",
			organizationId: "org_123",
			metadata: {
				approverName: "Morgan",
				startDate: "2026-05-01",
				endDate: "2026-05-02",
				absenceType: "Vacation",
				days: 2,
				i18n: {
					titleKey: "notifications.absence.requestApproved.title",
				},
			},
		});

		expect(result).toBe(true);
		expect(localizeOutboundNotificationMock).toHaveBeenCalledWith({
			userId: "user_123",
			organizationId: "org_123",
			title: "Original title",
			message: "Original message",
			metadata: {
				approverName: "Morgan",
				startDate: "2026-05-01",
				endDate: "2026-05-02",
				absenceType: "Vacation",
				days: 2,
				i18n: {
					titleKey: "notifications.absence.requestApproved.title",
				},
			},
		});
		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				subjectOverride: "Abwesenheitsanfrage genehmigt",
			}),
		);
	});

	it("replaces default rendered email body with localized notification content when no organization override is used", async () => {
		localizeOutboundNotificationMock.mockResolvedValue({
			locale: "de",
			title: "Abwesenheitsanfrage <genehmigt>",
			message: "Ihre Abwesenheitsanfrage wurde von Morgan & Partner genehmigt.",
		});
		renderOrganizationEmailTemplateMock.mockResolvedValue({
			subject: "Abwesenheitsanfrage <genehmigt>",
			html: "<p>Your absence request has been approved.</p>",
			usedOverride: false,
		});

		const result = await sendEmailNotification({
			userId: "user_123",
			type: "absence_request_approved",
			title: "Original title",
			message: "Your absence request has been approved.",
			organizationId: "org_123",
			metadata: {
				approverName: "Morgan",
				startDate: "2026-05-01",
				endDate: "2026-05-02",
				absenceType: "Vacation",
				days: 2,
				i18n: {
					titleKey: "common:notifications.content.absenceRequestApproved.title",
					messageKey: "common:notifications.content.absenceRequestApproved.message",
				},
			},
		});

		expect(result).toBe(true);
		expect(sendEmailMock).toHaveBeenCalledWith({
			to: "alex@example.com",
			subject: "Abwesenheitsanfrage <genehmigt>",
			html: expect.stringContaining("Ihre Abwesenheitsanfrage wurde von Morgan &amp; Partner genehmigt."),
			organizationId: "org_123",
		});
		const sentHtml = sendEmailMock.mock.calls[0]?.[0].html;
		expect(sentHtml).toContain("Abwesenheitsanfrage &lt;genehmigt&gt;");
		expect(sentHtml).toContain('href="https://org.example.com"');
		expect(sentHtml).not.toContain("Your absence request has been approved.");
	});

	it("preserves organization override email body when localized notification metadata exists", async () => {
		localizeOutboundNotificationMock.mockResolvedValue({
			locale: "de",
			title: "Abwesenheitsanfrage genehmigt",
			message: "Ihre Abwesenheitsanfrage wurde genehmigt.",
		});
		renderOrganizationEmailTemplateMock.mockResolvedValue({
			subject: "Custom localized subject",
			html: "<p>Organization custom content</p>",
			usedOverride: true,
		});

		const result = await sendEmailNotification({
			userId: "user_123",
			type: "absence_request_approved",
			title: "Original title",
			message: "Your absence request has been approved.",
			organizationId: "org_123",
			metadata: {
				approverName: "Morgan",
				startDate: "2026-05-01",
				endDate: "2026-05-02",
				absenceType: "Vacation",
				days: 2,
				i18n: {
					titleKey: "common:notifications.content.absenceRequestApproved.title",
					messageKey: "common:notifications.content.absenceRequestApproved.message",
				},
			},
		});

		expect(result).toBe(true);
		expect(sendEmailMock).toHaveBeenCalledWith({
			to: "alex@example.com",
			subject: "Custom localized subject",
			html: "<p>Organization custom content</p>",
			organizationId: "org_123",
		});
	});

	it("routes manager-recorded approved absence notifications to the manager-recorded template", async () => {
		const result = await sendEmailNotification({
			userId: "user_123",
			type: "absence_request_approved",
			title: "Absence recorded",
			message: "Original message",
			organizationId: "org_123",
			metadata: {
				managerRecorded: true,
				managerName: "Morgan",
				startDate: "2026-05-01",
				endDate: "2026-05-02",
				absenceType: "Sick Leave",
				days: 2,
			},
		});

		expect(result).toBe(true);
		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith({
			organizationId: "org_123",
			templateKey: "absence-recorded-by-manager",
			data: {
				employeeName: "Alex",
				managerName: "Morgan",
				startDate: "2026-05-01",
				endDate: "2026-05-02",
				absenceType: "Sick Leave",
				days: 2,
				appUrl: "https://org.example.com",
			},
			subjectOverride: "Absence Recorded",
		});
	});

	it("preserves dynamic team member notification subjects as template subject overrides", async () => {
		renderOrganizationEmailTemplateMock.mockResolvedValue({
			subject: "You've been added to Support",
			html: "<p>Custom team body</p>",
			usedOverride: false,
		});

		const result = await sendEmailNotification({
			userId: "user_123",
			type: "team_member_added",
			title: "Original team title",
			message: "Original message",
			organizationId: "org_123",
			metadata: {
				teamId: "team_123",
				teamName: "Support",
				addedByName: "Morgan",
			},
		});

		expect(result).toBe(true);
		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith({
			organizationId: "org_123",
			templateKey: "team-member-added",
			data: {
				memberName: "Alex",
				teamName: "Support",
				addedByName: "Morgan",
				teamUrl: "https://org.example.com/settings/teams/team_123",
				appUrl: "https://org.example.com",
			},
			subjectOverride: "You've been added to Support",
		});
	});

	it("populates team member added override data from i18n params metadata", async () => {
		renderOrganizationEmailTemplateMock.mockResolvedValue({
			subject: "Custom team added subject",
			html: "<p>Custom team added body</p>",
			usedOverride: true,
		});

		const result = await sendEmailNotification({
			userId: "user_123",
			type: "team_member_added",
			title: "Added to team",
			message: "Original message",
			organizationId: "org_123",
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.teamMemberAdded.title",
					messageKey: "common:notifications.content.teamMemberAdded.message",
					params: {
						teamName: "Support",
						performedByName: "Morgan",
					},
				},
			},
		});

		expect(result).toBe(true);
		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				templateKey: "team-member-added",
				data: expect.objectContaining({
					teamName: "Support",
					addedByName: "Morgan",
				}),
			}),
		);
		expect(sendEmailMock).toHaveBeenCalledWith({
			to: "alex@example.com",
			subject: "Custom team added subject",
			html: "<p>Custom team added body</p>",
			organizationId: "org_123",
		});
	});

	it("populates team member removed override data from i18n params metadata", async () => {
		renderOrganizationEmailTemplateMock.mockResolvedValue({
			subject: "Custom team removed subject",
			html: "<p>Custom team removed body</p>",
			usedOverride: true,
		});

		const result = await sendEmailNotification({
			userId: "user_123",
			type: "team_member_removed",
			title: "Removed from team",
			message: "Original message",
			organizationId: "org_123",
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.teamMemberRemoved.title",
					messageKey: "common:notifications.content.teamMemberRemoved.message",
					params: {
						teamName: "Support",
						performedByName: "Morgan",
					},
				},
			},
		});

		expect(result).toBe(true);
		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				templateKey: "team-member-removed",
				data: expect.objectContaining({
					teamName: "Support",
					removedByName: "Morgan",
				}),
			}),
		);
		expect(sendEmailMock).toHaveBeenCalledWith({
			to: "alex@example.com",
			subject: "Custom team removed subject",
			html: "<p>Custom team removed body</p>",
			organizationId: "org_123",
		});
	});

	it("populates submitted absence override data from i18n params metadata", async () => {
		const result = await sendEmailNotification({
			userId: "user_123",
			type: "absence_request_submitted",
			title: "Absence request submitted",
			message: "Original message",
			organizationId: "org_123",
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.absenceRequestSubmitted.title",
					messageKey: "common:notifications.content.absenceRequestSubmitted.message",
					params: {
						categoryName: "Vacation",
						dateRange: "May 1, 2026 - May 2, 2026",
					},
				},
			},
		});

		expect(result).toBe(true);
		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				templateKey: "absence-request-submitted",
				data: expect.objectContaining({
					absenceType: "Vacation",
					startDate: "May 1, 2026 - May 2, 2026",
					endDate: "May 1, 2026 - May 2, 2026",
				}),
			}),
		);
	});
});
