/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity, type ReactElement, type ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { discardStagedSickNoteUploadsAction } from "@/app/[locale]/(app)/absences/sick-note-actions";
import { recordAbsenceForEmployee, recordAbsenceWithSickNotes } from "./actions";
import { RecordAbsenceDialog } from "./record-absence-dialog";

const uploads = vi.hoisted(() => ({ stage: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, unknown>) =>
			(fallback ?? _key).replace(/\{(\w+)\}/gu, (match, name: string) =>
				params && name in params ? String(params[name]) : match,
			),
	}),
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({
	recordAbsenceForEmployee: vi.fn(),
	recordAbsenceWithSickNotes: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/absences/sick-note-actions", () => ({
	discardStagedSickNoteUploadsAction: vi.fn(),
}));
// The deputy field (#1011) is not under test here.
vi.mock("@/components/absences/deputy-picker", async (original) => ({
	...(await original<typeof import("@/components/absences/deputy-picker")>()),
	DeputyPicker: () => null,
}));
vi.mock("@/components/absences/sick-notes/use-staged-sick-note-uploads", async (original) => ({
	...(await original<
		typeof import("@/components/absences/sick-notes/use-staged-sick-note-uploads")
	>()),
	useStagedSickNoteUploads: () => ({
		stage: uploads.stage,
		isStaging: false,
		progress: 0,
		done: 0,
		total: 0,
	}),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		"aria-label": ariaLabel,
		name,
		value,
		onChange,
	}: {
		"aria-label"?: string;
		name?: string;
		value?: string;
		onChange: (value: string) => void;
	}) => (
		<input
			aria-label={ariaLabel ?? name}
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
	return {
		Select: ({
			children,
			name,
			onValueChange,
			value,
		}: {
			children: ReactNode;
			name?: string;
			onValueChange: (value: string) => void;
			value: string;
		}) => (
			<select
				aria-label={name}
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
		SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
		SelectValue: ({ placeholder }: { placeholder?: string }) => <>{placeholder}</>,
	};
});

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
		requiresApproval: false,
		countsAgainstVacation: false,
	},
];

function renderDialog(sickNotesEnabled = true) {
	return render(
		<RecordAbsenceDialog
			open
			onOpenChange={vi.fn()}
			employee={{ id: "employee-anna", name: "Anna Example" }}
			categories={categories}
			sickNotesEnabled={sickNotesEnabled}
		/>,
	);
}

function fillSickLeave() {
	fireEvent.change(screen.getByLabelText("categoryId"), { target: { value: "sick" } });
	fireEvent.change(screen.getByLabelText("sickDetail"), {
		target: { value: "without_certificate" },
	});
	fireEvent.change(screen.getByLabelText("startDate"), { target: { value: "2026-10-12" } });
	fireEvent.change(screen.getByLabelText("endDate"), { target: { value: "2026-10-14" } });
}

const pdf = (name: string) => new File(["%PDF-1.4"], name, { type: "application/pdf" });

