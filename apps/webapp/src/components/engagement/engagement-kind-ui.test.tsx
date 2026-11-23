/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngagementFilterToggle, ExternalContractorBadge } from "./engagement-kind-ui";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

afterEach(cleanup);

describe("External Contractor badge (#1995)", () => {
	it("labels a contractor", () => {
		render(<ExternalContractorBadge engagementKind="contractor" />);
		expect(screen.getByText("External Contractor")).toBeTruthy();
	});

	it.each([["employee"], [null], [undefined]] as const)("stays out of the way for %s", (kind) => {
		const { container } = render(<ExternalContractorBadge engagementKind={kind} />);
		expect(container.textContent).toBe("");
	});
});

describe("All | Employees | External Contractors filter (#1995)", () => {
	it("offers the three choices and reports the chosen one", () => {
		const onValueChange = vi.fn();
		render(<EngagementFilterToggle value="all" onValueChange={onValueChange} />);

		const group = screen.getByRole("radiogroup", { name: "Engagement" });
		expect(
			Array.from(group.querySelectorAll("[role=radio]")).map((item) => item.textContent),
		).toEqual(["All", "Employees", "External Contractors"]);
		fireEvent.click(screen.getByRole("radio", { name: "External Contractors" }));

		expect(onValueChange).toHaveBeenCalledWith("contractor");
	});

	it("keeps the selection when the pressed choice is clicked again", () => {
		const onValueChange = vi.fn();
		render(<EngagementFilterToggle value="employee" onValueChange={onValueChange} />);

		fireEvent.click(screen.getByRole("radio", { name: "Employees" }));

		expect(onValueChange).not.toHaveBeenCalled();
	});
});
