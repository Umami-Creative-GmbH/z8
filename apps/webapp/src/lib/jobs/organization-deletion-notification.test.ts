import { beforeEach, describe, expect, it, vi } from "vitest";

const { findManyMock, sendEmailMock, resolveLocaleMock, loadTimezoneMock } = vi.hoisted(() => ({
	findManyMock: vi.fn(),
	sendEmailMock: vi.fn(),
	resolveLocaleMock: vi.fn(),
	loadTimezoneMock: vi.fn(),
}));

/** A stand-in for the German `emails` catalog (until Tolgee sync fills it). */
const { GERMAN } = vi.hoisted(() => ({
	GERMAN: {
		"emails.subjects.organizationDeletion": "Organisation {organizationName} wird gelöscht",
		"emails.organizationDeletion.title": "Organisation zur Löschung vorgemerkt",
	} as Record<string, string>,
}));

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ and: conditions }),
	eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
	inArray: (column: unknown, values: unknown) => ({ inArray: [column, values] }),
}));
vi.mock("@/db", () => ({ db: { query: { member: { findMany: findManyMock } } } }));
vi.mock("@/db/auth-schema", () => ({
	member: { organizationId: "member.organizationId", role: "member.role" },
}));
vi.mock("@/lib/app-url", () => ({
	getOrganizationBaseUrl: async () => "https://acme.example.com",
}));
vi.mock("@/lib/email/email-service", () => ({ sendEmail: sendEmailMock }));
vi.mock("@/lib/notifications/recipient-locale", () => ({
	resolveRecipientNotificationLocale: resolveLocaleMock,
}));
vi.mock("@/lib/timezone/load-organization-timezone", () => ({
	loadOrganizationTimezone: loadTimezoneMock,
}));
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/lib/email/email-i18n", () => ({
	loadEmailTranslator: async (locale: string) => ({
		locale,
		t: (key: string, defaultValue: string, params?: Record<string, unknown>) =>
			((locale === "de" ? GERMAN[key] : undefined) ?? defaultValue).replace(
				/\{(\w+)\}/g,
				(match, name: string) => (params && name in params ? String(params[name]) : match),
			),
	}),
}));

import { sendOrganizationDeletionNotifications } from "./organization-deletion-notification";

function emailTo(address: string) {
	const call = sendEmailMock.mock.calls.find(([message]) => message.to === address);
	expect(call).toBeDefined();
	return call?.[0] as { subject: string; html: string; organizationId: string; actionUrl: string };
}

describe("sendOrganizationDeletionNotifications", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sendEmailMock.mockResolvedValue({ success: true });
		loadTimezoneMock.mockResolvedValue("Europe/Berlin");
		findManyMock.mockResolvedValue([
			{ role: "owner", user: { id: "u-de", email: "de@example.com", name: "Dora" } },
			{ role: "admin", user: { id: "u-en", email: "en@example.com", name: "Eli" } },
		]);
		resolveLocaleMock.mockImplementation(async ({ userId }: { userId: string }) =>
			userId === "u-de" ? "de" : "en",
		);
	});

	it("emails owners and admins of the organization, each in their language", async () => {
		await sendOrganizationDeletionNotifications({
			organizationId: "org-1",
			organizationName: "Acme",
			deletedByName: "Sam",
			deletionDate: "2026-10-13T12:05:00.000Z",
		});

		expect(findManyMock).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					and: [
						{ eq: ["member.organizationId", "org-1"] },
						{ inArray: ["member.role", ["owner", "admin"]] },
					],
				},
			}),
		);
		expect(resolveLocaleMock).toHaveBeenCalledWith({ userId: "u-de", organizationId: "org-1" });

		const german = emailTo("de@example.com");
		expect(german.subject).toBe("Organisation Acme wird gelöscht");
		expect(german.organizationId).toBe("org-1");
		expect(german.actionUrl).toBe("https://acme.example.com/settings/organizations");
		expect(german.html).toContain('lang="de"');
		expect(german.html).toContain("Organisation zur Löschung vorgemerkt");

		const english = emailTo("en@example.com");
		expect(english.subject).toBe("Organization Acme scheduled for deletion");
		expect(english.html).toContain("Organization scheduled for deletion");
	});

	it("shows the request and the permanent deletion in the organization timezone", async () => {
		await sendOrganizationDeletionNotifications({
			organizationId: "org-1",
			organizationName: "Acme",
			deletedByName: "Sam",
			deletionDate: "2026-10-13T12:05:00.000Z",
		});

		// 12:05 UTC is 14:05 in Berlin; permanent deletion 5 days later.
		expect(emailTo("de@example.com").html).toContain("13. Okt. 2026, 14:05 (Europe/Berlin)");
		expect(emailTo("de@example.com").html).toContain("18. Okt. 2026, 14:05 (Europe/Berlin)");
		expect(emailTo("en@example.com").html).toContain("Oct 18, 2026, 2:05 PM (Europe/Berlin)");
	});
});
