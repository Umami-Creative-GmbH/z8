/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import LocaleLayout from "./layout";

function findFontSizeInitScript(node: React.ReactNode): string | null {
	if (Array.isArray(node)) {
		for (const child of node) {
			const script = findFontSizeInitScript(child);
			if (script) {
				return script;
			}
		}
		return null;
	}

	if (!node || typeof node !== "object" || !("props" in node)) {
		return null;
	}

	const element = node as React.ReactElement<{
		children?: React.ReactNode;
		dangerouslySetInnerHTML?: { __html?: string };
	}>;
	const html = element.props.dangerouslySetInnerHTML?.__html;
	if (element.type === "script" && html?.includes("z8-font-size")) {
		return html;
	}

	return findFontSizeInitScript(element.props.children);
}

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
	it("inlines font size preference initialization before paint", async () => {
		const layout = await LocaleLayout({
			children: <div>Auth content</div>,
			params: Promise.resolve({ locale: "en" }),
		});

		const script = findFontSizeInitScript(layout);

		expect(script).not.toBeNull();
		expect(script).toContain("localStorage.getItem(\"z8-font-size\")");
		expect(script).toContain("document.documentElement.dataset.fontSize");
		expect(script).toContain("comfortable");
		expect(script).toContain("large");
		expect(script).toContain("catch");
	});

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
