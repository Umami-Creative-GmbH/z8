/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { backMock } = vi.hoisted(() => ({
	backMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (
			_key: string,
			defaultValue?: string,
			params?: Record<string, string | number>,
		) => {
			if (!defaultValue) {
				return _key;
			}

			return defaultValue.replace(/\{(\w+)\}/g, (_, token: string) => String(params?.[token] ?? `{${token}}`));
		},
	}),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
	useRouter: () => ({ back: backMock }),
}));

import { AppErrorState } from "./app-error-state";

describe("AppErrorState", () => {
	it("renders 404 actions and optional support details", () => {
		render(
			<AppErrorState
				variant="not-found"
				titleKey="errors.notFound.title"
				titleDefault="Page not found"
				descriptionKey="errors.notFound.description"
				descriptionDefault="The page may have moved or the link may be outdated."
				digest="digest-123"
			/>,
		);

		expect(screen.getByText("Page not found")).toBeTruthy();
		expect(screen.getByText("The page may have moved or the link may be outdated.")).toBeTruthy();
		expect(screen.getByRole("link", { name: /go to dashboard/i }).getAttribute("href")).toBe("/");
		expect(screen.getByRole("link", { name: /settings/i }).getAttribute("href")).toBe("/settings");
		expect(screen.getByRole("button", { name: /back/i })).toBeTruthy();
		expect(screen.getByText(/digest-123/i)).toBeTruthy();
		expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
	});

	it("calls retry handler for the error variant", () => {
		const onRetry = vi.fn();

		render(
			<AppErrorState
				variant="error"
				titleKey="errors.unexpected.title"
				titleDefault="Something went wrong"
				descriptionKey="errors.unexpected.description"
				descriptionDefault="Please try again."
				onRetry={onRetry}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /retry/i }));
		expect(onRetry).toHaveBeenCalledTimes(1);
	});
});
