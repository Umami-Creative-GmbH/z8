// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
	save: vi.fn(),
	enroll: vi.fn(),
	refresh: vi.fn(),
}));
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
	enrollDrivingLicenceEmployeeAction: api.enroll,
}));

vi.mock("@/lib/organization/driving-licence/interval-actions", () => ({
	previewDrivingLicenceIntervalAction: vi.fn(),
	applyDrivingLicenceIntervalAction: vi.fn(),
}));

import { DrivingLicenceSettings } from "./policy-settings";

beforeEach(() => {
	api.save.mockReset().mockResolvedValue({ success: true, data: {} });
	api.enroll.mockReset().mockResolvedValue({ success: true, data: {} });
});
it("lets an administrator choose retention, save a policy, and enroll an employee without implying authorization", async () => {
	render(
		<DrivingLicenceSettings
			data={{
				policy: null,
				employees: [{ id: "e1311", name: "Dana Driver" }],
				participants: [],
			}}
		/>,
	);
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
	await userEvent.click(
		screen.getByLabelText("Activate driving licence control"),
	);
	await userEvent.click(screen.getByRole("button", { name: "Save policy" }));
	await waitFor(() =>
		expect(screen.getByRole("status").textContent).toContain("Policy saved"),
	);
	expect(api.save).toHaveBeenCalledWith(
		expect.objectContaining({
			enabled: true,
			timezone: "Europe/Berlin",
			reminderLeadDays: [30, 7],
			retentionMonths: 24,
		}),
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Enroll Dana Driver" }),
	);
	await waitFor(() =>
		expect(
			screen.getByText("Not yet checked — no driving authorization"),
		).toBeTruthy(),
	);
	expect(api.enroll).toHaveBeenCalledWith({ employeeId: "e1311" });
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
				employees: [],
				participants: [],
			}}
		/>,
	);
	expect(
		screen.getByLabelText("Routine check interval (months)"),
	).toHaveProperty("readOnly", true);
	expect(
		screen.getByRole("button", { name: "Preview interval impact" }),
	).toBeTruthy();
	expect(
		screen.queryByRole("button", { name: "Apply interval change" }),
	).toBeNull();
});
