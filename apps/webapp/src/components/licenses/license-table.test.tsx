// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LicenseInfo } from "@/types/license";
import { LicenseTable } from "./license-table";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const licenses: LicenseInfo[] = [
	{ name: "alpha", version: "1.0.0", license: "MIT" },
	{ name: "beta", version: "1.0.0", license: "Apache-2.0" },
];

describe("LicenseTable", () => {
	it.each([
		["package name", "alpha", "alpha", "beta"],
		["license", "Apache", "beta", "alpha"],
	])("filters by %s", async (_field, query, visiblePackage, hiddenPackage) => {
		const user = userEvent.setup();
		render(<LicenseTable licenses={licenses} />);

		await user.type(
			screen.getByRole("textbox", {
				name: "Search packages or licenses…",
			}),
			query,
		);

		expect(screen.getByText(visiblePackage)).toBeTruthy();
		expect(screen.queryByText(hiddenPackage)).toBeNull();
	});
});
