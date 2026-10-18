/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getAbsenceComparisonPreview,
	getAbsencePlanPreview,
	requestAbsence,
} from "@/app/[locale]/(app)/absences/actions";
import type { AbsencePlanPreview } from "@/lib/absences/absence-plan-preview";
import type { AbsenceRequest } from "@/lib/absences/types";
import { RequestAbsenceDialog } from "./request-absence-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, unknown>) =>
			fallback
				? fallback.replace(/\{(\w+)\}/g, (_, key) => String(params?.[key] ?? `{${key}}`))
				: _key,
	}),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/[locale]/(app)/absences/actions", () => ({
	requestAbsence: vi.fn(),
	getAbsencePlanPreview: vi.fn(),
	getAbsenceComparisonPreview: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/absences/sick-note-actions", () => ({
	getOwnAbsenceSickNotesAction: vi.fn(async () => ({
		success: true,
		data: { canAttach: false, markers: {} },
	})),
	discardStagedSickNoteUploadsAction: vi.fn(),
}));

vi.mock("@/hooks/use-tus-file-upload", () => ({
	useTusFileUpload: () => ({
		addFile: vi.fn(),
		progress: 0,
		isUploading: false,
		isProcessing: false,
		reset: vi.fn(),
	}),
}));

const session = vi.hoisted(() => ({ userId: "user-1" }));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { session: { activeOrganizationId: "org-1" }, user: { id: session.userId } },
	}),
}));

vi.mock("@/app/[locale]/(app)/absences/deputy-actions", () => ({
	getDeputyCandidates: vi.fn().mockResolvedValue({
		success: true,
		data: [{ id: "deputy-ben", name: "Ben Example", image: null, awayPeriods: [] }],
	}),
	getDeputyDecisionCapability: vi.fn().mockResolvedValue({
		success: true,
		data: { canDecideApprovals: true },
	}),
}));

vi.mock("next-intl", () => ({ useLocale: () => "en" }));

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
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

const comparisonPreviewMock = vi.mocked(getAbsenceComparisonPreview);
const planPreviewMock = vi.mocked(getAbsencePlanPreview);
const requestAbsenceMock = vi.mocked(requestAbsence);

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
	{
		id: "bonus-days",
		name: "Bonus days",
		type: "custom",
		color: null,
		requiresApproval: true,
		countsAgainstVacation: true,
	},
];

/** A preview whose absence days tell the options apart: one day per date in the range. */
function previewFor(request: AbsenceRequest, overrides: Partial<AbsencePlanPreview> = {}) {
	const days =
		(Date.parse(request.endDate) - Date.parse(request.startDate)) / 86_400_000 +
		(request.durationKind === "partial_day" ? 0.5 : 1);
	return {
		requestedAbsenceDays: days,
		refusal: null,
		countsAgainstVacation: true,
		balances: [
			{
				year: Number(request.startDate.slice(0, 4)),
				chargedAbsenceDays: days,
				futureYear: false,
				status: "available" as const,
				remainingDays: 20,
				remainingAfterRequest: 20 - days,
			},
		],
		evaluatedAt: "2026-10-18T08:30:00Z",
		workBalance: null,
		holidays: [],
		overlaps: [],
		affectedShifts: [],
		coverage: { risks: [], status: "complete" as const, gaps: [] },
		notes: ["normal_approval_path"],
		...overrides,
	} satisfies AbsencePlanPreview;
}

function renderDialog({ organizationId = "org-1" }: { organizationId?: string } = {}) {
	// The app keeps query results fresh for a minute (lib/query/provider.tsx).
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
	});
	const onOpenChange = vi.fn();
	const ui = (orgId: string) => (
		<QueryClientProvider client={queryClient}>
			<RequestAbsenceDialog
				open
				onOpenChange={onOpenChange}
				organizationId={orgId}
				categories={categories}
			/>
		</QueryClientProvider>
	);
	const view = render(ui(organizationId));
	return {
		...view,
		onOpenChange,
		queryClient,
		rerenderWithOrganization: (orgId: string) => view.rerender(ui(orgId)),
	};
}

