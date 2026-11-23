/* @vitest-environment jsdom */

import { screen } from "@testing-library/react";
import { Effect } from "effect";
import { isValidElement, Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingService } from "@/lib/effect/services/onboarding.service";
import { render } from "@/test/render-with-translations";

const mocks = vi.hoisted(() => ({
	getRequestSession: vi.fn(),
	isUserAdmin: vi.fn(),
	progressProviderProps: [] as Array<{
		initialIsAdmin: boolean;
		initialUserId?: string | null;
		initialOrganizationId?: string | null;
	}>,
}));

// Translation acquisition/lifecycle is exercised with real Tolgee in route-boundary.test.tsx.
vi.mock("@/tolgee/route-boundary", () => ({
	RouteTranslationBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next/image", () => ({
	default: ({ alt, className }: { alt: string; className?: string }) => (
		<img alt={alt} className={className} data-testid="onboarding-background" />
	),
}));

vi.mock("next/server", () => ({
	connection: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/request-session", () => ({
	getRequestSession: mocks.getRequestSession,
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { Layer } = await import("effect");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	return runtimeModuleOver(
		Layer.succeed(
			OnboardingService,
			OnboardingService.of({
				isUserAdmin: mocks.isUserAdmin,
			} as never),
		),
	);
});

vi.mock("@/components/onboarding/onboarding-progress-provider", () => ({
	OnboardingProgressProvider: ({
		children,
		initialIsAdmin,
		initialUserId,
		initialOrganizationId,
	}: {
		children: React.ReactNode;
		initialIsAdmin: boolean;
		initialUserId?: string | null;
		initialOrganizationId?: string | null;
	}) => {
		mocks.progressProviderProps.push({ initialIsAdmin, initialUserId, initialOrganizationId });
		return <div data-testid="onboarding-progress-provider">{children}</div>;
	},
}));

vi.mock("@/components/info-footer", () => ({
	InfoFooter: () => <footer>Info footer</footer>,
}));

vi.mock("@/components/language-switcher", () => ({
	LanguageSwitcher: () => <button type="button">Language</button>,
}));

vi.mock("@/components/font-size-toggle", () => ({
	FontSizeToggle: () => <button type="button">Font size</button>,
}));

vi.mock("@/components/theme-toggle", () => ({
	ThemeToggle: () => <button type="button">Theme</button>,
}));

import OnboardingLayout from "./layout";
import source from "./layout.tsx?raw";

async function renderLayoutContent(children: React.ReactNode) {
	const boundary = OnboardingLayout({
		params: Promise.resolve({ locale: "en" }),
		children,
	});
	expect(boundary.props.route).toBe("/onboarding");
	const layout = boundary.props.children;
	if (!isValidElement(layout) || !isValidElement(layout.props.children)) {
		throw new Error("Expected onboarding content boundary");
	}
	const contentElement = layout.props.children as React.ReactElement<
		{ children: React.ReactNode },
		(props: { children: React.ReactNode }) => Promise<React.ReactNode>
	>;
	render(await contentElement.type(contentElement.props));
}

describe("OnboardingLayout", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.progressProviderProps.length = 0;
		mocks.getRequestSession.mockResolvedValue(null);
		mocks.isUserAdmin.mockReturnValue(Effect.succeed(false));
	});

	it("keeps random content in an async child behind neutral shell geometry", () => {
		const boundary = OnboardingLayout({
			params: Promise.resolve({ locale: "en" }),
			children: <div>private onboarding child</div>,
		});
		expect(boundary.props.route).toBe("/onboarding");
		const layout = boundary.props.children;

		expect(layout).not.toBeInstanceOf(Promise);
		expect(isValidElement(layout)).toBe(true);
		if (!isValidElement<{ fallback: React.ReactNode }>(layout)) {
			throw new Error("Expected OnboardingLayout to return Suspense");
		}
		expect(layout.type).toBe(Suspense);

		render(layout.props.fallback);
		expect(screen.getByRole("status", { name: "Loading onboarding" })).toBeTruthy();
		expect(screen.queryByText("private onboarding child")).toBeNull();

		const contentStart = source.indexOf("async function OnboardingLayoutContent");
		expect(contentStart).toBeGreaterThan(-1);
		expect(source.indexOf("await connection()", contentStart)).toBeGreaterThan(contentStart);
		expect(source.slice(0, contentStart)).not.toContain("connection()");
	});

	it("uses the auth-style full-screen glass shell", async () => {
		await renderLayoutContent(<div data-slot="card">Onboarding content</div>);

		const content = screen.getByText("Onboarding content");
		const main = content.closest("main");
		const background = screen.getByTestId("onboarding-background");
		const footer = screen.getByText("Info footer");

		expect(background.className).toContain("absolute");
		expect(background.className).toContain("inset-0");
		expect(background.className).toContain("object-cover");
		expect(main?.className).toContain("onboarding-glass-scope");
		expect(main?.className).toContain("flex-1");
		const controls = screen.getByRole("button", { name: "Theme" }).closest("div");
		expect(controls?.className).toContain("auth-shell-controls");
		expect(controls?.className).toContain("auth-shell-controls-readable");
		expect(controls?.className).toContain("[&_[data-slot=dropdown-menu-trigger]]:!bg-slate-950/85");
		expect(controls?.className).toContain("[&_[data-slot=select-trigger]]:!bg-slate-950/85");
		expect(screen.getByRole("button", { name: "Font size" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Language" })).toBeTruthy();
		expect(footer.closest("div")?.className).toContain("drop-shadow-sm");
	});

	it("seeds OnboardingProgressProvider with server-resolved org-admin state", async () => {
		mocks.getRequestSession.mockResolvedValue({
			user: { id: "user-admin" },
			session: { activeOrganizationId: "org-1" },
		});
		mocks.isUserAdmin.mockReturnValue(Effect.succeed(true));

		await renderLayoutContent(<div>Admin step</div>);

		expect(mocks.isUserAdmin).toHaveBeenCalledOnce();
		expect(mocks.progressProviderProps).toEqual([
			{
				initialIsAdmin: true,
				initialUserId: "user-admin",
				initialOrganizationId: "org-1",
			},
		]);
	});

	it("seeds non-admin state without querying admin access when there is no active organization", async () => {
		mocks.getRequestSession.mockResolvedValue({
			user: { id: "user-new" },
			session: { activeOrganizationId: null },
		});

		await renderLayoutContent(<div>Welcome step</div>);

		expect(mocks.isUserAdmin).not.toHaveBeenCalled();
		expect(mocks.progressProviderProps).toEqual([
			{
				initialIsAdmin: false,
				initialUserId: "user-new",
				initialOrganizationId: null,
			},
		]);
	});
});
