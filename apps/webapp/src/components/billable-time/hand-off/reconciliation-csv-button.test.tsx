/* @vitest-environment jsdom */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";
import { ReconciliationCsvButton } from "./reconciliation-csv-button";

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

afterEach(() => {
	vi.restoreAllMocks();
	toast.error.mockReset();
});

describe("ReconciliationCsvButton", () => {
	it("saves the CSV the server built under its file name", async () => {
		const blobs: Blob[] = [];
		window.URL.createObjectURL = vi.fn((blob: Blob) => {
			blobs.push(blob);
			return "blob:reconciliation";
		});
		window.URL.revokeObjectURL = vi.fn();
		const saved: string[] = [];
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
			this: HTMLAnchorElement,
		) {
			saved.push(this.download);
		});
		const download = vi.fn(async () => ({
			success: true as const,
			data: { fileName: "reconciliation-2026-09-01_2026-09-30.csv", content: "﻿a\r\n" },
		}));

		render(<ReconciliationCsvButton download={download} />);
		await userEvent.click(screen.getByRole("button", { name: "Download reconciliation CSV" }));

		await waitFor(() => expect(saved).toEqual(["reconciliation-2026-09-01_2026-09-30.csv"]));
		expect(blobs[0]?.type).toBe("text/csv;charset=utf-8");
		expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:reconciliation");
	});

	it("shows the server's refusal and saves nothing", async () => {
		window.URL.createObjectURL = vi.fn(() => "blob:x");
		const download = vi.fn(async () => ({
			success: false as const,
			error: "Only owners and admins can hand off billable work",
		}));

		render(<ReconciliationCsvButton download={download} />);
		await userEvent.click(screen.getByRole("button", { name: "Download reconciliation CSV" }));

		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith("Only owners and admins can hand off billable work"),
		);
		expect(window.URL.createObjectURL).not.toHaveBeenCalled();
	});
});
