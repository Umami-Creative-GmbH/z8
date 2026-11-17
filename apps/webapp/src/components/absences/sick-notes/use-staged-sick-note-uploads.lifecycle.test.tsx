/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity, useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { discardStagedSickNoteUploadsAction } from "@/app/[locale]/(app)/absences/sick-note-actions";
import type { ResolvedStagedSickNote } from "./sick-note-files-field";
import { type UploadedSickNote, useStagedSickNoteUploads } from "./use-staged-sick-note-uploads";

// Only the external upload transport is controlled. The staging controller,
// React effects and retained component state are real.
const transport = vi.hoisted(() => ({
	instances: [] as Array<{
		handlers: Map<string, (...args: unknown[]) => unknown>;
		addFile: ReturnType<typeof vi.fn>;
		cancelAll: ReturnType<typeof vi.fn>;
		destroy: ReturnType<typeof vi.fn>;
	}>,
}));

vi.mock("@uppy/core", () => ({
	default: class UploadTransport {
		handlers = new Map<string, (...args: unknown[]) => unknown>();
		addFile = vi.fn();
		cancelAll = vi.fn();
		destroy = vi.fn();
		constructor() {
			transport.instances.push(this);
		}
		use() {
			return this;
		}
		on(event: string, handler: (...args: unknown[]) => unknown) {
			this.handlers.set(event, handler);
			return this;
		}
		off(event: string) {
			this.handlers.delete(event);
			return this;
		}
	},
}));
vi.mock("@uppy/tus", () => ({ default: class UploadProtocol {} }));
vi.mock("@/app/[locale]/(app)/absences/sick-note-actions", () => ({
	discardStagedSickNoteUploadsAction: vi.fn(async () => ({ success: true })),
}));

const note = {
	file: new File(["%PDF synthetic"], "note.pdf", { type: "application/pdf" }),
	title: "Retained note",
	documentDate: "2026-11-17",
};
const notes = [note];

function UploadForm({
	process,
	files = notes,
}: {
	process?: (uploaded: UploadedSickNote) => Promise<void>;
	files?: readonly ResolvedStagedSickNote[];
}) {
	const uploads = useStagedSickNoteUploads({ process });
	const [result, setResult] = useState("");
	return (
		<>
			<button
				type="button"
				onClick={async () => {
					try {
						const uploaded = await uploads.stage(files);
						setResult(uploaded.map((note) => note.tusFileKey).join(","));
					} catch (error) {
						setResult(error instanceof Error ? error.message : "Failed");
					}
				}}
			>
				Upload selected note
			</button>
			<output aria-label="Staging">{uploads.isStaging ? "Uploading" : "Ready"}</output>
			<output aria-label="Result">{result}</output>
		</>
	);
}

beforeEach(() => {
	transport.instances.length = 0;
	vi.mocked(discardStagedSickNoteUploadsAction).mockClear();
});

it.each([false, true])(
	"only discards unattached completed files on retirement (processed=%s)",
	async (processed) => {
		const process = vi.fn(async () => {});
		const files = [
			note,
			{ ...note, file: new File(["%PDF second"], "second.pdf", { type: "application/pdf" }) },
		];
		const tree = (mode: "visible" | "hidden") => (
			<Activity mode={mode}>
				<UploadForm files={files} process={processed ? process : undefined} />
			</Activity>
		);
		const view = render(tree("visible"));
		fireEvent.click(screen.getByRole("button", { name: "Upload selected note" }));
		await waitFor(() => expect(transport.instances[0]?.addFile).toHaveBeenCalledOnce());
		await act(async () => {
			await transport.instances[0]?.handlers.get("complete")?.({
				successful: [{ uploadURL: "http://localhost/api/tus/first-completed", name: "note.pdf" }],
			});
		});
		await waitFor(() => expect(transport.instances[0]?.addFile).toHaveBeenCalledTimes(2));
		view.rerender(tree("hidden"));
		view.rerender(tree("visible"));
		await waitFor(() => expect(screen.getByLabelText("Staging").textContent).toBe("Ready"));
		if (processed) {
			expect(process).toHaveBeenCalledOnce();
			expect(discardStagedSickNoteUploadsAction).not.toHaveBeenCalled();
		} else {
			expect(discardStagedSickNoteUploadsAction).toHaveBeenCalledExactlyOnceWith([
				"first-completed",
			]);
		}
	},
);

