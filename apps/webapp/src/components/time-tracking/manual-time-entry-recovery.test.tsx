/* @vitest-environment jsdom */

/**
 * #310 / T45: frozen manual command recovery through the real dialog.
 *
 * The real TimeInput, DatePicker, project and category selectors, the recovery
 * hook and jsdom's session storage run together. Only the server actions,
 * translation, router and toasts are replaced. A "reload" unmounts everything
 * and mounts a fresh tree with a fresh query cache over the same tab storage.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ManualEntryTargetContext,
	ManualTimeEntryResult,
} from "@/app/[locale]/(app)/time-tracking/actions/types";
import { queryKeys } from "@/lib/query/keys";
import { MANUAL_RECOVERY_KEY_PREFIX } from "./manual-command-recovery";
import { ManualTimeEntryDialog } from "./manual-time-entry-dialog";

const actions = vi.hoisted(() => ({
	createManualTimeEntry: vi.fn(),
	lookupManualTimeEntry: vi.fn(),
	getManualEntryTargetContext: vi.fn(),
	updateTimezone: vi.fn(),
	refresh: vi.fn(),
	toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
	context: null as ManualEntryTargetContext | null,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			fallback.replace(/\{(\w+)\}/g, (_, key: string) => params?.[key] ?? `{${key}}`),
	}),
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: actions.refresh }) }));
vi.mock("@/components/providers/user-preferences-provider", () => ({
	useTimeFormat: () => "24h",
}));
vi.mock("sonner", () => ({ toast: actions.toast }));
vi.mock("@/lib/time-tracking/timezone-capture", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/time-tracking/timezone-capture")>()),
	getBrowserTimezone: () => "Europe/Berlin",
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/manual-entry-context", () => ({
	getManualEntryTargetContext: actions.getManualEntryTargetContext,
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	createManualTimeEntry: actions.createManualTimeEntry,
	lookupManualTimeEntry: actions.lookupManualTimeEntry,
}));
vi.mock("@/app/[locale]/(app)/settings/profile/actions", () => ({
	updateTimezone: actions.updateTimezone,
}));

const MANAGER = { userId: "user-manager", organizationId: "org-1" };
const WORK_PERIOD_ID = "10000000-0000-4000-8000-000000000310";

function targetContext(
	overrides: Partial<ManualEntryTargetContext> = {},
): ManualEntryTargetContext {
	return {
		targetEmployeeId: "employee-2",
		targetName: "Alex Target",
		isOwnEntry: false,
		timezone: "Europe/Berlin",
		timezoneSource: "employee",
		manualCommandVersion: 2,
		recoveryContext: MANAGER,
		projects: [
			{
				id: "project-1",
				name: "Project 1",
				color: null,
				status: "active",
				budgetHours: null,
				deadline: null,
				totalHoursBooked: 0,
			},
		],
		categories: [{ id: "category-1", name: "Category 1", factor: "1.00", color: null }],
		...overrides,
	};
}

/** One tab page: a fresh query cache per mount, the tab storage is shared. */
function mountDialog(
	context: ManualEntryTargetContext,
	props: Partial<Parameters<typeof ManualTimeEntryDialog>[0]> = {},
) {
	actions.context = context;
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const targetEmployeeId = props.targetEmployeeId ?? context.targetEmployeeId;
	queryClient.setQueryData(queryKeys.manualEntry.targetContext(targetEmployeeId), context);
	const element = (overrides: Partial<Parameters<typeof ManualTimeEntryDialog>[0]> = {}) => (
		<ManualTimeEntryDialog
			employeeId="employee-manager"
			employeeTimezone="Europe/Berlin"
			hasManager={false}
			open
			hideTrigger
			targetEmployeeId={targetEmployeeId}
			targetEmployeeName="Alex Target"
			defaultDate="2026-05-12"
			defaultClockInTime="10:15"
			defaultClockOutTime="15:45"
			{...props}
			{...overrides}
		/>
	);
	const view = render(element(), {
		wrapper: ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		),
	});
	return {
		...view,
		queryClient,
		rerenderWith: (overrides: Partial<Parameters<typeof ManualTimeEntryDialog>[0]>) =>
			view.rerender(element(overrides)),
	};
}

