/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContractTypeCell } from "./contract-type-cell";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

describe("ContractTypeCell", () => {
	it.each([
		["hourly", "Hourly"],
		["fixed", "Fixed"],
	] as const)("shows %s as a neutral badge with an icon", (contractType, label) => {
		render(<ContractTypeCell contractType={contractType} />);

		const badge = screen.getByText(label);
		expect(badge.querySelector("svg")).not.toBeNull();
		expect(badge.className).not.toMatch(/(orange|purple)-\d/);
	});
});
