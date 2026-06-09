/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

describe("Select", () => {
	it("types single-select onValueChange as nullable without widening multiple-select values", () => {
		type SingleStringOnValueChange = NonNullable<
			Parameters<typeof Select<string, false>>[0]["onValueChange"]
		>;
		type MultipleStringOnValueChange = NonNullable<
			Parameters<typeof Select<string, true>>[0]["onValueChange"]
		>;

		expectTypeOf<Parameters<SingleStringOnValueChange>[0]>().toEqualTypeOf<string | null>();
		expectTypeOf<Parameters<MultipleStringOnValueChange>[0]>().toEqualTypeOf<string[]>();
	});

	it("accepts non-null and nullable single-select handlers", () => {
		type SingleStringSelectProps = Parameters<typeof Select<string, false>>[0];
		type NullableStringSelectProps = Parameters<typeof Select<string | null, false>>[0];
		const handleStringValueChange = (value: string) => value;
		const handleNullableValueChange = (value: string | null) => value;

		const nonNullProps = {
			value: "ready",
			onValueChange: handleStringValueChange,
		} satisfies SingleStringSelectProps;
		const nullableProps = {
			value: null,
			onValueChange: handleNullableValueChange,
		} satisfies NullableStringSelectProps;

		expectTypeOf(nonNullProps.onValueChange).toEqualTypeOf<typeof handleStringValueChange>();
		expectTypeOf(nullableProps.onValueChange).toEqualTypeOf<typeof handleNullableValueChange>();
	});

	it("selects an item and updates trigger text", async () => {
		const user = userEvent.setup();

		render(
			<Select defaultValue="draft">
				<SelectTrigger aria-label="Status">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="draft">Draft</SelectItem>
					<SelectItem value="ready">Ready</SelectItem>
				</SelectContent>
			</Select>,
		);

		const trigger = screen.getByRole("combobox", { name: "Status" });
		await user.click(trigger);
		await user.click(await screen.findByRole("option", { name: "Ready" }));

		expect(trigger.textContent).toContain("Ready");
	});

	it("keeps the portaled positioner above modal overlays", async () => {
		const user = userEvent.setup();

		render(
			<Select defaultValue="draft">
				<SelectTrigger aria-label="Status">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="draft">Draft</SelectItem>
					<SelectItem value="ready">Ready</SelectItem>
				</SelectContent>
			</Select>,
		);

		await user.click(screen.getByRole("combobox", { name: "Status" }));

		expect(document.querySelector('[data-slot="select-positioner"]')?.className).toContain(
			"z-50",
		);
	});

	it("calls onValueChange when selecting a null value", async () => {
		const user = userEvent.setup();
		const onValueChange = vi.fn();

		render(
			<Select<string | null> defaultValue="ready" onValueChange={onValueChange}>
				<SelectTrigger aria-label="Status">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="ready">Ready</SelectItem>
					<SelectItem value={null}>No status</SelectItem>
				</SelectContent>
			</Select>,
		);

		await user.click(screen.getByRole("combobox", { name: "Status" }));
		await user.click(screen.getByRole("option", { name: "No status" }));

		expect(onValueChange).toHaveBeenCalledWith(null, expect.any(Object));
	});

	it("preserves Radix-compatible click-only option selection", async () => {
		const onValueChange = vi.fn();

		render(
			<Select defaultValue="draft" onValueChange={onValueChange}>
				<SelectTrigger aria-label="Status">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="draft">Draft</SelectItem>
					<SelectItem value="ready">Ready</SelectItem>
				</SelectContent>
			</Select>,
		);

		fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
		fireEvent.click(await screen.findByRole("option", { name: "Ready" }));

		expect(onValueChange).toHaveBeenCalledWith("ready", expect.any(Object));
	});
});
