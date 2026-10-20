// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
	save: vi.fn(),
	refresh: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: api.toast }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replace(`{${key}}`, value),
				fallback,
			),
	}),
}));
vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: api.refresh }),
}));
vi.mock("@/lib/organization/driving-licence/policy-actions", () => ({
	saveDrivingLicencePolicyAction: api.save,
}));

vi.mock("@/lib/organization/driving-licence/interval-actions", () => ({
	previewDrivingLicenceIntervalAction: vi.fn(),
	applyDrivingLicenceIntervalAction: vi.fn(),
}));

import { DrivingLicenceSettings } from "./policy-settings";

beforeEach(() => {
	api.save.mockReset().mockResolvedValue({ success: true, data: {} });
	api.toast.success.mockReset();
	api.toast.error.mockReset();
});
it("points to the Features switch instead of offering a policy form before the first activation", () => {
	render(
		<DrivingLicenceSettings
			data={{ policy: null }}
		/>,
	);
	expect(
		screen.getByText(/Switch on driving licence control on the Features card/),
	).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Save policy" })).toBeNull();
	expect(screen.queryByRole("checkbox")).toBeNull();
});
it("saves retention and reminders without an activation control, and no longer lists employees to enroll", async () => {
	render(
		<DrivingLicenceSettings
			data={{
				policy: {
					enabled: true,
					intervalMonths: 6,
					timezone: "Europe/Berlin",
					reminderLeadDays: [30, 7],
					retentionMonths: 12,
					retentionJustification: "Organization evidence retention",
				},
			}}
		/>,
	);
	expect(screen.queryByLabelText("Activate driving licence control")).toBeNull();
	expect(screen.queryByRole("checkbox")).toBeNull();
	expect(
		(screen.getByLabelText("Reminder lead days") as HTMLInputElement).value,
	).toBe("30, 7");
	expect(
		screen.getByText(/Date-only limits include the whole shown day/),
	).toBeTruthy();
	fireEvent.change(screen.getByLabelText("Retention period (months)"), {
		target: { value: "24" },
	});
	fireEvent.change(screen.getByLabelText("Retention justification"), {
		target: { value: "Our justified internal evidence retention policy." },
	});
	await userEvent.click(screen.getByRole("button", { name: "Save policy" }));
	await waitFor(() => expect(api.toast.success).toHaveBeenCalledWith("Policy saved"));
	expect(api.save).toHaveBeenCalledWith(
		expect.objectContaining({
			timezone: "Europe/Berlin",
			reminderLeadDays: [30, 7],
			retentionMonths: 24,
		}),
	);
	expect(api.save.mock.lastCall?.[0]).not.toHaveProperty("enabled");
	expect(screen.queryByRole("button", { name: /Enroll/ })).toBeNull();
});
it("routes an existing policy's interval edits to impact preview", () => {
	render(
		<DrivingLicenceSettings
			data={{
				policy: {
					enabled: true,
					intervalMonths: 6,
					timezone: "Europe/Berlin",
					reminderLeadDays: [7],
					retentionMonths: 36,
					retentionJustification: "Organization evidence retention",
				},
			}}
		/>,
	);
	// The current interval and the fixed deadline timezone are shown, not editable.
	expect(screen.getByText("6")).toBeTruthy();
	expect(screen.getByText("Europe/Berlin")).toBeTruthy();
	expect(screen.queryByRole("textbox", { name: /timezone/i })).toBeNull();
	expect(screen.queryByRole("spinbutton", { name: "Routine check interval (months)" })).toBeNull();
	expect(
		screen.getByRole("button", { name: "Preview interval impact" }),
	).toBeTruthy();
	expect(
		screen.queryByRole("button", { name: "Apply interval change" }),
	).toBeNull();
});
it("reports a refused save in a toast", async () => {
	api.save.mockResolvedValue({ success: false, error: "retention_required" });
	render(
		<DrivingLicenceSettings
			data={{
				policy: {
					enabled: true,
					intervalMonths: 6,
					timezone: "Europe/Berlin",
					reminderLeadDays: [30, 7],
					retentionMonths: 12,
					retentionJustification: "Organization evidence retention",
				},
			}}
		/>,
	);
	await userEvent.click(screen.getByRole("button", { name: "Save policy" }));
	await waitFor(() =>
		expect(api.toast.error).toHaveBeenCalledWith(
			expect.stringContaining("Keep a finite, justified retention period"),
		),
	);
	expect(api.toast.success).not.toHaveBeenCalled();
});
