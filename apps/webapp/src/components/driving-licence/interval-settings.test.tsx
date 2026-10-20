// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
	preview: vi.fn(),
	apply: vi.fn(),
	refresh: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: api.toast }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: api.refresh }),
}));
vi.mock("@/lib/organization/driving-licence/interval-actions", () => ({
	previewDrivingLicenceIntervalAction: api.preview,
	applyDrivingLicenceIntervalAction: api.apply,
}));

import { DrivingLicenceIntervalSettings } from "./interval-settings";

it("requires an impact preview, shows newly overdue classes, and discards a stale preview before retrying", async () => {
	api.preview.mockResolvedValue({
		success: true,
		data: {
			intervalMonths: 1,
			previousIntervalMonths: 6,
			policyVersion: 1,
			previewToken: "token",
			classes: [
				{
					employeeId: "e1",
					employeeName: "Dana Driver",
					classCode: "B",
					previousValidThrough: "2026-07-31",
					routineValidThrough: "2026-02-28",
					validThrough: "2026-02-28",
					deadlineTimezone: "Europe/Berlin",
					newlyOverdue: true,
					remainsSuspended: false,
					expiresAt: "2026-02-28T23:00:00Z",
				},
			],
		},
	});
	api.apply.mockResolvedValue({ success: false, error: "stale_preview" });
	render(<DrivingLicenceIntervalSettings intervalMonths={6} />);
	expect(
		screen.queryByRole("button", { name: "Apply interval change" }),
	).toBeNull();
	fireEvent.change(screen.getByLabelText("New routine interval (months)"), {
		target: { value: "1" },
	});
	await userEvent.click(
		screen.getByRole("button", { name: "Preview interval impact" }),
	);
	const impact = await screen.findByRole("table");
	expect(impact.textContent).toContain("Dana Driver");
	expect(screen.getByText("Newly overdue — will be suspended")).toBeTruthy();
	expect(screen.getByText("Feb 28, 2026")).toBeTruthy();
	expect(screen.getByText("Europe/Berlin")).toBeTruthy();
	await userEvent.click(
		screen.getByRole("button", { name: "Apply interval change" }),
	);
	await waitFor(() =>
		expect(api.toast.error).toHaveBeenCalledWith(expect.stringContaining("changed")),
	);
	expect(
		screen.queryByRole("button", { name: "Apply interval change" }),
	).toBeNull();
});
it("confirms an applied interval in a toast", async () => {
	api.preview.mockResolvedValue({
		success: true,
		data: {
			intervalMonths: 12,
			previousIntervalMonths: 6,
			policyVersion: 1,
			previewToken: "token",
			classes: [],
		},
	});
	api.apply.mockResolvedValue({ success: true, data: {} });
	render(<DrivingLicenceIntervalSettings intervalMonths={6} />);
	fireEvent.change(screen.getByLabelText("New routine interval (months)"), {
		target: { value: "12" },
	});
	await userEvent.click(screen.getByRole("button", { name: "Preview interval impact" }));
	await userEvent.click(await screen.findByRole("button", { name: "Apply interval change" }));
	await waitFor(() =>
		expect(api.toast.success).toHaveBeenCalledWith(
			"Interval applied. Existing suspensions remain in effect.",
		),
	);
	expect(api.refresh).toHaveBeenCalled();
});
