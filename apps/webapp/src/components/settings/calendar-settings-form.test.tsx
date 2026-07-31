/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateCalendarSettings } from "@/app/[locale]/(app)/settings/calendar/actions";
import { CalendarSettingsForm } from "./calendar-settings-form";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/calendar/actions", () => ({
	updateCalendarSettings: vi.fn(),
}));

const initialSettings = {
	googleEnabled: false,
	microsoft365Enabled: false,
	icsFeedsEnabled: true,
	teamIcsFeedsEnabled: false,
	autoSyncOnApproval: false,
	conflictDetectionRequired: false,
	eventTitleTemplate: "Out of Office",
	eventDescriptionTemplate: null,
	googleAvailable: true,
	microsoft365Available: true,
	relevantConnections: [],
};

describe("CalendarSettingsForm", () => {
	beforeEach(() => vi.clearAllMocks());

	it("re-enables save and reports the existing error when updating rejects", async () => {
		const user = userEvent.setup();
		vi.mocked(updateCalendarSettings).mockRejectedValue(
			new Error("Network failed"),
		);
		render(
			<CalendarSettingsForm initialSettings={initialSettings} canManage />,
		);

		await user.clear(screen.getByLabelText("Event Title Template"));
		await user.type(screen.getByLabelText("Event Title Template"), "Leave");
		await user.click(screen.getByRole("button", { name: "Save Changes" }));

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Save Changes" }),
			).toHaveProperty("disabled", false),
		);
		expect(toast.error).toHaveBeenCalledWith(
			"Failed to save calendar settings",
		);
		expect(toast.success).not.toHaveBeenCalled();
	});
});
