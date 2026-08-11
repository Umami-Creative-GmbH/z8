/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { Suspense } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import LocaleLayout from "./layout";

function findFontSizeInitScript(node: React.ReactNode): {
	children: React.ReactNode;
	id?: string;
	strategy?: string;
} | null {
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
		id?: string;
		strategy?: string;
	}>;
	if (element.props.id === "font-size-init") {
		return {
			children: element.props.children,
			id: element.props.id,
			strategy: element.props.strategy,
		};
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
	NextIntlClientProvider: ({
		children,
		locale,
		messages,
	}: {
		children: React.ReactNode;
		locale: string;
		messages: Record<string, string>;
	}) => (
		<div
			data-next-intl-locale={locale}
			data-next-intl-messages={JSON.stringify(messages)}
		>
			{children}
		</div>
	),
}));

vi.mock("next-intl/server", () => ({
	setRequestLocale: mockState.setRequestLocale,
}));

vi.mock("sonner", () => ({
	Toaster: () => null,
}));

vi.mock("@/components/bprogress/bprogress", () => ({
	BProgressBar: () => <div data-testid="application-shell" />,
}));

vi.mock("@/components/deployment-refresh", () => ({
	DeploymentRefreshChecker: () => (
		<div data-testid="deployment-refresh-checker" />
	),
}));

vi.mock("@/components/offline", () => ({
	OfflineBanner: () => null,
	SWUpdatePrompt: () => null,
}));

vi.mock("@/components/posthog-provider", () => ({
	PostHogProvider: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
}));

vi.mock("@/components/theme-provider", () => ({
	ThemeProvider: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
}));

vi.mock("@/components/ui/tooltip", () => ({
	TooltipProvider: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
}));

vi.mock("@/lib/query", () => ({
	QueryProvider: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
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
	TolgeeNextProvider: ({
		children,
		language,
		staticData,
	}: {
		children: React.ReactNode;
		language: string;
		staticData: Record<string, unknown>;
	}) => (
		<div
			data-tolgee-language={language}
			data-tolgee-static-data={JSON.stringify(staticData)}
		>
			{children}
		</div>
	),
}));

vi.mock("@/tolgee/shared", () => ({
	ALL_LANGUAGES: ["en"],
	loadRouteTranslations: vi.fn(async () => ({})),
}));

vi.mock("drizzle-orm", () => ({
	eq: vi.fn(() => ({})),
}));

describe("LocaleLayout", () => {
	it("does not render font size initialization as a script during locale navigation", async () => {
		const layout = await LocaleLayout({
			children: <div>Auth content</div>,
			params: Promise.resolve({ locale: "en" }),
		});

		const script = findFontSizeInitScript(layout);

		expect(script).toBeNull();
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

	it("keeps route content outside an async analytics-consent boundary", () => {
		const source = readFileSync("src/app/[locale]/layout.tsx", "utf8");

		expect(source).not.toContain("PostHogConsentProvider");
		expect(source).not.toContain('minHeight: "100vh"');
	});

	it("isolates the deployment refresh checker behind a Suspense boundary", () => {
		const source = readFileSync("src/app/[locale]/layout.tsx", "utf8");

		expect(source).toMatch(
			/<Suspense fallback=\{null\}>\s*<DeploymentRefreshChecker[^>]+\/>\s*<\/Suspense>/,
		);
	});

	it("renders next-intl through a client boundary without inheriting request config", () => {
		const providerSource = readFileSync(
			"src/app/[locale]/translation-providers.tsx",
			"utf8",
		);
		const layoutSource = readFileSync("src/app/[locale]/layout.tsx", "utf8");

		expect(providerSource).toMatch(/^"use client";/);
		expect(providerSource).toContain(
			'import { NextIntlClientProvider } from "next-intl";',
		);
		expect(layoutSource).not.toContain('from "next-intl"');
	});

	it("shows the app frame while primary route content is pending in the translation fallback", () => {
		const source = readFileSync("src/app/[locale]/layout.tsx", "utf8");

		expect(source).toMatch(
			/<TranslationProviders locale=\{locale\} records=\{\{\}\}>\s*<ApplicationContent>\s*<NeutralAppFrameLoading \/>\s*<\/ApplicationContent>\s*<\/TranslationProviders>/,
		);
	});

	it("renders the translation-context fallback while route translations are pending", async () => {
		let resolveHeaders: (headers: Headers) => void = () => {};
		let resolveRoute: () => void = () => {};
		let routeResolved = false;
		const pendingRoute = new Promise<void>((resolve) => {
			resolveRoute = () => {
				routeResolved = true;
				resolve();
			};
		});
		function PendingRoute() {
			if (!routeResolved) {
				throw pendingRoute;
			}
			return <main data-testid="application-child">Auth content</main>;
		}
		function RouteWithLocalFallback() {
			return (
				<Suspense
					fallback={
						<p data-testid="route-local-fallback">Loading route details</p>
					}
				>
					<PendingRoute />
				</Suspense>
			);
		}
		mockState.headers.mockImplementation(
			() =>
				new Promise<Headers>((resolve) => {
					resolveHeaders = resolve;
				}),
		);

		try {
			const layout = await LocaleLayout({
				children: <RouteWithLocalFallback />,
				params: Promise.resolve({ locale: "en" }),
			});
			const stream = await renderToReadableStream(layout);
			const reader = stream.getReader();
			const { value } = await reader.read();
			resolveHeaders(new Headers({ "x-pathname": "/en/sign-in" }));
			resolveRoute();
			while (!(await reader.read()).done) {
				// Consume the resolved translation branch so the stream ends without an abort.
			}
			const container = document.createElement("div");
			container.innerHTML = new TextDecoder().decode(value);

			const tolgeeProvider = container.querySelector(
				'[data-tolgee-language="en"]',
			);
			const intlProvider = tolgeeProvider?.querySelector(
				'[data-next-intl-locale="en"]',
			);

			expect(tolgeeProvider).not.toBeNull();
			expect(tolgeeProvider?.getAttribute("data-tolgee-static-data")).toBe(
				"{}",
			);
			expect(intlProvider).not.toBeNull();
			expect(intlProvider?.getAttribute("data-next-intl-messages")).toBe(
				'{"locale":"en"}',
			);
			const loading = intlProvider?.querySelector('[role="status"]');
			expect(loading?.getAttribute("aria-busy")).toBe("true");
			expect(loading?.textContent).toBe("");
			expect(
				loading?.querySelector('[data-testid="app-sidebar-loading"]'),
			).not.toBeNull();
			expect(container.textContent).not.toContain("Loading application");
			expect(container.textContent).not.toContain("Loading route details");
			expect(
				container.querySelector('[data-testid="route-local-fallback"]'),
			).toBeNull();
			expect(
				container.querySelector('[data-testid="application-child"]'),
			).toBeNull();
		} finally {
			mockState.headers.mockImplementation(
				async () => new Headers({ "x-pathname": "/en/sign-in" }),
			);
		}
	});

	it("renders route children after translations resolve", async () => {
		const layout = await LocaleLayout({
			children: <main data-testid="application-child">Auth content</main>,
			params: Promise.resolve({ locale: "en" }),
		});
		const stream = await renderToReadableStream(layout);
		const html = await new Response(stream).text();

		expect(html).toContain('data-testid="application-child"');
		expect(html).toContain("Auth content");
	});
});
