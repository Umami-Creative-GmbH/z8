/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SearchableSelect } from "./searchable-select";

beforeAll(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	HTMLElement.prototype.scrollIntoView = vi.fn();
});

const options = [
	{ code: "AT", name: "Austria" },
	{ code: "DE", name: "Germany" },
	{ code: "CH", name: "Switzerland" },
];

function CountrySelect() {
	const [value, setValue] = useState("DE");

	return (
		<>
			<label htmlFor="country">Country</label>
			<SearchableSelect
				emptyText="No country found"
				id="country"
				onValueChange={setValue}
				options={options}
				placeholder="Select a country"
				searchPlaceholder="Search countries"
				value={value}
			/>
		</>
	);
}

function getTrigger() {
	return screen.getByRole("combobox", { name: "Country" });
}

async function openAndExpectSearchFocus(open: () => Promise<void>) {
	await open();
	const search = await screen.findByPlaceholderText("Search countries");
	await waitFor(() => expect(document.activeElement).toBe(search));
}

describe("SearchableSelect", () => {
	it("uses the shared field trigger look instead of the outline button", () => {
		render(<CountrySelect />);

		const trigger = getTrigger();
		expect(trigger.className).toContain("bg-card");
		expect(trigger.className).toContain("border-input");
		expect(trigger.className).not.toContain("bg-background");
		expect(trigger.className).not.toContain("hover:bg-accent");
	});

	it("moves focus into the search field when opened by click", async () => {
		const user = userEvent.setup();
		render(<CountrySelect />);

		await openAndExpectSearchFocus(() => user.click(getTrigger()));
	});

	it.each(["{Enter}", " "])(
		"moves focus into the search field when opened with %s and filters as the user types",
		async (key) => {
			const user = userEvent.setup();
			render(<CountrySelect />);

			getTrigger().focus();
			await openAndExpectSearchFocus(() => user.keyboard(key));

			await user.keyboard("swi");

			expect(screen.getByRole("option", { name: "Switzerland" })).toBeTruthy();
			expect(screen.queryByRole("option", { name: "Austria" })).toBeNull();
		},
	);

	it("highlights the selected option and scrolls it into view when opened", async () => {
		const user = userEvent.setup();
		const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView);
		scrollIntoView.mockClear();
		render(<CountrySelect />);

		await openAndExpectSearchFocus(() => user.click(getTrigger()));

		const germany = screen.getByRole("option", { name: "Germany" });
		expect(germany.getAttribute("aria-selected")).toBe("true");
		await waitFor(() => expect(scrollIntoView.mock.contexts).toContain(germany));
	});

	it("keeps pinned options above the list while the list filters (#688)", async () => {
		const user = userEvent.setup();
		const onValueChange = vi.fn();
		render(
			<>
				<span id="question">Where were you at midnight?</span>
				<SearchableSelect
					aria-labelledby="question"
					emptyText="No country found"
					onValueChange={onValueChange}
					options={options}
					pinnedOptions={[
						{ code: "DE", name: "No business activity abroad" },
						{ code: "special:other", name: "Something else" },
					]}
					placeholder="Choose a location"
					searchPlaceholder="Search countries"
					value="special:other"
				/>
			</>,
		);
		const trigger = screen.getByRole("combobox", { name: "Where were you at midnight?" });
		expect(trigger.textContent).toContain("Something else");

		await openAndExpectSearchFocus(() => user.click(trigger));
		await user.keyboard("swi");
		expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
			"No business activity abroad",
			"Something else",
			"Switzerland",
		]);

		await user.click(screen.getByRole("option", { name: "No business activity abroad" }));
		expect(onValueChange).toHaveBeenCalledWith("DE");
	});

	it("finds options by their keywords and reports when the list closes", async () => {
		const user = userEvent.setup();
		const onOpenChange = vi.fn();
		render(
			<SearchableSelect
				aria-label="Currency"
				aria-invalid
				emptyText="No currency found"
				onOpenChange={onOpenChange}
				onValueChange={vi.fn()}
				options={[
					{ code: "CHF", name: "CHF – Swiss Franc", keywords: ["CHF", "Swiss Franc"] },
					{ code: "EUR", name: "EUR – Euro", keywords: ["EUR", "Euro"] },
				]}
				placeholder="Choose a currency"
				searchPlaceholder="Search currencies"
				value=""
			/>,
		);
		const trigger = screen.getByRole("combobox", { name: "Currency" });
		expect(trigger.getAttribute("aria-invalid")).toBe("true");

		await user.click(trigger);
		expect(onOpenChange).toHaveBeenLastCalledWith(true);
		await user.keyboard("franc");
		expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
			"CHF – Swiss Franc",
		]);
		await user.keyboard("{Escape}");
		expect(onOpenChange).toHaveBeenLastCalledWith(false);
	});

	it("returns focus to the trigger when Escape closes the popover", async () => {
		const user = userEvent.setup();
		render(<CountrySelect />);

		await openAndExpectSearchFocus(() => user.click(getTrigger()));
		await user.keyboard("{Escape}");

		await waitFor(() => expect(document.activeElement).toBe(getTrigger()));
		expect(screen.queryByPlaceholderText("Search countries")).toBeNull();
	});
});
