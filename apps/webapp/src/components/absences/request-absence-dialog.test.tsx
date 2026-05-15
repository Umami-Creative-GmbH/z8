/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAbsencePlanPreview, requestAbsence } from "@/app/[locale]/(app)/absences/actions";
import type { AbsencePlanPreview } from "@/lib/absences/absence-plan-preview";
import { RequestAbsenceDialog } from "./request-absence-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/[locale]/(app)/absences/actions", () => ({
	requestAbsence: vi.fn(),
	getAbsencePlanPreview: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		"aria-label": ariaLabel,
		value,
		onChange,
	}: {
		"aria-label"?: string;
		value?: string;
		onChange: (value: string) => void;
	}) => (
		<input
			aria-label={ariaLabel}
			onChange={(event) => onChange(event.target.value)}
			type="date"
			value={value ?? ""}
		/>
	),
}));

vi.mock("@/components/ui/select", async () => {
	const React = await import("react");

	function collectOptions(children: ReactNode): ReactElement[] {
		return React.Children.toArray(children).flatMap((child) => {
			if (!React.isValidElement<{ children?: ReactNode; value?: string }>(child)) return [];
			if (child.props.value) {
				return [
					<option key={child.props.value} value={child.props.value}>
						{child.props.children}
					</option>,
				];
			}

			return collectOptions(child.props.children);
		});
	}

	function findAriaLabel(children: ReactNode): string | undefined {
		for (const child of React.Children.toArray(children)) {
			if (!React.isValidElement<{ "aria-label"?: string; children?: ReactNode }>(child)) continue;
			if (child.props["aria-label"]) return child.props["aria-label"];

			const nestedLabel = findAriaLabel(child.props.children);
			if (nestedLabel) return nestedLabel;
		}
	}

	return {
		Select: ({
			children,
			onValueChange,
			value,
		}: {
			children: ReactNode;
			onValueChange: (value: string) => void;
			value: string;
		}) => (
			<select
				aria-label={findAriaLabel(children)}
				onChange={(event) => onValueChange(event.target.value)}
				value={value}
			>
				<option value="">Select option</option>
				{collectOptions(children)}
			</select>
		),
		SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
		SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
			<option value={value}>{children}</option>
		),
		SelectTrigger: ({ children }: { "aria-label"?: string; children: ReactNode }) => (
			<>{children}</>
		),
		SelectValue: ({ placeholder }: { placeholder?: string }) => <>{placeholder}</>,
	};
});

const requestAbsenceMock = vi.mocked(requestAbsence);
const getAbsencePlanPreviewMock = vi.mocked(getAbsencePlanPreview);
const toastMock = vi.mocked(toast);

const categories = [
	{
		id: "vacation",
		name: "Vacation",
		type: "vacation",
		color: null,
		requiresApproval: true,
		countsAgainstVacation: true,
	},
	{
		id: "sick",
		name: "Sick leave",
		type: "sick",
		color: null,
		requiresApproval: true,
		countsAgainstVacation: false,
	},
];

const riskyPreview: AbsencePlanPreview = {
	requestedDays: 2,
	balance: {
		year: 2026,
		remainingDays: 10,
		remainingAfterRequest: 8,
		countsAgainstVacation: true,
	},
	holidays: [],
	overlaps: [],
	affectedShifts: [],
	coverage: { risks: [], hasConfiguredRulesForAffectedShifts: true },
	approvalSignal: "risky",
	warnings: ["Coverage may be tight for this request."],
	reasons: ["Request follows the normal approval path."],
};

function renderDialog({
	onOpenChange = vi.fn(),
	organizationId = "org-1",
	remainingDays = 10,
}: {
	onOpenChange?: (open: boolean) => void;
	organizationId?: string;
	remainingDays?: number;
} = {}) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	const view = render(
		<QueryClientProvider client={queryClient}>
			<RequestAbsenceDialog
				open
				onOpenChange={onOpenChange}
				organizationId={organizationId}
				remainingDays={remainingDays}
				categories={categories}
			/>
		</QueryClientProvider>,
	);

	return { ...view, queryClient };
}

