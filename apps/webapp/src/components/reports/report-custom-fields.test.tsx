// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportCustomFieldsCard } from "./report-custom-fields";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/components/providers/app-locale-provider", () => ({ useAppLocale: () => "en" }));

afterEach(cleanup);

describe("ReportCustomFieldsCard", () => {
	it("lists the report's custom fields in order with readable values", () => {
		render(
			<ReportCustomFieldsCard
				fields={[
					{ fieldId: "f-po", name: "PO number", type: "text", value: "PN-7" },
					{ fieldId: "f-union", name: "Union member", type: "boolean", value: false },
					{ fieldId: "f-tier", name: "Tier", type: "select", value: null },
				]}
			/>,
		);

		expect(screen.getByRole("heading", { name: "Custom fields" })).toBeTruthy();
		const terms = screen.getAllByRole("term").map((term) => term.textContent);
		const definitions = screen.getAllByRole("definition").map((value) => value.textContent);
		expect(terms).toEqual(["PO number", "Union member", "Tier"]);
		expect(definitions).toEqual(["PN-7", "No", "—"]);
	});

	it("renders nothing without fields", () => {
		const { container } = render(<ReportCustomFieldsCard fields={[]} />);
		expect(container.innerHTML).toBe("");
	});
});
