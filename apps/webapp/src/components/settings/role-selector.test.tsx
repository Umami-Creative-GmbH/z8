/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContractTypeSelector } from "./contract-type-selector";
import { RoleSelector } from "./role-selector";

const saturatedPalette = /(red|green|blue|purple|orange)-\d/;

describe("RoleSelector", () => {
	it("marks the selected role with the primary selection treatment instead of a per-role color", () => {
		render(<RoleSelector value="manager" onChange={vi.fn()} />);

		const manager = screen.getByRole("button", { name: /Manager/ });
		expect(manager.getAttribute("aria-pressed")).toBe("true");
		expect(manager.className).toContain("border-primary");
		expect(screen.getByRole("button", { name: /Admin/ }).getAttribute("aria-pressed")).toBe(
			"false",
		);
		for (const button of screen.getAllByRole("button")) {
			expect(button.outerHTML).not.toMatch(saturatedPalette);
			expect(button.querySelector("svg")).not.toBeNull();
		}
	});

	it("reports the chosen role", () => {
		const onChange = vi.fn();
		render(<RoleSelector value="employee" onChange={onChange} />);

		fireEvent.click(screen.getByRole("button", { name: /Admin/ }));

		expect(onChange).toHaveBeenCalledWith("admin");
	});
});

describe("ContractTypeSelector", () => {
	it("marks the selected contract type with the primary selection treatment", () => {
		render(<ContractTypeSelector value="hourly" onChange={vi.fn()} />);

		const hourly = screen.getByRole("button", { name: /Hourly/ });
		expect(hourly.getAttribute("aria-pressed")).toBe("true");
		expect(hourly.className).toContain("border-primary");
		for (const button of screen.getAllByRole("button")) {
			expect(button.outerHTML).not.toMatch(saturatedPalette);
			expect(button.querySelector("svg")).not.toBeNull();
		}
	});

	it("does not change the contract type while disabled", () => {
		const onChange = vi.fn();
		render(<ContractTypeSelector value="fixed" onChange={onChange} disabled />);

		fireEvent.click(screen.getByRole("button", { name: /Hourly/ }));

		expect(onChange).not.toHaveBeenCalled();
	});
});