function fillDraft() {
	fireEvent.change(screen.getByLabelText("Absence Type *"), { target: { value: "vacation" } });
	fireEvent.change(screen.getByLabelText("Start Date *"), { target: { value: "2026-12-28" } });
	fireEvent.change(screen.getByLabelText("End Date"), { target: { value: "2026-12-30" } });
}

function openComparison() {
	fireEvent.click(screen.getByRole("button", { name: "Compare dates" }));
}

function option(name: string) {
	return screen.getByRole("region", { name });
}

function comparisonCallsFor(startDate: string) {
	return comparisonPreviewMock.mock.calls.filter(([request]) => request.startDate === startDate);
}

describe("RequestAbsenceDialog vacation comparison (#1342)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		session.userId = "user-1";
		requestAbsenceMock.mockResolvedValue({ success: true, data: { absenceId: "absence-1" } });
		planPreviewMock.mockImplementation(async (request) => ({
			success: true,
			data: previewFor(request),
		}));
		comparisonPreviewMock.mockImplementation(async (request) => ({
			success: true,
			data: previewFor(request),
		}));
	});

	it("offers comparison only for a vacation category that consumes the vacation balance", () => {
		renderDialog();

		expect(screen.queryByRole("button", { name: "Compare dates" })).toBeNull();
		fireEvent.change(screen.getByLabelText("Absence Type *"), { target: { value: "sick" } });
		expect(screen.queryByRole("button", { name: "Compare dates" })).toBeNull();
		fireEvent.change(screen.getByLabelText("Absence Type *"), {
			target: { value: "bonus-days" },
		});
		expect(screen.queryByRole("button", { name: "Compare dates" })).toBeNull();

		fireEvent.change(screen.getByLabelText("Absence Type *"), { target: { value: "vacation" } });
		const compare = screen.getByRole("button", { name: "Compare dates" });
		expect(compare.hasAttribute("disabled")).toBe(true);
		fireEvent.change(screen.getByLabelText("Start Date *"), { target: { value: "2026-12-28" } });
		expect(compare.hasAttribute("disabled")).toBe(false);
	});

	it("evaluates the labeled original through the comparison preview on opening", async () => {
		renderDialog();
		fillDraft();
		openComparison();

		const original = option("Original request");
		expect(within(original).getByText("Your current draft, kept as the baseline.")).toBeTruthy();
		// Keyboard and screen-reader focus moves into the comparison.
		expect(
			document.activeElement?.textContent?.startsWith("Compare your request with up to two"),
		).toBe(true);
		await waitFor(() =>
			expect(comparisonPreviewMock).toHaveBeenCalledWith({
				categoryId: "vacation",
				startDate: "2026-12-28",
				startPeriod: "full_day",
				endDate: "2026-12-30",
				endPeriod: "full_day",
				durationKind: "full_day",
				startTime: undefined,
				endTime: undefined,
			}),
		);
		expect(await within(original).findByText("3 days")).toBeTruthy();
		expect(within(original).getByText("2026")).toBeTruthy();
		expect(within(original).getByText("17 days")).toBeTruthy();
		expect(screen.queryByLabelText("Absence Type *")).toBeNull();
	});

	it("adds, duplicates and removes alternatives within the cap of two", async () => {
		renderDialog();
		fillDraft();
		openComparison();

		fireEvent.click(screen.getByRole("button", { name: "Add alternative" }));
		expect(option("Alternative 1")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Duplicate Original request" }));
		const copy = option("Alternative 2");
		expect((within(copy).getByLabelText("Start date") as HTMLInputElement).value).toBe(
			"2026-12-28",
		);
		expect(screen.getByRole("button", { name: "Add alternative" }).hasAttribute("disabled")).toBe(
			true,
		);
		expect(
			screen.getByRole("button", { name: "Duplicate Original request" }).hasAttribute("disabled"),
		).toBe(true);
		expect(screen.getByText("You can compare up to two alternatives.")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Remove Alternative 1" }));
		expect(screen.queryByRole("region", { name: "Alternative 2" })).toBeNull();
		expect(
			(within(option("Alternative 1")).getByLabelText("Start date") as HTMLInputElement).value,
		).toBe("2026-12-28");
		expect(screen.getByRole("button", { name: "Add alternative" }).hasAttribute("disabled")).toBe(
			false,
		);
	});

	it("refreshes only the edited alternative and keeps the original's result", async () => {
		renderDialog();
		fillDraft();
		openComparison();
		await within(option("Original request")).findByText("3 days");

		fireEvent.click(screen.getByRole("button", { name: "Add alternative" }));
		const alternative = option("Alternative 1");
		expect(within(alternative).getByText("Choose a start date.")).toBeTruthy();
		fireEvent.change(within(alternative).getByLabelText("Start date"), {
			target: { value: "2027-02-01" },
		});
		fireEvent.change(within(alternative).getByLabelText("End date"), {
			target: { value: "2027-02-05" },
		});

		expect(await within(alternative).findByText("5 days")).toBeTruthy();
		expect(comparisonCallsFor("2026-12-28")).toHaveLength(1);
		expect(within(option("Original request")).getByText("3 days")).toBeTruthy();
	});

	it("explains an invalid alternative inline and does not evaluate or apply it", async () => {
		renderDialog();
		fillDraft();
		openComparison();
		fireEvent.click(screen.getByRole("button", { name: "Add alternative" }));
		const alternative = option("Alternative 1");

		fireEvent.change(within(alternative).getByLabelText("Start date"), {
			target: { value: "2027-01-05" },
		});
		fireEvent.change(within(alternative).getByLabelText("Duration"), {
			target: { value: "partial_day" },
		});
		fireEvent.change(within(alternative).getByLabelText("Start time"), {
			target: { value: "13:00" },
		});
		fireEvent.change(within(alternative).getByLabelText("End time"), {
			target: { value: "09:00" },
		});

		const issue = within(alternative).getByText(
			"End after the start time, or end on the next day for an overnight absence.",
		);
		// The issue is tied to the input it concerns.
		const endTime = within(alternative).getByLabelText("End time");
		expect(endTime.getAttribute("aria-invalid")).toBe("true");
		expect(endTime.getAttribute("aria-describedby")).toContain(issue.id);
		expect(
			within(alternative)
				.getByRole("button", { name: "Apply Alternative 1 to request" })
				.hasAttribute("disabled"),
		).toBe(true);
		expect(
			comparisonCallsFor("2027-01-05").filter(
				([request]) => request.durationKind === "partial_day",
			),
		).toHaveLength(0);
	});

	it("keeps the other options when one option's evaluation fails", async () => {
		comparisonPreviewMock.mockImplementation(async (request) =>
			request.startDate === "2027-02-01"
				? { success: false, error: "Unable to build absence plan preview" }
				: { success: true, data: previewFor(request) },
		);
		renderDialog();
		fillDraft();
		openComparison();
		fireEvent.click(screen.getByRole("button", { name: "Add alternative" }));
		fireEvent.change(within(option("Alternative 1")).getByLabelText("Start date"), {
			target: { value: "2027-02-01" },
		});

		expect(
			await within(option("Alternative 1")).findByText(
				"This option could not be checked. Your other options are not affected.",
				{},
				// A failed read is retried once before it shows.
				{ timeout: 4000 },
			),
		).toBeTruthy();
		expect(within(option("Original request")).getByText("3 days")).toBeTruthy();
		// A valid option whose evidence failed can still be applied.
		expect(
			within(option("Alternative 1"))
				.getByRole("button", { name: "Apply Alternative 1 to request" })
				.hasAttribute("disabled"),
		).toBe(false);
	});

	it("explains, without retrying, a category that is no longer available", async () => {
		comparisonPreviewMock.mockResolvedValue({
			success: false,
			error: "Absence category not found",
			code: "category_unavailable",
		});
		renderDialog();
		fillDraft();
		openComparison();

		expect(
			await within(option("Original request")).findByText(
				"This absence type is no longer available. Go back and choose another type.",
			),
		).toBeTruthy();
		expect(comparisonCallsFor("2026-12-28")).toHaveLength(1);
		expect(
			within(option("Original request")).queryByRole("button", { name: "Try again" }),
		).toBeNull();
	});

	it("re-evaluates every option on Refresh all", async () => {
		renderDialog();
		fillDraft();
		openComparison();
		fireEvent.click(screen.getByRole("button", { name: "Add alternative" }));
		fireEvent.change(within(option("Alternative 1")).getByLabelText("Start date"), {
			target: { value: "2027-02-01" },
		});
		await within(option("Alternative 1")).findByText("1 day");
		await within(option("Original request")).findByText("3 days");

		fireEvent.click(screen.getByRole("button", { name: "Refresh all" }));

		await waitFor(() => {
			expect(comparisonCallsFor("2026-12-28")).toHaveLength(2);
			expect(comparisonCallsFor("2027-02-01")).toHaveLength(2);
		});
	});

	it("keeps an option's earlier result and says so when Refresh all fails for it", async () => {
		renderDialog();
		fillDraft();
		openComparison();
		await within(option("Original request")).findByText("3 days");
		comparisonPreviewMock.mockResolvedValue({
			success: false,
			error: "Unable to build absence plan preview",
		});

		fireEvent.click(screen.getByRole("button", { name: "Refresh all" }));

		expect(
			await within(option("Original request")).findByText(
				"This option could not be refreshed. It shows the earlier check below.",
				{},
				{ timeout: 4000 },
			),
		).toBeTruthy();
		expect(within(option("Original request")).getByText("3 days")).toBeTruthy();
	});

	it("never shows a response for an earlier input of an option", async () => {
		const pending: Array<{ request: AbsenceRequest; resolve: () => void }> = [];
		comparisonPreviewMock.mockImplementation(
			(request) =>
				new Promise((resolve) => {
					const respond = () => resolve({ success: true, data: previewFor(request) });
					if (request.startDate === "2026-12-28") respond();
					else pending.push({ request, resolve: respond });
				}),
		);
		renderDialog();
		fillDraft();
		openComparison();
		fireEvent.click(screen.getByRole("button", { name: "Add alternative" }));
		const alternative = option("Alternative 1");
		fireEvent.change(within(alternative).getByLabelText("Start date"), {
			target: { value: "2027-02-01" },
		});
		fireEvent.change(within(alternative).getByLabelText("End date"), {
			target: { value: "2027-02-01" },
		});
		await waitFor(() => expect(pending).toHaveLength(1));
		fireEvent.change(within(alternative).getByLabelText("End date"), {
			target: { value: "2027-02-03" },
		});
		await waitFor(() => expect(pending).toHaveLength(2));

		await act(async () => pending[1].resolve());
		expect(await within(alternative).findByText("3 days")).toBeTruthy();
		await act(async () => pending[0].resolve());
		expect(within(alternative).getByText("3 days")).toBeTruthy();
		expect(within(alternative).queryByText("1 day")).toBeNull();
	});

	it("applies only an option's dates and times, keeping category, notes and deputy", async () => {
		renderDialog();
		fillDraft();
		fireEvent.change(screen.getByLabelText("Notes (Optional)"), {
			target: { value: "Family trip" },
		});
		await screen.findByRole("option", { name: "Ben Example" });
		fireEvent.change(screen.getByLabelText("Deputy"), { target: { value: "deputy-ben" } });
		openComparison();
		fireEvent.click(screen.getByRole("button", { name: "Add alternative" }));
		const alternative = option("Alternative 1");
		fireEvent.change(within(alternative).getByLabelText("Start date"), {
			target: { value: "2026-12-31" },
		});
		fireEvent.change(within(alternative).getByLabelText("End date"), {
			target: { value: "2027-01-01" },
		});
		fireEvent.change(within(alternative).getByLabelText("Duration"), {
			target: { value: "partial_day" },
		});
		fireEvent.change(within(alternative).getByLabelText("Start time"), {
			target: { value: "22:00" },
		});
		fireEvent.change(within(alternative).getByLabelText("End time"), {
			target: { value: "02:00" },
		});

		fireEvent.click(
			within(alternative).getByRole("button", { name: "Apply Alternative 1 to request" }),
		);

		expect((screen.getByLabelText("Start Date *") as HTMLInputElement).value).toBe("2026-12-31");
		expect((screen.getByLabelText("End Date") as HTMLInputElement).value).toBe("2027-01-01");
		expect((screen.getByLabelText("Absence Duration") as HTMLSelectElement).value).toBe(
			"partial_day",
		);
		expect((screen.getByLabelText("Start Time *") as HTMLInputElement).value).toBe("22:00");
		expect((screen.getByLabelText("End Time *") as HTMLInputElement).value).toBe("02:00");
		expect((screen.getByLabelText("Absence Type *") as HTMLSelectElement).value).toBe("vacation");
		expect((screen.getByLabelText("Notes (Optional)") as HTMLTextAreaElement).value).toBe(
			"Family trip",
		);
		await waitFor(() =>
			expect((screen.getByLabelText("Deputy") as HTMLSelectElement).value).toBe("deputy-ben"),
		);
		expect(
			screen.getByText(
				"Alternative 1 applied to your request. Check the preview and your deputy before submitting.",
			),
		).toBeTruthy();
		await waitFor(() =>
			expect(planPreviewMock).toHaveBeenCalledWith(
				expect.objectContaining({
					startDate: "2026-12-31",
					endDate: "2027-01-01",
					durationKind: "partial_day",
					startTime: "22:00",
					endTime: "02:00",
				}),
			),
		);
		expect(requestAbsenceMock).not.toHaveBeenCalled();
	});

	it("submits an applied option through the ordinary request and keeps it editable when refused", async () => {
		requestAbsenceMock.mockResolvedValue({
			success: false,
			error: "You already have an absence during this period.",
			code: "ConflictError",
		});
		renderDialog();
		fillDraft();
		openComparison();
		fireEvent.click(screen.getByRole("button", { name: "Add alternative" }));
		fireEvent.change(within(option("Alternative 1")).getByLabelText("Start date"), {
			target: { value: "2027-02-01" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Apply Alternative 1 to request" }));
		await screen.findByText("Estimated balance after request (2027):");

		fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

		await waitFor(() =>
			expect(requestAbsenceMock).toHaveBeenCalledWith(
				expect.objectContaining({
					categoryId: "vacation",
					startDate: "2027-02-01",
					endDate: "2027-02-01",
				}),
			),
		);
		await waitFor(() =>
			expect(vi.mocked(toast).error).toHaveBeenCalledWith(
				"You already have an absence during this period.",
			),
		);
		expect((screen.getByLabelText("Start Date *") as HTMLInputElement).value).toBe("2027-02-01");
		expect(screen.getByRole("button", { name: "Submit Request" }).hasAttribute("disabled")).toBe(
			false,
		);
	});

	it("returns to the unchanged draft without applying and resumes the comparison", async () => {
		renderDialog();
		fillDraft();
		fireEvent.change(screen.getByLabelText("Notes (Optional)"), {
			target: { value: "Family trip" },
		});
		openComparison();
		fireEvent.click(screen.getByRole("button", { name: "Add alternative" }));
		fireEvent.change(within(option("Alternative 1")).getByLabelText("Start date"), {
			target: { value: "2027-02-01" },
		});

		fireEvent.click(screen.getByRole("button", { name: "Back to request" }));

		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Compare dates" }));
		expect((screen.getByLabelText("Start Date *") as HTMLInputElement).value).toBe("2026-12-28");
		expect((screen.getByLabelText("End Date") as HTMLInputElement).value).toBe("2026-12-30");
		expect((screen.getByLabelText("Notes (Optional)") as HTMLTextAreaElement).value).toBe(
			"Family trip",
		);
		expect(requestAbsenceMock).not.toHaveBeenCalled();

		openComparison();
		expect(
			(within(option("Alternative 1")).getByLabelText("Start date") as HTMLInputElement).value,
		).toBe("2027-02-01");
	});

	it("clears the comparison when the category changes", () => {
		renderDialog();
		fillDraft();
		openComparison();
		fireEvent.click(screen.getByRole("button", { name: "Add alternative" }));
		fireEvent.click(screen.getByRole("button", { name: "Back to request" }));

		fireEvent.change(screen.getByLabelText("Absence Type *"), { target: { value: "sick" } });
		fireEvent.change(screen.getByLabelText("Absence Type *"), { target: { value: "vacation" } });
		openComparison();

		expect(screen.queryByRole("region", { name: "Alternative 1" })).toBeNull();
	});

	it("clears the comparison when the organization changes", () => {
		const view = renderDialog();
		fillDraft();
		openComparison();
		fireEvent.click(screen.getByRole("button", { name: "Add alternative" }));

		view.rerenderWithOrganization("org-2");

		expect(screen.queryByRole("region", { name: "Original request" })).toBeNull();
		expect(screen.getByLabelText("Start Date *")).toBeTruthy();
	});

	it("keeps the alternatives after applying one and resumes with the applied dates", async () => {
		renderDialog();
		fillDraft();
		openComparison();
		fireEvent.click(screen.getByRole("button", { name: "Add alternative" }));
		fireEvent.change(within(option("Alternative 1")).getByLabelText("Start date"), {
			target: { value: "2027-02-01" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Apply Alternative 1 to request" }));
		expect((screen.getByLabelText("Start Date *") as HTMLInputElement).value).toBe("2027-02-01");

		openComparison();

		expect(
			(within(option("Alternative 1")).getByLabelText("Start date") as HTMLInputElement).value,
		).toBe("2027-02-01");
		await waitFor(() =>
			expect(comparisonPreviewMock).toHaveBeenCalledWith(
				expect.objectContaining({ startDate: "2027-02-01", endDate: "2027-02-01" }),
			),
		);
	});

	it("re-evaluates every option each time the comparison opens", async () => {
		renderDialog();
		fillDraft();
		openComparison();
		await within(option("Original request")).findByText("3 days");
		fireEvent.click(screen.getByRole("button", { name: "Back to request" }));

		openComparison();

		await waitFor(() => expect(comparisonCallsFor("2026-12-28")).toHaveLength(2));
	});

	it("drops the applied notice once the draft's dates are edited by hand", async () => {
		renderDialog();
		fillDraft();
		openComparison();
		fireEvent.click(screen.getByRole("button", { name: "Add alternative" }));
		fireEvent.change(within(option("Alternative 1")).getByLabelText("Start date"), {
			target: { value: "2027-02-01" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Apply Alternative 1 to request" }));
		expect(screen.getByText(/^Alternative 1 applied to your request\./)).toBeTruthy();

		fireEvent.change(screen.getByLabelText("End Date"), { target: { value: "2027-02-03" } });

		expect(screen.queryByText(/^Alternative 1 applied to your request\./)).toBeNull();
	});

	it("returns focus to Compare dates only right after leaving the comparison", () => {
		const view = renderDialog();
		fillDraft();
		openComparison();
		fireEvent.click(screen.getByRole("button", { name: "Back to request" }));
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Compare dates" }));

		const notes = screen.getByLabelText("Notes (Optional)") as HTMLTextAreaElement;
		notes.focus();
		fireEvent.change(screen.getByLabelText("Absence Type *"), { target: { value: "sick" } });
		fireEvent.change(screen.getByLabelText("Absence Type *"), { target: { value: "vacation" } });
		expect(document.activeElement).toBe(notes);

		// Closing and reopening the form does not move focus to Compare dates either.
		view.rerender(
			<QueryClientProvider client={view.queryClient}>
				<RequestAbsenceDialog
					open={false}
					onOpenChange={view.onOpenChange}
					organizationId="org-1"
					categories={categories}
				/>
			</QueryClientProvider>,
		);
		view.rerender(
			<QueryClientProvider client={view.queryClient}>
				<RequestAbsenceDialog
					open
					onOpenChange={view.onOpenChange}
					organizationId="org-1"
					categories={categories}
				/>
			</QueryClientProvider>,
		);
		fillDraft();
		expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Compare dates" }));
	});

	it("re-reads every preview after a successful submission", async () => {
		const view = renderDialog();
		const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");
		fillDraft();
		await screen.findByText("Estimated balance after request (2026):");

		fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

		await waitFor(() =>
			expect(invalidate).toHaveBeenCalledWith({ queryKey: ["absence-plan-preview"] }),
		);
	});

	it("clears the comparison after a successful submission", async () => {
		renderDialog();
		fillDraft();
		openComparison();
		fireEvent.click(screen.getByRole("button", { name: "Add alternative" }));
		fireEvent.click(screen.getByRole("button", { name: "Back to request" }));
		await screen.findByText("Estimated balance after request (2026):");

		fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));
		await waitFor(() => expect(requestAbsenceMock).toHaveBeenCalledTimes(1));

		fillDraft();
		openComparison();
		expect(screen.queryByRole("region", { name: "Alternative 1" })).toBeNull();
	});
});
