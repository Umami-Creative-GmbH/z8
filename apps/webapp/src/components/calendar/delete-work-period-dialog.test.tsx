/** @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/types";
import { DeleteWorkPeriodDialog } from "./delete-work-period-dialog";

const { requestTimeEntryDeletion } = vi.hoisted(() => ({
	requestTimeEntryDeletion: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/corrections", () => ({
	requestTimeEntryDeletion,
}));

const workPeriodEvent: CalendarEvent = {
	id: "work-period-1",
	type: "work_period",
	date: new Date("2026-05-04T08:00:00.000Z"),
	endDate: new Date("2026-05-04T16:00:00.000Z"),
	title: "Work period",
	color: "blue",
	metadata: {
		durationMinutes: 480,
		employeeName: "Ada Lovelace",
		notes: "Front desk shift",
	},
};

describe("DeleteWorkPeriodDialog", () => {
	beforeEach(() => {
		requestTimeEntryDeletion.mockReset();
		requestTimeEntryDeletion.mockResolvedValue({
			success: true,
			data: { approvalId: "approval-1" },
		});
	});

	it("renders deletion request copy and reason field", () => {
		render(<DeleteWorkPeriodDialog event={workPeriodEvent} open={true} onOpenChange={vi.fn()} />);

		expect(screen.getByRole("heading", { name: "Request deletion?" })).toBeTruthy();
		expect(
			screen.getByText(
				"This will hide the time entry after manager approval. The audit history and time-entry chain will be preserved.",
			),
		).toBeTruthy();
		expect(screen.getByLabelText("Reason for deletion")).toBeTruthy();
		expect(screen.getByRole("button", { name: /Delete entry/i })).toBeTruthy();
	});

	it("submits the deletion request with the entered reason", async () => {
		const user = userEvent.setup();
		const onDeleteComplete = vi.fn();
		const onOpenChange = vi.fn();

		render(
			<DeleteWorkPeriodDialog
				event={workPeriodEvent}
				open={true}
				onDeleteComplete={onDeleteComplete}
				onOpenChange={onOpenChange}
			/>,
		);

		await user.type(screen.getByLabelText("Reason for deletion"), "  Duplicate entry  ");
		await user.click(screen.getByRole("button", { name: /Delete entry/i }));

		await waitFor(() => {
			expect(requestTimeEntryDeletion).toHaveBeenCalledWith({
				workPeriodId: "work-period-1",
				reason: "Duplicate entry",
			});
		});
		expect(onDeleteComplete).toHaveBeenCalledOnce();
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
