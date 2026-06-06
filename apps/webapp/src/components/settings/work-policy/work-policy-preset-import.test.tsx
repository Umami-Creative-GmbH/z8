/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
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
	Element.prototype.hasPointerCapture = vi.fn(() => false);
	Element.prototype.setPointerCapture = vi.fn();
	Element.prototype.releasePointerCapture = vi.fn();
	Element.prototype.scrollIntoView = vi.fn();
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

	it("exposes an accessible search input", async () => {
		renderWithQueryClient(
			<WorkPolicyPresetImport organizationId="org-1" onImportSuccess={vi.fn()} />,
		);

		const searchInput = await screen.findByRole("textbox", { name: "Search presets" });

		expect(searchInput.getAttribute("name")).toBe("preset-search");
		expect(searchInput.getAttribute("autocomplete")).toBe("off");
	});

	it("confirms archive before archiving a custom preset", async () => {
		const user = userEvent.setup();

		renderWithQueryClient(
			<WorkPolicyPresetImport organizationId="org-1" onImportSuccess={vi.fn()} />,
		);

		await screen.findByText("Retail 38h");
		await user.click(screen.getByRole("button", { name: "Archive" }));

		expect(archiveWorkPolicyPreset).not.toHaveBeenCalled();
		expect(screen.getByRole("alertdialog", { name: "Archive custom preset?" })).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Archive preset" }));

		expect(archiveWorkPolicyPreset).toHaveBeenCalledWith("org-1", "custom-1");
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

	it("submits edited regulation limits from the review dialog", async () => {
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

		await user.clear(screen.getByLabelText("Max daily hours"));
		await user.type(screen.getByLabelText("Max daily hours"), "9");
		await user.clear(screen.getByLabelText("Max weekly hours"));
		await user.type(screen.getByLabelText("Max weekly hours"), "44");
		await user.clear(screen.getByLabelText("Max uninterrupted hours"));
		await user.type(screen.getByLabelText("Max uninterrupted hours"), "5.5");
		await user.click(screen.getByRole("button", { name: "Create policy" }));

		expect(createWorkPolicyFromPreset).toHaveBeenCalledWith(
			"org-1",
			"system-1",
			expect.objectContaining({
				regulation: expect.objectContaining({
					maxDailyMinutes: 540,
					maxWeeklyMinutes: 2640,
					maxUninterruptedMinutes: 330,
				}),
			}),
			false,
		);
	});

	it("submits edited break rule values from the review dialog", async () => {
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

		await user.clear(screen.getByLabelText("After working hours"));
		await user.type(screen.getByLabelText("After working hours"), "7");
		await user.clear(screen.getByLabelText("Break required minutes"));
		await user.type(screen.getByLabelText("Break required minutes"), "45");
		await user.click(screen.getByRole("button", { name: "Create policy" }));

		expect(createWorkPolicyFromPreset).toHaveBeenCalledWith(
			"org-1",
			"system-1",
			expect.objectContaining({
				regulation: expect.objectContaining({
					breakRules: [
						expect.objectContaining({
							workingMinutesThreshold: 420,
							requiredBreakMinutes: 45,
						}),
					],
				}),
			}),
			false,
		);
	});

	it("submits edited schedule defaults from the review dialog", async () => {
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

		await user.click(screen.getByRole("combobox", { name: "Schedule cycle" }));
		await user.click(screen.getByRole("option", { name: "Monthly" }));
		await user.click(screen.getByRole("combobox", { name: "Working days" }));
		await user.click(screen.getByRole("option", { name: "All days" }));
		await user.click(screen.getByRole("button", { name: "Create policy" }));

		expect(createWorkPolicyFromPreset).toHaveBeenCalledWith(
			"org-1",
			"system-1",
			expect.objectContaining({
				schedule: expect.objectContaining({
					scheduleCycle: "monthly",
					workingDaysPreset: "all_days",
				}),
			}),
			false,
		);
	});

	it("submits edited break option values from the review dialog", async () => {
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

		await user.clear(screen.getByLabelText("Split count"));
		await user.type(screen.getByLabelText("Split count"), "2");
		await user.clear(screen.getByLabelText("Min split minutes"));
		await user.type(screen.getByLabelText("Min split minutes"), "15");
		await user.clear(screen.getByLabelText("Longest split minutes"));
		await user.type(screen.getByLabelText("Longest split minutes"), "20");
		await user.click(screen.getByRole("button", { name: "Create policy" }));

		expect(createWorkPolicyFromPreset).toHaveBeenCalledWith(
			"org-1",
			"system-1",
			expect.objectContaining({
				regulation: expect.objectContaining({
					breakRules: [
						expect.objectContaining({
							options: [
								expect.objectContaining({
									splitCount: 2,
									minimumSplitMinutes: 15,
									minimumLongestSplitMinutes: 20,
								}),
							],
						}),
					],
				}),
			}),
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

	it("resets reviewed values when reopened for a different preset", async () => {
		const user = userEvent.setup();

		function ReviewHarness() {
			const [open, setOpen] = useState(false);
			const [preset, setPreset] = useState<WorkPolicyPresetWithSource | null>(systemPreset);

			return (
				<>
					<button
						type="button"
						onClick={() => {
							setPreset(systemPreset);
							setOpen(true);
						}}
					>
						Open System
					</button>
					<button
						type="button"
						onClick={() => {
							setPreset(customPreset);
							setOpen(true);
						}}
					>
						Open Custom
					</button>
					<button type="button" onClick={() => setOpen(false)}>
						Close
					</button>
					<WorkPolicyPresetReviewDialog
						open={open}
						onOpenChange={setOpen}
						organizationId="org-1"
						mode="useAsPolicy"
						preset={preset}
						onSuccess={vi.fn()}
					/>
				</>
			);
		}

		renderWithQueryClient(<ReviewHarness />);

		await user.click(screen.getByRole("button", { name: "Open System" }));
		const nameInput = screen.getByLabelText("Name");
		await user.clear(nameInput);
		await user.type(nameInput, "Edited stale value");
		await user.click(screen.getByRole("button", { name: "Close" }));

		await user.click(screen.getByRole("button", { name: "Open Custom" }));

		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Retail 38h");
	});
});
