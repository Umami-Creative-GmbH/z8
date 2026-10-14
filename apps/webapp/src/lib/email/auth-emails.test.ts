import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	memberFindFirstMock,
	userSettingsFindFirstMock,
	orgSettingsFindFirstMock,
	sendEmailMock,
	renderTemplateMock,
	getOrganizationBaseUrlMock,
} = vi.hoisted(() => ({
	memberFindFirstMock: vi.fn(),
	userSettingsFindFirstMock: vi.fn(),
	orgSettingsFindFirstMock: vi.fn(),
	sendEmailMock: vi.fn(),
	renderTemplateMock: vi.fn(),
	getOrganizationBaseUrlMock: vi.fn(),
}));

/** Stand-ins for the `emails` catalogs (until Tolgee sync fills them). */
const { CATALOGS } = vi.hoisted(() => ({
	CATALOGS: {
		de: {
			"emails.subjects.verifyEmail": "Bestätige deine E-Mail-Adresse",
			"emails.verification.title": "E-Mail-Adresse bestätigen",
		},
		fr: {
			"emails.subjects.passwordReset": "Réinitialisez votre mot de passe",
			"emails.passwordReset.title": "Réinitialiser le mot de passe",
		},
		it: {
			"emails.subjects.organizationInvitation": "Sei stato invitato in {organizationName}",
			"emails.invitation.title": "Invito a {organizationName}",
		},
	} as Record<string, Record<string, string>>,
}));

vi.mock("drizzle-orm", () => ({
	eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
	asc: (column: unknown) => ({ asc: column }),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			member: { findFirst: memberFindFirstMock },
			userSettings: { findFirst: userSettingsFindFirstMock },
			organizationNotificationSettings: { findFirst: orgSettingsFindFirstMock },
		},
	},
}));

vi.mock("@/db/auth-schema", () => ({
	member: { userId: "member.userId", createdAt: "member.createdAt", id: "member.id" },
}));

vi.mock("@/db/schema", () => ({
	userSettings: { userId: "userSettings.userId" },
	organizationNotificationSettings: { organizationId: "orgSettings.organizationId" },
}));

vi.mock("@/lib/app-url", () => ({ getOrganizationBaseUrl: getOrganizationBaseUrlMock }));
vi.mock("./email-service", () => ({ sendEmail: sendEmailMock }));
vi.mock("./template-renderer", () => ({ renderOrganizationEmailTemplate: renderTemplateMock }));
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ warn: vi.fn() }) }));

vi.mock("./email-i18n", () => ({
	loadEmailTranslator: async (locale: string) => ({
		locale,
		t: (key: string, defaultValue: string, params?: Record<string, unknown>) =>
			(CATALOGS[locale]?.[key] ?? defaultValue).replace(/\{(\w+)\}/g, (match, name: string) =>
				params && name in params ? String(params[name]) : match,
			),
	}),
}));

import {
	sendOrganizationInvitationEmail,
	sendPasswordResetEmail,
	sendVerificationEmail,
} from "./auth-emails";

const user = { id: "user-1", email: "alex@example.com", name: "Alex" };

function request(headers: Record<string, string>) {
	return new Request("https://app.example.com/api/auth/sign-up/email", { headers });
}

function sentEmail() {
	expect(sendEmailMock).toHaveBeenCalledTimes(1);
	return sendEmailMock.mock.calls[0]?.[0] as { to: string; subject: string; html: string };
}