it("discards a completed unattached file even if retirement precedes its completion callback", async () => {
	const tree = (mode: "visible" | "hidden") => (
		<Activity mode={mode}>
			<UploadForm />
		</Activity>
	);
	const view = render(tree("visible"));
	fireEvent.click(screen.getByRole("button", { name: "Upload selected note" }));
	await waitFor(() => expect(transport.instances[0]?.addFile).toHaveBeenCalledOnce());
	let completion: unknown;
	act(() => {
		completion = transport.instances[0]?.handlers.get("complete")?.({
			successful: [
				{ uploadURL: "http://localhost/api/tus/completed-before-return", name: "note.pdf" },
			],
		});
		view.rerender(tree("hidden"));
	});
	await act(async () => {
		await completion;
	});
	expect(discardStagedSickNoteUploadsAction).toHaveBeenCalledExactlyOnceWith([
		"completed-before-return",
	]);
});

it.each(["success", "rejection"] as const)(
	"ignores an old processing %s after Activity starts a replacement upload",
	async (outcome) => {
		let finish!: () => void;
		const process = vi.fn(async () => {});
		process.mockImplementationOnce(
			() =>
				new Promise<void>((resolve, reject) => {
					finish = () => (outcome === "success" ? resolve() : reject(new Error("Retired")));
				}),
		);
		const tree = (mode: "visible" | "hidden") => (
			<Activity mode={mode}>
				<UploadForm process={process} />
			</Activity>
		);
		const view = render(tree("visible"));
		fireEvent.click(screen.getByRole("button", { name: "Upload selected note" }));
		await waitFor(() => expect(transport.instances[0]?.addFile).toHaveBeenCalledOnce());
		let oldCompletion: unknown;
		act(() => {
			oldCompletion = transport.instances[0]?.handlers.get("complete")?.({
				successful: [{ uploadURL: "http://localhost/api/tus/retired-note", name: "note.pdf" }],
			});
		});
		await waitFor(() => expect(process).toHaveBeenCalledOnce());
		view.rerender(tree("hidden"));
		view.rerender(tree("visible"));
		fireEvent.click(screen.getByRole("button", { name: "Upload selected note" }));
		await waitFor(() => expect(transport.instances[1]?.addFile).toHaveBeenCalledOnce());
		await act(async () => {
			finish();
			await oldCompletion;
		});
		expect(screen.getByLabelText("Staging").textContent).toBe("Uploading");
		expect(screen.getByLabelText("Result").textContent).not.toBe("retired-note");
		await act(async () => {
			await transport.instances[1]?.handlers.get("complete")?.({
				successful: [{ uploadURL: "http://localhost/api/tus/current-note", name: "note.pdf" }],
			});
		});
		expect(screen.getByLabelText("Result").textContent).toBe("current-note");
		expect(process).toHaveBeenCalledTimes(2);
	},
);

it("permits a fresh upload of the retained file after Activity destroys the old uploader", async () => {
	const view = render(
		<Activity mode="visible">
			<UploadForm />
		</Activity>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Upload selected note" }));
	await waitFor(() => expect(transport.instances[0]?.addFile).toHaveBeenCalledOnce());
	view.rerender(
		<Activity mode="hidden">
			<UploadForm />
		</Activity>,
	);
	view.rerender(
		<Activity mode="visible">
			<UploadForm />
		</Activity>,
	);
	expect(transport.instances[0]?.destroy).toHaveBeenCalledOnce();
	fireEvent.click(screen.getByRole("button", { name: "Upload selected note" }));
	await waitFor(() => expect(transport.instances[1]?.addFile).toHaveBeenCalledOnce());
	expect(transport.instances[1]?.addFile).toHaveBeenCalledWith(
		expect.objectContaining({ name: "note.pdf", data: notes[0]?.file }),
	);
	await act(async () => {
		await transport.instances[1]?.handlers.get("complete")?.({
			successful: [{ uploadURL: "http://localhost/api/tus/replacement-note", name: "note.pdf" }],
		});
	});
	expect(screen.getByLabelText("Result").textContent).toBe("replacement-note");
	expect(screen.getByLabelText("Staging").textContent).toBe("Ready");
	expect(discardStagedSickNoteUploadsAction).not.toHaveBeenCalled();
});
