/* @vitest-environment jsdom */

import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionHistoryDialog } from "./execution-history-dialog";

const mocks = vi.hoisted(() => ({
	getExecutionHistoryAction: vi.fn(),
	translate: (_key: string, fallback: string) => fallback,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: mocks.translate }),
}));

vi.mock("@/app/[locale]/(app)/settings/scheduled-exports/actions", () => ({
	getExecutionHistoryAction: mocks.getExecutionHistoryAction,
}));

vi.mock("@/components/ui/action-panel", () => ({
	ActionPanel: ({ children, open }: { children: ReactNode; open: boolean }) =>
		open ? <div>{children}</div> : null,
	ActionPanelBody: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	ActionPanelContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	ActionPanelDescription: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	ActionPanelHeader: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	ActionPanelTitle: ({ children }: { children: ReactNode }) => (
		<h1>{children}</h1>
	),
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function historyResult(id: string) {
	return {
		success: true,
		data: [
			{
				id,
				status: "completed",
				triggeredAt: new Date("2026-07-29T10:00:00Z"),
				dateRangeStart: `${id}-start`,
				dateRangeEnd: `${id}-end`,
				recordCount: 1,
				emailsSent: 1,
				emailsFailed: 0,
				errorMessage: null,
				durationMs: 100,
				completedAt: new Date("2026-07-29T10:00:00Z"),
			},
		],
	};
}

describe("ExecutionHistoryDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("does not let stale schedule history overwrite the current schedule", async () => {
		const first = deferred<ReturnType<typeof historyResult>>();
		const second = deferred<ReturnType<typeof historyResult>>();
		mocks.getExecutionHistoryAction
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);

		const { rerender } = render(
			<ExecutionHistoryDialog
				open
				onOpenChange={vi.fn()}
				organizationId="org-old"
				scheduleId="schedule-old"
				scheduleName="Old"
			/>,
		);
		await waitFor(() =>
			expect(mocks.getExecutionHistoryAction).toHaveBeenCalledOnce(),
		);

		rerender(
			<ExecutionHistoryDialog
				open
				onOpenChange={vi.fn()}
				organizationId="org-new"
				scheduleId="schedule-new"
				scheduleName="New"
			/>,
		);
		await waitFor(() =>
			expect(mocks.getExecutionHistoryAction).toHaveBeenCalledTimes(2),
		);

		await act(async () => {
			second.resolve(historyResult("new"));
			await second.promise;
		});
		expect(await screen.findByText(/new-start/)).toBeTruthy();

		await act(async () => {
			first.resolve(historyResult("old"));
			await first.promise;
		});

		expect(screen.getByText(/new-start/)).toBeTruthy();
		expect(screen.queryByText(/old-start/)).toBeNull();
		expect(mocks.getExecutionHistoryAction).toHaveBeenNthCalledWith(
			1,
			"org-old",
			"schedule-old",
			50,
		);
		expect(mocks.getExecutionHistoryAction).toHaveBeenNthCalledWith(
			2,
			"org-new",
			"schedule-new",
			50,
		);
	});

	it("hides committed history during the render that switches schedule keys", async () => {
		const first = deferred<ReturnType<typeof historyResult>>();
		const second = deferred<ReturnType<typeof historyResult>>();
		mocks.getExecutionHistoryAction
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<ExecutionHistoryDialog
					open
					onOpenChange={vi.fn()}
					organizationId="org-a"
					scheduleId="schedule-a"
					scheduleName="A"
				/>,
			);
		});
		await act(async () => {
			first.resolve(historyResult("old"));
			await first.promise;
		});
		expect(screen.getByText(/old-start/)).toBeTruthy();

		act(() => {
			flushSync(() => {
				root.render(
					<ExecutionHistoryDialog
						open
						onOpenChange={vi.fn()}
						organizationId="org-b"
						scheduleId="schedule-b"
						scheduleName="B"
					/>,
				);
			});
			expect(screen.queryByText(/old-start/)).toBeNull();
			expect(screen.getByLabelText("Loading")).toBeTruthy();
		});
		await act(async () => root.unmount());
		container.remove();
	});
});
