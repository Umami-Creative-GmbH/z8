/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	PayrollConnectorsSettings,
	type PayrollConnectorsSettingsProps,
} from "./payroll-connectors-settings";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const formSpies = vi.hoisted(() => ({
	datev: vi.fn(),
	lexware: vi.fn(),
	sage: vi.fn(),
	personio: vi.fn(),
	successfactors: vi.fn(),
	workday: vi.fn(),
	wageTypes: vi.fn(),
	expenseWageTypes: vi.fn(),
}));

vi.mock("./datev-config-form", () => ({
	DatevConfigForm: (props: Record<string, unknown>) => {
		formSpies.datev(props);
		return <div data-testid="datev-config-form">DATEV Form</div>;
	},
}));
vi.mock("./lexware-config-form", () => ({
	LexwareConfigForm: (props: Record<string, unknown>) => {
		formSpies.lexware(props);
		return <div data-testid="lexware-config-form">Lexware Form</div>;
	},
}));
vi.mock("./sage-config-form", () => ({
	SageConfigForm: (props: Record<string, unknown>) => {
		formSpies.sage(props);
		return <div data-testid="sage-config-form">Sage Form</div>;
	},
}));
vi.mock("./personio-config-form", () => ({
	PersonioConfigForm: (props: Record<string, unknown>) => {
		formSpies.personio(props);
		return <div data-testid="personio-config-form">Personio Form</div>;
	},
}));
vi.mock("./successfactors-config-form", () => ({
	SuccessFactorsConfigForm: (props: Record<string, unknown>) => {
		formSpies.successfactors(props);
		return <div data-testid="successfactors-config-form">SAP SuccessFactors Form</div>;
	},
}));
vi.mock("./workday-config-form", () => ({
	WorkdayConfigForm: (props: Record<string, unknown>) => {
		formSpies.workday(props);
		return <div data-testid="workday-config-form">Workday Form</div>;
	},
}));
vi.mock("./wage-type-mappings", () => ({
	WageTypeMappings: (props: Record<string, unknown>) => {
		formSpies.wageTypes(props);
		return <div data-testid="wage-type-mappings">Wage Type Mappings</div>;
	},
}));
vi.mock("./expense-wage-type-mappings", () => ({
	ExpenseWageTypeMappings: () => {
		formSpies.expenseWageTypes();
		return <div data-testid="expense-wage-type-mappings">Expense Wage Type Mappings</div>;
	},
}));

const emptyProps: PayrollConnectorsSettingsProps = {
	datevConfig: null,
	lexwareConfig: null,
	sageConfig: null,
	personioConfig: null,
	successFactorsConfig: null,
	workdayConfig: null,
	identifierFields: [{ id: "cf-1", name: "Personnel ID" }],
	hasMappingFormat: false,
};

describe("PayrollConnectorsSettings (#1958)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders only the two top-level tabs (Payroll Targets and Wage Types) without Export or History tabs", () => {
		render(<PayrollConnectorsSettings {...emptyProps} />);

		const tabs = screen.getAllByRole("tab");
		expect(tabs.map((tab) => tab.textContent)).toEqual(["Payroll Targets", "Wage Types"]);
		expect(screen.queryByRole("tab", { name: "Export" })).toBeNull();
		expect(screen.queryByRole("tab", { name: "History" })).toBeNull();
	});

	it("switches between all six payroll target forms inside Payroll Targets", () => {
		render(<PayrollConnectorsSettings {...emptyProps} />);

		// Defaults to DATEV when nothing is configured
		expect(screen.getByTestId("datev-config-form")).toBeTruthy();
		expect(formSpies.datev).toHaveBeenCalledWith(
			expect.objectContaining({ identifierFields: emptyProps.identifierFields }),
		);

		const targets: Array<[string, string]> = [
			["Lexware", "lexware-config-form"],
			["Sage", "sage-config-form"],
			["Personio", "personio-config-form"],
			["SAP SuccessFactors", "successfactors-config-form"],
			["Workday", "workday-config-form"],
			["DATEV", "datev-config-form"],
		];

		for (const [label, testId] of targets) {
			fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
			expect(screen.getByTestId(testId)).toBeTruthy();
		}
	});

	it("defaults to the first configured payroll target and shows status badges", () => {
		render(
			<PayrollConnectorsSettings
				{...emptyProps}
				sageConfig={{
					id: "cfg-sage",
					formatId: "sage_lohn",
					config: {} as never,
					isActive: true,
					createdAt: new Date("2026-01-01"),
					updatedAt: new Date("2026-01-01"),
				}}
				personioConfig={{
					id: "cfg-personio",
					formatId: "personio",
					config: {} as never,
					isActive: true,
					hasCredentials: false,
					createdAt: new Date("2026-01-01"),
					updatedAt: new Date("2026-01-01"),
				}}
			/>,
		);

		expect(screen.getByTestId("sage-config-form")).toBeTruthy();
		expect(screen.getByText("Configured")).toBeTruthy();
		expect(screen.getByText("Needs credentials")).toBeTruthy();
	});

	it("renders work and expense wage-type mappings inside the Wage Types tab", () => {
		render(<PayrollConnectorsSettings {...emptyProps} hasMappingFormat />);

		fireEvent.click(screen.getByRole("tab", { name: "Wage Types" }));

		expect(screen.getByTestId("wage-type-mappings")).toBeTruthy();
		expect(screen.getByTestId("expense-wage-type-mappings")).toBeTruthy();
		expect(formSpies.wageTypes).toHaveBeenCalledWith({ hasMappingFormat: true });
	});
});