function recoveryKeys() {
	return Object.keys(window.sessionStorage).filter((key) =>
		key.startsWith(MANUAL_RECOVERY_KEY_PREFIX),
	);
}

function recoveryItem(summary = "2026-05-12, 10:15–15:45 (Europe/Berlin)") {
	return screen.getByRole("listitem", { name: summary });
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
	await user.type(screen.getByLabelText("Reason"), "Forgot to clock out");
	await user.click(screen.getByRole("combobox", { name: "Project" }));
	await user.click(await screen.findByRole("option", { name: /Project 1/ }));
	await user.click(screen.getByRole("combobox", { name: "Work Category" }));
	await user.click(await screen.findByRole("option", { name: /Category 1/ }));
	await user.click(screen.getByRole("button", { name: "Create Entry" }));
}

const lostResponse = () => Promise.reject(new TypeError("Failed to fetch"));
const saved = (overrides: Partial<{ requiresApproval: boolean }> = {}): ManualTimeEntryResult => ({
	success: true,
	data: {
		workPeriodId: WORK_PERIOD_ID,
		requiresApproval: false,
		disposition: "replayed",
		...overrides,
	},
});

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

beforeEach(() => {
	window.sessionStorage.clear();
	for (const mock of [
		actions.createManualTimeEntry,
		actions.lookupManualTimeEntry,
		actions.getManualEntryTargetContext,
		actions.refresh,
		actions.toast.error,
		actions.toast.info,
		actions.toast.success,
	]) {
		mock.mockReset();
	}
	actions.getManualEntryTargetContext.mockImplementation(async () =>
		actions.context ? { success: true, data: actions.context } : { success: false, error: "x" },
	);
});

afterEach(() => {
	vi.restoreAllMocks();
	window.sessionStorage.clear();
});

