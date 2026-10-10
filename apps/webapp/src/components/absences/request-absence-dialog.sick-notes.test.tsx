/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAbsencePlanPreview, requestAbsence } from "@/app/[locale]/(app)/absences/actions";
import { getOwnAbsenceSickNotesAction } from "@/app/[locale]/(app)/absences/sick-note-actions";
import { RequestAbsenceDialog } from "./request-absence-dialog";
import { StagedSickNoteUploadError } from "./sick-notes/use-staged-sick-note-uploads";

const uploads = vi.hoisted(() => ({ stage: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, unknown>) =>
			(fallback ?? _key).replace(/\{(\w+)\}/gu, (match, name: string) =>
				params && name in params ? String(params[name]) : match,
			),
	}),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/[locale]/(app)/absences/actions", () => ({
	requestAbsence: vi.fn(),
	getAbsencePlanPreview: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/absences/sick-note-actions", () => ({
	getOwnAbsenceSickNotesAction: vi.fn(),
	discardStagedSickNoteUploadsAction: vi.fn(),
}));

vi.mock("./sick-notes/use-staged-sick-note-uploads", async (original) => ({
	...(await original<typeof import("./sick-notes/use-staged-sick-note-uploads")>()),
	useStagedSickNoteUploads: () => ({
		stage: uploads.stage,
		isStaging: false,
		progress: 0,
		done: 0,
		total: 0,
	}),
}));

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

const requestAbsenceMock = vi.mocked(requestAbsence);
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

function renderDialog() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<RequestAbsenceDialog
				open
				onOpenChange={vi.fn()}
				organizationId="org-1"
				remainingDays={10}
				categories={categories}
			/>
		</QueryClientProvider>,
	);
}

function chooseCategory(id: string) {
	fireEvent.change(screen.getByLabelText("Absence Type *"), { target: { value: id } });
}

function fillSickLeave() {
	chooseCategory("sick");
	fireEvent.change(screen.getByLabelText("Start Date *"), { target: { value: "2026-10-12" } });
	fireEvent.change(screen.getByLabelText("End Date"), { target: { value: "2026-10-14" } });
	fireEvent.change(screen.getByLabelText("Sick detail *"), {
		target: { value: "without_certificate" },
	});
}

const pdf = (name: string) => new File(["%PDF-1.4"], name, { type: "application/pdf" });

async function stageFiles(names: string[]) {
	const input = await screen.findByTestId("sick-note-file-input");
	fireEvent.change(input, { target: { files: names.map(pdf) } });
}

describe("RequestAbsenceDialog sick notes (#983)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getAbsencePlanPreview).mockResolvedValue({ success: false, error: "skip" });
		vi.mocked(getOwnAbsenceSickNotesAction).mockResolvedValue({
			success: true,
			data: { canAttach: true, markers: {} },
		});
		requestAbsenceMock.mockResolvedValue({
			success: true,
			data: { absenceId: "absence-1", sickNotes: { attached: 2, failed: [] } },
		});
		uploads.stage.mockImplementation(
			async (notes: Array<{ file: File; title: string; documentDate: string }>) =>
				notes.map((note) => ({
					tusFileKey: `key-${note.file.name}`,
					fileName: note.file.name,
					title: note.title,
					documentDate: note.documentDate,
				})),
		);
	});

	it("offers the sick note section only for a sick category", async () => {
		renderDialog();

		chooseCategory("sick");
		expect(await screen.findByRole("button", { name: "Take photo" })).toBeTruthy();

		chooseCategory("vacation");
		expect(screen.queryByRole("button", { name: "Take photo" })).toBeNull();
	});

	it("offers no section while the organization does not let employees attach sick notes", async () => {
		vi.mocked(getOwnAbsenceSickNotesAction).mockResolvedValue({
			success: true,
			data: { canAttach: false, markers: {} },
		});
		renderDialog();

		chooseCategory("sick");
		await waitFor(() => expect(getOwnAbsenceSickNotesAction).toHaveBeenCalledWith([]));
		expect(screen.queryByRole("button", { name: "Take photo" })).toBeNull();
	});

	it("drops the staged files when switching to a non-sick category", async () => {
		renderDialog();
		chooseCategory("sick");
		await stageFiles(["a.pdf"]);
		expect(screen.getByText("a.pdf")).toBeTruthy();

		chooseCategory("vacation");
		chooseCategory("sick");

		await screen.findByRole("button", { name: "Take photo" });
		expect(screen.queryByText("a.pdf")).toBeNull();
	});

	it("uploads the staged files and sends them with the request, titled after the entered dates", async () => {
		renderDialog();
		fillSickLeave();
		await stageFiles(["a.pdf", "b.pdf"]);

		fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

		await waitFor(() => expect(requestAbsenceMock).toHaveBeenCalledTimes(1));
		const [data, staged] = requestAbsenceMock.mock.calls[0] ?? [];
		expect(data).toMatchObject({ categoryId: "sick", sickDetail: "without_certificate" });
		expect(staged).toEqual([
			{
				tusFileKey: "key-a.pdf",
				fileName: "a.pdf",
				title: expect.stringMatching(/^Sick note Oct 12.+14, 2026$/u),
				documentDate: "2026-10-12",
			},
			{
				tusFileKey: "key-b.pdf",
				fileName: "b.pdf",
				title: expect.stringMatching(/^Sick note Oct 12.+14, 2026$/u),
				documentDate: "2026-10-12",
			},
		]);
		expect(toastMock.success).toHaveBeenCalled();
	});

	it("does not request the absence when a file cannot be uploaded, and names it", async () => {
		uploads.stage.mockRejectedValue(new StagedSickNoteUploadError("b.pdf", "Upload failed"));
		renderDialog();
		fillSickLeave();
		await stageFiles(["a.pdf", "b.pdf"]);

		fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

		await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
		expect(String(toastMock.error.mock.calls[0]?.[0])).toContain("b.pdf");
		expect(requestAbsenceMock).not.toHaveBeenCalled();
	});

	it("tells which file could not be attached after the absence was requested", async () => {
		requestAbsenceMock.mockResolvedValue({
			success: true,
			data: {
				absenceId: "absence-1",
				sickNotes: { attached: 1, failed: [{ fileName: "b.pdf", error: "Unsupported file type" }] },
			},
		});
		renderDialog();
		fillSickLeave();
		await stageFiles(["a.pdf", "b.pdf"]);

		fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

		await waitFor(() => expect(toastMock.warning).toHaveBeenCalled());
		expect(String(toastMock.warning.mock.calls[0]?.[0])).toBe(
			"Your absence was requested, but b.pdf could not be attached. You can attach sick notes from the absence later.",
		);
	});

	it("refuses a staged file without a title", async () => {
		renderDialog();
		fillSickLeave();
		await stageFiles(["a.pdf"]);
		fireEvent.change(screen.getByLabelText("Title"), { target: { value: " " } });

		fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

		expect(
			await screen.findByText("Give each sick note a title and a document date."),
		).toBeTruthy();
		expect(uploads.stage).not.toHaveBeenCalled();
		expect(requestAbsenceMock).not.toHaveBeenCalled();
	});
});
