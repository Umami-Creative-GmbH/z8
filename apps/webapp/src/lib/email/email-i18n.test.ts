import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEmailTranslator } from "./email-i18n";

const { loadNamespacesMock } = vi.hoisted(() => ({ loadNamespacesMock: vi.fn() }));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ warn: vi.fn() }),
}));

vi.mock("@/tolgee/shared", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/tolgee/shared")>()),
	loadNamespaces: loadNamespacesMock,
}));

describe("loadEmailTranslator", () => {
	beforeEach(() => {
		loadNamespacesMock.mockReset();
		loadNamespacesMock.mockImplementation(async (locale: string) => ({
			[locale]:
				locale === "de"
					? { emails: { notification: { openAction: "Z8 öffnen", hello: "Hallo {name}" } } }
					: {},
		}));
	});

	it("translates email copy from the emails namespace in the recipient language", async () => {
		const { locale, t } = await loadEmailTranslator("de");

		expect(locale).toBe("de");
		expect(loadNamespacesMock).toHaveBeenCalledWith("de", ["emails"]);
		expect(t("emails.notification.openAction", "Open Z8")).toBe("Z8 öffnen");
		expect(t("emails.notification.hello", "Hello {name}", { name: "Alex" })).toBe("Hallo Alex");
		expect(t("emails.notification.missing", "Missing copy")).toBe("Missing copy");
	});

	it("falls back to English for a language Z8 does not offer", async () => {
		const { locale, t } = await loadEmailTranslator("xx");

		expect(locale).toBe("en");
		expect(t("emails.notification.openAction", "Open Z8")).toBe("Open Z8");
		// An apostrophe in ICU copy stays literal.
		expect(
			t("emails.subjects.teamMemberAdded", "You've been added to {teamName}", {
				teamName: "Support",
			}),
		).toBe("You've been added to Support");
	});

	it("falls back to the English defaults when the catalog cannot be loaded", async () => {
		loadNamespacesMock.mockRejectedValue(new Error("catalog missing"));
		const { locale, t } = await loadEmailTranslator("de");

		expect(locale).toBe("de");
		expect(t("emails.notification.hello", "Hello {name}", { name: "Alex" })).toBe("Hello Alex");
	});
});
