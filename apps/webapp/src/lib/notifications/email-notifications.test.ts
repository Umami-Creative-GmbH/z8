import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/email/email-service";
import {
	type RenderOrganizationEmailTemplateInput,
	renderOrganizationEmailTemplate,
} from "@/lib/email/template-renderer";
import { sendEmailNotification } from "./email-notifications";
import { EMAIL_FREE_NOTIFICATION_TYPES } from "./email-routes";

/** A stand-in for the German `emails` catalog (ICU `{name}` params only). */
const { GERMAN_EMAIL_COPY } = vi.hoisted(() => ({
	GERMAN_EMAIL_COPY: {
		"emails.notification.openAction": "Z8 öffnen",
		"emails.layout.footer": "Diese E-Mail wurde von Z8 gesendet.",
		"emails.subjects.teamMemberAdded": "Du wurdest zu {teamName} hinzugefügt",
		"emails.subjects.passwordChanged": "Sicherheitshinweis: Passwort geändert",
		"emails.securityAlert.passwordChanged.title": "Passwort geändert",
		"emails.variables.yourManager": "deine Führungskraft",
		"emails.variables.noReason": "Kein Grund angegeben",
		"emails.variables.noTime": "k. A.",
		"emails.details.category": "Kategorie",
		"emails.details.dates": "Zeitraum",
		"emails.details.range": "{start} bis {end}",
	} as Record<string, string>,
}));

