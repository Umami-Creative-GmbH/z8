/** @vitest-environment jsdom */

import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
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
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			fallback.replace(
				/\{(\w+)\}/g,
				(_match, key: string) => params?.[key] ?? `{${key}}`,
			),
	}),
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

vi.mock("@/components/time-tracking/work-category-selector", () => ({
	WorkCategorySelector: ({
		employeeId,
		onValueChange,
		persistPreference,
		value,
	}: {
		employeeId: string;
		onValueChange: (value: string | undefined) => void;
		persistPreference?: boolean;
		value: string | undefined;
	}) => (
		<div
			data-employee-id={employeeId}
			data-persist-preference={String(persistPreference)}
			data-testid="work-category-selector"
		>
			<label htmlFor="work-category">Work Category</label>
			<select
				id="work-category"
				onChange={(event) => onValueChange(event.target.value || undefined)}
				value={value ?? ""}
			>
				<option value="">No category</option>
				<option value="category-1">Category 1</option>
				<option value="category-2">Category 2</option>
			</select>
		</div>
	),
}));

const workPeriod = {
	id: "period-1",
	startTime: new Date("2026-07-01T08:00:00.000Z"),
	endTime: new Date("2026-07-01T16:00:00.000Z"),
	clockOut: { notes: null },
	workLocationType: "office" as const,
	workCategoryId: null,
};

function renderDialog(
	props: Partial<Parameters<typeof TimeCorrectionDialog>[0]> = {},
) {
	return render(
		<TimeCorrectionDialog
			workPeriod={workPeriod}
			employeeId="employee-1"
			isSameDay={false}
			employeeTimezone="UTC"
			{...props}
		/>,
	);
}

async function openDialog(
	name:
		| "Edit time entry"
		| "Request time correction" = "Request time correction",
) {
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name }));
	return user;
}

