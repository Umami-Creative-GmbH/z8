/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CronSchedulePreset, ScheduledCronJobRow } from "@/lib/cron/schedules";
import { resetCronSchedule, updateCronSchedule } from "./actions";
import { ScheduleControls } from "./schedule-controls";

const mocks = vi.hoisted(() => ({
	refresh: vi.fn(),
	toastSuccess: vi.fn(),
	toastWarning: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("sonner", () => ({
	toast: {
		success: mocks.toastSuccess,
		warning: mocks.toastWarning,
		error: mocks.toastError,
	},
}));

vi.mock("./actions", () => ({
	updateCronSchedule: vi.fn(),
	resetCronSchedule: vi.fn(),
}));

const labels = {
	edit: "Edit",
	reset: "Reset",
	save: "Save schedule",
	cancel: "Cancel",
	presetLabel: "Schedule preset",
	highRiskTitle: "High-risk schedule",
	highRiskDescription: "Changing this job can affect operations.",
	confirmationLabel: "Type confirmation",
	confirmationText: "I understand the operational impact",
	saved: "Schedule saved",
	resetSaved: "Schedule reset",
	warningPrefix: "Saved with warning",
	failed: "Schedule change failed",
	mismatch: "BullMQ differs from saved schedule",
	readOnly: "No matching preset for this schedule",
};

const presets: CronSchedulePreset[] = [
	{ id: "every-5-minutes", pattern: "*/5 * * * *", label: "Every 5 minutes" },
	{ id: "hourly", pattern: "0 * * * *", label: "Hourly" },
	{ id: "daily-midnight", pattern: "0 0 * * *", label: "Daily at midnight" },
];

function buildJob(overrides: Partial<ScheduledCronJobRow> = {}): ScheduledCronJobRow {
	return {
		jobName: "cron:export",
		name: "cron:export",
		defaultPattern: "*/5 * * * *",
		effectivePattern: "*/5 * * * *",
		presetId: "every-5-minutes",
		isOverridden: false,
		canEdit: true,
		next: null,
		currentBullMqPattern: "*/5 * * * *",
		hasScheduleMismatch: false,
		...overrides,
	};
}

function renderControls(job: ScheduledCronJobRow = buildJob()) {
	return render(<ScheduleControls job={job} labels={labels} presets={presets} />);
}

describe("ScheduleControls", () => {
	beforeEach(() => {
		vi.mocked(updateCronSchedule).mockClear();
		vi.mocked(resetCronSchedule).mockClear();
		vi.mocked(updateCronSchedule).mockResolvedValue({
			success: true,
			data: { immediateReconciled: true, warning: null },
		});
		vi.mocked(resetCronSchedule).mockResolvedValue({
			success: true,
			data: { immediateReconciled: true, warning: null },
		});
		mocks.refresh.mockClear();
		mocks.toastSuccess.mockClear();
		mocks.toastWarning.mockClear();
		mocks.toastError.mockClear();
	});

	it("submits a selected preset for low-risk jobs without confirmation", async () => {
		renderControls();

		fireEvent.click(screen.getByRole("button", { name: labels.edit }));
		fireEvent.change(screen.getByLabelText(labels.presetLabel), { target: { value: "hourly" } });
		fireEvent.click(screen.getByRole("button", { name: labels.save }));

		await waitFor(() => {
			expect(updateCronSchedule).toHaveBeenCalledWith({
				jobName: "cron:export",
				presetId: "hourly",
				confirmation: undefined,
			});
		});
		expect(mocks.refresh).toHaveBeenCalledTimes(1);
		expect(mocks.toastSuccess).toHaveBeenCalledWith(labels.saved);
	});

	it("shows high-risk copy and submits the exact confirmation", async () => {
		renderControls(
			buildJob({
				jobName: "cron:billing-seat-reconciliation",
				name: "cron:billing-seat-reconciliation",
				presetId: "daily-midnight",
				effectivePattern: "0 0 * * *",
			}),
		);

		fireEvent.click(screen.getByRole("button", { name: labels.edit }));

		expect(screen.getByText(labels.highRiskTitle)).toBeTruthy();
		expect(screen.getByText(labels.highRiskDescription)).toBeTruthy();

		fireEvent.change(screen.getByLabelText(labels.presetLabel), { target: { value: "hourly" } });
		fireEvent.change(screen.getByLabelText(labels.confirmationLabel), {
			target: { value: labels.confirmationText },
		});
		fireEvent.click(screen.getByRole("button", { name: labels.save }));

		await waitFor(() => {
			expect(updateCronSchedule).toHaveBeenCalledWith({
				jobName: "cron:billing-seat-reconciliation",
				presetId: "hourly",
				confirmation: labels.confirmationText,
			});
		});
	});

	it("does not submit a high-risk edit without the exact confirmation", () => {
		renderControls(
			buildJob({
				jobName: "cron:billing-seat-reconciliation",
				name: "cron:billing-seat-reconciliation",
				presetId: "daily-midnight",
				effectivePattern: "0 0 * * *",
			}),
		);

		fireEvent.click(screen.getByRole("button", { name: labels.edit }));
		fireEvent.change(screen.getByLabelText(labels.presetLabel), { target: { value: "hourly" } });

		const saveButton = screen.getByRole<HTMLButtonElement>("button", { name: labels.save });
		expect(saveButton.disabled).toBe(true);

		fireEvent.click(saveButton);

		expect(updateCronSchedule).not.toHaveBeenCalled();
	});

	it("resets edited preset state when canceling and reopening", () => {
		renderControls();

		fireEvent.click(screen.getByRole("button", { name: labels.edit }));
		fireEvent.change(screen.getByLabelText(labels.presetLabel), { target: { value: "hourly" } });
		fireEvent.click(screen.getByRole("button", { name: labels.cancel }));
		fireEvent.click(screen.getByRole("button", { name: labels.edit }));

		expect(screen.getByLabelText<HTMLSelectElement>(labels.presetLabel).value).toBe(
			"every-5-minutes",
		);
	});

	it("syncs open edit form values when job props change before submit", async () => {
		const { rerender } = renderControls(
			buildJob({
				jobName: "cron:billing-seat-reconciliation",
				name: "cron:billing-seat-reconciliation",
				presetId: "daily-midnight",
				effectivePattern: "0 0 * * *",
			}),
		);

		fireEvent.click(screen.getByRole("button", { name: labels.edit }));
		fireEvent.change(screen.getByLabelText(labels.presetLabel), { target: { value: "hourly" } });
		fireEvent.change(screen.getByLabelText(labels.confirmationLabel), {
			target: { value: labels.confirmationText },
		});

		rerender(
			<ScheduleControls
				job={buildJob({ presetId: "every-5-minutes", effectivePattern: "*/5 * * * *" })}
				labels={labels}
				presets={presets}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: labels.save }));

		await waitFor(() => {
			expect(updateCronSchedule).toHaveBeenCalledWith({
				jobName: "cron:export",
				presetId: "every-5-minutes",
				confirmation: undefined,
			});
		});
	});

	it("disables editing and shows read-only text when the schedule cannot be edited", () => {
		renderControls(buildJob({ canEdit: false }));

		expect(screen.getByRole<HTMLButtonElement>("button", { name: labels.edit }).disabled).toBe(
			true,
		);
		expect(screen.getByText(labels.readOnly)).toBeTruthy();
	});

	it("resets an overridden low-risk job", async () => {
		renderControls(
			buildJob({ isOverridden: true, presetId: "hourly", effectivePattern: "0 * * * *" }),
		);

		fireEvent.click(screen.getByRole("button", { name: labels.reset }));

		await waitFor(() => {
			expect(resetCronSchedule).toHaveBeenCalledWith({
				jobName: "cron:export",
				confirmation: undefined,
			});
		});
		expect(mocks.refresh).toHaveBeenCalledTimes(1);
		expect(mocks.toastSuccess).toHaveBeenCalledWith(labels.resetSaved);
	});

	it("renders mismatch warning when BullMQ differs from the saved schedule", () => {
		renderControls(buildJob({ hasScheduleMismatch: true }));

		expect(screen.getByText(labels.mismatch)).toBeTruthy();
	});
});
