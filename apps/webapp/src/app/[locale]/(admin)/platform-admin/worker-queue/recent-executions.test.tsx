/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentExecution } from "./actions";

const { getWorkerQueueJobExecutionsMock } = vi.hoisted(() => ({
	getWorkerQueueJobExecutionsMock: vi.fn(),
}));

vi.mock("./actions", () => ({
	getWorkerQueueJobExecutions: getWorkerQueueJobExecutionsMock,
}));

import { RecentExecutions } from "./recent-executions";

const labels = {
	description: "Last 50 job executions tracked in the database.",
	filterLabel: "Filter by job",
	allJobs: "All jobs",
	loading: "Loading executions…",
	error: "Failed to load executions",
	noExecutions: "No recent executions found",
	unknown: "Unknown",
	status: {
		completed: "Completed",
		failed: "Failed",
		running: "Running",
		pending: "Pending",
	},
	table: {
		jobName: "Job Name",
		status: "Status",
		startedAt: "Started At",
		duration: "Duration",
		error: "Error",
	},
};

const execution = (overrides: Partial<RecentExecution>): RecentExecution => ({
	id: "exec-1",
	jobName: "sync-users",
	status: "completed",
	startedAt: "2026-05-23T10:00:00.000Z",
	completedAt: "2026-05-23T10:00:01.000Z",
	durationMs: 1000,
	error: null,
	...overrides,
});

describe("RecentExecutions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("loads a selected job and restores the initial global executions without refetching all jobs", async () => {
		getWorkerQueueJobExecutionsMock.mockResolvedValue({
			success: true,
			data: [execution({ id: "exec-2", jobName: "send-digest" })],
		});

		render(
			<RecentExecutions
				availableJobNames={["send-digest"]}
				initialExecutions={[execution({ id: "exec-1", jobName: "sync-users" })]}
				labels={labels}
				locale="en"
			/>,
		);

		expect(screen.getByText("sync-users")).toBeTruthy();

		fireEvent.change(screen.getByRole("combobox", { name: "Filter by job" }), {
			target: { value: "send-digest" },
		});

		await waitFor(() => expect(screen.getByText("send-digest")).toBeTruthy());
		expect(getWorkerQueueJobExecutionsMock).toHaveBeenCalledWith("send-digest");

		fireEvent.change(screen.getByRole("combobox", { name: "Filter by job" }), {
			target: { value: "__all__" },
		});

		expect(screen.getByText("sync-users")).toBeTruthy();
		expect(getWorkerQueueJobExecutionsMock).toHaveBeenCalledTimes(1);
	});

	it("shows a concise error and keeps the previous executions when a job fetch fails", async () => {
		getWorkerQueueJobExecutionsMock.mockResolvedValue({
			success: false,
			error: "Queue unavailable",
		});

		render(
			<RecentExecutions
				availableJobNames={["send-digest"]}
				initialExecutions={[execution({ id: "exec-1", jobName: "sync-users" })]}
				labels={labels}
				locale="en"
			/>,
		);

		fireEvent.change(screen.getByRole("combobox", { name: "Filter by job" }), {
			target: { value: "send-digest" },
		});

		await waitFor(() =>
			expect(screen.getByText("Failed to load executions: Queue unavailable")).toBeTruthy(),
		);
		expect(screen.getByText("sync-users")).toBeTruthy();
	});
});
