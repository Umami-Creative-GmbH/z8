/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { Slot } from "@/components/ui/slot";

describe("Slot", () => {
	it("merges class names and forwards props to the child", () => {
		render(
			<Slot className="from-slot" data-slot="button">
				<a href="/settings" className="from-child">
					Settings
				</a>
			</Slot>,
		);

		const link = screen.getByRole("link", { name: "Settings" });
		expect(link.getAttribute("href")).toBe("/settings");
		expect(link.getAttribute("data-slot")).toBe("button");
		expect(link.classList.contains("from-child")).toBe(true);
		expect(link.classList.contains("from-slot")).toBe(true);
	});

	it("runs child and slot event handlers child first", async () => {
		const user = userEvent.setup();
		const order: string[] = [];
		const childClick = vi.fn(() => order.push("child"));
		const slotClick = vi.fn(() => order.push("slot"));

		render(
			<Slot onClick={slotClick}>
				<button type="button" onClick={childClick}>
					Open
				</button>
			</Slot>,
		);

		await user.click(screen.getByRole("button", { name: "Open" }));

		expect(childClick).toHaveBeenCalledTimes(1);
		expect(slotClick).toHaveBeenCalledTimes(1);
		expect(order).toEqual(["child", "slot"]);
	});

	it("composes child and slot refs", () => {
		const childRef = React.createRef<HTMLButtonElement | null>();
		const slotRef = React.createRef<HTMLElement | null>();

		render(
			<Slot ref={slotRef}>
				<button type="button" ref={childRef}>
					Open
				</button>
			</Slot>,
		);

		const button = screen.getByRole("button", { name: "Open" });
		expect(childRef.current).toBe(button);
		expect(slotRef.current).toBe(button);
	});

	it("renders null for invalid children", () => {
		const { container, rerender } = render(<Slot>{null}</Slot>);
		expect(container.innerHTML).toBe("");

		rerender(<Slot>Invalid</Slot>);
		expect(container.innerHTML).toBe("");

		const invalidObject = { invalid: true } as unknown as React.ReactNode;
		rerender(<Slot>{invalidObject}</Slot>);
		expect(container.innerHTML).toBe("");
	});
});
