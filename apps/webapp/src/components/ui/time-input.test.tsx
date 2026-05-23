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
			ui?: {
				appendModalSelector?: string;
				editable?: boolean;
			};
			callbacks?: {
				onConfirm?: (data: {
					hour?: string | null;
					minutes?: string | null;
					type?: string | null;
				}) => void;
			};
		};
		open: ReturnType<typeof vi.fn>;
	}>,
}));

vi.mock("timepicker-ui", () => ({
	TimepickerUI: vi.fn().mockImplementation(function TimepickerUIMock(input, options) {
		const open = vi.fn();
		input.addEventListener("click", open);
		instances.push({ input, options, open });
		return {
			create: createMock,
			destroy: destroyMock,
		};
	}),
}));

import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
import { TimeInput } from "./time-input";

describe("TimeInput", () => {
	beforeEach(() => {
		createMock.mockClear();
		destroyMock.mockClear();
		instances.length = 0;
	});

	it("uses a masked text input and a separate picker anchor", () => {
		render(<TimeInput aria-label="Start time" value="09:00" onChange={vi.fn()} />);

		const input = screen.getByLabelText("Start time");
		const button = screen.getByRole("button", { name: "Open time picker" });

		expect(input.getAttribute("type")).toBe("text");
		expect(input.hasAttribute("readonly")).toBe(false);
		expect(button.getAttribute("type")).toBe("button");
		expect(createMock).toHaveBeenCalledTimes(1);
		expect(instances[0]?.input).not.toBe(input);
		expect(instances[0]?.input.getAttribute("aria-hidden")).toBe("true");
		expect(instances[0]?.options.clock?.type).toBe("24h");
		expect(instances[0]?.options.ui?.editable).toBe(false);
	});

	it("keeps the picker anchor value synchronized with the displayed time", () => {
		render(<TimeInput aria-label="Start time" timeFormat="12h" value="14:05" onChange={vi.fn()} />);

		expect(screen.getByLabelText<HTMLInputElement>("Start time").value).toBe("02:05");
		expect(instances[0]?.input.value).toBe("02:05 PM");

		fireEvent.click(screen.getByRole("button", { name: "Switch to AM" }));
		expect(instances[0]?.input.value).toBe("02:05 AM");

		instances[0]?.options.callbacks?.onConfirm?.({ hour: "9", minutes: "30", type: "AM" });
		expect(instances[0]?.input.value).toBe("09:30 AM");

		fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "10:45" } });
		expect(instances[0]?.input.value).toBe("10:45 AM");
	});

	it("opens the picker only from the connected button", () => {
		render(<TimeInput aria-label="Start time" value="09:00" onChange={vi.fn()} />);

		const input = screen.getByLabelText("Start time");
		const button = screen.getByRole("button", { name: "Open time picker" });

		fireEvent.focus(input);
		fireEvent.click(input);
		expect(instances[0]?.open).not.toHaveBeenCalled();

		fireEvent.click(button);
		expect(instances[0]?.open).toHaveBeenCalledTimes(1);
	});

	it("disables the input and picker trigger together", () => {
		render(<TimeInput aria-label="Start time" value="09:00" onChange={vi.fn()} disabled />);

		expect(screen.getByLabelText<HTMLInputElement>("Start time").disabled).toBe(true);
		expect(
			screen.getByRole<HTMLButtonElement>("button", { name: "Open time picker" }).disabled,
		).toBe(true);
	});

	it("passes the 12-hour preference to timepicker-ui", () => {
		render(<TimeInput aria-label="Start time" onChange={vi.fn()} timeFormat="12h" value="09:00" />);

		expect(instances[0]?.options.clock?.type).toBe("12h");
	});

	it("displays controlled values with the 12-hour preference", () => {
		render(<TimeInput aria-label="Start time" onChange={vi.fn()} timeFormat="12h" value="14:05" />);

		expect(screen.getByLabelText<HTMLInputElement>("Start time").value).toBe("02:05");
		expect(screen.getByRole("button", { name: "Switch to AM" }).textContent).toBe("PM");
	});

	it("displays controlled values with the 24-hour preference", () => {
		render(<TimeInput aria-label="Start time" onChange={vi.fn()} timeFormat="24h" value="14:05" />);

		expect(screen.getByLabelText<HTMLInputElement>("Start time").value).toBe("14:05");
	});

	it("uses the provider time format when no explicit time format is passed", () => {
		render(
			<UserPreferencesProvider timeFormat="12h" weekStartDay="sunday">
				<TimeInput aria-label="Start time" onChange={vi.fn()} value="09:00" />
			</UserPreferencesProvider>,
		);

		expect(instances[0]?.options.clock?.type).toBe("12h");
	});

	it("uses an explicit time format over the provider time format", () => {
		render(
			<UserPreferencesProvider timeFormat="12h" weekStartDay="sunday">
				<TimeInput aria-label="Start time" onChange={vi.fn()} timeFormat="24h" value="09:00" />
			</UserPreferencesProvider>,
		);

		expect(instances[0]?.options.clock?.type).toBe("24h");
	});

	it("emits standard change events when a 24-hour time is confirmed", () => {
		const handleChange = vi.fn();
		render(<TimeInput aria-label="Start time" value="09:00" onChange={handleChange} />);

		instances[0]?.options.callbacks?.onConfirm?.({ hour: "14", minutes: "30" });

		expect(handleChange).toHaveBeenCalledTimes(1);
		expect(handleChange.mock.calls[0]?.[0].target.value).toBe("14:30");
		expect(handleChange.mock.calls[0]?.[0].currentTarget.value).toBe("14:30");
		expect(handleChange.mock.calls[0]?.[0].type).toBe("change");
	});

	it("converts confirmed PM times to stored 24-hour values in 12-hour mode", () => {
		const handleChange = vi.fn();
		render(
			<TimeInput aria-label="Start time" timeFormat="12h" value="09:00" onChange={handleChange} />,
		);

		instances[0]?.options.callbacks?.onConfirm?.({ hour: "2", minutes: "05", type: "PM" });

		expect(handleChange).toHaveBeenCalledTimes(1);
		expect(handleChange.mock.calls[0]?.[0].target.value).toBe("14:05");
		expect(handleChange.mock.calls[0]?.[0].currentTarget.value).toBe("14:05");
		expect(handleChange.mock.calls[0]?.[0].type).toBe("change");
		expect(screen.getByLabelText<HTMLInputElement>("Start time").value).toBe("02:05");
		expect(screen.getByRole("button", { name: "Switch to AM" }).textContent).toBe("PM");
	});

	it("converts confirmed AM midnight to stored 24-hour values in 12-hour mode", () => {
		const handleChange = vi.fn();
		render(
			<TimeInput aria-label="Start time" timeFormat="12h" value="09:00" onChange={handleChange} />,
		);

		instances[0]?.options.callbacks?.onConfirm?.({ hour: "12", minutes: "00", type: "AM" });

		expect(handleChange).toHaveBeenCalledTimes(1);
		expect(handleChange.mock.calls[0]?.[0].target.value).toBe("00:00");
	});

	it("treats unknown marker types as 24-hour values", () => {
		const handleChange = vi.fn();
		render(
			<TimeInput aria-label="Start time" timeFormat="12h" value="09:00" onChange={handleChange} />,
		);

		instances[0]?.options.callbacks?.onConfirm?.({ hour: "12", minutes: "00", type: "unknown" });

		expect(handleChange).toHaveBeenCalledTimes(1);
		expect(handleChange.mock.calls[0]?.[0].target.value).toBe("12:00");
	});

	it("preserves the input value when recreating the picker", () => {
		const { rerender } = render(
			<TimeInput aria-label="Start time" timeFormat="24h" value="09:00" />,
		);

		rerender(<TimeInput aria-label="Start time" timeFormat="12h" value="09:00" />);

		expect(destroyMock).toHaveBeenCalledWith({ keepInputValue: true });
	});

	it("emits normalized values from valid 24-hour typing", () => {
		const handleChange = vi.fn();
		render(<TimeInput aria-label="Start time" timeFormat="24h" value="" onChange={handleChange} />);

		fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "14:30" } });

		expect(handleChange).toHaveBeenCalledTimes(1);
		expect(handleChange.mock.calls[0]?.[0].target.value).toBe("14:30");
		expect(handleChange.mock.calls[0]?.[0].currentTarget.value).toBe("14:30");
	});

	it("does not emit changes for incomplete typed values", () => {
		const handleChange = vi.fn();
		render(<TimeInput aria-label="Start time" timeFormat="24h" value="" onChange={handleChange} />);

		fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "14:" } });

		expect(handleChange).not.toHaveBeenCalled();
	});

	it("emits an empty string when clearing a populated time", () => {
		const handleChange = vi.fn();
		render(
			<TimeInput aria-label="Start time" timeFormat="24h" value="14:30" onChange={handleChange} />,
		);

		fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "" } });

		expect(handleChange).toHaveBeenCalledTimes(1);
		expect(handleChange.mock.calls[0]?.[0].target.value).toBe("");
		expect(handleChange.mock.calls[0]?.[0].currentTarget.value).toBe("");
	});

	it("emits normalized values from 12-hour typing and AM/PM state", () => {
		const handleChange = vi.fn();
		render(<TimeInput aria-label="Start time" timeFormat="12h" value="" onChange={handleChange} />);

		fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "02:05" } });
		fireEvent.click(screen.getByRole("button", { name: "Switch to PM" }));

		expect(handleChange).toHaveBeenLastCalledWith(
			expect.objectContaining({
				target: expect.objectContaining({ value: "14:05" }),
				currentTarget: expect.objectContaining({ value: "14:05" }),
			}),
		);
	});

	it("appends the picker modal inside the component subtree", () => {
		render(<TimeInput aria-label="Start time" value="09:00" onChange={vi.fn()} />);

		const modalRootSelector = instances[0]?.options.ui?.appendModalSelector;

		expect(modalRootSelector).toMatch(/^#time-input-/);
		expect(document.querySelector(modalRootSelector ?? "")?.contains(instances[0]?.input)).toBe(
			true,
		);
	});
});
