/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getNote: vi.fn(),
	dismissNote: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
				fallback
					.replace(/\{count, plural, one \{([^}]*)\} other \{([^}]*)\}\}/, (_match, one, other) =>
						params?.count === 1 ? one : other,
					)
					.replaceAll("#", String(params?.count ?? "")),
			),
	}),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("@/app/[locale]/(app)/settings/employees/wage-history-merge-note-actions", () => ({
	getWageHistoryMergeNoteAction: mocks.getNote,
	dismissWageHistoryMergeNoteAction: mocks.dismissNote,
}));

const { WageHistoryMergeNote } = await import("./wage-history-merge-note");

function renderNote() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<WageHistoryMergeNote employeeId="employee-1" />
		</QueryClientProvider>,
	);
}

describe("WageHistoryMergeNote (#1176)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("tells the org admin when the wage history was merged and how many rate changes were adjusted", async () => {
		mocks.getNote.mockResolvedValue({
			success: true,
			data: { mergedOn: "2026-10-14", adjustedCount: 3 },
		});

		renderNote();

		expect(
			await screen.findByText(
				"Wage history was merged from the old rate history on Oct 14, 2026; 3 rate changes were adjusted.",
			),
		).toBeTruthy();
		expect(mocks.getNote).toHaveBeenCalledWith("employee-1");
	});

	it("shows nothing when the employee has no note", async () => {
		mocks.getNote.mockResolvedValue({ success: true, data: null });

		const { container } = renderNote();

		await waitFor(() => expect(mocks.getNote).toHaveBeenCalled());
		expect(container.textContent).toBe("");
	});

	it("shows nothing when the note can't be read", async () => {
		mocks.getNote.mockResolvedValue({ success: false, error: "Only owners and admins" });

		const { container } = renderNote();

		await waitFor(() => expect(mocks.getNote).toHaveBeenCalled());
		expect(container.textContent).toBe("");
	});

	it("hides the note once dismissed", async () => {
		mocks.getNote.mockResolvedValueOnce({
			success: true,
			data: { mergedOn: "2026-10-14", adjustedCount: 1 },
		});
		mocks.getNote.mockResolvedValue({ success: true, data: null });
		mocks.dismissNote.mockResolvedValue({ success: true, data: undefined });

		renderNote();
		fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));

		await waitFor(() => expect(screen.queryByText(/Wage history was merged/)).toBeNull());
		expect(mocks.dismissNote).toHaveBeenCalledWith("employee-1");
	});

	it("keeps the note and reports a failed dismissal", async () => {
		mocks.getNote.mockResolvedValue({
			success: true,
			data: { mergedOn: "2026-10-14", adjustedCount: 1 },
		});
		mocks.dismissNote.mockResolvedValue({ success: false, error: "connection lost" });

		renderNote();
		fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));

		await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("connection lost"));
		expect(screen.getByText(/1 rate change was adjusted/)).toBeTruthy();
	});
});
