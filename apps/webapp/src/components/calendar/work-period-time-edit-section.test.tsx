/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TFnType } from "@tolgee/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { WorkPeriodTimeEditAccess } from "@/lib/time-tracking/work-period-time-edit-policy";
import { WorkPeriodTimeSection } from "./work-period-time-edit-section";

const { getContext, updateTimes, toastError, toastSuccess } = vi.hoisted(
	() => ({
		getContext: vi.fn(),
		updateTimes: vi.fn(),
		toastError: vi.fn(),
		toastSuccess: vi.fn(),
	}),
);

vi.mock(
	"@/app/[locale]/(app)/time-tracking/actions/work-period-time-edit",
	() => ({
		getWorkPeriodTimeEditContext: getContext,
		updateWorkPeriodTimes: updateTimes,
	}),
);

vi.mock("sonner", () => ({
	toast: { error: toastError, success: toastSuccess },
}));

vi.mock("@/components/ui/time-input", () => ({
	TimeInput: (props: ComponentProps<"input">) => <input {...props} />,
}));

const t = ((_key: string, fallback: string, params?: Record<string, unknown>) =>
	fallback.replace(/\{(\w+)\}/g, (_match, name: string) =>
		String(params?.[name] ?? ""),
	)) as unknown as TFnType;

const event: CalendarEvent = {
	id: "4a1ab5ee-67f8-4b52-bd33-a1fb0dc59a2e",
	type: "work_period",
	date: new Date("2026-09-01T07:00:00Z"),
	endDate: new Date("2026-09-01T15:00:00Z"),
	title: "Work",
	color: "#000",
	metadata: { durationMinutes: 480, employeeName: "Alex" },
};

const values = {
	clockInDate: "2026-09-01",
	clockInTime: "09:00",
	clockOutDate: "2026-09-01",
	clockOutTime: "17:00",
};

function mockAccess(access: WorkPeriodTimeEditAccess) {
	getContext.mockResolvedValue({
		success: true,
		data: { access, timezone: "Europe/Berlin", values },
	});
}

function renderSection(onTimesUpdated = vi.fn()) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={queryClient}>
			<WorkPeriodTimeSection
				event={event}
				displayContext={{
					locale: "en-US",
					timezone: "Europe/Berlin",
					timeFormat: "24h",
				}}
				onTimesUpdated={onTimesUpdated}
				t={t}
			/>
		</QueryClientProvider>,
	);
	return { onTimesUpdated };
}

describe("WorkPeriodTimeSection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("lets admins move an entry to another date and applies it directly", async () => {
		mockAccess({ kind: "admin" });
		updateTimes.mockResolvedValue({
			success: true,
			data: { status: "applied" },
		});
		const { onTimesUpdated } = renderSection();

		fireEvent.click(await screen.findByRole("button", { name: "Edit time" }));
		fireEvent.change(screen.getByLabelText("Clock in date"), {
			target: { value: "2026-08-03" },
		});
		fireEvent.change(screen.getByLabelText("Clock out date"), {
			target: { value: "2026-08-03" },
		});

		expect(screen.getByText("This change applies immediately.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => expect(onTimesUpdated).toHaveBeenCalledTimes(1));
		expect(updateTimes).toHaveBeenCalledWith(
			expect.objectContaining({
				workPeriodId: event.id,
				clockInDate: "2026-08-03",
				clockInTime: "09:00",
				clockOutDate: "2026-08-03",
				clockOutTime: "17:00",
				submissionId: expect.any(String),
			}),
		);
		expect(toastSuccess).toHaveBeenCalledWith("Time entry updated");
	});

	it("routes an employee's date change through approval and requires a reason", async () => {
		mockAccess({ kind: "self_service" });
		updateTimes.mockResolvedValue({
			success: true,
			data: { status: "pending" },
		});
		const { onTimesUpdated } = renderSection();

		fireEvent.click(await screen.findByRole("button", { name: "Edit time" }));
		fireEvent.change(screen.getByLabelText("Clock out date"), {
			target: { value: "2026-09-02" },
		});
		fireEvent.change(screen.getByLabelText("Clock out time"), {
			target: { value: "01:00" },
		});

		const submit = screen.getByRole("button", { name: "Submit for approval" });
		expect(
			screen.getByText(
				"This change will be sent to your manager for approval.",
			),
		).toBeTruthy();
		fireEvent.submit(submit.closest("form") as HTMLFormElement);
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith(
				"Please add a reason for your manager.",
			),
		);
		expect(updateTimes).not.toHaveBeenCalled();

		fireEvent.change(screen.getByLabelText("Reason"), {
			target: { value: "Forgot to clock out" },
		});
		fireEvent.click(submit);

		await waitFor(() => expect(onTimesUpdated).toHaveBeenCalledTimes(1));
		expect(updateTimes).toHaveBeenCalledWith(
			expect.objectContaining({ reason: "Forgot to clock out" }),
		);
		expect(toastSuccess).toHaveBeenCalledWith(
			"Change submitted for manager approval",
		);
	});

	it("keeps same-day time edits direct inside the self-service window", async () => {
		mockAccess({ kind: "self_service" });
		renderSection();

		fireEvent.click(await screen.findByRole("button", { name: "Edit time" }));
		fireEvent.change(screen.getByLabelText("Clock out time"), {
			target: { value: "16:30" },
		});

		expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
		expect(screen.getByText("Note (optional)")).toBeTruthy();
	});

	it("rejects ranges where clock out is not after clock in", async () => {
		mockAccess({ kind: "admin" });
		renderSection();

		fireEvent.click(await screen.findByRole("button", { name: "Edit time" }));
		fireEvent.change(screen.getByLabelText("Clock out time"), {
			target: { value: "08:00" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith(
				"Clock out must be after clock in.",
			),
		);
		expect(updateTimes).not.toHaveBeenCalled();
	});

	it("explains why entries beyond the approval window cannot be edited", async () => {
		mockAccess({
			kind: "blocked",
			reason: "beyond_approval_window",
			daysBack: 30,
		});
		renderSection();

		expect(
			await screen.findByText(
				"Entries older than 30 days can only be edited by an admin.",
			),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Edit time" })).toBeNull();
	});

	it("hides editing for other employees' entries without a hint", async () => {
		mockAccess({ kind: "blocked", reason: "not_owner" });
		renderSection();

		await waitFor(() => expect(getContext).toHaveBeenCalled());
		expect(screen.queryByRole("button", { name: "Edit time" })).toBeNull();
		expect(screen.getByText("09:00 - 17:00")).toBeTruthy();
	});
});
