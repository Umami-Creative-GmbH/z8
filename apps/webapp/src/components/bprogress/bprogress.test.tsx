/* @vitest-environment jsdom */

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	start: vi.fn(),
	done: vi.fn(),
	configure: vi.fn(),
}));

vi.mock("@bprogress/core", () => ({
	BProgress: mocks,
}));

vi.mock("@tanstack/react-query", () => ({
	useIsFetching: () => 0,
}));

import { BProgressBar } from "./bprogress";

describe("BProgressBar", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = "";
	});

	it("delegates anchor clicks through document instead of retaining per-anchor listeners", () => {
		document.body.innerHTML = '<a href="/next">Next</a>';
		const documentAddEventListener = vi.spyOn(document, "addEventListener");
		const anchorAddEventListener = vi.spyOn(HTMLAnchorElement.prototype, "addEventListener");

		render(<BProgressBar />);

		expect(documentAddEventListener).toHaveBeenCalledWith(
			"click",
			expect.any(Function),
			expect.any(Object),
		);
		expect(anchorAddEventListener).not.toHaveBeenCalledWith(
			"click",
			expect.any(Function),
			expect.anything(),
		);
	});

	it("starts progress for dynamically added links", async () => {
		render(<BProgressBar />);

		const anchor = document.createElement("a");
		anchor.href = "/dynamic";
		anchor.addEventListener("click", (event) => event.preventDefault());
		document.body.append(anchor);
		anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

		await waitFor(() => expect(mocks.start).toHaveBeenCalled());
	});
});
