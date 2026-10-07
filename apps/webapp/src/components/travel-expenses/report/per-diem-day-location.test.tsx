/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));

import { PerDiemDayLocationFields } from "./per-diem-day-location";

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
afterEach(cleanup);

const MIDNIGHT = /Where were you at midnight\?/;

function mount(night: string, onChange = vi.fn()) {
	render(
		<PerDiemDayLocationFields
			id="day-2"
			index={1}
			count={3}
			value={{ night, activityAbroad: "" }}
			previousNight=""
			onChange={onChange}
		/>,
	);
	return onChange;
}

describe("PerDiemDayLocationFields", () => {
	it("filters countries by typed text and keeps the pinned answers (#688)", async () => {
		const user = userEvent.setup();
		const onChange = mount("");
		await user.click(screen.getByRole("combobox", { name: MIDNIGHT }));
		await user.keyboard("fra");
		const options = screen.getAllByRole("option").map((option) => option.textContent);
		expect(options.slice(0, 4)).toEqual([
			"Germany",
			"In flight all day (between take-off day and landing day)",
			"On board a ship all day (not embarking or disembarking)",
			"Something else (needs a manual calculation)",
		]);
		expect(options).toContain("France");
		expect(options).not.toContain("Italy");

		await user.click(screen.getByRole("option", { name: "France" }));
		expect(onChange).toHaveBeenCalledWith({ night: "FR", activityAbroad: "" });
	});

	it("chooses a pinned special situation with its saved value", async () => {
		const user = userEvent.setup();
		const onChange = mount("");
		await user.click(screen.getByRole("combobox", { name: MIDNIGHT }));
		await user.click(
			screen.getByRole("option", {
				name: "In flight all day (between take-off day and landing day)",
			}),
		);
		expect(onChange).toHaveBeenCalledWith({ night: "special:in_flight", activityAbroad: "" });
	});

	it.each([
		["FR:paris", "France"],
		["special:at_sea", "On board a ship all day (not embarking or disembarking)"],
	])("shows the saved answer %s unchanged", (night, label) => {
		const onChange = mount(night);
		expect(screen.getByRole("combobox", { name: MIDNIGHT }).textContent).toContain(label);
		expect(onChange).not.toHaveBeenCalled();
	});
});
