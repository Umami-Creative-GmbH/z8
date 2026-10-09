/* @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const uppyState = vi.hoisted(() => ({
	instances: [] as Array<{
		handlers: Map<string, (...args: unknown[]) => unknown>;
		destroy: ReturnType<typeof vi.fn>;
		addFile: ReturnType<typeof vi.fn>;
		cancelAll: ReturnType<typeof vi.fn>;
	}>,
}));

vi.mock("@uppy/core", () => ({
	default: class FakeUppy {
		handlers = new Map<string, (...args: unknown[]) => unknown>();
		destroy = vi.fn();
		addFile = vi.fn();
		cancelAll = vi.fn();
		constructor() {
			uppyState.instances.push(this);
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
vi.mock("@uppy/tus", () => ({ default: class FakeTus {} }));

const { useTravelExpenseFileUpload } = await import("./use-travel-expense-file-upload");

const tusUploadUrl = "http://localhost/api/tus/.tmp%2Ftus%2Fowner-file";

describe("useTravelExpenseFileUpload", () => {
	beforeEach(() => {
		uppyState.instances.length = 0;
	});

	it("keeps one uploader across rerenders and reports to the latest callbacks", async () => {
		const process = vi.fn(async () => ({ id: "receipt-1" }));
		const firstSuccess = vi.fn();
		const latestSuccess = vi.fn();
		const { result, rerender } = renderHook(
			({ onSuccess }) => useTravelExpenseFileUpload({ process, onSuccess, onError: vi.fn() }),
			{ initialProps: { onSuccess: firstSuccess } },
		);
		const file = new File(["%PDF"], "receipt.pdf", { type: "application/pdf" });
		act(() => result.current.addFile(file));

		// Autosave and query updates rerender the editor while the file uploads.
		rerender({ onSuccess: latestSuccess });
		rerender({ onSuccess: latestSuccess });

		expect(uppyState.instances).toHaveLength(1);
		const uppy = uppyState.instances[0]!;
		expect(uppy.destroy).not.toHaveBeenCalled();
		expect(uppy.addFile).toHaveBeenCalledWith(
			expect.objectContaining({ name: "receipt.pdf", data: file }),
		);

		act(() => {
			uppy.handlers.get("upload")?.();
		});
		expect(result.current.isUploading).toBe(true);

		await act(async () => {
			await uppy.handlers.get("complete")?.({
				successful: [{ uploadURL: tusUploadUrl, name: "receipt.pdf" }],
			});
		});
		await waitFor(() => expect(latestSuccess).toHaveBeenCalledWith({ id: "receipt-1" }));
		expect(process).toHaveBeenCalledWith({
			tusFileKey: ".tmp/tus/owner-file",
			fileName: "receipt.pdf",
		});
		expect(firstSuccess).not.toHaveBeenCalled();
		expect(result.current.isUploading).toBe(false);
	});

	it("sends a declared upload purpose as TUS metadata (#865)", () => {
		const { result } = renderHook(() =>
			useTravelExpenseFileUpload({
				process: vi.fn(),
				allowedFileTypes: ["application/pdf"],
				uploadMetadata: { purpose: "personnel-document" },
			}),
		);
		const file = new File(["%PDF"], "contract.pdf", { type: "application/pdf" });
		act(() => result.current.addFile(file));

		expect(uppyState.instances[0]?.addFile).toHaveBeenCalledWith(
			expect.objectContaining({ meta: { purpose: "personnel-document" } }),
		);
	});

	it("reports a processing failure and becomes ready again", async () => {
		const onError = vi.fn();
		const { result } = renderHook(() =>
			useTravelExpenseFileUpload({
				process: async () => {
					throw new Error("Unsupported file type");
				},
				onSuccess: vi.fn(),
				onError,
			}),
		);
		const uppy = uppyState.instances[0]!;
		await act(async () => {
			uppy.handlers.get("upload")?.();
			await uppy.handlers.get("complete")?.({
				successful: [{ uploadURL: tusUploadUrl, name: "receipt.pdf" }],
			});
		});
		expect(onError).toHaveBeenCalledWith(new Error("Unsupported file type"));
		expect(result.current.isUploading).toBe(false);
	});

	it("reports a file the uploader refuses before uploading", () => {
		const onError = vi.fn();
		const { result } = renderHook(() =>
			useTravelExpenseFileUpload({ process: vi.fn(), onSuccess: vi.fn(), onError }),
		);
		uppyState.instances[0]!.addFile.mockImplementation(() => {
			throw new Error("This file exceeds maximum allowed size");
		});
		act(() => result.current.addFile(new File(["x"], "big.pdf")));
		expect(onError).toHaveBeenCalledWith(new Error("This file exceeds maximum allowed size"));
	});

	it("destroys the uploader only on unmount", () => {
		const { unmount } = renderHook(() =>
			useTravelExpenseFileUpload({ process: vi.fn(), onSuccess: vi.fn(), onError: vi.fn() }),
		);
		const uppy = uppyState.instances[0]!;
		expect(uppy.destroy).not.toHaveBeenCalled();
		unmount();
		expect(uppy.destroy).toHaveBeenCalledTimes(1);
	});
});