describe("sign-in and invitation emails", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		memberFindFirstMock.mockResolvedValue(undefined);
		userSettingsFindFirstMock.mockResolvedValue(undefined);
		orgSettingsFindFirstMock.mockResolvedValue(undefined);
		getOrganizationBaseUrlMock.mockResolvedValue("https://app.example.com");
		sendEmailMock.mockResolvedValue({ success: true });
		// No enabled override: the caller's translated default is sent.
		renderTemplateMock.mockImplementation(
			async (input: { subjectOverride: string; renderDefaultHtml: () => Promise<string> }) => ({
				subject: input.subjectOverride,
				html: await input.renderDefaultHtml(),
				usedOverride: false,
			}),
		);
	});

	describe("verification email", () => {
		it("follows the page language of a sign-up from /de/ when nothing is saved", async () => {
			await sendVerificationEmail({
				user,
				url: "http://localhost:3000/api/auth/verify-email?token=abc",
				request: request({ cookie: "NEXT_LOCALE=de", "accept-language": "en-US" }),
			});

			const email = sentEmail();
			expect(email.to).toBe("alex@example.com");
			expect(email.subject).toBe("Bestätige deine E-Mail-Adresse");
			expect(email.html).toContain('lang="de"');
			expect(email.html).toContain("E-Mail-Adresse bestätigen");
			expect(email.html).toContain("https://app.example.com/api/auth/verify-email?token=abc");
		});

		it("follows Accept-Language without a cookie", async () => {
			await sendVerificationEmail({
				user,
				url: "http://localhost:3000/api/auth/verify-email?token=abc",
				request: request({ "accept-language": "de-AT,de;q=0.9" }),
			});

			expect(sentEmail().subject).toBe("Bestätige deine E-Mail-Adresse");
		});

		it("uses the earliest organization's default without a page language, else English", async () => {
			memberFindFirstMock.mockResolvedValue({ organizationId: "org-1" });
			orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "de" });
			getOrganizationBaseUrlMock.mockResolvedValue("https://acme.example.com");

			await sendVerificationEmail({ user, url: "http://localhost/verify?token=a" });

			expect(memberFindFirstMock).toHaveBeenCalledWith(
				expect.objectContaining({
					orderBy: [{ asc: "member.createdAt" }, { asc: "member.id" }],
				}),
			);
			expect(sentEmail().subject).toBe("Bestätige deine E-Mail-Adresse");
			expect(sendEmailMock).toHaveBeenCalledWith(
				expect.objectContaining({
					organizationId: "org-1",
					actionUrl: "https://acme.example.com/verify?token=a",
				}),
			);

			sendEmailMock.mockClear();
			memberFindFirstMock.mockResolvedValue(undefined);
			await sendVerificationEmail({ user, url: "http://localhost/verify?token=a" });
			expect(sentEmail().subject).toBe("Verify your email address");
		});
	});

	describe("password reset email", () => {
		it("uses the saved language whatever cookie the request carries", async () => {
			userSettingsFindFirstMock.mockResolvedValue({ locale: "fr" });

			await sendPasswordResetEmail({
				user,
				url: "http://localhost:3000/reset-password/abc?callbackURL=%2F",
				request: request({ cookie: "NEXT_LOCALE=de", "accept-language": "de" }),
			});

			const email = sentEmail();
			expect(email.subject).toBe("Réinitialisez votre mot de passe");
			expect(email.html).toContain('lang="fr"');
			expect(email.html).toContain("Réinitialiser le mot de passe");
		});
	});

	describe("invitation email", () => {
		it("is written in the inviting organization's default language", async () => {
			orgSettingsFindFirstMock.mockResolvedValue({ defaultLanguage: "it" });

			await sendOrganizationInvitationEmail({
				organizationId: "org-1",
				organizationName: "Acme",
				email: "new@example.com",
				inviterName: "Sam",
				role: "member",
				invitationUrl: "https://acme.example.com/accept-invitation/inv-1",
			});

			const email = sentEmail();
			expect(email.to).toBe("new@example.com");
			expect(email.subject).toBe("Sei stato invitato in Acme");
			expect(email.html).toContain('lang="it"');
			expect(email.html).toContain("Invito a Acme");
			// The inviter's own saved language plays no part.
			expect(userSettingsFindFirstMock).not.toHaveBeenCalled();
			expect(sendEmailMock).toHaveBeenCalledWith(
				expect.objectContaining({ organizationId: "org-1" }),
			);
		});
	});
});