describe("RecordAbsenceDialog sick notes (#984)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(recordAbsenceForEmployee).mockResolvedValue({
			success: true,
			data: { absenceId: "absence-1" },
		});
		vi.mocked(recordAbsenceWithSickNotes).mockResolvedValue({
			success: true,
			data: { absenceId: "absence-1", sickNotes: { attached: 1, failed: [] } },
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

	it("uploads the sick notes first and records the absence with them", async () => {
		renderDialog();
		fillSickLeave();
		fireEvent.change(await screen.findByTestId("sick-note-file-input"), {
			target: { files: [pdf("note.pdf")] },
		});

		fireEvent.click(screen.getByRole("button", { name: "Record absence" }));

		await waitFor(() => expect(recordAbsenceWithSickNotes).toHaveBeenCalledTimes(1));
		const [input, notes] = vi.mocked(recordAbsenceWithSickNotes).mock.calls[0] ?? [];
		expect(input).toMatchObject({
			employeeId: "employee-anna",
			categoryId: "sick",
			startDate: "2026-10-12",
			endDate: "2026-10-14",
			sickDetail: "without_certificate",
		});
		expect(notes).toEqual([
			{
				tusFileKey: "key-note.pdf",
				fileName: "note.pdf",
				title: expect.stringMatching(/^Sick note /u),
				documentDate: "2026-10-12",
			},
		]);
		expect(recordAbsenceForEmployee).not.toHaveBeenCalled();
		expect(vi.mocked(toast).success).toHaveBeenCalledWith("Absence recorded");
	});

	it("records without sick notes as before when none are added", async () => {
		renderDialog();
		fillSickLeave();

		fireEvent.click(screen.getByRole("button", { name: "Record absence" }));

		await waitFor(() => expect(recordAbsenceForEmployee).toHaveBeenCalledTimes(1));
		expect(recordAbsenceWithSickNotes).not.toHaveBeenCalled();
		expect(uploads.stage).not.toHaveBeenCalled();
	});

	it("keeps the submitted draft when cancellation is attempted during a pending record", async () => {
		let complete!: (value: Awaited<ReturnType<typeof recordAbsenceForEmployee>>) => void;
		vi.mocked(recordAbsenceForEmployee).mockImplementation(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		renderDialog();
		fillSickLeave();
		const notes = screen.getByLabelText("Notes");
		fireEvent.change(notes, { target: { value: "Retained draft" } });
		fireEvent.click(screen.getByRole("button", { name: "Record absence" }));
		await waitFor(() => expect(recordAbsenceForEmployee).toHaveBeenCalledTimes(1));
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect((notes as HTMLTextAreaElement).value).toBe("Retained draft");
		complete({ success: false, error: "Refused" });
	});

	it("keeps the draft after refusal and retries the actual form once", async () => {
		vi.mocked(recordAbsenceForEmployee).mockResolvedValueOnce({
			success: false,
			error: "Not allowed",
		});
		renderDialog();
		fillSickLeave();
		fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Keep this reason" } });
		fireEvent.click(screen.getByRole("button", { name: "Record absence" }));
		await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Not allowed"));
		expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("Keep this reason");
		fireEvent.click(screen.getByRole("button", { name: "Record absence" }));
		await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Absence recorded"));
		expect(recordAbsenceForEmployee).toHaveBeenCalledTimes(2);
	});

	it.each(["success", "refusal", "rejection"])(
		"ignores a late %s after the form retires",
		async (outcome) => {
			let resolve!: (value: Awaited<ReturnType<typeof recordAbsenceForEmployee>>) => void;
			let reject!: (error: Error) => void;
			vi.mocked(recordAbsenceForEmployee).mockImplementation(
				() =>
					new Promise((yes, no) => {
						resolve = yes;
						reject = no;
					}),
			);
			const view = renderDialog();
			fillSickLeave();
			fireEvent.click(screen.getByRole("button", { name: "Record absence" }));
			await waitFor(() => expect(recordAbsenceForEmployee).toHaveBeenCalledOnce());
			view.unmount();
			if (outcome === "rejection") reject(new Error("Transport failed"));
			else
				resolve(
					outcome === "success"
						? { success: true, data: { absenceId: "late" } }
						: { success: false, error: "Refused" },
				);
			await new Promise((done) => setTimeout(done, 0));
			expect(toast.success).not.toHaveBeenCalled();
			expect(toast.error).not.toHaveBeenCalled();
		},
	);

	it("retires pending work while Activity is hidden and permits a fresh operation on return", async () => {
		let resolve!: (value: Awaited<ReturnType<typeof recordAbsenceForEmployee>>) => void;
		vi.mocked(recordAbsenceForEmployee).mockImplementationOnce(
			() =>
				new Promise((yes) => {
					resolve = yes;
				}),
		);
		const panel = (
			<RecordAbsenceDialog
				open
				onOpenChange={vi.fn()}
				employee={{ id: "employee-anna", name: "Anna Example" }}
				categories={categories}
				sickNotesEnabled
			/>
		);
		const view = render(<Activity mode="visible">{panel}</Activity>);
		fillSickLeave();
		fireEvent.click(screen.getByRole("button", { name: "Record absence" }));
		await waitFor(() => expect(recordAbsenceForEmployee).toHaveBeenCalledOnce());
		view.rerender(<Activity mode="hidden">{panel}</Activity>);
		view.rerender(<Activity mode="visible">{panel}</Activity>);
		await waitFor(() =>
			expect(
				(screen.getByRole("button", { name: "Record absence" }) as HTMLButtonElement).disabled,
			).toBe(false),
		);
		resolve({ success: true, data: { absenceId: "late" } });
		await new Promise((done) => setTimeout(done, 0));
		expect(toast.success).not.toHaveBeenCalled();
	});

	it("names the files that could not be attached after recording", async () => {
		vi.mocked(recordAbsenceWithSickNotes).mockResolvedValue({
			success: true,
			data: {
				absenceId: "absence-1",
				sickNotes: { attached: 0, failed: [{ fileName: "note.pdf", error: "Processing failed" }] },
			},
		});
		renderDialog();
		fillSickLeave();
		fireEvent.change(await screen.findByTestId("sick-note-file-input"), {
			target: { files: [pdf("note.pdf")] },
		});

		fireEvent.click(screen.getByRole("button", { name: "Record absence" }));

		await waitFor(() => expect(vi.mocked(toast).warning).toHaveBeenCalledTimes(1));
		expect(vi.mocked(toast).warning).toHaveBeenCalledWith(expect.stringContaining("note.pdf"));
	});

	it("deletes the uploaded files when the recording never reaches the server, and says so", async () => {
		vi.mocked(recordAbsenceWithSickNotes).mockRejectedValue(new Error("Failed to fetch"));
		renderDialog();
		fillSickLeave();
		fireEvent.change(await screen.findByTestId("sick-note-file-input"), {
			target: { files: [pdf("note.pdf")] },
		});

		fireEvent.click(screen.getByRole("button", { name: "Record absence" }));

		await waitFor(() =>
			expect(discardStagedSickNoteUploadsAction).toHaveBeenCalledWith(["key-note.pdf"]),
		);
		expect(vi.mocked(toast).error).toHaveBeenCalledWith("Failed to record absence");
		expect(vi.mocked(toast).success).not.toHaveBeenCalled();
	});

	it("offers no sick notes while personnel files are off, or for other absences", () => {
		renderDialog(false);
		fillSickLeave();
		expect(screen.queryByTestId("sick-note-file-input")).toBeNull();
	});

	it("offers no sick notes for a vacation", () => {
		renderDialog();
		fireEvent.change(screen.getByLabelText("categoryId"), { target: { value: "vacation" } });
		expect(screen.queryByTestId("sick-note-file-input")).toBeNull();
	});
});
