/** @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimeCorrectionDialog } from "./time-correction-dialog";

const mocks = vi.hoisted(() => ({
	editSameDayTimeEntry: vi.fn(),
	refresh: vi.fn(),
	requestTimeCorrection: vi.fn(),
	randomUUID: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("sonner", () => ({
	toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/corrections", () => ({
	editSameDayTimeEntry: mocks.editSameDayTimeEntry,
	requestTimeCorrection: mocks.requestTimeCorrection,
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: mocks.refresh }),
}));

const workPeriod = {
	id: "period-1",
	startTime: new Date("2026-07-01T08:00:00.000Z"),
	endTime: new Date("2026-07-01T16:00:00.000Z"),
	clockOut: { notes: null },
};

async function submitCorrection() {
	const user = userEvent.setup();
	render(
		<TimeCorrectionDialog
			workPeriod={workPeriod}
			isSameDay={false}
			employeeTimezone="UTC"
		/>,
	);
	await user.click(
		screen.getByRole("button", { name: "Request time correction" }),
	);
	await user.type(
		screen.getByLabelText("Reason for Correction"),
		"Correct clock-in",
	);
	await user.click(screen.getByRole("button", { name: "Submit Request" }));
}

describe("TimeCorrectionDialog approval presentation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		let uuidSequence = 0;
		mocks.randomUUID.mockImplementation(() => {
			uuidSequence += 1;
			return `41000000-0000-4000-8000-${uuidSequence.toString().padStart(12, "0")}`;
		});
		vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
			mocks.randomUUID,
		);
	});

	it("reuses the cycle token after an uncertain failure", async () => {
		mocks.requestTimeCorrection
			.mockResolvedValueOnce({ success: false, error: "Try again" })
			.mockResolvedValueOnce({
				success: true,
				data: { approvalId: "approval-1", status: "pending" },
			});
		const user = userEvent.setup();
		render(
			<TimeCorrectionDialog
				workPeriod={workPeriod}
				isSameDay={false}
				employeeTimezone="UTC"
			/>,
		);
		await user.click(
			screen.getByRole("button", { name: "Request time correction" }),
		);
		await user.type(
			screen.getByLabelText("Reason for Correction"),
			"Correct clock-in",
		);
		await user.click(screen.getByRole("button", { name: "Submit Request" }));
		await waitFor(() =>
			expect(mocks.requestTimeCorrection).toHaveBeenCalledTimes(1),
		);
		await user.click(screen.getByRole("button", { name: "Submit Request" }));
		await waitFor(() =>
			expect(mocks.requestTimeCorrection).toHaveBeenCalledTimes(2),
		);

		const submissionIds = mocks.requestTimeCorrection.mock.calls.map(
			([request]) => request.submissionId,
		);
		expect(submissionIds[0]).toMatch(/^[0-9a-f-]{36}$/);
		expect(submissionIds[1]).toBe(submissionIds[0]);
	});

	it("starts a new cycle token when the form is opened again", async () => {
		mocks.requestTimeCorrection
			.mockResolvedValueOnce({ success: false, error: "Try again" })
			.mockResolvedValueOnce({
				success: true,
				data: { approvalId: "approval-1", status: "pending" },
			});
		const user = userEvent.setup();
		render(
			<TimeCorrectionDialog
				workPeriod={workPeriod}
				isSameDay={false}
				employeeTimezone="UTC"
			/>,
		);
		await user.click(
			screen.getByRole("button", { name: "Request time correction" }),
		);
		await user.type(
			screen.getByLabelText("Reason for Correction"),
			"First correction",
		);
		await user.click(screen.getByRole("button", { name: "Submit Request" }));
		await waitFor(() =>
			expect(mocks.requestTimeCorrection).toHaveBeenCalledTimes(1),
		);
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		const trigger = await screen.findByRole("button", {
			name: "Request time correction",
		});
		await user.click(trigger);
		await user.type(
			screen.getByLabelText("Reason for Correction"),
			"Later correction",
		);
		await user.click(screen.getByRole("button", { name: "Submit Request" }));
		await waitFor(() =>
			expect(mocks.requestTimeCorrection).toHaveBeenCalledTimes(2),
		);

		const submissionIds = mocks.requestTimeCorrection.mock.calls.map(
			([request]) => request.submissionId,
		);
		expect(submissionIds[1]).not.toBe(submissionIds[0]);
	});

	it("presents an auto-completed correction as applied and refreshes the period", async () => {
		mocks.requestTimeCorrection.mockResolvedValue({
			success: true,
			data: { approvalId: "approval-1", status: "approved" },
		});

		await submitCorrection();

		await waitFor(() => {
			expect(mocks.toastSuccess).toHaveBeenCalledWith(
				"Correction applied successfully",
			);
		});
		expect(mocks.refresh).toHaveBeenCalledOnce();
	});

	it("keeps the pending manager-approval presentation for human approval", async () => {
		mocks.requestTimeCorrection.mockResolvedValue({
			success: true,
			data: { approvalId: "approval-1", status: "pending" },
		});

		await submitCorrection();

		await waitFor(() => {
			expect(mocks.toastSuccess).toHaveBeenCalledWith(
				"Correction request submitted for manager approval",
			);
		});
		expect(mocks.refresh).not.toHaveBeenCalled();
	});
});
