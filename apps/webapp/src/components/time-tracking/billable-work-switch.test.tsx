/* @vitest-environment jsdom */

import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";

vi.mock("@/stores/organization-settings-store", () => ({
	useBillableTimeEnabled: () => true,
}));

import { BillableWorkSwitch } from "./billable-work-switch";

describe("BillableWorkSwitch", () => {
	it("describes billable work in Billable Time's own terms", () => {
		render(
			<BillableWorkSwitch
				choice={{ visible: true, enabled: true, checked: true, request: undefined }}
				onChange={vi.fn()}
			/>,
		);

		const description = screen.getByText(/project's customer/);
		expect(description.textContent).toBe("Billable work for the project's customer");
		expect(screen.queryByText(/chargeable/i)).toBeNull();
	});
});