function fillRequiredFields() {
	fireEvent.change(screen.getByLabelText("Absence Type *"), { target: { value: "vacation" } });
	fireEvent.change(screen.getByLabelText("Start Date *"), { target: { value: "2026-05-11" } });
}

function fillRequiredFieldsForSickCategory() {
	fireEvent.change(screen.getByLabelText("Absence Type *"), { target: { value: "sick" } });
	fireEvent.change(screen.getByLabelText("Start Date *"), { target: { value: "2026-05-11" } });
}

describe("RequestAbsenceDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		requestAbsenceMock.mockResolvedValue({ success: true });
		getAbsencePlanPreviewMock.mockResolvedValue({ success: true, data: riskyPreview });
	});

	it("renders the open request form without missing form item context", () => {
		renderDialog();

		expect(screen.getByRole("heading", { name: "Request Absence" })).toBeTruthy();
		expect(screen.getByLabelText("Absence Type *")).toBeTruthy();
		expect(screen.getByLabelText("Start Date *")).toBeTruthy();
		expect(screen.getByLabelText("End Date")).toBeTruthy();
		expect(screen.getByLabelText("Absence Duration")).toBeTruthy();
		expect(screen.queryByLabelText("Start Period")).toBeNull();
		expect(screen.queryByLabelText("End Period")).toBeNull();
		expect(screen.queryByText("Category is required")).toBeNull();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("stacks request form fields with compact vertical spacing", () => {
		renderDialog();

		const body = document.querySelector('[data-slot="action-panel-body"]');

		expect(body).toBeTruthy();
		expect(body?.classList.contains("space-y-4")).toBe(true);
		expect(body?.classList.contains("grid")).toBe(false);
	});

	it("does not require an open change handler in controlled mode", () => {
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		render(
			<QueryClientProvider client={queryClient}>
				<RequestAbsenceDialog
					open
					organizationId="org-1"
					remainingDays={10}
					categories={categories}
				/>
			</QueryClientProvider>,
		);

		expect(() => fireEvent.click(screen.getByRole("button", { name: "Cancel" }))).not.toThrow();
	});

	it("keeps the planner panel hidden until required fields are selected", () => {
		renderDialog();

		expect(screen.queryByRole("heading", { name: "Smart planner" })).toBeNull();
		expect(getAbsencePlanPreviewMock).not.toHaveBeenCalled();
	});

	it("calls and renders the planner after required fields are selected", async () => {
		const { queryClient } = renderDialog({ organizationId: "org-1" });

		fillRequiredFields();

		await waitFor(() => {
			expect(getAbsencePlanPreviewMock).toHaveBeenCalledWith({
				categoryId: "vacation",
				startDate: "2026-05-11",
				startPeriod: "full_day",
				endDate: "2026-05-11",
				endPeriod: "full_day",
				durationKind: "full_day",
				startTime: undefined,
				endTime: undefined,
			});
		});
		expect(
			queryClient.getQueryCache().find({
				queryKey: [
					"absence-plan-preview",
					"org-1",
					{
						categoryId: "vacation",
						startDate: "2026-05-11",
						startPeriod: "full_day",
						endDate: "2026-05-11",
						endPeriod: "full_day",
						durationKind: "full_day",
						startTime: undefined,
						endTime: undefined,
					},
				],
			}),
		).toBeTruthy();
		expect(await screen.findByRole("heading", { name: "Smart planner" })).toBeTruthy();
		expect(screen.getByText("Coverage may be tight for this request.")).toBeTruthy();
	});

	it("shows the sick detail field when the sick category is selected", () => {
		renderDialog();

		fireEvent.change(screen.getByLabelText("Absence Type *"), { target: { value: "sick" } });

		expect(screen.getByText("Sick detail *")).toBeTruthy();
	});

	it("hides the sick detail field when a non-sick category is selected", () => {
		renderDialog();

		fireEvent.change(screen.getByLabelText("Absence Type *"), { target: { value: "vacation" } });

		expect(screen.queryByText("Sick detail *")).toBeNull();
	});

	it("shows the generic required fields error when sick detail is missing", async () => {
		renderDialog();

		fillRequiredFieldsForSickCategory();
		fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

		await waitFor(() =>
			expect(toastMock.error).toHaveBeenCalledWith("Please fill in all required fields"),
		);
		expect(requestAbsenceMock).not.toHaveBeenCalled();
	});

	it("submits sick detail when selected for a sick absence", async () => {
		renderDialog();

		fillRequiredFieldsForSickCategory();
		fireEvent.change(screen.getByLabelText("Sick detail *"), {
			target: { value: "with_certificate" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

		await waitFor(() =>
			expect(requestAbsenceMock).toHaveBeenCalledWith(
				expect.objectContaining({
					categoryId: "sick",
					sickDetail: "with_certificate",
				}),
			),
		);
	});

	it("keeps loading and error states non-blocking for submission", async () => {
		getAbsencePlanPreviewMock.mockRejectedValue(new Error("Preview failed"));
		renderDialog();

		fillRequiredFields();

		expect(await screen.findByText("Checking balance, holidays, and coverage…")).toBeTruthy();
		expect(
			await screen.findByText("Planning preview unavailable. You can still submit your request."),
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

		await waitFor(() => expect(requestAbsenceMock).toHaveBeenCalledTimes(1));
	});

	it("allows submission when the planner returns risky advisory warnings", async () => {
		renderDialog();

		fillRequiredFields();
		expect(await screen.findByText("Coverage may be tight for this request.")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

		await waitFor(() => expect(requestAbsenceMock).toHaveBeenCalledTimes(1));
	});

	it("blocks invalid same-day partial-day times before submission", async () => {
		renderDialog();

		fillRequiredFields();
		fireEvent.change(screen.getByLabelText("Absence Duration"), {
			target: { value: "partial_day" },
		});
		fireEvent.change(screen.getByLabelText("Start Time *"), { target: { value: "13:00" } });
		fireEvent.change(screen.getByLabelText("End Time *"), { target: { value: "09:00" } });

		const validationError = screen.getByRole("alert");
		expect(validationError.getAttribute("aria-live")).toBe("polite");
		expect(validationError.textContent).toContain(
			"Enter an end time after the start time, or choose the next end date for an overnight absence.",
		);
		expect(screen.getByRole("button", { name: "Submit Request" }).hasAttribute("disabled")).toBe(
			true,
		);

		fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

		await waitFor(() => expect(requestAbsenceMock).not.toHaveBeenCalled());
	});

	it("submits partial-day times with an empty end date as a same-day request", async () => {
		renderDialog();

		fillRequiredFields();
		fireEvent.change(screen.getByLabelText("Absence Duration"), {
			target: { value: "partial_day" },
		});
		fireEvent.change(screen.getByLabelText("Start Time *"), { target: { value: "09:00" } });
		fireEvent.change(screen.getByLabelText("End Time *"), { target: { value: "13:00" } });

		fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

		await waitFor(() => {
			expect(requestAbsenceMock).toHaveBeenCalledWith({
				categoryId: "vacation",
				startDate: "2026-05-11",
				startPeriod: "am",
				endDate: "2026-05-11",
				endPeriod: "am",
				durationKind: "partial_day",
				startTime: "09:00",
				endTime: "13:00",
				notes: undefined,
			});
		});
	});

	it("blocks insufficient vacation balance before submission", async () => {
		renderDialog({ remainingDays: 1 });

		fillRequiredFields();
		fireEvent.change(screen.getByLabelText("End Date"), { target: { value: "2026-05-14" } });

		fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

		await waitFor(() => expect(requestAbsenceMock).not.toHaveBeenCalled());
	});
});