describe("frozen manual command recovery (#310)", () => {
	it("keeps an uncertain command through close, reopen and reload and retries exactly its bytes", async () => {
		const user = userEvent.setup();
		actions.createManualTimeEntry.mockImplementationOnce(lostResponse);
		const first = mountDialog(targetContext());

		await fillAndSubmit(user);

		await waitFor(() => expect(actions.createManualTimeEntry).toHaveBeenCalledOnce());
		const [sentCommand, sentContext] = actions.createManualTimeEntry.mock.calls[0] ?? [];
		expect(sentCommand).toEqual({
			version: 2,
			submissionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
			targetEmployeeId: "employee-2",
			date: "2026-05-12",
			clockIn: { time: "10:15", occurrence: null, displayedOffsetMinutes: 120 },
			clockOut: { time: "15:45", occurrence: null, displayedOffsetMinutes: 120 },
			zone: { basis: "target", timezone: "Europe/Berlin" },
			browserTimezone: null,
			reason: "Forgot to clock out",
			projectId: "project-1",
			workCategoryId: "category-1",
		});
		expect(sentContext).toEqual(MANAGER);
		expect(actions.toast.error).toHaveBeenCalledWith(
			expect.stringContaining("We couldn't confirm whether this entry was saved."),
		);
		expect(
			within(recoveryItem()).getByText("Not confirmed. It may already be saved."),
		).toBeTruthy();
		expect(recoveryKeys()).toHaveLength(1);

		// Closing and reopening resets the editable draft, not the frozen command.
		first.rerenderWith({ open: false });
		first.rerenderWith({ open: true });
		expect(screen.getByLabelText<HTMLTextAreaElement>("Reason").value).toBe("");
		expect(recoveryItem()).toBeTruthy();

		// Reload: a fresh tree over the same tab storage; nothing is resent on its own.
		first.unmount();
		mountDialog(targetContext());
		expect(within(recoveryItem()).getByText("Forgot to clock out")).toBeTruthy();
		expect(actions.createManualTimeEntry).toHaveBeenCalledOnce();

		actions.createManualTimeEntry.mockResolvedValueOnce(saved());
		await user.click(within(recoveryItem()).getByRole("button", { name: "Retry exactly" }));

		await waitFor(() => expect(actions.createManualTimeEntry).toHaveBeenCalledTimes(2));
		expect(actions.createManualTimeEntry.mock.calls[1]).toEqual([sentCommand, MANAGER]);
		await waitFor(() =>
			expect(actions.toast.success).toHaveBeenCalledWith("Time entry created successfully"),
		);
		expect(screen.queryByRole("region", { name: "Unconfirmed entries" })).toBeNull();
		expect(recoveryKeys()).toEqual([]);
		expect(actions.refresh).toHaveBeenCalled();
	});

	it("stores the command before the request leaves, so a reload mid-request can recover it", async () => {
		const user = userEvent.setup();
		actions.createManualTimeEntry.mockImplementationOnce(() => new Promise(() => {}));
		const first = mountDialog(targetContext());
		await fillAndSubmit(user);
		await waitFor(() => expect(actions.createManualTimeEntry).toHaveBeenCalledOnce());
		expect(recoveryKeys()).toHaveLength(1);
		// A lookup cannot overtake the request still in flight in this tab.
		expect(
			within(recoveryItem())
				.getByRole<HTMLButtonElement>("button", { name: "Check status" })
				.hasAttribute("disabled"),
		).toBe(true);

		first.unmount();
		mountDialog(targetContext());

		expect(
			within(recoveryItem()).getByText("Not confirmed. It may already be saved."),
		).toBeTruthy();
		expect(within(recoveryItem()).queryByRole("button", { name: "Dismiss" })).toBeNull();
		expect(actions.createManualTimeEntry).toHaveBeenCalledOnce();
	});

	it("keeps the unresolved command while an edited draft is submitted under a new identity", async () => {
		const user = userEvent.setup();
		actions.createManualTimeEntry.mockImplementationOnce(lostResponse);
		mountDialog(targetContext());
		await fillAndSubmit(user);
		await waitFor(() => expect(recoveryItem()).toBeTruthy());

		const clockOut = screen.getByLabelText<HTMLInputElement>("Clock Out");
		await user.clear(clockOut);
		await user.type(clockOut, "1630");
		actions.createManualTimeEntry.mockResolvedValueOnce(saved());
		await user.click(screen.getByRole("button", { name: "Create Entry" }));

		await waitFor(() => expect(actions.createManualTimeEntry).toHaveBeenCalledTimes(2));
		const [original] = actions.createManualTimeEntry.mock.calls[0] ?? [];
		const [edited] = actions.createManualTimeEntry.mock.calls[1] ?? [];
		expect(edited).toMatchObject({ clockOut: { time: "16:30" } });
		expect(edited.submissionId).not.toBe(original.submissionId);
		// The edited submission committed; the earlier uncertain one is still kept.
		expect(recoveryKeys()).toHaveLength(1);
		expect(recoveryKeys()[0]).toContain(original.submissionId);
	});

	it("never shows or resends a command to another user, organization or target", async () => {
		const user = userEvent.setup();
		actions.createManualTimeEntry.mockImplementationOnce(lostResponse);
		const first = mountDialog(targetContext());
		await fillAndSubmit(user);
		await waitFor(() => expect(recoveryItem()).toBeTruthy());
		first.unmount();

		for (const context of [
			targetContext({ recoveryContext: { ...MANAGER, userId: "user-other" } }),
			targetContext({ recoveryContext: { ...MANAGER, organizationId: "org-2" } }),
			targetContext({ targetEmployeeId: "employee-3" }),
		]) {
			const view = mountDialog(context);
			expect(screen.queryByRole("region", { name: "Unconfirmed entries" })).toBeNull();
			view.unmount();
		}
		expect(actions.createManualTimeEntry).toHaveBeenCalledOnce();
		expect(actions.lookupManualTimeEntry).not.toHaveBeenCalled();

		// Another session in this tab: the server refuses the retry before the identity.
		mountDialog(targetContext());
		actions.createManualTimeEntry.mockResolvedValueOnce({
			success: false,
			error: "You are signed in to a different account or organization.",
			code: "context_mismatch",
		});
		await user.click(within(recoveryItem()).getByRole("button", { name: "Retry exactly" }));

		await waitFor(() =>
			expect(
				within(recoveryItem()).getByText(
					/Not confirmed\. It may already be saved\. You're signed in to a different account/,
				),
			).toBeTruthy(),
		);
		expect(actions.createManualTimeEntry.mock.calls[1]?.[1]).toEqual(MANAGER);
		expect(within(recoveryItem()).queryByRole("button", { name: "Dismiss" })).toBeNull();
	});

	it("never rewrites a frozen command from changed props or settings", async () => {
		const user = userEvent.setup();
		actions.createManualTimeEntry.mockImplementationOnce(lostResponse);
		const first = mountDialog(targetContext());
		await fillAndSubmit(user);
		await waitFor(() => expect(recoveryItem()).toBeTruthy());
		const [frozen] = actions.createManualTimeEntry.mock.calls[0] ?? [];
		const stored = window.sessionStorage.getItem(recoveryKeys()[0] ?? "");
		first.unmount();

		// The target's zone and choices changed since; the draft follows, the command does not.
		const second = mountDialog(
			targetContext({ timezone: "Asia/Tokyo", projects: [], categories: [] }),
			{ employeeTimezone: "Asia/Tokyo", targetEmployeeName: "Renamed" },
		);
		second.rerenderWith({ defaultClockOutTime: "17:00" });
		expect(window.sessionStorage.getItem(recoveryKeys()[0] ?? "")).toBe(stored);

		actions.createManualTimeEntry.mockResolvedValueOnce(saved());
		await user.click(within(recoveryItem()).getByRole("button", { name: "Retry exactly" }));
		await waitFor(() => expect(actions.createManualTimeEntry).toHaveBeenCalledTimes(2));
		expect(actions.createManualTimeEntry.mock.calls[1]?.[0]).toEqual(frozen);
	});

	it("inspects without resending and keeps absence, unsupported and conflicts distinct", async () => {
		const user = userEvent.setup();
		actions.createManualTimeEntry.mockImplementationOnce(lostResponse);
		mountDialog(targetContext());
		await fillAndSubmit(user);
		await waitFor(() => expect(recoveryItem()).toBeTruthy());
		const [frozen] = actions.createManualTimeEntry.mock.calls[0] ?? [];
		const check = () =>
			user.click(within(recoveryItem()).getByRole("button", { name: "Check status" }));

		actions.lookupManualTimeEntry.mockResolvedValueOnce({ status: "unsupported" });
		await check();
		await waitFor(() =>
			expect(
				within(recoveryItem()).getByText("Its status can't be checked. It may already be saved."),
			).toBeTruthy(),
		);
		expect(actions.lookupManualTimeEntry).toHaveBeenLastCalledWith(frozen, MANAGER);
		expect(within(recoveryItem()).queryByRole("button", { name: "Edit as new entry" })).toBeNull();
		// It may already be saved, so it cannot be dismissed.
		expect(within(recoveryItem()).queryByRole("button", { name: "Dismiss" })).toBeNull();

		actions.lookupManualTimeEntry.mockResolvedValueOnce({ status: "failed", error: "x" });
		await check();
		await waitFor(() =>
			expect(actions.toast.error).toHaveBeenLastCalledWith(
				"Couldn't check this entry right now. Try again later.",
			),
		);
		expect(within(recoveryItem()).getByText(/Its status can't be checked/)).toBeTruthy();

		actions.lookupManualTimeEntry.mockResolvedValueOnce({ status: "not_committed" });
		await check();
		await waitFor(() => expect(within(recoveryItem()).getByText("No save found.")).toBeTruthy());
		expect(actions.createManualTimeEntry).toHaveBeenCalledOnce();

		// Conclusive absence: its values become the editable draft for a fresh submission.
		await user.click(within(recoveryItem()).getByRole("button", { name: "Edit as new entry" }));
		expect(screen.getByLabelText<HTMLTextAreaElement>("Reason").value).toBe("Forgot to clock out");
		expect(screen.queryByRole("region", { name: "Unconfirmed entries" })).toBeNull();
		actions.createManualTimeEntry.mockResolvedValueOnce(saved());
		await user.click(screen.getByRole("button", { name: "Create Entry" }));
		await waitFor(() => expect(actions.createManualTimeEntry).toHaveBeenCalledTimes(2));
		const [fresh] = actions.createManualTimeEntry.mock.calls[1] ?? [];
		expect(fresh).toEqual({ ...frozen, submissionId: fresh.submissionId });
		expect(fresh.submissionId).not.toBe(frozen.submissionId);
	});

	it("directs a conflict to inspection and only offers dismissal", async () => {
		const user = userEvent.setup();
		actions.createManualTimeEntry.mockImplementationOnce(lostResponse);
		mountDialog(targetContext());
		await fillAndSubmit(user);
		await waitFor(() => expect(recoveryItem()).toBeTruthy());

		actions.lookupManualTimeEntry.mockResolvedValueOnce({ status: "conflict" });
		await user.click(within(recoveryItem()).getByRole("button", { name: "Check status" }));

		await waitFor(() =>
			expect(
				within(recoveryItem()).getByText(
					"This entry conflicts with an earlier submission or changed work. Check your existing entries.",
				),
			).toBeTruthy(),
		);
		expect(within(recoveryItem()).queryByRole("button", { name: "Retry exactly" })).toBeNull();
		await user.click(within(recoveryItem()).getByRole("button", { name: "Dismiss" }));
		expect(recoveryKeys()).toEqual([]);
	});

	it("reports the original approval participation apart from the current status", async () => {
		const user = userEvent.setup();
		actions.createManualTimeEntry.mockImplementationOnce(lostResponse);
		mountDialog(targetContext());
		await fillAndSubmit(user);
		await waitFor(() => expect(recoveryItem()).toBeTruthy());

		actions.lookupManualTimeEntry.mockResolvedValueOnce({
			status: "committed",
			data: {
				workPeriodId: WORK_PERIOD_ID,
				requiresApproval: true,
				disposition: "replayed",
				currentApprovalStatus: "approved",
			},
		});
		await user.click(within(recoveryItem()).getByRole("button", { name: "Check status" }));

		await waitFor(() =>
			expect(actions.toast.success).toHaveBeenCalledWith(
				"This entry was saved and submitted for approval. Its current status: approved.",
			),
		);
		expect(recoveryKeys()).toEqual([]);
		expect(actions.createManualTimeEntry).toHaveBeenCalledOnce();
	});

	it("keeps nothing when the first attempt was answered without a commit", async () => {
		const user = userEvent.setup();
		actions.createManualTimeEntry.mockResolvedValueOnce({
			success: false,
			error: "billing_required",
			code: "subscription_required",
		});
		mountDialog(targetContext());
		await fillAndSubmit(user);
		await waitFor(() => expect(actions.createManualTimeEntry).toHaveBeenCalledOnce());
		await act(async () => {});
		expect(recoveryKeys()).toEqual([]);

		actions.createManualTimeEntry.mockResolvedValueOnce({
			success: false,
			error: "overlap",
			code: "occupancy_conflict",
			rejection: { reason: "occupancy_conflict", occupants: [] },
		});
		await user.click(screen.getByRole("button", { name: "Create Entry" }));
		await waitFor(() => expect(actions.createManualTimeEntry).toHaveBeenCalledTimes(2));
		await waitFor(() =>
			expect(actions.toast.error).toHaveBeenLastCalledWith(
				"This time overlaps recorded work. Choose a range that doesn't overlap existing entries.",
			),
		);
		expect(recoveryKeys()).toEqual([]);
		// The draft stays for correction.
		expect(screen.getByLabelText<HTMLTextAreaElement>("Reason").value).toBe("Forgot to clock out");
	});
});
