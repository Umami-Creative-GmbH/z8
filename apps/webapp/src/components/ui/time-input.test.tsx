/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMock, destroyMock, instances } = vi.hoisted(() => ({
	createMock: vi.fn(),
	destroyMock: vi.fn(),
	instances: [] as Array<{
		input: HTMLInputElement;
		options: {
			clock?: {
				type?: "12h" | "24h";
			};
			callbacks?: {
				onConfirm?: (data: { hour?: string | null; minutes?: string | null }) => void;
			};
		};
	}>,
}));

vi.mock("timepicker-ui", () => ({
	TimepickerUI: vi.fn().mockImplementation(function TimepickerUIMock(input, options) {
		instances.push({ input, options });
		return {
			create: createMock,
			destroy: destroyMock,
		};
	}),
}));

import { TimeInput } from "./time-input";

describe("TimeInput", () => {
	beforeEach(() => {
		createMock.mockClear();
		destroyMock.mockClear();
		instances.length = 0;
	});

	it("uses timepicker-ui without rendering a native time input", () => {
		render(<TimeInput aria-label="Start time" value="09:00" onChange={vi.fn()} />);

		const input = screen.getByLabelText("Start time");

		expect(input.getAttribute("type")).toBe("text");
		expect(input.getAttribute("readonly")).toBe("");
		expect(createMock).toHaveBeenCalledTimes(1);
		expect(instances[0]?.input).toBe(input);
		expect(instances[0]?.options.clock?.type).toBe("24h");
	});

	it("passes the 12-hour preference to timepicker-ui", () => {
		render(<TimeInput aria-label="Start time" onChange={vi.fn()} timeFormat="12h" value="09:00" />);

		expect(instances[0]?.options.clock?.type).toBe("12h");
	});

	it("emits standard change events when a time is confirmed", () => {
		const handleChange = vi.fn();
		render(<TimeInput aria-label="Start time" value="09:00" onChange={handleChange} />);

		instances[0]?.options.callbacks?.onConfirm?.({ hour: "14", minutes: "30" });

		expect(handleChange).toHaveBeenCalledTimes(1);
		expect(handleChange.mock.calls[0]?.[0].target.value).toBe("14:30");
		expect(handleChange.mock.calls[0]?.[0].currentTarget.value).toBe("14:30");
		expect(handleChange.mock.calls[0]?.[0].type).toBe("change");
	});

	it("preserves the input value when recreating the picker", () => {
		const { rerender } = render(<TimeInput aria-label="Start time" timeFormat="24h" value="09:00" />);

		rerender(<TimeInput aria-label="Start time" timeFormat="12h" value="09:00" />);

		expect(destroyMock).toHaveBeenCalledWith({ keepInputValue: true });
	});

	it("does not emit changes from manual typing", () => {
		const handleChange = vi.fn();
		render(<TimeInput aria-label="Start time" value="" onChange={handleChange} />);

		fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "08:15" } });

		expect(handleChange).not.toHaveBeenCalled();
	});
});
