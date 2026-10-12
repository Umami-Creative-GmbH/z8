/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TolgeeProvider } from "@tolgee/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeriodSubmissionSettings } from "@/lib/time-tracking/period-submissions/settings-policy";
import { createTestTolgee } from "@/test/render-with-translations";

const mocks = vi.hoisted(() => ({
	save: vi.fn(),
	refresh: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({
	toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/app/[locale]/(app)/settings/organizations/period-submission-actions", () => ({
	updatePeriodSubmissionSettings: mocks.save,
}));

import { OrganizationPeriodSubmissionsCard } from "./organization-period-submissions-card";

const OFF: PeriodSubmissionSettings = {
	cadence: { kind: "off" },
	inEffect: { kind: "off" },
	upcoming: null,
	secondReminderDelayDays: 3,
	revision: 0,
};

function show(
	settings: PeriodSubmissionSettings = OFF,
	role: "owner" | "admin" | "member" = "admin",
) {
	return render(
		<TolgeeProvider tolgee={createTestTolgee("en", {})}>
			<OrganizationPeriodSubmissionsCard
				organizationId="org-1"
				settings={settings}
				currentMemberRole={role}
			/>
		</TolgeeProvider>,
	);
}

describe("OrganizationPeriodSubmissionsCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.save.mockImplementation(async (input) => ({
			success: true,
			data: { ...OFF, cadence: input.cadence, revision: 1 },
		}));
	});
	afterEach(cleanup);

	it("shows period submissions off with the default reminder delay", () => {
		show();
		expect(screen.getByRole("radio", { name: "Off" }).getAttribute("aria-checked")).toBe("true");
		expect(screen.queryByRole("combobox", { name: "Weeks start on" })).toBeNull();
		expect(screen.getByLabelText("Days until the second reminder")).toHaveProperty("value", "3");
	});

	it("saves a weekly cadence with Monday as the default week start", async () => {
		show();
		fireEvent.click(screen.getByRole("radio", { name: "Weekly" }));
		expect(screen.getByRole("combobox", { name: "Weeks start on" }).textContent).toContain(
			"Monday",
		);
		fireEvent.change(screen.getByLabelText("Days until the second reminder"), {
			target: { value: "5" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(mocks.save).toHaveBeenCalledWith({
				organizationId: "org-1",
				cadence: { kind: "weekly", weekStartDay: "monday" },
				secondReminderDelayDays: 5,
			}),
		);
		await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
		expect((await screen.findByRole("status")).textContent).toBe(
			"Period submission settings saved",
		);
	});

	it("saves another week start day", async () => {
		const user = userEvent.setup();
		show();
		await user.click(screen.getByRole("radio", { name: "Weekly" }));
		await user.click(screen.getByRole("combobox", { name: "Weeks start on" }));
		await user.click(await screen.findByRole("option", { name: "Sunday" }));
		await user.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(mocks.save).toHaveBeenCalledWith(
				expect.objectContaining({ cadence: { kind: "weekly", weekStartDay: "sunday" } }),
			),
		);
	});

	it("saves a monthly cadence without a week start", async () => {
		show();
		fireEvent.click(screen.getByRole("radio", { name: "Monthly" }));
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(mocks.save).toHaveBeenCalledWith(
				expect.objectContaining({ cadence: { kind: "monthly" } }),
			),
		);
	});

	it.each(["0", "31", "1.5", ""])("rejects %j days without saving", async (value) => {
		show();
		fireEvent.change(screen.getByLabelText("Days until the second reminder"), {
			target: { value },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		expect(await screen.findByText("Enter whole days from 1 to 30.")).toBeTruthy();
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it("shows when a saved change takes effect", () => {
		show({
			cadence: { kind: "monthly" },
			inEffect: { kind: "weekly", weekStartDay: "monday" },
			upcoming: { cadence: { kind: "monthly" }, fromDate: "2026-06-01" },
			secondReminderDelayDays: 3,
			revision: 2,
		});
		expect(screen.getByText(/Monthly periods start on Jun 1, 2026\./)).toBeTruthy();
		expect(screen.getByText(/Until then, weekly periods continue\./)).toBeTruthy();
	});

	it("shows when switching off takes effect", () => {
		show({
			cadence: { kind: "off" },
			inEffect: { kind: "monthly" },
			upcoming: { cadence: { kind: "off" }, fromDate: "2026-03-01" },
			secondReminderDelayDays: 3,
			revision: 2,
		});
		expect(
			screen.getByText(
				"No periods are expected from Mar 1, 2026. The current period is still expected.",
			),
		).toBeTruthy();
	});

	it("shows the error of a refused save", async () => {
		mocks.save.mockResolvedValue({ success: false, error: "Only admins" });
		show();
		fireEvent.click(screen.getByRole("radio", { name: "Monthly" }));
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		expect((await screen.findByRole("alert")).textContent).toBe("Only admins");
		expect(mocks.refresh).not.toHaveBeenCalled();
	});

	it("lets only owners and admins change the settings", () => {
		show(OFF, "member");
		expect(screen.getByRole("radio", { name: "Weekly" }).hasAttribute("disabled")).toBe(true);
		expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(
			true,
		);
		expect(
			screen.getByText("Only organization admins and owners can change these settings."),
		).toBeTruthy();
	});
});
