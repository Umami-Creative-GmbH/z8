/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AuthenticatedAppShell } from "./app-layout-shell";

const APP_ROUTE_ROOT = join(process.cwd(), "src/app/[locale]/(app)");

beforeAll(() => {
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: vi.fn(() => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	});
});

describe("AuthenticatedAppShell", () => {
	it("renders neutral loading geometry without links or protected identity", () => {
		render(<AuthenticatedAppShell />);

		const main = screen.getByRole("main", { name: "Loading application" });

		expect(main.getAttribute("aria-busy")).toBe("true");
		expect(screen.queryAllByRole("link")).toHaveLength(0);
		expect(screen.queryByText("Ada Lovelace")).toBeNull();
		expect(screen.queryByText("Protected payroll report")).toBeNull();
	});

	it("has no request, identity, tenant, or protected-child dependencies", () => {
		const source = readFileSync(
			join(APP_ROUTE_ROOT, "app-layout-shell.tsx"),
			"utf8",
		);

		expect(source).not.toMatch(
			/\bauth\b|database|(?:^|\W)db(?:\W|$)|billing|organizationId|children/i,
		);
		expect(source).not.toMatch(
			/next\/(?:headers|navigation)|@\/env|@\/lib\/organization-settings/,
		);
	});
});
