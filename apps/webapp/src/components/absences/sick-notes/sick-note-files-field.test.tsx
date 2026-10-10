/* @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
	resolveStagedSickNoteFiles,
	SickNoteFilesField,
	type StagedSickNoteFile,
} from "./sick-note-files-field";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, unknown>) =>
			(fallback ?? _key).replace(/\{(\w+)\}/gu, (match, name: string) =>
				params && name in params ? String(params[name]) : match,
			),
	}),
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

const file = (name: string, type = "application/pdf") => new File(["%PDF-1.4"], name, { type });

let latest: StagedSickNoteFile[] = [];

function Harness({ dates }: { dates: { startDate: string; endDate: string } }) {
	const [value, setValue] = useState<StagedSickNoteFile[]>([]);
	latest = value;
	return <SickNoteFilesField value={value} onChange={setValue} dates={dates} />;
}

const october = { startDate: "2026-10-12", endDate: "2026-10-14" };

function choose(files: File[]) {
	fireEvent.change(screen.getByTestId("sick-note-file-input"), { target: { files } });
}

describe("SickNoteFilesField", () => {
	it("opens the rear camera for photos of supported types only, next to a file picker", () => {
		render(<Harness dates={october} />);

		const camera = screen.getByTestId("sick-note-camera-input");
		expect(camera.getAttribute("capture")).toBe("environment");
		expect(camera.getAttribute("accept")).toBe("image/jpeg,image/png,image/webp");
		expect(camera.hasAttribute("multiple")).toBe(false);

		const picker = screen.getByTestId("sick-note-file-input");
		expect(picker.getAttribute("accept")).toBe("application/pdf,image/jpeg,image/png,image/webp");
		expect(picker.hasAttribute("multiple")).toBe(true);
		expect(screen.getByRole("button", { name: "Take photo" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Choose files" })).toBeTruthy();
	});

	it("adds photos one after another, each with the absence's default title and first day", () => {
		render(<Harness dates={october} />);

		fireEvent.change(screen.getByTestId("sick-note-camera-input"), {
			target: { files: [file("photo-1.jpg", "image/jpeg")] },
		});
		fireEvent.change(screen.getByTestId("sick-note-camera-input"), {
			target: { files: [file("photo-2.jpg", "image/jpeg")] },
		});

		const rows = screen.getAllByRole("listitem");
		expect(rows.map((row) => within(row).getByText(/photo-\d\.jpg/u).textContent)).toEqual([
			"photo-1.jpg",
			"photo-2.jpg",
		]);
		for (const row of rows) {
			const title = within(row).getByLabelText("Title") as HTMLInputElement;
			expect(title.value).toMatch(/^Sick note Oct 12.+14, 2026$/u);
			expect((within(row).getByLabelText("Document date") as HTMLInputElement).value).toBe(
				"2026-10-12",
			);
		}
	});

	it("keeps an edited title while the others follow new absence dates", () => {
		const view = render(<Harness dates={october} />);
		choose([file("a.pdf"), file("b.pdf")]);
		const [first] = screen.getAllByRole("listitem");
		if (!first) throw new Error("no row");
		fireEvent.change(within(first).getByLabelText("Title"), { target: { value: "My note" } });

		view.rerender(<Harness dates={{ startDate: "2026-10-19", endDate: "2026-10-19" }} />);

		expect(
			resolveStagedSickNoteFiles(latest, { title: "Default", documentDate: "2026-10-19" }).map(
				(note) => [note.file.name, note.title, note.documentDate],
			),
		).toEqual([
			["a.pdf", "My note", "2026-10-19"],
			["b.pdf", "Default", "2026-10-19"],
		]);
		const [, second] = screen.getAllByRole("listitem");
		if (!second) throw new Error("no row");
		expect((within(second).getByLabelText("Title") as HTMLInputElement).value).toMatch(
			/^Sick note Oct 19, 2026$/u,
		);
	});

	it("refuses a HEIC photo from the files with the existing message and keeps the others", () => {
		render(<Harness dates={october} />);

		choose([file("IMG_0001.HEIC", "image/heic"), file("scan.pdf")]);

		expect(screen.getByRole("alert").textContent).toBe(
			"IMG_0001.HEIC: HEIC images are not supported. Export the photo as JPEG and upload it again.",
		);
		expect(latest.map((staged) => staged.file.name)).toEqual(["scan.pdf"]);
	});

	it("removes a staged file", () => {
		render(<Harness dates={october} />);
		choose([file("a.pdf"), file("b.pdf")]);

		fireEvent.click(screen.getByRole("button", { name: "Remove a.pdf" }));

		expect(latest.map((staged) => staged.file.name)).toEqual(["b.pdf"]);
	});

	it("takes at most ten files", () => {
		render(<Harness dates={october} />);

		choose(Array.from({ length: 12 }, (_, index) => file(`page-${index}.pdf`)));

		expect(latest).toHaveLength(10);
		expect(screen.getByRole("alert").textContent).toBe("You can add up to 10 files.");
	});
});
