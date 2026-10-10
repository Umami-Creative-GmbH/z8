import { beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { clockConnectionRequired } from "@/lib/time-tracking/browser-clock-command";
import { toastClockCommandError } from "./clock-command-error-toast";

beforeEach(() => {
	toastError.mockClear();
});

describe("toastClockCommandError", () => {
	it("shows a failed clock command as an error toast", () => {
		toastClockCommandError({ success: false, code: "holiday" }, "Cannot clock in", {
			description: "Holiday",
		});

		expect(toastError).toHaveBeenCalledWith("Cannot clock in", { description: "Holiday" });
	});

	it("leaves the offline connection refusal (#845) to the inline notice", () => {
		toastClockCommandError(clockConnectionRequired(), "Clocking needs a connection");

		expect(toastError).not.toHaveBeenCalled();
	});
});
