/* @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

import { BillableCurrencyForm } from "./billable-currency-form";

afterEach(cleanup);

describe("BillableCurrencyForm", () => {
	it("saves once and holds the choice while the save is pending", async () => {
		let finish!: () => void;
		const onSubmit = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		const user = userEvent.setup();
		render(
			<BillableCurrencyForm defaultCurrency="CHF" onSubmit={onSubmit}>
				{({ pending }) => (
					<button type="submit" aria-busy={pending}>
						Save currency
					</button>
				)}
			</BillableCurrencyForm>,
		);

		const trigger = screen.getByRole("combobox", { name: "Billable currency" });
		expect(trigger.hasAttribute("disabled") || trigger.getAttribute("aria-disabled") === "true").toBe(
			false,
		);
		await user.click(screen.getByRole("button", { name: "Save currency" }));
		await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("CHF"));

		await waitFor(() =>
			expect(
				trigger.hasAttribute("disabled") || trigger.getAttribute("aria-disabled") === "true",
			).toBe(true),
		);
		// A second submit while saving (e.g. Enter or a double click) is ignored.
		await user.click(screen.getByRole("button", { name: "Save currency" }));
		expect(onSubmit).toHaveBeenCalledTimes(1);

		finish();
		await waitFor(() =>
			expect(
				trigger.hasAttribute("disabled") || trigger.getAttribute("aria-disabled") === "true",
			).toBe(false),
		);
	});
});
