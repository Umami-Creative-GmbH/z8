// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

const remote = vi.hoisted(() => ({
	commit: vi.fn(),
	decision: vi.fn(),
	map: vi.fn(),
	refresh: vi.fn(),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: remote.refresh }),
}));
vi.mock("@/app/[locale]/(app)/settings/import/csv-actions", () => ({
	commitCsvWorkAction: remote.commit,
	decideCsvWorkAction: remote.decision,
	mapCsvWorkAction: remote.map,
	refreshCsvWorkAction: vi.fn(),
}));
const { CsvWorkReview } = await import("./csv-work-review");
beforeAll(() => {
	globalThis.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
it("keeps commit available for accepted rows while showing unresolved source errors", async () => {
	remote.commit.mockResolvedValue({ success: true, data: {} });
	render(
		<CsvWorkReview
			batchId="batch"
			view={{
				batch: {
					status: "needs_review",
					selectedScope: { timezone: "Europe/Berlin", fileName: "work.csv" },
					errorMessage: null,
				},
				summary: {
					total: 2,
					accepted: 1,
					imported: 0,
					skipped: 0,
					rejected: 0,
					unresolved: 2,
				},
				people: [],
				vehicles: [],
				rows: [
					{
						id: "valid",
						rowStatus: "accepted",
						issueSeverity: "none",
						sourcePayload: {
							rowNumber: 2,
							values: {
								personnel_number: "0042",
								starts_at: "2026-07-22T08:00Z",
								ends_at: "2026-07-22T09:00Z",
							},
						},
						normalizedPayload: {},
						commitError: null,
						decisionReason: null,
						commitTargetId: null,
					},
					{
						id: "invalid",
						rowStatus: "needs_mapping",
						issueSeverity: "blocking",
						sourcePayload: {
							rowNumber: 3,
							values: { personnel_number: "unknown" },
						},
						normalizedPayload: {},
						commitError: "Unknown personnel number",
						decisionReason: null,
						commitTargetId: null,
					},
				],
			}}
		/>,
	);
	const button = screen.getByRole("button", { name: "Commit accepted rows" });
	expect(button.hasAttribute("disabled")).toBe(false);
	expect(screen.getByText("Unknown personnel number")).toBeTruthy();
	const user = userEvent.setup();
	await user.click(button);
	// Committing asks first: the count, what it creates, and that it cannot be undone.
	const dialog = await screen.findByRole("alertdialog");
	expect(dialog.textContent).toContain("accepted row");
	expect(dialog.textContent).toContain("An import cannot be undone");
	expect(remote.commit).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Import rows" }));
	await waitFor(() =>
		expect(remote.commit).toHaveBeenCalledWith({
			batchId: "batch",
		}),
	);
	expect(remote.refresh).toHaveBeenCalled();
	await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
});

it("keeps the commit confirmation open with the failure inline", async () => {
	remote.commit.mockResolvedValue({ success: false, error: "The commit could not be queued" });
	render(
		<CsvWorkReview
			batchId="batch"
			view={{
				batch: { status: "needs_review", selectedScope: { fileName: "work.csv" }, errorMessage: null },
				summary: { total: 1, accepted: 1, imported: 0, skipped: 0, rejected: 0, unresolved: 1 },
				people: [],
				vehicles: [],
				rows: [],
			}}
		/>,
	);
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Commit accepted rows" }));
	await user.click(await screen.findByRole("button", { name: "Import rows" }));

	const dialog = await screen.findByRole("alertdialog");
	await waitFor(() => expect(dialog.querySelector("[role=alert]")?.textContent).toBeTruthy());
	expect(remote.commit).toHaveBeenCalledOnce();
	expect(remote.refresh).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(remote.commit).toHaveBeenCalledOnce();
});

it("lets an admin map an unknown personnel number and reject an unresolved row", async () => {
	remote.map.mockResolvedValue({ success: true, data: {} });
	remote.decision.mockResolvedValue({ success: true, data: {} });
	render(
		<CsvWorkReview
			batchId="batch"
			view={{
				batch: {
					status: "needs_review",
					selectedScope: { fileName: "work.csv" },
					errorMessage: null,
				},
				summary: {
					total: 1,
					accepted: 0,
					imported: 0,
					skipped: 0,
					rejected: 0,
					unresolved: 1,
				},
				people: [{ id: "employee", number: "0042", name: "Alice" }],
				vehicles: [],
				rows: [
					{
						id: "unmatched",
						rowStatus: "needs_mapping",
						issueSeverity: "blocking",
						sourcePayload: {
							rowNumber: 2,
							values: { personnel_number: "external-7" },
						},
						normalizedPayload: {},
						commitError: "Unknown personnel number",
						decisionReason: null,
						commitTargetId: null,
					},
				],
			}}
		/>,
	);
	const user = userEvent.setup();
	await user.selectOptions(screen.getByLabelText("Source value"), "external-7");
	await user.click(screen.getByLabelText("Existing employee"));
	await user.click(await screen.findByRole("option", { name: /Alice/ }));
	await waitFor(() => expect(screen.queryByRole("option", { name: /Alice/ })).toBeNull());
	await user.click(screen.getByRole("button", { name: "Apply mapping" }));
	await waitFor(() =>
		expect(remote.map).toHaveBeenCalledWith({
			batchId: "batch",
			kind: "employee",
			sourceValue: "external-7",
			targetId: "employee",
		}),
	);
	await user.click(screen.getByRole("checkbox", { name: "Select CSV row 2" }));
	await user.click(
		screen.getByRole("button", { name: "Reject selected rows" }),
	);
	await waitFor(() =>
		expect(remote.decision).toHaveBeenCalledWith({
			batchId: "batch",
			rowIds: ["unmatched"],
			decision: "rejected",
		}),
	);
});
