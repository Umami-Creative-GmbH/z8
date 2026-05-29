/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkPolicyPresetWithSource } from "@/app/[locale]/(app)/settings/work-policies/actions";
import {
	createWorkPolicyFromPreset,
	createWorkPolicyPreset,
} from "@/app/[locale]/(app)/settings/work-policies/actions";
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
	createWorkPolicyPreset: vi.fn(),
	updateWorkPolicyPreset: vi.fn(),
	copySystemWorkPolicyPreset: vi.fn(),
	createWorkPolicyFromPreset: vi.fn(),
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
	name: "System Preset",
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
