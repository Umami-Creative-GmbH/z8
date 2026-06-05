// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PayrollAccessForm } from "./payroll-access-form";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/app/[locale]/(app)/settings/payroll-access/actions", () => ({
	savePayrollAccessAction: vi.fn(),
}));

describe("PayrollAccessForm", () => {
	it("renders payroll employee, team, and employee selectors", () => {
		render(
			<PayrollAccessForm
				employees={[{ id: "employee-1", name: "Ada Lovelace" }]}
				teams={[{ id: "team-1", name: "Ops" }]}
				initialGrants={[]}
			/>,
		);

		expect(screen.getByText("Payroll access")).toBeTruthy();
		expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
		expect(screen.getByText("Ops")).toBeTruthy();
	});
});
