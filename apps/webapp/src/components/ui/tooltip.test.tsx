/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

describe("Tooltip", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows tooltip content on hover", async () => {
		const user = userEvent.setup();

		render(
			<Tooltip>
				<TooltipTrigger>Payroll status</TooltipTrigger>
				<TooltipContent>Approved timesheets are ready for export.</TooltipContent>
			</Tooltip>,
		);

		await user.hover(screen.getByRole("button", { name: "Payroll status" }));

		expect(await screen.findByText("Approved timesheets are ready for export.")).toBeTruthy();
	});

	it("does not shadow an outer provider delayDuration with the default delay", async () => {
		vi.useFakeTimers();

		render(
			<TooltipProvider delayDuration={150}>
				<Tooltip>
					<TooltipTrigger>Payroll status</TooltipTrigger>
					<TooltipContent>Delayed by provider.</TooltipContent>
				</Tooltip>
			</TooltipProvider>,
		);

		const trigger = screen.getByRole("button", { name: "Payroll status" });

		fireEvent.pointerEnter(trigger);
		fireEvent.mouseEnter(trigger);

		expect(screen.queryByText("Delayed by provider.")).toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(149);
		});

		expect(screen.queryByText("Delayed by provider.")).toBeNull();
	});

	it("keeps default spacing between tooltip content and its trigger", () => {
		const source = readFileSync(join(process.cwd(), "src/components/ui/tooltip.tsx"), "utf8");

		expect(source).toContain("sideOffset = 4");
		expect(source).not.toContain("translate-y-[calc(-50%_-_2px)]");
	});
});
