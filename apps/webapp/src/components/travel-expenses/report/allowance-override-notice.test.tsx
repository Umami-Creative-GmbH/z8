// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AllowanceOverrideNotice } from "./allowance-override-notice";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? ""),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));

const override = {
	amount: "112.80",
	currency: "EUR",
	reason: "International trip",
	evidence: "BMF 2026, France: Paris",
	calculationBasis: "2 × 39.00 + 58.00 − 23.20",
	situation: { kind: "unsupported_case" as const, reasons: ["international"] },
	authorizedBy: { employeeId: "admin-1", name: "Ada Admin" },
	authorizedAt: "2026-09-20T08:00:00Z",
};

describe("AllowanceOverrideNotice (#610)", () => {
	it("shows the manual amount with its reason, evidence, basis and authorizer", () => {
		render(<AllowanceOverrideNotice override={{ ...override, applies: true }} ordinary={null} />);
		expect(screen.getByText("Allowance set manually by an expense administrator")).toBeTruthy();
		expect(screen.getByText("€112.80")).toBeTruthy();
		expect(screen.getByText("International trip")).toBeTruthy();
		expect(screen.getByText("BMF 2026, France: Paris")).toBeTruthy();
		expect(screen.getByText("2 × 39.00 + 58.00 − 23.20")).toBeTruthy();
		expect(screen.getByText(/Ada Admin/)).toBeTruthy();
		expect(screen.getByText("Not covered by the supported calculation rules")).toBeTruthy();
		expect(screen.getByText("No ordinary calculation exists for these facts.")).toBeTruthy();
	});

	it("names the ordinary policy result next to the override", () => {
		render(
			<AllowanceOverrideNotice
				override={{ ...override, applies: true }}
				ordinary={{ amount: "100.00", currency: "EUR" }}
			/>,
		);
		expect(screen.getByText("The policy would calculate €100.00.")).toBeTruthy();
	});

	it("explains that an override for other facts no longer counts", () => {
		render(<AllowanceOverrideNotice override={{ ...override, applies: false }} ordinary={null} />);
		expect(
			screen.getByText(
				"This manual allowance was authorized for different facts and no longer applies. An expense administrator must review the changed facts.",
			),
		).toBeTruthy();
	});
});
