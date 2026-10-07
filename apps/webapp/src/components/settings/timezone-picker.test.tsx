/* @vitest-environment jsdom */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";
import { TimezonePicker } from "./timezone-picker";

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

function ControlledTimezonePicker() {
	const [timezone, setTimezone] = useState("Europe/Berlin");

	return <TimezonePicker onChange={setTimezone} value={timezone} />;
}

function getTrigger() {
	return screen.getByRole("combobox");
}

async function expectSearchFocused() {
	const search = await screen.findByPlaceholderText(/search timezone/i);
	await waitFor(() => expect(document.activeElement).toBe(search));
}

describe("TimezonePicker", () => {
	it("uses the shared field trigger look", () => {
		render(<ControlledTimezonePicker />);

		expect(getTrigger().className).toContain("bg-card");
		expect(getTrigger().className).not.toContain("hover:bg-accent");
	});

	it("moves focus into the search field when opened by click", async () => {
		const user = userEvent.setup();
		render(<ControlledTimezonePicker />);

		await user.click(getTrigger());

		await expectSearchFocused();
	});

	it.each(["{Enter}", " "])(
		"moves focus into the search field when opened with %s and filters as the user types",
		async (key) => {
			const user = userEvent.setup();
			render(<ControlledTimezonePicker />);

			getTrigger().focus();
			await user.keyboard(key);
			await expectSearchFocused();

			await user.keyboard("tokyo");

			expect(screen.getByRole("option", { name: /Tokyo/ })).toBeTruthy();
			expect(screen.queryByRole("option", { name: /Berlin/ })).toBeNull();
		},
	);

	it("highlights the selected timezone when opened", async () => {
		const user = userEvent.setup();
		render(<ControlledTimezonePicker />);

		await user.click(getTrigger());
		await expectSearchFocused();

		expect(screen.getByRole("option", { name: /Berlin/ }).getAttribute("aria-selected")).toBe(
			"true",
		);
	});

	it("selects a filtered timezone with the keyboard", async () => {
		const user = userEvent.setup();
		render(<ControlledTimezonePicker />);

		await user.click(getTrigger());
		await expectSearchFocused();
		await user.keyboard("tokyo{Enter}");

		await waitFor(() => expect(getTrigger().textContent).toContain("Tokyo"));
	});

	it("returns focus to the trigger when Escape closes the popover", async () => {
		const user = userEvent.setup();
		render(<ControlledTimezonePicker />);

		await user.click(getTrigger());
		await expectSearchFocused();
		await user.keyboard("{Escape}");

		await waitFor(() => expect(document.activeElement).toBe(getTrigger()));
	});
});
