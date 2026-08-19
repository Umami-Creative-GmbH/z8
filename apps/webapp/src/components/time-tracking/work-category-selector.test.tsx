/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkCategorySelectorView } from "./work-category-selector";

const mocks = vi.hoisted(() => ({
	writeLastWorkCategoryId: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("./selection-preferences", () => ({
	writeLastWorkCategoryId: mocks.writeLastWorkCategoryId,
}));

const categories = [
	{
		id: "category-1",
		name: "Operations",
		factor: "1.00",
		color: null,
	},
];

function renderSelector(
	props: Partial<Parameters<typeof WorkCategorySelectorView>[0]> = {},
) {
	const onValueChange = vi.fn();
	render(
		<WorkCategorySelectorView
			employeeId="employee-1"
			value={undefined}
			onValueChange={onValueChange}
			categories={categories}
			isLoading={false}
			isError={false}
			{...props}
		/>,
	);
	return { onValueChange };
}

describe("WorkCategorySelectorView", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("associates the visible label with the select trigger", () => {
		renderSelector();

		const trigger = screen.getByLabelText("Work Category");
		expect(trigger.getAttribute("data-slot")).toBe("select-trigger");
		expect(trigger.id).not.toBe("");
	});

	it("persists category changes by default", async () => {
		const user = userEvent.setup();
		const { onValueChange } = renderSelector();

		await user.click(screen.getByLabelText("Work Category"));
		await user.click(await screen.findByRole("option", { name: /Operations/ }));

		expect(mocks.writeLastWorkCategoryId).toHaveBeenCalledWith("category-1");
		expect(onValueChange).toHaveBeenCalledWith("category-1");
	});

	it("can change a historical category without persisting the preference", async () => {
		const user = userEvent.setup();
		const { onValueChange } = renderSelector({ persistPreference: false });

		await user.click(screen.getByLabelText("Work Category"));
		await user.click(await screen.findByRole("option", { name: /Operations/ }));

		expect(mocks.writeLastWorkCategoryId).not.toHaveBeenCalled();
		expect(onValueChange).toHaveBeenCalledWith("category-1");
	});
});
