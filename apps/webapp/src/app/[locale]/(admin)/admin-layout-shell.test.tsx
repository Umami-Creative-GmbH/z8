/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminLayoutShell } from "./admin-layout-shell";

const ADMIN_ROUTE_ROOT = join(process.cwd(), "src/app/[locale]/(admin)");

describe("AdminLayoutShell", () => {
	it("renders neutral loading geometry without links or protected identity", () => {
		render(<AdminLayoutShell />);

		const main = screen.getByRole("main", { name: "Loading admin console" });

		expect(main.getAttribute("aria-busy")).toBe("true");
		expect(screen.queryAllByRole("link")).toHaveLength(0);
		expect(screen.queryByText("Ada Lovelace")).toBeNull();
		expect(screen.queryByText("Admin Console")).toBeNull();
		expect(screen.queryByText("Billing")).toBeNull();
	});

	it("has no request, identity, billing, privileged-label, or child dependencies", () => {
		const source = readFileSync(
			join(ADMIN_ROUTE_ROOT, "admin-layout-shell.tsx"),
			"utf8",
		);

		expect(source).not.toMatch(
			/\bauth\b|database|(?:^|\W)db(?:\W|$)|billing|session|children|platform management/i,
		);
		expect(source).not.toMatch(
			/next\/(?:headers|navigation)|@\/env|@\/lib\/auth/,
		);
	});
});
