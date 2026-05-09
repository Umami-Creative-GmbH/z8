/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimeFormatSettings } from "./time-format-settings";

const refreshMock = vi.fn();

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: refreshMock }),
}));

describe("TimeFormatSettings", () => {
	it("saves a changed time format", async () => {
		const onUpdate = vi.fn().mockResolvedValue({ success: true, data: undefined });

		render(<TimeFormatSettings currentTimeFormat="24h" onUpdate={onUpdate} />);

		fireEvent.click(screen.getByRole("combobox", { name: "Time format" }));
		fireEvent.click(screen.getByRole("option", { name: "12-hour (8:00 AM)" }));
		fireEvent.click(screen.getByRole("button", { name: "Save Time Format" }));

		await waitFor(() => {
			expect(onUpdate).toHaveBeenCalledWith("12h");
		});
		expect(refreshMock).toHaveBeenCalled();
	});
});
