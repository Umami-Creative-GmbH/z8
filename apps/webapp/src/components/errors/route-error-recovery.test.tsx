/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (
			key: string,
			fallback?: string,
			params?: Record<string, string | number>,
		) =>
			(fallback ?? key).replace(/\{(\w+)\}/g, (_match, token: string) =>
				String(params?.[token] ?? `{${token}}`),
			),
	}),
}));
vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
	useRouter: () => ({ back: vi.fn() }),
	usePathname: () => "/",
}));

import AdminError from "@/app/[locale]/(admin)/error";
import WorkspaceError from "@/app/[locale]/(app)/error";
import SettingsError from "@/app/[locale]/(app)/settings/error";
import LocaleError from "@/app/[locale]/error";

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
it.each([
	{
		name: "locale",
		Boundary: LocaleError,
		recovery: "Sign in",
		href: "/sign-in",
	},
	{
		name: "admin",
		Boundary: AdminError,
		recovery: "Admin Console",
		href: "/platform-admin",
	},
	{
		name: "workspace",
		Boundary: WorkspaceError,
		recovery: "Go to Dashboard",
		href: "/",
	},
	{
		name: "settings",
		Boundary: SettingsError,
		recovery: "Back to Settings",
		href: "/settings",
	},
])(
	"$name Retry asks Next to refetch failed server data and preserves safe recovery",
	({ Boundary, recovery, href }) => {
		const retry = vi.fn(),
			reset = vi.fn();
		const error = Object.assign(new Error("Private database failure details"), {
			digest: "opaque-error-reference",
		});
		const nextProps = { error, retry, reset };
		render(<Boundary {...nextProps} />);
		expect(
			screen.getByRole("link", { name: recovery }).getAttribute("href"),
		).toBe(href);
		expect(screen.getByText("Reference: opaque-error-reference")).toBeTruthy();
		expect(screen.queryByText("Private database failure details")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(retry).toHaveBeenCalledTimes(1);
		expect(reset).not.toHaveBeenCalled();
	},
);