async function submitCorrection() {
	const user = userEvent.setup();
	renderDialog();
	await user.click(
		screen.getByRole("button", { name: "Request time correction" }),
	);
	await user.type(
		screen.getByLabelText("Reason for Correction"),
		"Correct clock-in",
	);
	await user.click(screen.getByRole("radio", { name: "Remote" }));
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

	it("uses a content-start container and semantic endpoint ledger rows", async () => {
		renderDialog();
		await openDialog();

		const body = screen.getByText(
			/Times are in your local timezone/,
		).parentElement;
		expect(body?.getAttribute("data-slot")).toBe("action-panel-body");
		expect(body?.className).toContain("grid");
		expect(body?.className).toContain("content-start");
		expect(body?.className).toContain("@container/correction");

		const clockIn = screen.getByRole("group", { name: "Clock in" });
		const clockOut = screen.getByRole("group", { name: "Clock out" });
		expect(clockIn.className).toContain("grid-cols-2");
		expect(clockIn.className).toContain(
			"@[24rem]/correction:grid-cols-[minmax(6rem,8rem)_minmax(0,1fr)_minmax(0,1fr)]",
		);
		expect(
			within(clockIn)
				.getByLabelText(/Clock in date/)
				.getAttribute("type"),
		).toBe("date");
		expect(
			within(clockIn).getByLabelText("Clock in time").hasAttribute("required"),
		).toBe(true);
		expect(
			within(clockOut)
				.getByLabelText(/Clock out date/)
				.getAttribute("type"),
		).toBe("date");
		expect(within(clockOut).getByLabelText("Clock out time")).toBeTruthy();
	});

	it("prefills metadata selectors and passes the employee to category loading", async () => {
		renderDialog({
			workPeriod: {
				...workPeriod,
				workLocationType: "home",
				workCategoryId: "category-1",
			},
		});
		await openDialog();

		expect(
			screen.getByRole("radio", { name: "Home" }).getAttribute("aria-checked"),
		).toBe("true");
		expect(
			(screen.getByLabelText("Work Category") as HTMLSelectElement).value,
		).toBe("category-1");
		expect(
			screen
				.getByTestId("work-category-selector")
				.getAttribute("data-employee-id"),
		).toBe("employee-1");
		expect(
			screen
				.getByTestId("work-category-selector")
				.getAttribute("data-persist-preference"),
		).toBe("false");
		expect(
			screen.getByRole("group", { name: "Work location" }).parentElement
				?.className,
		).toContain("@container/widget");
	});

	it("submits a metadata-only direct edit with explicit metadata", async () => {
		mocks.editSameDayTimeEntry.mockResolvedValue({ success: true });
		renderDialog({ isSameDay: true });
		const user = await openDialog("Edit time entry");

		await user.click(screen.getByRole("radio", { name: "Remote" }));
		await user.click(screen.getByRole("button", { name: "Save Changes" }));

		await waitFor(() =>
			expect(mocks.editSameDayTimeEntry).toHaveBeenCalledOnce(),
		);
		expect(mocks.editSameDayTimeEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				workLocationType: "remote",
				workCategoryId: null,
			}),
		);
		expect(mocks.requestTimeCorrection).not.toHaveBeenCalled();
	});

	it("submits a metadata-only approval request with explicit metadata", async () => {
		mocks.requestTimeCorrection.mockResolvedValue({
			success: true,
			data: { approvalId: "approval-1", status: "pending" },
		});
		renderDialog();
		const user = await openDialog();

		await user.selectOptions(
			screen.getByLabelText("Work Category"),
			"category-1",
		);
		await user.type(
			screen.getByLabelText("Reason for Correction"),
			"Correct category",
		);
		await user.click(screen.getByRole("button", { name: "Submit Request" }));

		await waitFor(() =>
			expect(mocks.requestTimeCorrection).toHaveBeenCalledOnce(),
		);
		expect(mocks.requestTimeCorrection).toHaveBeenCalledWith(
			expect.objectContaining({
				workLocationType: "office",
				workCategoryId: "category-1",
			}),
		);
	});

	it("submits through the semantic form when Enter is pressed", async () => {
		mocks.editSameDayTimeEntry.mockResolvedValue({ success: true });
		renderDialog({ isSameDay: true });
		const user = await openDialog("Edit time entry");
		await user.click(screen.getByRole("radio", { name: "Remote" }));
		const clockInDate = screen.getByLabelText(/Clock in date/);
		clockInDate.focus();

		await user.keyboard("{Enter}");

		await waitFor(() =>
			expect(mocks.editSameDayTimeEntry).toHaveBeenCalledOnce(),
		);
	});

	it("routes programmatic form submission through TanStack Form", async () => {
		mocks.editSameDayTimeEntry.mockResolvedValue({ success: true });
		renderDialog({ isSameDay: true });
		const user = await openDialog("Edit time entry");
		await user.click(screen.getByRole("radio", { name: "Remote" }));
		const nativeForm = screen
			.getByRole("button", { name: "Save Changes" })
			.closest("form");
		expect(nativeForm).not.toBeNull();
		if (!nativeForm) return;

		fireEvent.submit(nativeForm);

		await waitFor(() =>
			expect(mocks.editSameDayTimeEntry).toHaveBeenCalledOnce(),
		);
	});

	it("blocks approval submission when the required reason is empty", async () => {
		renderDialog();
		const user = await openDialog();
		await user.click(screen.getByRole("radio", { name: "Remote" }));

		await user.click(screen.getByRole("button", { name: "Submit Request" }));

		expect(
			(screen.getByLabelText("Reason for Correction") as HTMLTextAreaElement)
				.validity.valueMissing,
		).toBe(true);
		expect(mocks.requestTimeCorrection).not.toHaveBeenCalled();
	});

	it("blocks a completely unchanged form with the server validation message", async () => {
		renderDialog({ isSameDay: true });
		const user = await openDialog("Edit time entry");

		await user.click(screen.getByRole("button", { name: "Save Changes" }));

		expect(mocks.toastError).toHaveBeenCalledWith(
			"At least one correction value must change",
		);
		expect(mocks.editSameDayTimeEntry).not.toHaveBeenCalled();
		expect(mocks.requestTimeCorrection).not.toHaveBeenCalled();
	});

	it("resets endpoint and metadata controls when reopened", async () => {
		renderDialog({
			workPeriod: { ...workPeriod, workCategoryId: "category-1" },
		});
		let user = await openDialog();
		await user.clear(screen.getByLabelText("Clock in time"));
		await user.type(screen.getByLabelText("Clock in time"), "09:30");
		await user.click(screen.getByRole("radio", { name: "Remote" }));
		await user.selectOptions(
			screen.getByLabelText("Work Category"),
			"category-2",
		);
		await user.click(screen.getByRole("button", { name: "Cancel" }));

		user = await openDialog();
		expect(
			(screen.getByLabelText("Clock in time") as HTMLInputElement).value,
		).toBe("08:00");
		expect(
			screen
				.getByRole("radio", { name: "Office" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(
			(screen.getByLabelText("Work Category") as HTMLSelectElement).value,
		).toBe("category-1");
	});

	it("adapts the category selector's undefined value to explicit null", async () => {
		mocks.requestTimeCorrection.mockResolvedValue({
			success: true,
			data: { approvalId: "approval-1", status: "pending" },
		});
		renderDialog({
			workPeriod: { ...workPeriod, workCategoryId: "category-1" },
		});
		const user = await openDialog();
		await user.selectOptions(screen.getByLabelText("Work Category"), "");
		await user.type(
			screen.getByLabelText("Reason for Correction"),
			"Remove category",
		);
		await user.click(screen.getByRole("button", { name: "Submit Request" }));

		await waitFor(() =>
			expect(mocks.requestTimeCorrection).toHaveBeenCalledOnce(),
		);
		expect(mocks.requestTimeCorrection).toHaveBeenCalledWith(
			expect.objectContaining({ workCategoryId: null }),
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
				employeeId="employee-1"
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
		await user.click(screen.getByRole("radio", { name: "Remote" }));
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
				employeeId="employee-1"
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
		await user.click(screen.getByRole("radio", { name: "Remote" }));
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
		await user.click(screen.getByRole("radio", { name: "Remote" }));
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
