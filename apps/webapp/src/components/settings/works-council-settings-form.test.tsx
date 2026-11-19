/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_WORKS_COUNCIL_SETTINGS,
	type WorksCouncilSettingsFormValues,
} from "@/lib/works-council/settings";
import { WorksCouncilSettingsForm } from "./works-council-settings-form";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, string>) =>
			(fallback ?? _key).replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match),
	}),
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
	HTMLElement.prototype.scrollIntoView = vi.fn();
});

const scopeOptions = {
	teams: [
		{ id: "team_1", name: "Assembly" },
		{ id: "team_2", name: "Logistics" },
	],
	locations: [{ id: "location_1", name: "Berlin plant" }],
};

describe("WorksCouncilSettingsForm", () => {
	beforeEach(() => vi.clearAllMocks());

	it("shows conservative default controls", () => {
		render(
			<WorksCouncilSettingsForm
				initialSettings={{
					organizationId: "org_1",
					...DEFAULT_WORKS_COUNCIL_SETTINGS,
				}}
				scopeOptions={scopeOptions}
			/>,
		);

		expect(
			screen.queryByRole("switch", { name: "Enable Works Council Mode" }),
		).toBeNull();
		expect(
			screen
				.getByRole("switch", { name: "Enable review exports" })
				.getAttribute("aria-checked"),
		).toBe("false");
		expect(
			(screen.getByLabelText("Identity visibility") as HTMLSelectElement).value,
		).toBe("aggregated");
		expect(
			(screen.getByLabelText("Absence visibility") as HTMLSelectElement).value,
		).toBe("hidden");
		expect(
			(
				screen.getByLabelText(
					"Minimum aggregation threshold",
				) as HTMLInputElement
			).value,
		).toBe("5");
		expect(screen.getByRole("combobox", { name: "Visible teams" }).textContent).toContain(
			"Add a team",
		);
		expect(
			screen.getByRole("combobox", { name: "Visible locations" }).textContent,
		).toContain("Add a location");
		// No raw id inputs remain.
		expect(screen.queryByLabelText("Visible team IDs")).toBeNull();
		expect(screen.queryByRole("list", { name: "Selected teams" })).toBeNull();
	});

	it("picks teams and locations by name and saves their ids", async () => {
		const user = userEvent.setup();
		const onSave =
			vi.fn<
				(_values: WorksCouncilSettingsFormValues) => Promise<{ success: true }>
			>();
		onSave.mockResolvedValue({ success: true });

		render(
			<WorksCouncilSettingsForm
				initialSettings={{
					organizationId: "org_1",
					...DEFAULT_WORKS_COUNCIL_SETTINGS,
				}}
				scopeOptions={scopeOptions}
				onSave={onSave}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Identity visibility"), {
			target: { value: "pseudonymized" },
		});
		fireEvent.change(screen.getByLabelText("Absence visibility"), {
			target: { value: "grouped" },
		});
		fireEvent.click(
			screen.getByRole("switch", { name: "Enable review exports" }),
		);
		fireEvent.change(screen.getByLabelText("Minimum aggregation threshold"), {
			target: { value: "8" },
		});

		await user.click(screen.getByRole("combobox", { name: "Visible teams" }));
		await user.click(await screen.findByRole("option", { name: "Logistics" }));
		await user.click(screen.getByRole("combobox", { name: "Visible teams" }));
		await user.click(await screen.findByRole("option", { name: "Assembly" }));
		await user.click(screen.getByRole("combobox", { name: "Visible locations" }));
		await user.click(await screen.findByRole("option", { name: "Berlin plant" }));

		const teams = screen.getByRole("list", { name: "Selected teams" });
		expect(within(teams).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
			"Logistics",
			"Assembly",
		]);
		// Every team is selected, so the picker has nothing left to add.
		expect(screen.getByRole("combobox", { name: "Visible teams" })).toHaveProperty(
			"disabled",
			true,
		);

		await user.click(screen.getByRole("button", { name: "Save settings" }));

		await waitFor(() => {
			expect(onSave).toHaveBeenCalledWith({
				enabled: false,
				identityVisibility: "pseudonymized",
				absenceVisibility: "grouped",
				exportEnabled: true,
				minimumAggregationThreshold: 8,
				visibleTeamIds: ["team_2", "team_1"],
				visibleLocationIds: ["location_1"],
			});
		});
	});

	it("keeps saved ids that no longer exist visible as unknown until removed", async () => {
		const user = userEvent.setup();
		const onSave = vi.fn().mockResolvedValue({ success: true });

		render(
			<WorksCouncilSettingsForm
				initialSettings={{
					organizationId: "org_1",
					...DEFAULT_WORKS_COUNCIL_SETTINGS,
					visibleTeamIds: ["team_1", "0f3a9c21-deleted-team"],
					visibleLocationIds: ["gone-location-1234"],
				}}
				scopeOptions={scopeOptions}
				onSave={onSave}
			/>,
		);

		expect(screen.getByText("Assembly")).toBeTruthy();
		expect(screen.getByText("Unknown team (0f3a9c21)")).toBeTruthy();
		expect(screen.getByText("Unknown location (gone-loc)")).toBeTruthy();

		// Saving without touching the pickers keeps every stored id.
		await user.click(screen.getByRole("button", { name: "Save settings" }));
		await waitFor(() =>
			expect(onSave).toHaveBeenLastCalledWith(
				expect.objectContaining({
					visibleTeamIds: ["team_1", "0f3a9c21-deleted-team"],
					visibleLocationIds: ["gone-location-1234"],
				}),
			),
		);

		await user.click(
			screen.getByRole("button", { name: "Remove Unknown team (0f3a9c21)" }),
		);
		expect(screen.queryByText("Unknown team (0f3a9c21)")).toBeNull();

		await user.click(screen.getByRole("button", { name: "Save settings" }));
		await waitFor(() =>
			expect(onSave).toHaveBeenLastCalledWith(
				expect.objectContaining({ visibleTeamIds: ["team_1"] }),
			),
		);
	});

	it("tells teams with the same name apart by their short id", async () => {
		const user = userEvent.setup();

		render(
			<WorksCouncilSettingsForm
				initialSettings={{
					organizationId: "org_1",
					...DEFAULT_WORKS_COUNCIL_SETTINGS,
					visibleTeamIds: ["aaaaaaaa-first"],
				}}
				scopeOptions={{
					teams: [
						{ id: "aaaaaaaa-first", name: "Night shift" },
						{ id: "bbbbbbbb-second", name: "Night shift" },
					],
					locations: [],
				}}
			/>,
		);

		const teams = screen.getByRole("list", { name: "Selected teams" });
		expect(within(teams).getByText("Night shift (aaaaaaaa)")).toBeTruthy();
		await user.click(screen.getByRole("combobox", { name: "Visible teams" }));
		expect(await screen.findByRole("option", { name: "Night shift (bbbbbbbb)" })).toBeTruthy();
	});

	it("re-enables save and reports the existing error when saving rejects", async () => {
		const onSave = vi.fn().mockRejectedValue(new Error("Network failed"));

		render(
			<WorksCouncilSettingsForm
				initialSettings={{
					organizationId: "org_1",
					...DEFAULT_WORKS_COUNCIL_SETTINGS,
				}}
				scopeOptions={scopeOptions}
				onSave={onSave}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Save settings" }),
			).toHaveProperty("disabled", false),
		);
		expect(toast.error).toHaveBeenCalledWith(
			"Failed to save Works Council settings",
		);
		expect(toast.success).not.toHaveBeenCalled();
	});
});
