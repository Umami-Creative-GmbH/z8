/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const previewMock = vi.hoisted(() => vi.fn());

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		name,
		value,
		onChange,
	}: {
		name: string;
		value?: string;
		onChange: (value: string) => void;
	}) => (
		<input
			aria-label={name}
			value={value ?? ""}
			onChange={(event) => onChange(event.target.value)}
		/>
	),
}));

vi.mock("@/lib/query/use-employee-offboarding", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/query/use-employee-offboarding")>()),
	useDeparturePreview: previewMock,
}));

import { DepartureForm, type DepartureFormProps } from "./departure-form";

const employeeId = "11111111-1111-4111-8111-111111111111";

function renderForm(overrides: Partial<DepartureFormProps> = {}) {
	const props: DepartureFormProps = {
		organizationId: "org-1",
		employeeId,
		departure: null,
		initialMode: "scheduled",
		canSchedule: true,
		canOffboardNow: true,
		scheduleDeparture: vi.fn().mockResolvedValue({ success: true, data: {} }),
		offboardNow: vi.fn().mockResolvedValue({ success: true, data: {} }),
		onCompleted: vi.fn(),
		onCancel: vi.fn(),
		...overrides,
	};
	render(<DepartureForm {...props} />);
	return props;
}

describe("DepartureForm", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		previewMock.mockReturnValue({
			data: {
				lastWorkingDay: "2026-09-30",
				cutoff: "2026-09-30T22:00:00Z",
				timezone: "Europe/Berlin",
				pendingDutyCount: 0,
				replacementOptions: [],
				exceptions: ["running_timer"],
			},
			isFetching: false,
			error: null,
		});
	});

	it("shows the server's cutoff in the organization zone, not the viewer's", () => {
		renderForm();

		expect(screen.getByTestId("departure-cutoff").textContent).toBe(
			"Access and paid-seat usage end at Oct 1, 2026, 12:00 AM (Europe/Berlin).",
		);
		expect(
			screen.getByText("A running timer will be closed at the cutoff and marked for review."),
		).toBeTruthy();
	});

	it("shows a visible field error when the last working day is missing", async () => {
		const props = renderForm();

		fireEvent.click(screen.getByRole("button", { name: "Schedule departure" }));

		expect(await screen.findByText("Choose the last working day.")).toBeTruthy();
		expect(props.scheduleDeparture).not.toHaveBeenCalled();
	});

	it("keeps entered values, focuses the server guidance and retries with the same request id", async () => {
		const user = userEvent.setup();
		const scheduleDeparture = vi
			.fn()
			.mockResolvedValueOnce({
				success: false,
				error: "This departure has already taken effect. Rehire the employee to restore access.",
			})
			.mockResolvedValueOnce({ success: true, data: {} });
		const props = renderForm({ scheduleDeparture });

		await user.type(screen.getByLabelText("lastWorkingDay"), "2026-09-30");
		await user.click(screen.getByRole("button", { name: "Schedule departure" }));

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("already taken effect");
		await waitFor(() => expect(document.activeElement).toBe(alert));
		expect((screen.getByLabelText("lastWorkingDay") as HTMLInputElement).value).toBe("2026-09-30");

		await user.click(screen.getByRole("button", { name: "Schedule departure" }));

		await waitFor(() => expect(props.onCompleted).toHaveBeenCalled());
		const [first, second] = scheduleDeparture.mock.calls.map(([input]) => input);
		expect(first).toMatchObject({
			employeeId,
			expectedRevision: null,
			lastWorkingDay: "2026-09-30",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: false,
		});
		expect(second.requestId).toBe(first.requestId);
	});

	it("uses a new request id once the intent changes", async () => {
		const user = userEvent.setup();
		const scheduleDeparture = vi.fn().mockResolvedValue({ success: false, error: "Try again" });
		renderForm({ scheduleDeparture });

		await user.type(screen.getByLabelText("lastWorkingDay"), "2026-09-30");
		await user.click(screen.getByRole("button", { name: "Schedule departure" }));
		await screen.findByRole("alert");
		await user.clear(screen.getByLabelText("lastWorkingDay"));
		await user.type(screen.getByLabelText("lastWorkingDay"), "2026-10-15");
		await user.click(screen.getByRole("button", { name: "Schedule departure" }));

		await waitFor(() => expect(scheduleDeparture).toHaveBeenCalledTimes(2));
		const [first, second] = scheduleDeparture.mock.calls.map(([input]) => input);
		expect(second.requestId).not.toBe(first.requestId);
	});

	it("edits a pending departure against its current revision", async () => {
		const user = userEvent.setup();
		const props = renderForm({
			departure: {
				id: "22222222-2222-4222-8222-222222222222",
				revision: 3,
				mode: "scheduled",
				lastWorkingDay: "2026-09-30",
				cutoff: "2026-09-30T22:00:00Z",
				timezone: "Europe/Berlin",
				replacementEmployeeId: null,
				blockedReason: null,
			},
		});

		await user.click(screen.getByRole("button", { name: "Save departure" }));

		await waitFor(() =>
			expect(props.scheduleDeparture).toHaveBeenCalledWith(
				expect.objectContaining({ expectedRevision: 3, lastWorkingDay: "2026-09-30" }),
			),
		);
	});

	it("offboards immediately through the explicit mode, operable by keyboard", async () => {
		const user = userEvent.setup();
		const props = renderForm();

		await user.click(screen.getByRole("radio", { name: "Offboard now" }));
		expect(
			screen.getByText(
				"Access and paid-seat usage end immediately, and a running timer is closed now.",
			),
		).toBeTruthy();
		screen.getByRole("button", { name: "Offboard now" }).focus();
		await user.keyboard("{Enter}");

		await waitFor(() =>
			expect(props.offboardNow).toHaveBeenCalledWith(
				expect.objectContaining({ employeeId, replacementEmployeeId: null }),
			),
		);
		expect(props.scheduleDeparture).not.toHaveBeenCalled();
		expect(previewMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ lastWorkingDay: null, enabled: true }),
		);
	});

	it("requires confirming unassigned approval duties without a replacement", async () => {
		const user = userEvent.setup();
		previewMock.mockReturnValue({
			data: {
				lastWorkingDay: "2026-09-30",
				cutoff: "2026-09-30T22:00:00Z",
				timezone: "Europe/Berlin",
				pendingDutyCount: 2,
				replacementOptions: [],
				exceptions: ["unassigned_approval_duties"],
			},
			isFetching: false,
			error: null,
		});
		const props = renderForm();

		await user.type(screen.getByLabelText("lastWorkingDay"), "2026-09-30");
		await user.click(screen.getByRole("button", { name: "Schedule departure" }));

		expect(
			await screen.findByText(
				"Choose a replacement or confirm admins will resolve the open duties.",
			),
		).toBeTruthy();
		expect(props.scheduleDeparture).not.toHaveBeenCalled();

		await user.click(
			screen.getByRole("checkbox", { name: "Admins will resolve the 2 open approval duties." }),
		);
		await user.click(screen.getByRole("button", { name: "Schedule departure" }));

		await waitFor(() =>
			expect(props.scheduleDeparture).toHaveBeenCalledWith(
				expect.objectContaining({ acknowledgeUnassignedDuties: true }),
			),
		);
	});

	it("checks the preview against the chosen replacement", () => {
		renderForm({
			departure: {
				id: "22222222-2222-4222-8222-222222222222",
				revision: 1,
				mode: "scheduled",
				lastWorkingDay: "2026-09-30",
				cutoff: "2026-09-30T22:00:00Z",
				timezone: "Europe/Berlin",
				replacementEmployeeId: "33333333-3333-4333-8333-333333333333",
				blockedReason: null,
			},
		});

		expect(previewMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				lastWorkingDay: "2026-09-30",
				replacementEmployeeId: "33333333-3333-4333-8333-333333333333",
			}),
		);
	});

	it("previews unassigned duties while no replacement is chosen", () => {
		renderForm();

		expect(previewMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ replacementEmployeeId: null }),
		);
	});

	it("only offers immediate departure when scheduling is not allowed", () => {
		renderForm({ canSchedule: false });

		expect(screen.queryByRole("radio", { name: "Schedule departure" })).toBeNull();
		expect(screen.getByRole("button", { name: "Offboard now" })).toBeTruthy();
	});
});
