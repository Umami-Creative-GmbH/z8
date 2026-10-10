/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttachSickNoteDialog } from "./attach-sick-note-dialog";
import { StagedSickNoteUploadError, type UploadedSickNote } from "./use-staged-sick-note-uploads";

const uploads = vi.hoisted(() => ({
	stage: vi.fn(),
	process: null as ((uploaded: UploadedSickNote) => Promise<void>) | null,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, unknown>) =>
			(fallback ?? _key).replace(/\{(\w+)\}/gu, (match, name: string) =>
				params && name in params ? String(params[name]) : match,
			),
	}),
}));

vi.mock("@/app/[locale]/(app)/absences/sick-note-actions", () => ({
	discardStagedSickNoteUploadsAction: vi.fn(),
}));

vi.mock("./use-staged-sick-note-uploads", async (original) => ({
	...(await original<typeof import("./use-staged-sick-note-uploads")>()),
	useStagedSickNoteUploads: (options: {
		process?: (uploaded: UploadedSickNote) => Promise<void>;
	}) => {
		uploads.process = options.process ?? null;
		return { stage: uploads.stage, isStaging: false, progress: 0, done: 0, total: 0 };
	},
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

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

const absence = {
	id: "absence-1",
	employeeId: "employee-1",
	startDate: "2026-10-12",
	endDate: "2026-10-14",
};

const pdf = (name: string) => new File(["%PDF-1.4"], name, { type: "application/pdf" });

function renderDialog(onAttached = vi.fn()) {
	render(
		<AttachSickNoteDialog absence={absence} open onOpenChange={vi.fn()} onAttached={onAttached} />,
	);
	return { onAttached };
}

describe("AttachSickNoteDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		uploads.stage.mockImplementation(
			async (notes: Array<{ file: File; title: string; documentDate: string }>) => {
				const done: UploadedSickNote[] = [];
				for (const note of notes) {
					const uploaded = {
						tusFileKey: `key-${note.file.name}`,
						fileName: note.file.name,
						title: note.title,
						documentDate: note.documentDate,
					};
					await uploads.process?.(uploaded);
					done.push(uploaded);
				}
				return done;
			},
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })),
		);
	});

	it("offers the camera next to the file picker", () => {
		renderDialog();

		expect(screen.getByRole("button", { name: "Take photo" })).toBeTruthy();
		expect(screen.getByTestId("sick-note-camera-input").getAttribute("capture")).toBe(
			"environment",
		);
	});

	it("asks for at least one file", async () => {
		renderDialog();

		fireEvent.click(screen.getByRole("button", { name: "Attach" }));

		expect(await screen.findByText("Choose at least one file.")).toBeTruthy();
		expect(uploads.stage).not.toHaveBeenCalled();
	});

	it("attaches each file as its own sick note to the absence", async () => {
		const { onAttached } = renderDialog();
		fireEvent.change(screen.getByTestId("sick-note-file-input"), {
			target: { files: [pdf("a.pdf"), pdf("b.pdf")] },
		});

		fireEvent.click(screen.getByRole("button", { name: "Attach" }));

		await waitFor(() => expect(onAttached).toHaveBeenCalledTimes(1));
		const bodies = vi
			.mocked(fetch)
			.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
		expect(bodies).toEqual([
			{
				tusFileKey: "key-a.pdf",
				fileName: "a.pdf",
				employeeId: "employee-1",
				source: "own",
				absenceId: "absence-1",
				metadata: {
					category: "sick_note",
					title: expect.stringMatching(/^Sick note Oct 12.+14, 2026$/u),
					documentDate: "2026-10-12",
				},
			},
			expect.objectContaining({ tusFileKey: "key-b.pdf", absenceId: "absence-1" }),
		]);
		expect(vi.mocked(toast).success).toHaveBeenCalledTimes(1);
	});

	it("keeps the notes attached before a failed file and names it", async () => {
		uploads.stage.mockRejectedValue(
			new StagedSickNoteUploadError("b.pdf", "Unsupported file type", [
				{ tusFileKey: "key-a.pdf", fileName: "a.pdf", title: "A", documentDate: "2026-10-12" },
			]),
		);
		const { onAttached } = renderDialog();
		fireEvent.change(screen.getByTestId("sick-note-file-input"), {
			target: { files: [pdf("a.pdf"), pdf("b.pdf")] },
		});

		fireEvent.click(screen.getByRole("button", { name: "Attach" }));

		await waitFor(() => expect(vi.mocked(toast).error).toHaveBeenCalled());
		expect(vi.mocked(toast).error).toHaveBeenCalledWith("b.pdf: Unsupported file type");
		expect(onAttached).toHaveBeenCalledTimes(1);
	});
});
