/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import LocaleLayout from "./layout";

const mockState = vi.hoisted(() => ({
	headers: vi.fn(async () => new Headers({ "x-pathname": "/en/sign-in" })),
	getSession: vi.fn(async () => null),
	findUserSettings: vi.fn(),
	setRequestLocale: vi.fn(),
}));

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("next-intl", () => ({
	NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next-intl/server", () => ({
	setRequestLocale: mockState.setRequestLocale,
}));

vi.mock("sonner", () => ({
	Toaster: () => null,
}));

vi.mock("@/components/bprogress/bprogress", () => ({
	BProgressBar: () => null,
}));

vi.mock("@/components/offline", () => ({
	OfflineBanner: () => null,
	SWUpdatePrompt: () => null,
}));

vi.mock("@/components/posthog-provider", () => ({
	PostHogProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/theme-provider", () => ({
	ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/tooltip", () => ({
	TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/query", () => ({
	QueryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			userSettings: {
				findFirst: mockState.findUserSettings,
			},
		},
	},
}));

vi.mock("@/db/schema", () => ({
	userSettings: {
		userId: "userId",
	},
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: mockState.getSession,
		},
	},
}));

vi.mock("@/proxy", () => ({
	DOMAIN_HEADERS: {
		PATHNAME: "x-pathname",
	},
}));

vi.mock("@/tolgee/client", () => ({
	TolgeeNextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/tolgee/shared", () => ({
	ALL_LANGUAGES: ["en"],
	loadRouteTranslations: vi.fn(async () => ({})),
}));

vi.mock("drizzle-orm", () => ({
	eq: vi.fn(() => ({})),
}));

describe("LocaleLayout", () => {
	it("does not block the shell on the PostHog consent session lookup", async () => {
		await LocaleLayout({
			children: <div>Auth content</div>,
			params: Promise.resolve({ locale: "en" }),
		});

		expect(mockState.setRequestLocale).toHaveBeenCalledWith("en");
		expect(mockState.getSession).not.toHaveBeenCalled();
		expect(mockState.findUserSettings).not.toHaveBeenCalled();
	});
});