const {
	debugMock,
	errorMock,
	infoMock,
	warnMock,
	findUserMock,
	getOrganizationBaseUrlMock,
	localizeOutboundNotificationMock,
	resolveOutboundNotificationPreferencesMock,
	loadOrganizationTimezoneMock,
} = vi.hoisted(() => ({
	loadOrganizationTimezoneMock: vi.fn(),
	debugMock: vi.fn(),
	errorMock: vi.fn(),
	infoMock: vi.fn(),
	warnMock: vi.fn(),
	findUserMock: vi.fn(),
	getOrganizationBaseUrlMock: vi.fn(),
	localizeOutboundNotificationMock: vi.fn(),
	resolveOutboundNotificationPreferencesMock: vi.fn(),
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

vi.mock("@/lib/timezone/load-organization-timezone", () => ({
	loadOrganizationTimezone: loadOrganizationTimezoneMock,
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

vi.mock("@/lib/email/email-i18n", () => ({
	loadEmailTranslator: async (locale: string) => ({
		locale,
		t: (key: string, defaultValue: string, params?: Record<string, unknown>) =>
			((locale === "de" ? GERMAN_EMAIL_COPY[key] : undefined) ?? defaultValue).replace(
				/\{(\w+)\}/g,
				(match, name: string) => (params && name in params ? String(params[name]) : match),
			),
	}),
}));

/** The renderer without an enabled override: the caller's default body is sent. */
async function renderWithoutOverride(input: RenderOrganizationEmailTemplateInput) {
	return {
		subject: input.subjectOverride ?? "",
		html: input.renderDefaultHtml ? await input.renderDefaultHtml() : "<p>Registry default</p>",
		usedOverride: false,
	};
}

vi.mock("./outbound-localization", () => ({
	localizeOutboundNotification: localizeOutboundNotificationMock,
	resolveOutboundNotificationPreferences: resolveOutboundNotificationPreferencesMock,
}));

const sendEmailMock = vi.mocked(sendEmail);
const renderOrganizationEmailTemplateMock = vi.mocked(renderOrganizationEmailTemplate);

describe("sendEmailNotification", () => {
	it("preserves durable console unavailability instead of treating it as a delivery error", async () => {
		sendEmailMock.mockResolvedValue({ success: false, unavailable: true });
		await expect(
			sendEmailNotification(
				{
					userId: "user_123",
					organizationId: "org",
					type: "automatic_clock_out",
					title: "Ended",
					message: "Ended",
				},
				{ throwOnError: true },
			),
		).resolves.toBe(false);
		expect(sendEmailMock).toHaveBeenCalledWith(expect.any(Object), { durable: true });
	});
	it("sends automatic clock-out generic email and propagates transport failure only for durable callers", async () => {
		const params = {
			userId: "user_123",
			organizationId: "org",
			type: "automatic_clock_out" as const,
			title: "Automatically clocked out",
			message: "720 minutes",
			actionUrl: "/calendar/employee?date=2026-10-24",
		};
		await expect(sendEmailNotification(params, { throwOnError: true })).resolves.toBe(true);
		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({
				html: expect.stringContaining("/calendar/employee?date=2026-10-24"),
			}),
			{ durable: true },
		);
		findUserMock.mockResolvedValue({ email: "alex@example.com", name: "Alex" });
		sendEmailMock.mockResolvedValue({ success: false, error: "provider unavailable" });
		await expect(sendEmailNotification(params, { throwOnError: true })).rejects.toThrow();
		await expect(sendEmailNotification(params)).resolves.toBe(false);
	});
	it("links personnel file expiry reminders to the personnel file or My documents only", async () => {
		const reminder = {
			userId: "user_123",
			organizationId: "org",
			type: "personnel_file_expiry_upcoming" as const,
			title: "A document expires soon",
			message: "Soon",
		};
		findUserMock.mockResolvedValue({ email: "alex@example.com", name: "Alex" });
		await sendEmailNotification({ ...reminder, actionUrl: "/personnel-files/emp-1" });
		await sendEmailNotification({ ...reminder, actionUrl: "/my-documents" });
		await sendEmailNotification({ ...reminder, actionUrl: "/settings/billing" });
		const links = sendEmailMock.mock.calls.map(([message]) =>
			/href="([^"]+)"/.exec(message.html ?? "")?.[1],
		);
		expect(links).toEqual([
			"https://org.example.com/personnel-files/emp-1",
			"https://org.example.com/my-documents",
			"https://org.example.com",
		]);
	});
	it("links skill expiry reminders to the employee's skills or the own profile only (#1143)", async () => {
		const reminder = {
			userId: "user_123",
			organizationId: "org",
			type: "skill_expired_today" as const,
			title: "A skill expires today",
			message: "Today",
		};
		findUserMock.mockResolvedValue({ email: "alex@example.com", name: "Alex" });
		await sendEmailNotification({ ...reminder, actionUrl: "/settings/employees/emp-1" });
		await sendEmailNotification({ ...reminder, actionUrl: "/settings/profile#skills" });
		await sendEmailNotification({ ...reminder, actionUrl: "/settings/billing" });
		const links = sendEmailMock.mock.calls.map(([message]) =>
			/href="([^"]+)"/.exec(message.html ?? "")?.[1],
		);
		expect(links).toEqual([
			"https://org.example.com/settings/employees/emp-1",
			"https://org.example.com/settings/profile#skills",
			"https://org.example.com",
		]);
	});
	it("sends deputy notifications as plain localized emails linking to the dashboard (#1013)", async () => {
		findUserMock.mockResolvedValue({ email: "alex@example.com", name: "Alex" });
		for (const type of [
			"absence_deputy_assigned",
			"absence_deputy_removed",
			"absence_deputy_dates_changed",
			"absence_deputy_reminder",
		] as const) {
			await sendEmailNotification({
				userId: "user_123",
				organizationId: "org",
				type,
				title: "Absence deputy",
				message: "You're covering for Sam (12–14 Oct 2026).",
				actionUrl: "/",
			});
		}
		expect(renderOrganizationEmailTemplateMock).not.toHaveBeenCalled();
		expect(localizeOutboundNotificationMock).toHaveBeenCalledTimes(4);
		expect(
			sendEmailMock.mock.calls.map(([message]) => /href="([^"]+)"/.exec(message.html ?? "")?.[1]),
		).toEqual(Array(4).fill("https://org.example.com/"));
	});
	it("links cover summaries to the inbox section and the deputy decisions (#1018)", async () => {
		findUserMock.mockResolvedValue({ email: "alex@example.com", name: "Alex" });
		await sendEmailNotification({
			userId: "user_123",
			organizationId: "org",
			type: "approval_cover_started",
			title: "You're covering approvals",
			message: "You're covering Sam's approvals: 2 waiting.",
			actionUrl: "/approvals/inbox#covering-emp-1",
		});
		await sendEmailNotification({
			userId: "user_123",
			organizationId: "org",
			type: "approval_cover_return_summary",
			title: "Decided while you were away",
			message: "While you were away, Sam decided 2 approvals.",
			actionUrl: "/approvals/deputy-decisions/abs-1?deputy=emp-2",
		});
		expect(renderOrganizationEmailTemplateMock).not.toHaveBeenCalled();
		expect(
			sendEmailMock.mock.calls.map(([message]) => /href="([^"]+)"/.exec(message.html ?? "")?.[1]),
		).toEqual([
			"https://org.example.com/approvals/inbox#covering-emp-1",
			"https://org.example.com/approvals/deputy-decisions/abs-1?deputy=emp-2",
		]);
	});
	beforeEach(() => {
		debugMock.mockReset();
		errorMock.mockReset();
		infoMock.mockReset();
		warnMock.mockReset();
		findUserMock.mockReset();
		getOrganizationBaseUrlMock.mockReset();
		localizeOutboundNotificationMock.mockReset();
		resolveOutboundNotificationPreferencesMock.mockReset();
		sendEmailMock.mockReset();
		renderOrganizationEmailTemplateMock.mockReset();
		findUserMock
			.mockResolvedValueOnce({ email: "alex@example.com" })
			.mockResolvedValueOnce({ name: "Alex" });
		getOrganizationBaseUrlMock.mockResolvedValue("https://org.example.com");
		resolveOutboundNotificationPreferencesMock.mockResolvedValue({ locale: "en" });
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
			renderDefaultHtml: expect.any(Function),
		});
		expect(sendEmailMock).toHaveBeenCalledWith({
			to: "alex@example.com",
			subject: "Custom absence subject",
			html: "<p>Custom absence body</p>",
			organizationId: "org_123",
		});
		expect(localizeOutboundNotificationMock).not.toHaveBeenCalled();
	});

	it("sends no email for email-free types, even with translation keys (U1)", async () => {
		for (const type of EMAIL_FREE_NOTIFICATION_TYPES) {
			const result = await sendEmailNotification(
				{
					userId: "user_123",
					type,
					title: "Original title",
					message: "Original message",
					organizationId: "org_123",
					metadata: {
						i18n: {
							titleKey: "common:notifications.content.example.title",
							messageKey: "common:notifications.content.example.message",
						},
					},
				},
				{ throwOnError: true },
			);
			expect(result, type).toBe(false);
		}

		expect(localizeOutboundNotificationMock).not.toHaveBeenCalled();
		expect(renderOrganizationEmailTemplateMock).not.toHaveBeenCalled();
		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	it("writes a de recipient's notification email in German: subject, body and button", async () => {
		resolveOutboundNotificationPreferencesMock.mockResolvedValue({ locale: "de" });
		localizeOutboundNotificationMock.mockResolvedValue({
			locale: "de",
			title: "Automatisch ausgestempelt",
			message: "Du wurdest nach 12 Stunden automatisch ausgestempelt.",
		});

		const result = await sendEmailNotification({
			userId: "user_123",
			organizationId: "org_123",
			type: "automatic_clock_out",
			title: "Automatically clocked out",
			message: "You were clocked out automatically after 12 hours.",
			actionUrl: "/calendar/employee?date=2026-10-24",
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.automaticClockOut.title",
					messageKey: "common:notifications.content.automaticClockOut.message",
				},
			},
		});

		expect(result).toBe(true);
		const message = sendEmailMock.mock.calls[0]?.[0];
		expect(message?.subject).toBe("Automatisch ausgestempelt");
		expect(message?.html).toContain('lang="de"');
		expect(message?.html).toContain("Du wurdest nach 12 Stunden automatisch ausgestempelt.");
		expect(message?.html).toContain("Z8 öffnen");
		expect(message?.html).toContain("Diese E-Mail wurde von Z8 gesendet.");
		expect(message?.html).not.toContain("Open Z8");
		expect(message?.html).not.toContain("clocked out automatically");
	});

	it("sends the shared layout, not the per-type template, when no override is enabled", async () => {
		resolveOutboundNotificationPreferencesMock.mockResolvedValue({ locale: "de" });
		localizeOutboundNotificationMock.mockResolvedValue({
			locale: "de",
			title: "Zum Team hinzugefügt",
			message: "Morgan hat dich zum Team Support hinzugefügt.",
		});
		renderOrganizationEmailTemplateMock.mockImplementation(renderWithoutOverride);

		const result = await sendEmailNotification({
			userId: "user_123",
			type: "team_member_added",
			title: "Added to team",
			message: "Morgan added you to Support.",
			organizationId: "org_123",
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.teamMemberAdded.title",
					messageKey: "common:notifications.content.teamMemberAdded.message",
					params: { teamName: "Support", teamId: "team_123", performedByName: "Morgan" },
				},
			},
		});

		expect(result).toBe(true);
		const message = sendEmailMock.mock.calls[0]?.[0];
		expect(message?.subject).toBe("Zum Team hinzugefügt");
		expect(message?.html).toContain('lang="de"');
		expect(message?.html).toContain("Morgan hat dich zum Team Support hinzugefügt.");
		expect(message?.html).toContain("Z8 öffnen");
		expect(message?.html).toContain('href="https://org.example.com/settings/teams/team_123"');
		// Not the old English team template.
		expect(message?.html).not.toContain("Welcome to the Team");
	});

	it("translates a type's subject in the recipient language when the notification has no title key", async () => {
		resolveOutboundNotificationPreferencesMock.mockResolvedValue({ locale: "de" });
		renderOrganizationEmailTemplateMock.mockImplementation(renderWithoutOverride);

		await sendEmailNotification({
			userId: "user_123",
			type: "team_member_added",
			title: "Added to team",
			message: "Morgan added you to Support.",
			organizationId: "org_123",
			metadata: { teamId: "team_123", teamName: "Support", addedByName: "Morgan" },
		});

		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith(
			expect.objectContaining({ subjectOverride: "Du wurdest zu Support hinzugefügt" }),
		);
		expect(sendEmailMock.mock.calls[0]?.[0].subject).toBe("Du wurdest zu Support hinzugefügt");
	});

	it("sends the dedicated security alert in the recipient language, timed in the org timezone", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-13T12:05:00.000Z"));
		try {
			renderOrganizationEmailTemplateMock.mockImplementation(renderWithoutOverride);
			resolveOutboundNotificationPreferencesMock.mockResolvedValue({ locale: "de" });
			loadOrganizationTimezoneMock.mockResolvedValue("Europe/Berlin");

			await sendEmailNotification({
				userId: "user_123",
				type: "password_changed",
				title: "Password changed",
				message: "Your password was changed.",
				organizationId: "org_123",
			});
		} finally {
			vi.useRealTimers();
		}

		expect(loadOrganizationTimezoneMock).toHaveBeenCalledWith(expect.anything(), "org_123");
		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				templateKey: "security-alert",
				subjectOverride: "Sicherheitshinweis: Passwort geändert",
				// Override `{{timestamp}}` gets the same org-timezone time.
				data: expect.objectContaining({
					eventType: "password_changed",
					timestamp: "13. Okt. 2026, 14:05 (Europe/Berlin)",
				}),
			}),
		);
		const html = sendEmailMock.mock.calls[0]?.[0].html ?? "";
		expect(html).toContain('lang="de"');
		expect(html).toContain("Passwort geändert");
		expect(html).toContain("13. Okt. 2026, 14:05 (Europe/Berlin)");
		expect(html).toContain('href="https://org.example.com/settings/security"');
	});

	it("localizes the notification in the user's own language when there is no organization", async () => {
		resolveOutboundNotificationPreferencesMock.mockResolvedValue({ locale: "de" });
		localizeOutboundNotificationMock.mockResolvedValue({
			locale: "de",
			title: "Abwesenheitsanfrage genehmigt",
			message: "Deine Abwesenheit wurde genehmigt.",
		});
		renderOrganizationEmailTemplateMock.mockImplementation(renderWithoutOverride);

		const result = await sendEmailNotification({
			userId: "user_123",
			type: "absence_request_approved",
			title: "Absence request approved",
			message: "Your absence request was approved.",
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
		expect(resolveOutboundNotificationPreferencesMock).toHaveBeenCalledWith({
			userId: "user_123",
			organizationId: undefined,
		});
		expect(localizeOutboundNotificationMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: "user_123", locale: "de" }),
		);
		const message = sendEmailMock.mock.calls[0]?.[0];
		expect(message?.subject).toBe("Abwesenheitsanfrage genehmigt");
		expect(message?.html).toContain("Deine Abwesenheit wurde genehmigt.");
		expect(message?.html).not.toContain("Your absence request was approved.");
	});

	it("keeps the type's subject without an organization or i18n title", async () => {
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
			locale: "en",
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
		resolveOutboundNotificationPreferencesMock.mockResolvedValue({ locale: "de" });
		renderOrganizationEmailTemplateMock.mockImplementation(renderWithoutOverride);

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
			html: expect.stringContaining(
				"Ihre Abwesenheitsanfrage wurde von Morgan &amp; Partner genehmigt.",
			),
			organizationId: "org_123",
		});
		const sentHtml = sendEmailMock.mock.calls[0]?.[0].html;
		expect(sentHtml).toContain("Abwesenheitsanfrage &lt;genehmigt&gt;");
		expect(sentHtml).toContain('href="https://org.example.com"');
		expect(sentHtml).not.toContain("Your absence request has been approved.");
	});

	it("sends an enabled override unchanged to a de recipient", async () => {
		resolveOutboundNotificationPreferencesMock.mockResolvedValue({ locale: "de" });
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
			renderDefaultHtml: expect.any(Function),
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
			renderDefaultHtml: expect.any(Function),
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

	describe("absence and time-correction emails (#1152, #1137)", () => {
		const entryTime = (at: string, preset: "dateMedium" | "time") => ({
			kind: "entryInstant",
			at,
			utcOffsetMinutes: 120,
			preset,
		});

		beforeEach(() => {
			resolveOutboundNotificationPreferencesMock.mockResolvedValue({ locale: "de" });
		});

		it("sends the manager's absence pending email with the override variables in the recipient language", async () => {
			const result = await sendEmailNotification({
				userId: "user_123",
				type: "approval_request_submitted",
				title: "New absence request",
				message: "Avery requested Vacation.",
				organizationId: "org_123",
				actionUrl: "/approvals/inbox",
				metadata: {
					approvalSubject: "absence",
					i18n: {
						params: {
							employeeName: "Avery",
							categoryName: "Vacation",
							startDate: { kind: "plainDate", date: "2026-05-11" },
							endDate: { kind: "plainDate", date: "2026-05-12" },
							days: 2,
							notes: "Family trip",
						},
					},
				},
			});

			expect(result).toBe(true);
			expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith(
				expect.objectContaining({
					organizationId: "org_123",
					templateKey: "absence-request-pending-approval",
					data: {
						managerName: "Alex",
						employeeName: "Avery",
						startDate: "11. Mai 2026",
						endDate: "12. Mai 2026",
						absenceType: "Vacation",
						days: 2,
						notes: "Family trip",
						approvalUrl: "https://org.example.com/approvals/inbox",
					},
				}),
			);
			expect(sendEmailMock).toHaveBeenCalledOnce();
			expect(sendEmailMock).toHaveBeenCalledWith(
				expect.objectContaining({ to: "alex@example.com", organizationId: "org_123" }),
			);
		});

		it("fills the recorded-by-manager email's dates from the typed params (#1153)", async () => {
			await sendEmailNotification({
				userId: "user_123",
				type: "absence_request_approved",
				title: "Absence recorded",
				message: "Morgan recorded Sick Leave.",
				organizationId: "org_123",
				metadata: {
					managerRecorded: true,
					managerName: "Morgan",
					absenceType: "Sick Leave",
					days: 2,
					i18n: {
						params: {
							managerName: "Morgan",
							absenceType: "Sick Leave",
							startDate: { kind: "plainDate", date: "2026-05-11" },
							endDate: { kind: "plainDate", date: "2026-05-12" },
							days: 2,
						},
					},
				},
			});

			expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith(
				expect.objectContaining({
					templateKey: "absence-recorded-by-manager",
					data: expect.objectContaining({
						managerName: "Morgan",
						startDate: "11. Mai 2026",
						endDate: "12. Mai 2026",
						absenceType: "Sick Leave",
						days: 2,
					}),
				}),
			);
		});

		it("sends the manager's time-correction pending email with times at the entry's offset", async () => {
			renderOrganizationEmailTemplateMock.mockImplementation(renderWithoutOverride);

			const result = await sendEmailNotification({
				userId: "user_123",
				type: "approval_request_submitted",
				title: "New time correction request",
				message: "Avery submitted a time correction request.",
				organizationId: "org_123",
				actionUrl: "/approvals/inbox",
				metadata: {
					approvalSubject: "time_correction",
					i18n: {
						params: {
							employeeName: "Avery",
							reason: "Forgot to clock in",
							date: entryTime("2026-05-11T08:00:00Z", "dateMedium"),
							originalClockIn: entryTime("2026-05-11T08:00:00Z", "time"),
							correctedClockIn: entryTime("2026-05-11T07:15:00Z", "time"),
							correctedClockOut: entryTime("2026-05-11T15:00:00Z", "time"),
						},
					},
				},
			});

			expect(result).toBe(true);
			expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith(
				expect.objectContaining({
					templateKey: "time-correction-pending-approval",
					data: {
						managerName: "Alex",
						employeeName: "Avery",
						date: "11. Mai 2026",
						originalClockIn: "10:00",
						originalClockOut: "k. A.",
						correctedClockIn: "09:15",
						correctedClockOut: "17:00",
						reason: "Forgot to clock in",
						approvalUrl: "https://org.example.com/approvals/inbox",
					},
				}),
			);
			expect(sendEmailMock.mock.calls[0]?.[0].html).toContain(
				'href="https://org.example.com/approvals/inbox"',
			);
		});

		it("sends the employee's absence rejection email with the reason and calendar dates", async () => {
			await sendEmailNotification({
				userId: "user_123",
				type: "absence_request_rejected",
				title: "Absence request rejected",
				message: "Your Vacation request was rejected.",
				organizationId: "org_123",
				metadata: {
					i18n: {
						params: {
							approverName: "Morgan",
							categoryName: "Vacation",
							startDate: { kind: "plainDate", date: "2026-05-11" },
							endDate: { kind: "plainDate", date: "2026-05-12" },
							days: 2,
							rejectionReason: "Team offsite",
						},
					},
				},
			});

			expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith(
				expect.objectContaining({
					templateKey: "absence-request-rejected",
					data: {
						employeeName: "Alex",
						approverName: "Morgan",
						startDate: "11. Mai 2026",
						endDate: "12. Mai 2026",
						absenceType: "Vacation",
						days: 2,
						rejectionReason: "Team offsite",
						appUrl: "https://org.example.com",
					},
				}),
			);
		});

		it("sends the employee's time-correction decision emails (#1137)", async () => {
			const params = {
				approverName: "Morgan",
				date: entryTime("2026-05-11T07:15:00Z", "dateMedium"),
				correctedClockIn: entryTime("2026-05-11T07:15:00Z", "time"),
			};
			await sendEmailNotification({
				userId: "user_123",
				type: "time_correction_approved",
				title: "Time correction approved",
				message: "Your time correction request was approved by Morgan.",
				organizationId: "org_123",
				metadata: { i18n: { params } },
			});
			findUserMock
				.mockResolvedValueOnce({ email: "alex@example.com" })
				.mockResolvedValueOnce({ name: "Alex" });
			await sendEmailNotification({
				userId: "user_123",
				type: "time_correction_rejected",
				title: "Time correction rejected",
				message: "Your time correction request was rejected by Morgan.",
				organizationId: "org_123",
				metadata: { i18n: { params: { ...params, rejectionReason: "Not plausible" } } },
			});

			const decided = {
				employeeName: "Alex",
				approverName: "Morgan",
				date: "11. Mai 2026",
				correctedClockIn: "09:15",
				correctedClockOut: "k. A.",
				appUrl: "https://org.example.com",
			};
			expect(renderOrganizationEmailTemplateMock.mock.calls.map(([input]) => input.data)).toEqual([
				decided,
				{ ...decided, rejectionReason: "Not plausible" },
			]);
			expect(sendEmailMock).toHaveBeenCalledTimes(2);
		});

		it("shows the absence's dates, duration, category and notes as detail rows (#812 §4)", async () => {
			renderOrganizationEmailTemplateMock.mockImplementation(renderWithoutOverride);

			await sendEmailNotification({
				userId: "user_123",
				type: "approval_request_submitted",
				title: "New absence request",
				message: "Avery requested Vacation.",
				organizationId: "org_123",
				metadata: {
					approvalSubject: "absence",
					i18n: {
						params: {
							employeeName: "Avery",
							categoryName: "Vacation",
							startDate: { kind: "plainDate", date: "2026-05-11" },
							endDate: { kind: "plainDate", date: "2026-05-12" },
							days: 2,
							notes: "Family trip",
						},
					},
				},
			});

			const html = sendEmailMock.mock.calls[0]?.[0].html ?? "";
			expect(html).toContain("Zeitraum");
			expect(html).toContain("11. Mai 2026 bis 12. Mai 2026");
			expect(html).toContain("Kategorie");
			expect(html).toContain("Vacation");
			expect(html).toMatch(/>Days<\/p>\s*<p[^>]*>2<\/p>/);
			expect(html).toContain("Family trip");
		});

		it("shows the original and corrected times and the reason as detail rows", async () => {
			renderOrganizationEmailTemplateMock.mockImplementation(renderWithoutOverride);

			await sendEmailNotification({
				userId: "user_123",
				type: "approval_request_submitted",
				title: "New time correction request",
				message: "Avery submitted a time correction request.",
				organizationId: "org_123",
				metadata: {
					approvalSubject: "time_correction",
					i18n: {
						params: {
							employeeName: "Avery",
							reason: "Forgot to clock in",
							date: entryTime("2026-05-11T08:00:00Z", "dateMedium"),
							originalClockIn: entryTime("2026-05-11T08:00:00Z", "time"),
							correctedClockIn: entryTime("2026-05-11T07:15:00Z", "time"),
							correctedClockOut: entryTime("2026-05-11T15:00:00Z", "time"),
						},
					},
				},
			});

			const html = sendEmailMock.mock.calls[0]?.[0].html ?? "";
			expect(html).toContain("11. Mai 2026");
			expect(html).toContain("10:00 bis k. A.");
			expect(html).toContain("09:15 bis 17:00");
			expect(html).toContain("Forgot to clock in");
		});

		it("fills missing override variables in the recipient language", async () => {
			await sendEmailNotification({
				userId: "user_123",
				type: "absence_request_submitted",
				title: "Absence request submitted",
				message: "Submitted",
				organizationId: "org_123",
				metadata: { categoryName: "Vacation", startDate: "11. Mai", endDate: "12. Mai" },
			});
			findUserMock
				.mockResolvedValueOnce({ email: "alex@example.com" })
				.mockResolvedValueOnce({ name: "Alex" });
			await sendEmailNotification({
				userId: "user_123",
				type: "time_correction_rejected",
				title: "Time correction rejected",
				message: "Rejected",
				organizationId: "org_123",
				metadata: { approverName: "Morgan", date: "11. Mai 2026" },
			});

			const [submitted, rejected] = renderOrganizationEmailTemplateMock.mock.calls.map(
				([input]) => input.data,
			);
			expect(submitted).toMatchObject({ managerName: "deine Führungskraft" });
			expect(rejected).toMatchObject({
				correctedClockIn: "k. A.",
				correctedClockOut: "k. A.",
				rejectionReason: "Kein Grund angegeben",
			});
		});

		it("formats typed override variables in the recipient's own hour cycle", async () => {
			resolveOutboundNotificationPreferencesMock.mockResolvedValue({
				locale: "de",
				timeFormat: "12h",
			});

			await sendEmailNotification({
				userId: "user_123",
				type: "time_correction_approved",
				title: "Time correction approved",
				message: "Approved",
				organizationId: "org_123",
				metadata: {
					i18n: {
						params: {
							approverName: "Morgan",
							correctedClockIn: entryTime("2026-05-11T13:15:00Z", "time"),
						},
					},
				},
			});

			const data = renderOrganizationEmailTemplateMock.mock.calls[0]?.[0].data;
			expect(String(data?.correctedClockIn)).toMatch(/^3:15\s?PM$/i);
		});

		it("never sends the employee's own submitted notification as the manager's pending email (O8)", async () => {
			const result = await sendEmailNotification({
				userId: "user_123",
				type: "time_correction_submitted",
				title: "Time correction submitted",
				message: "Your time correction request is pending approval.",
				organizationId: "org_123",
				metadata: { employeeName: "Alex" },
			});

			expect(result).toBe(false);
			expect(renderOrganizationEmailTemplateMock).not.toHaveBeenCalled();
			expect(sendEmailMock).not.toHaveBeenCalled();
		});
	});

	it("supplies typed override variables formatted in the recipient language (#1149)", async () => {
		resolveOutboundNotificationPreferencesMock.mockResolvedValue({ locale: "de" });
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
						dateRange: { kind: "plainDateRange", start: "2026-05-01", end: "2026-05-02" },
					},
				},
			},
		});

		expect(result).toBe(true);
		expect(resolveOutboundNotificationPreferencesMock).toHaveBeenCalledWith({
			userId: "user_123",
			organizationId: "org_123",
		});
		expect(renderOrganizationEmailTemplateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ startDate: "1.–2. Mai 2026", endDate: "1.–2. Mai 2026" }),
			}),
		);
		// The localized body is rendered in the same, already resolved language.
		expect(localizeOutboundNotificationMock).toHaveBeenCalledWith(
			expect.objectContaining({ locale: "de" }),
		);
	});
});
