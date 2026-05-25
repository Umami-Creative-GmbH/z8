/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_WORKS_COUNCIL_SETTINGS,
	type WorksCouncilSettingsFormValues,
} from "@/lib/works-council/settings";
import { WorksCouncilSettingsForm } from "./works-council-settings-form";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

describe("WorksCouncilSettingsForm", () => {
	it("shows conservative default controls", () => {
		render(
			<WorksCouncilSettingsForm
				initialSettings={{ organizationId: "org_1", ...DEFAULT_WORKS_COUNCIL_SETTINGS }}
			/>,
		);

		expect(screen.queryByRole("switch", { name: "Enable Works Council Mode" })).toBeNull();
		expect(
			screen.getByRole("switch", { name: "Enable review exports" }).getAttribute("aria-checked"),
		).toBe("false");
		expect((screen.getByLabelText("Identity visibility") as HTMLSelectElement).value).toBe(
			"aggregated",
		);
		expect((screen.getByLabelText("Absence visibility") as HTMLSelectElement).value).toBe("hidden");
		expect((screen.getByLabelText("Minimum aggregation threshold") as HTMLInputElement).value).toBe(
			"5",
		);
		expect(screen.getByLabelText("Visible team IDs") as HTMLInputElement).toBeTruthy();
		expect(screen.getByLabelText("Visible location IDs") as HTMLInputElement).toBeTruthy();
	});

	it("saves the current settings payload", async () => {
		const onSave = vi.fn<(_values: WorksCouncilSettingsFormValues) => Promise<{ success: true }>>();
		onSave.mockResolvedValue({ success: true });

		render(
			<WorksCouncilSettingsForm
				initialSettings={{ organizationId: "org_1", ...DEFAULT_WORKS_COUNCIL_SETTINGS }}
				onSave={onSave}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Identity visibility"), {
			target: { value: "pseudonymized" },
		});
		fireEvent.change(screen.getByLabelText("Absence visibility"), {
			target: { value: "grouped" },
		});
		fireEvent.click(screen.getByRole("switch", { name: "Enable review exports" }));
		fireEvent.change(screen.getByLabelText("Minimum aggregation threshold"), {
			target: { value: "8" },
		});
		fireEvent.change(screen.getByLabelText("Visible team IDs"), {
			target: { value: "team_1, team_2" },
		});
		fireEvent.change(screen.getByLabelText("Visible location IDs"), {
			target: { value: "location_1" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

		await waitFor(() => {
			expect(onSave).toHaveBeenCalledWith({
				enabled: false,
				identityVisibility: "pseudonymized",
				absenceVisibility: "grouped",
				exportEnabled: true,
				minimumAggregationThreshold: 8,
				visibleTeamIds: ["team_1", "team_2"],
				visibleLocationIds: ["location_1"],
			});
		});
	});
});
