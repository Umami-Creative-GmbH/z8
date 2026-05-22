/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import settingsDemoMessages from "../../../messages/settings/demo/en.json";
import { DemoDataWizard } from "./demo-data-wizard";

vi.mock("@/app/[locale]/(app)/settings/demo/actions", () => ({
	assignWorkCategoriesToPeriodsStepAction: vi.fn(),
	clearTimeDataAction: vi.fn(),
	deleteNonAdminDataAction: vi.fn(),
	generateAbsencesStepAction: vi.fn(),
	generateChangePoliciesStepAction: vi.fn(),
	generateDemoEmployeesAction: vi.fn(),
	generateLocationsStepAction: vi.fn(),
	generateManagersStepAction: vi.fn(),
	generateProjectsStepAction: vi.fn(),
	generateShiftsStepAction: vi.fn(),
	generateShiftTemplatesStepAction: vi.fn(),
	generateTeamsStepAction: vi.fn(),
	generateTimeEntriesStepAction: vi.fn(),
	generateWorkCategoriesStepAction: vi.fn(),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn() }),
}));

const getMessage = (key: string): string | undefined => {
	const parts = key.split(".");
	let current: unknown = settingsDemoMessages;

	for (const part of parts) {
		if (!current || typeof current !== "object" || !(part in current)) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}

	return typeof current === "string" ? current : undefined;
};

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback?: string, params?: Record<string, string | number>) => {
			const message = getMessage(key) ?? fallback ?? key;
			if (/\$\{[^}]+\}/.test(message)) {
				throw new SyntaxError("MALFORMED_ARGUMENT");
			}
			return message.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ""));
		},
	}),
}));

describe("DemoDataWizard", () => {
	it("renders the all employees option with the localized employee count", () => {
		render(
			<DemoDataWizard
				employees={[
					{ id: "emp_1", name: "Ada Lovelace" },
					{ id: "emp_2", name: "Grace Hopper" },
				]}
				organizationId="org_1"
			/>,
		);

		expect(screen.getByText("All employees (2)")).toBeTruthy();
	});
});
