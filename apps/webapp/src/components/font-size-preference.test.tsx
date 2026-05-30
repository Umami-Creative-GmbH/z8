/* @vitest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FontSizeProvider, useFontSizePreference } from "./font-size-preference";
import {
	applyFontSizePreference,
	FONT_SIZE_STORAGE_KEY,
	readStoredFontSize,
	writeStoredFontSize,
} from "./font-size-preference-utils";

function Consumer() {
	const { fontSize, setFontSize } = useFontSizePreference();

	return (
		<div>
			<p>Current: {fontSize}</p>
			<button type="button" onClick={() => setFontSize("large")}>
				Set large
			</button>
		</div>
	);
}

beforeEach(() => {
	localStorage.clear();
	document.documentElement.removeAttribute("data-font-size");
});

describe("font size preference helpers", () => {
	it("reads valid stored values", () => {
		localStorage.setItem(FONT_SIZE_STORAGE_KEY, "comfortable");

		expect(readStoredFontSize(localStorage)).toBe("comfortable");
	});

	it("falls back to default for invalid stored values", () => {
		localStorage.setItem(FONT_SIZE_STORAGE_KEY, "giant");

		expect(readStoredFontSize(localStorage)).toBe("default");
	});

	it("falls back to default when storage throws", () => {
		const storage = {
			getItem: vi.fn(() => {
				throw new Error("blocked");
			}),
		} as unknown as Storage;

		expect(readStoredFontSize(storage)).toBe("default");
	});

	it("writes values when storage is available", () => {
		writeStoredFontSize(localStorage, "large");

		expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe("large");
	});

	it("does not throw when storage writes fail", () => {
		const storage = {
			setItem: vi.fn(() => {
				throw new Error("blocked");
			}),
		} as unknown as Storage;

		expect(() => writeStoredFontSize(storage, "comfortable")).not.toThrow();
	});

	it("applies default by removing the html attribute", () => {
		document.documentElement.setAttribute("data-font-size", "large");

		applyFontSizePreference("default");

		expect(document.documentElement.hasAttribute("data-font-size")).toBe(false);
	});

	it("applies non-default values to html", () => {
		applyFontSizePreference("comfortable");

		expect(document.documentElement.dataset.fontSize).toBe("comfortable");
	});
});

describe("FontSizeProvider", () => {
	it("loads stored preference and updates the document", async () => {
		localStorage.setItem(FONT_SIZE_STORAGE_KEY, "comfortable");

		render(
			<FontSizeProvider>
				<Consumer />
			</FontSizeProvider>,
		);

		expect(await screen.findByText("Current: comfortable")).toBeTruthy();
		expect(document.documentElement.dataset.fontSize).toBe("comfortable");
	});

	it("updates state, storage, and html when changed", async () => {
		render(
			<FontSizeProvider>
				<Consumer />
			</FontSizeProvider>,
		);

		await screen.findByText("Current: default");

		act(() => {
			screen.getByRole("button", { name: "Set large" }).click();
		});

		expect(screen.getByText("Current: large")).toBeTruthy();
		expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe("large");
		expect(document.documentElement.dataset.fontSize).toBe("large");
	});

	it("keeps working when localStorage access throws", async () => {
		const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

		Object.defineProperty(window, "localStorage", {
			configurable: true,
			get() {
				throw new DOMException("blocked", "SecurityError");
			},
		});

		try {
			render(
				<FontSizeProvider>
					<Consumer />
				</FontSizeProvider>,
			);

			expect(await screen.findByText("Current: default")).toBeTruthy();

			act(() => {
				screen.getByRole("button", { name: "Set large" }).click();
			});

			expect(screen.getByText("Current: large")).toBeTruthy();
			expect(document.documentElement.dataset.fontSize).toBe("large");
		} finally {
			if (localStorageDescriptor) {
				Object.defineProperty(window, "localStorage", localStorageDescriptor);
			}
		}
	});
});
