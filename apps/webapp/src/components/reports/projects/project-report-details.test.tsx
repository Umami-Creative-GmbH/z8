// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectInfo } from "@/lib/reports/project-types";
import { ProjectReportDetails } from "./project-report-details";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/components/providers/app-locale-provider", () => ({ useAppLocale: () => "en" }));

afterEach(cleanup);

const project: ProjectInfo = {
	id: "p1",
	name: "Website",
	description: null,
	status: "active",
	color: null,
	budgetHours: null,
	deadline: null,
	customer: {
		id: "c1",
		name: "Acme",
		customFields: [{ fieldId: "f-region", name: "Region", type: "text", value: "DACH" }],
	},
	customFields: [{ fieldId: "f-phase", name: "Phase", type: "select", value: "Delivery" }],
};

describe("ProjectReportDetails", () => {
	it("shows the customer and the project's and customer's custom fields", () => {
		render(<ProjectReportDetails project={project} />);

		expect(screen.getByText("Acme")).toBeTruthy();
		const terms = screen.getAllByRole("term").map((term) => term.textContent);
		expect(terms).toEqual(["Customer", "Phase", "Region"]);
		expect(screen.getByText("Delivery")).toBeTruthy();
		expect(screen.getByText("DACH")).toBeTruthy();
	});

	it("says when the project has no customer", () => {
		render(<ProjectReportDetails project={{ ...project, customer: null, customFields: [] }} />);

		expect(screen.getByText("No customer")).toBeTruthy();
		expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual(["Customer"]);
	});
});
