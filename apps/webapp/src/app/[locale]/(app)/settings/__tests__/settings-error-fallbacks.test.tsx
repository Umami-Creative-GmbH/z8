/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerMock = vi.hoisted(() => ({
	back: vi.fn(),
	pathname: "/en/settings/employees",
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			params
				? fallback.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
				: fallback,
	}),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: ComponentProps<"a">) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
	usePathname: () => routerMock.pathname,
	useRouter: () => ({ back: routerMock.back }),
}));

import SettingsError from "../error";
import EmployeesError from "../employees/error";
import DeveloperAccessError from "../enterprise/api-keys/error";

beforeEach(() => {
	vi.clearAllMocks();
	routerMock.pathname = "/en/settings/employees";
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("Settings error boundaries", () => {
	it("renders settings/error.tsx inside AppErrorState with retry and Settings recovery", () => {
		const retry = vi.fn();
		render(
			<SettingsError error={Object.assign(new Error("boom"), { digest: "dig-1" })} retry={retry} />,
		);

		expect(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeTruthy();
		expect(screen.getByText("Reference: dig-1")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Back to Settings" }).getAttribute("href")).toBe(
			"/settings",
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(retry).toHaveBeenCalledOnce();
	});

	it("renders settings/employees/error.tsx inside AppErrorState and wires retry", () => {
		const retry = vi.fn();
		render(<EmployeesError error={new Error("directory failed")} retry={retry} />);

		expect(
			screen.getByRole("heading", { level: 1, name: "Employee directory could not be loaded" }),
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "Back to Settings" }).getAttribute("href")).toBe(
			"/settings",
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(retry).toHaveBeenCalledOnce();
	});

	it("renders settings/enterprise/api-keys/error.tsx inside AppErrorState and wires retry", () => {
		const retry = vi.fn();
		render(<DeveloperAccessError retry={retry} />);

		expect(
			screen.getByRole("heading", { level: 1, name: "Developer Access unavailable" }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(retry).toHaveBeenCalledOnce();
	});

	it("keeps every Settings error.tsx backed by AppErrorState without double-padded p-6 wrappers", () => {
		const settingsErrorFiles = [
			"src/app/[locale]/(app)/settings/error.tsx",
			"src/app/[locale]/(app)/settings/employees/error.tsx",
			"src/app/[locale]/(app)/settings/enterprise/api-keys/error.tsx",
		];

		for (const file of settingsErrorFiles) {
			const source = readFileSync(join(process.cwd(), file), "utf8");
			expect(source, file).toContain("<AppErrorState");
			expect(source, file).not.toMatch(/(?<![-\w])p-6(?![-\w])/);
		}
	});

	it("frames inline Settings fallbacks without double-padded p-6 page containers", () => {
		const employeesClient = readFileSync(
			join(process.cwd(), "src/app/[locale]/(app)/settings/employees/employees-page-client.tsx"),
			"utf8",
		);
		expect(employeesClient).not.toContain(
			'className="flex flex-1 items-center justify-center p-6"',
		);
		expect(employeesClient).toContain("<SettingsLoadError");

		const drivingLicencePage = readFileSync(
			join(process.cwd(), "src/app/[locale]/(app)/settings/driving-licence/page.tsx"),
			"utf8",
		);
		expect(drivingLicencePage).toContain("<SettingsLoadError");
	});
});
