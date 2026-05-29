/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkPolicyPresetWithSource } from "@/app/[locale]/(app)/settings/work-policies/actions";
import {
	archiveWorkPolicyPreset,
	createWorkPolicyFromPreset,
	createWorkPolicyPreset,
	getWorkPolicyPresets,
} from "@/app/[locale]/(app)/settings/work-policies/actions";
import { WorkPolicyPresetImport } from "./work-policy-preset-import";
import { WorkPolicyPresetReviewDialog } from "./work-policy-preset-review-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("@/app/[locale]/(app)/settings/work-policies/actions", () => ({
	archiveWorkPolicyPreset: vi.fn(),
	createWorkPolicyPreset: vi.fn(),
	updateWorkPolicyPreset: vi.fn(),
	copySystemWorkPolicyPreset: vi.fn(),
	createWorkPolicyFromPreset: vi.fn(),
	getWorkPolicyPresets: vi.fn(),
}));

beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

function renderWithQueryClient(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});

	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

const systemPreset = {
	id: "system-1",
	name: "German Labor Law",
	description: "Default labor law template",
	countryCode: "DE",
	organizationId: null,
	scheduleCycle: "weekly",
	workingDaysPreset: "weekdays",
	hoursPerCycle: "40",
	maxDailyMinutes: 480,
	maxWeeklyMinutes: 2400,
	maxUninterruptedMinutes: 360,
	breakRulesJson: {
		rules: [
			{
				workingMinutesThreshold: 360,
				requiredBreakMinutes: 30,
				options: [
					{
						splitCount: 1,
						minimumSplitMinutes: null,
						minimumLongestSplitMinutes: null,
					},
				],
			},
		],
	},
	source: "system",
	sourceLabel: "System",
} as unknown as WorkPolicyPresetWithSource;

const customPreset = {
	...systemPreset,
	id: "custom-1",
	name: "Retail 38h",
	description: "Retail operations preset",
	organizationId: "org-1",
	hoursPerCycle: "38",
	maxWeeklyMinutes: 2280,
	source: "custom",
	sourceLabel: "Custom",
} as unknown as WorkPolicyPresetWithSource;

describe("WorkPolicyPresetImport", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getWorkPolicyPresets).mockResolvedValue({
			success: true,
			data: [systemPreset, customPreset],
		} as Awaited<ReturnType<typeof getWorkPolicyPresets>>);
		vi.mocked(archiveWorkPolicyPreset).mockResolvedValue({
			success: true,
			data: {},
		} as Awaited<ReturnType<typeof archiveWorkPolicyPreset>>);
	});

	it("shows system and custom presets with source-specific actions", async () => {
		renderWithQueryClient(
			<WorkPolicyPresetImport organizationId="org-1" onImportSuccess={vi.fn()} />,
		);

		expect(await screen.findByText("German Labor Law")).toBeTruthy();
		expect(screen.getByText("Retail 38h")).toBeTruthy();
		expect(screen.getAllByRole("button", { name: "Use as policy" })).toHaveLength(2);
		expect(screen.getByRole("button", { name: "Copy to custom preset" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Edit preset" })).toBeTruthy();
	});

	it("filters presets by search text", async () => {
		const user = userEvent.setup();

		renderWithQueryClient(
			<WorkPolicyPresetImport organizationId="org-1" onImportSuccess={vi.fn()} />,
		);

		expect(await screen.findByText("German Labor Law")).toBeTruthy();

		await user.type(screen.getByPlaceholderText("Search presets..."), "retail");

		expect(screen.queryByText("German Labor Law")).toBeNull();
		expect(screen.getByText("Retail 38h")).toBeTruthy();
	});
});

describe("WorkPolicyPresetReviewDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(createWorkPolicyPreset).mockResolvedValue({
			success: true,
			data: {},
		} as Awaited<ReturnType<typeof createWorkPolicyPreset>>);
		vi.mocked(createWorkPolicyFromPreset).mockResolvedValue({
			success: true,
			data: {},
		} as Awaited<ReturnType<typeof createWorkPolicyFromPreset>>);
	});

	it("creates a custom preset with reviewed values", async () => {
		const user = userEvent.setup();
		const onSuccess = vi.fn();

		renderWithQueryClient(
			<WorkPolicyPresetReviewDialog
				open
				onOpenChange={vi.fn()}
				organizationId="org-1"
				mode="createCustom"
				onSuccess={onSuccess}
			/>,
		);

		await user.type(screen.getByLabelText("Name"), "Reviewed Custom Preset");
		await user.click(screen.getByRole("button", { name: "Save custom preset" }));

		expect(createWorkPolicyPreset).toHaveBeenCalledWith(
			"org-1",
			expect.objectContaining({ name: "Reviewed Custom Preset" }),
		);
		expect(onSuccess).toHaveBeenCalled();
	});

	it("creates a policy from a reviewed preset without making it default", async () => {
		const user = userEvent.setup();

		renderWithQueryClient(
			<WorkPolicyPresetReviewDialog
				open
				onOpenChange={vi.fn()}
				organizationId="org-1"
				mode="useAsPolicy"
				preset={systemPreset}
				onSuccess={vi.fn()}
			/>,
		);

		await user.clear(screen.getByLabelText("Name"));
		await user.type(screen.getByLabelText("Name"), "Reviewed Policy");
		await user.click(screen.getByRole("button", { name: "Create policy" }));

		expect(createWorkPolicyFromPreset).toHaveBeenCalledWith(
			"org-1",
			"system-1",
			expect.objectContaining({ name: "Reviewed Policy" }),
			false,
		);
	});

	it("shows duplicate-name server errors inline", async () => {
		const user = userEvent.setup();
		vi.mocked(createWorkPolicyPreset).mockResolvedValue({
			success: false,
			error: "A preset with this name already exists",
			code: "CONFLICT_ERROR",
		} as Awaited<ReturnType<typeof createWorkPolicyPreset>>);

		renderWithQueryClient(
			<WorkPolicyPresetReviewDialog
				open
				onOpenChange={vi.fn()}
				organizationId="org-1"
				mode="createCustom"
				onSuccess={vi.fn()}
			/>,
		);

		await user.type(screen.getByLabelText("Name"), "Duplicate Preset");
		await user.click(screen.getByRole("button", { name: "Save custom preset" }));

		expect(screen.getByText("A preset with this name already exists")).toBeTruthy();
	});
});
