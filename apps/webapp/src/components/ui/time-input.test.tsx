/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMock, destroyMock, instances } = vi.hoisted(() => ({
	createMock: vi.fn(),
	destroyMock: vi.fn(),
	instances: [] as Array<{
		input: HTMLInputElement;
		options: {
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
		expect(createMock).toHaveBeenCalledTimes(1);
		expect(instances[0]?.input).toBe(input);
	});

	it("emits standard change events when a time is confirmed", () => {
		const handleChange = vi.fn();
		render(<TimeInput aria-label="Start time" value="09:00" onChange={handleChange} />);

		instances[0]?.options.callbacks?.onConfirm?.({ hour: "14", minutes: "30" });

		expect(handleChange).toHaveBeenCalledTimes(1);
		expect(handleChange.mock.calls[0]?.[0].target.value).toBe("14:30");
	});

	it("keeps manual typing compatible with text input fallback", () => {
		const handleChange = vi.fn();
		render(<TimeInput aria-label="Start time" value="" onChange={handleChange} />);

		fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "08:15" } });

		expect(handleChange).toHaveBeenCalledWith(expect.objectContaining({ type: "change" }));
	});
});
