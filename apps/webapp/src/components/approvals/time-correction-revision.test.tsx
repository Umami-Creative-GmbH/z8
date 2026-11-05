// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimeCorrectionRevision } from "./time-correction-revision";

vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: {
			...actual.systemClock,
			nowInstant: () => actual.parseInstant("2026-11-05T12:00:00Z"),
		},
	};
});

const mocks = vi.hoisted(() => ({
	prepare: vi.fn(),
	submit: vi.fn(),
	reject: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/corrections", () => ({
	prepareTimeCorrectionRevision: mocks.prepare,
	requestTimeCorrection: mocks.submit,
}));
vi.mock("@/lib/query/use-approval-inbox", () => ({
	dispatchApprovalDecision: mocks.reject,
	useInvalidateApprovalInbox: () => vi.fn(),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			fallback.replace(/\{(\w+)\}/g, (match, key) => params?.[key] ?? match),
	}),
}));
const request = {
	workPeriodId: "period-1",
	newClockInDate: "2026-11-02",
	newClockInTime: "14:17",
	newClockOutDate: "2026-11-02",
	newClockOutTime: "16:10",
	reason: "Forgot to clock in",
	workLocationType: "office",
	workCategoryId: "category-1",
	vehicleUse: null,
};
const draft = {
	request,
	timezone: "Europe/Berlin",
	requestedRange: {
		startAt: "2026-11-02T13:17:00Z",
		endAt: "2026-11-02T15:10:00Z",
	},
	originalStart: { date: "2026-11-02", time: "14:47" },
	originalEnd: { date: "2026-11-02", time: "16:10" },
	metadataChanged: false,
};
const overlaps = [
	{
		kind: "work_period" as const,
		id: "other",
		startAt: "2026-11-02T12:00:00Z",
		endAt: "2026-11-02T13:30:00Z",
	},
];
function setup() {
	const onComplete = vi.fn();
	const onRejected = vi.fn();
	render(
		<TimeCorrectionRevision
			approvalId="approval-1"
			overlaps={overlaps}
			onActiveChange={vi.fn()}
			onComplete={onComplete}
			onRejected={onRejected}
		/>,
	);
	return { onComplete, onRejected };
}
async function open() {
	fireEvent.click(
		screen.getByRole("button", { name: "Adjust requested times" }),
	);
	await screen.findByLabelText("Start time");
}
async function fitAndSubmit() {
	fireEvent.click(
		screen.getByRole("button", { name: "Auto-fit requested times" }),
	);
	await waitFor(() =>
		expect(
			(screen.getByLabelText("Start time") as HTMLInputElement).value,
		).toBe("14:30"),
	);
	fireEvent.change(screen.getByLabelText("Reason for revision"), {
		target: { value: "Fit around existing work" },
	});
	fireEvent.click(
		screen.getByRole("button", { name: "Reject and submit revision" }),
	);
}
describe("revising an overlapping correction", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.prepare.mockResolvedValue({ success: true, data: draft });
		mocks.reject.mockResolvedValue({ success: true });
		mocks.submit.mockResolvedValue({
			success: true,
			data: { approvalId: "replacement", status: "pending" },
		});
	});
	it("auto-fits in the employee timezone and resubmits through the ordinary correction path", async () => {
		const { onComplete } = setup();
		await open();
		expect(
			(screen.getByLabelText("Start time") as HTMLInputElement).value,
		).toBe("14:17");
		await fitAndSubmit();
		await waitFor(() => expect(onComplete).toHaveBeenCalledWith("pending"));
		expect(mocks.reject).toHaveBeenCalledWith({
			approvalId: "approval-1",
			action: "reject",
			reason: expect.stringContaining("Fit around existing work"),
		});
		expect(mocks.submit).toHaveBeenCalledWith(
			expect.objectContaining({
				...request,
				newClockInTime: "14:30",
				reason: expect.stringContaining("approval-1"),
				submissionId: expect.any(String),
			}),
		);
		expect(mocks.reject.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.submit.mock.invocationCallOrder[0],
		);
	});
	it("does not reject the original while the proposed range still overlaps", async () => {
		setup();
		await open();
		fireEvent.change(screen.getByLabelText("Reason for revision"), {
			target: { value: "Fix" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Reject and submit revision" }),
		);
		expect(await screen.findByRole("alert")).toHaveProperty(
			"textContent",
			expect.stringContaining("still overlap"),
		);
		expect(mocks.reject).not.toHaveBeenCalled();
		expect(mocks.submit).not.toHaveBeenCalled();
	});
	it("does not submit a replacement if rejection fails", async () => {
		mocks.reject.mockResolvedValue({
			success: false,
			error: "Approval changed",
		});
		setup();
		await open();
		await fitAndSubmit();
		expect(await screen.findByText("Approval changed")).toBeTruthy();
		expect(mocks.submit).not.toHaveBeenCalled();
	});
	it("retains the draft after rejection and retries submission without rejecting twice", async () => {
		mocks.submit.mockResolvedValueOnce({
			success: false,
			error: "Please retry",
		});
		const { onComplete, onRejected } = setup();
		await open();
		await fitAndSubmit();
		expect((await screen.findByRole("alert")).textContent).toBe("Please retry");
		expect(onRejected).toHaveBeenCalledOnce();
		expect(screen.getByRole("status").textContent).toContain(
			"original request has been rejected",
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Submit revised correction" }),
		);
		await waitFor(() => expect(onComplete).toHaveBeenCalledWith("pending"));
		expect(mocks.reject).toHaveBeenCalledOnce();
		expect(mocks.submit).toHaveBeenCalledTimes(2);
		expect(mocks.submit.mock.calls[0][0].submissionId).toBe(
			mocks.submit.mock.calls[1][0].submissionId,
		);
	});
	it("keeps the original untouched when the reviewer has no revision authority", async () => {
		mocks.prepare.mockResolvedValue({
			success: false,
			error: "Only an eligible manager can revise",
		});
		setup();
		fireEvent.click(
			screen.getByRole("button", { name: "Adjust requested times" }),
		);
		expect(
			await screen.findByText("Only an eligible manager can revise"),
		).toBeTruthy();
		expect(mocks.reject).not.toHaveBeenCalled();
	});
});
