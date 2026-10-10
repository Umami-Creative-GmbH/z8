/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { discardStagedSickNoteUploadsAction } from "@/app/[locale]/(app)/absences/sick-note-actions";
import { useStagedSickNoteUploads } from "./use-staged-sick-note-uploads";

/** The TUS uploader: each added file "uploads" to a key named after it, unless it should fail. */
const tus = vi.hoisted(() => ({ failing: new Set<string>(), uploaded: [] as string[] }));

vi.mock("@/hooks/use-tus-file-upload", () => ({
	useTusFileUpload: (options: {
		process: (input: { tusFileKey: string; fileName: string | undefined }) => Promise<unknown>;
		onSuccess?: (result: unknown) => void;
		onError?: (error: Error) => void;
	}) => ({
		addFile: (file: File) => {
			void (async () => {
				if (tus.failing.has(file.name)) {
					options.onError?.(new Error("Upload failed"));
					return;
				}
				tus.uploaded.push(file.name);
				try {
					options.onSuccess?.(
						await options.process({ tusFileKey: `key-${file.name}`, fileName: file.name }),
					);
				} catch (error) {
					options.onError?.(error as Error);
				}
			})();
		},
		progress: 0,
		isUploading: false,
		isProcessing: false,
		reset: vi.fn(),
	}),
}));

vi.mock("@/app/[locale]/(app)/absences/sick-note-actions", () => ({
	discardStagedSickNoteUploadsAction: vi.fn(async () => undefined),
}));

const file = (name: string) => new File(["%PDF-1.4"], name, { type: "application/pdf" });
const note = (name: string) => ({
	file: file(name),
	title: `Title ${name}`,
	documentDate: "2026-10-12",
});

describe("useStagedSickNoteUploads", () => {
	beforeEach(() => {
		tus.failing.clear();
		tus.uploaded.length = 0;
		vi.mocked(discardStagedSickNoteUploadsAction).mockClear();
	});

	it("uploads the files one after another and resolves to their keys with title and date", async () => {
		const { result } = renderHook(() => useStagedSickNoteUploads());

		let staged: unknown;
		await act(async () => {
			staged = await result.current.stage([note("a.pdf"), note("b.pdf")]);
		});

		expect(staged).toEqual([
			{
				tusFileKey: "key-a.pdf",
				fileName: "a.pdf",
				title: "Title a.pdf",
				documentDate: "2026-10-12",
			},
			{
				tusFileKey: "key-b.pdf",
				fileName: "b.pdf",
				title: "Title b.pdf",
				documentDate: "2026-10-12",
			},
		]);
		expect(discardStagedSickNoteUploadsAction).not.toHaveBeenCalled();
	});

	it("stops at the first failed file, names it, and discards the uploads before it", async () => {
		tus.failing.add("b.pdf");
		const { result } = renderHook(() => useStagedSickNoteUploads());

		let failure: unknown;
		await act(async () => {
			failure = await result.current
				.stage([note("a.pdf"), note("b.pdf"), note("c.pdf")])
				.catch((error: unknown) => error);
		});

		expect(failure).toMatchObject({ fileName: "b.pdf", message: "Upload failed" });
		expect(tus.uploaded).toEqual(["a.pdf"]);
		expect(discardStagedSickNoteUploadsAction).toHaveBeenCalledWith(["key-a.pdf"]);
	});

	it("hands each finished upload to `process` instead when given, and keeps what it took", async () => {
		const process = vi.fn(async (staged: { fileName?: string }) => {
			if (staged.fileName === "b.pdf") throw new Error("Absence gone");
		});
		const { result } = renderHook(() => useStagedSickNoteUploads({ process }));

		let failure: unknown;
		await act(async () => {
			failure = await result.current
				.stage([note("a.pdf"), note("b.pdf")])
				.catch((error: unknown) => error);
		});

		expect(process).toHaveBeenCalledTimes(2);
		expect(failure).toMatchObject({ fileName: "b.pdf", message: "Absence gone" });
		// What `process` took is its own; nothing is discarded behind it.
		expect(discardStagedSickNoteUploadsAction).not.toHaveBeenCalled();
	});
});
