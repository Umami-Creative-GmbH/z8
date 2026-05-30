/* @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	uppyInstances: [] as Array<{
		handlers: Map<string, Set<(...args: never[]) => void>>;
		destroy: ReturnType<typeof vi.fn>;
		cancelAll: ReturnType<typeof vi.fn>;
		setOptions: ReturnType<typeof vi.fn>;
		use: ReturnType<typeof vi.fn>;
		addFile: ReturnType<typeof vi.fn>;
		emit: (event: string, ...args: never[]) => void;
	}>,
	processMutation: {
		isPending: false,
		mutateAsync: vi.fn(),
	},
}));

vi.mock("@uppy/core", () => ({
	default: class MockUppy {
		readonly handlers = new Map<string, Set<(...args: never[]) => void>>();
		readonly destroy = vi.fn();
		readonly cancelAll = vi.fn();
		readonly setOptions = vi.fn();
		readonly use = vi.fn(() => this);

		constructor() {
			mockState.uppyInstances.push(this);
		}

		on(event: string, handler: (...args: never[]) => void) {
			const handlers = this.handlers.get(event) ?? new Set<(...args: never[]) => void>();
			handlers.add(handler);
			this.handlers.set(event, handlers);
		}

		off(event: string, handler: (...args: never[]) => void) {
			this.handlers.get(event)?.delete(handler);
		}

		addFile = vi.fn(() => {
			this.emit("upload");
		});

		emit(event: string, ...args: never[]) {
			for (const handler of this.handlers.get(event) ?? []) {
				handler(...args);
			}
		}
	},
}));

vi.mock("@uppy/tus", () => ({
	default: vi.fn(),
}));

vi.mock("@uppy/locales/lib/de_DE", () => ({ default: {} }));
vi.mock("@uppy/locales/lib/en_US", () => ({ default: {} }));

vi.mock("next-intl", () => ({
	useLocale: () => "en",
}));

vi.mock("@/lib/query/use-image-process", () => ({
	useImageProcessMutation: () => mockState.processMutation,
}));

import { useImageUpload } from "./use-image-upload";

describe("useImageUpload", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.uppyInstances.length = 0;
		mockState.processMutation.isPending = false;
		mockState.processMutation.mutateAsync.mockReset();
		global.FileReader = class FileReader {
			result: string | ArrayBuffer | null = "data:image/png;base64,preview";
			onloadend: null | (() => void) = null;

			readAsDataURL() {
				this.onloadend?.();
			}
		} as never;
	});

	it.each([
		{ label: "profile avatar", options: { uploadType: "avatar" } as const },
		{
			label: "organization logo",
			options: { uploadType: "org-logo", organizationId: "org-1" } as const,
		},
	])("keeps the active Uppy $label upload instance alive across upload state updates", async ({
		options,
	}) => {
		const { result, unmount } = renderHook(() => useImageUpload(options));

		expect(mockState.uppyInstances).toHaveLength(1);
		const activeUppy = mockState.uppyInstances[0];

		await act(async () => {
			result.current.addFile(new File(["avatar"], "avatar.png", { type: "image/png" }));
		});

		await waitFor(() => expect(result.current.isUploading).toBe(true));

		expect(mockState.uppyInstances).toHaveLength(1);
		expect(activeUppy.destroy).not.toHaveBeenCalled();

		unmount();

		expect(activeUppy.destroy).toHaveBeenCalledTimes(1);
	});
});
