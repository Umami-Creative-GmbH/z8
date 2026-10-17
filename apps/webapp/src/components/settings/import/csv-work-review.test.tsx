// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

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
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
it("keeps commit available for accepted rows while showing unresolved source errors", async () => {
	remote.commit.mockResolvedValue({ success: true, data: {} });
	render(
		<CsvWorkReview
			organizationId="org"
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
	await userEvent.setup().click(button);
	await waitFor(() =>
		expect(remote.commit).toHaveBeenCalledWith({
			organizationId: "org",
			batchId: "batch",
		}),
	);
	expect(remote.refresh).toHaveBeenCalled();
});

it("lets an admin map an unknown personnel number and reject an unresolved row", async () => {
	remote.map.mockResolvedValue({ success: true, data: {} });
	remote.decision.mockResolvedValue({ success: true, data: {} });
	render(
		<CsvWorkReview
			organizationId="org"
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
	await user.selectOptions(
		screen.getByLabelText("Existing employee"),
		"employee",
	);
	await user.click(screen.getByRole("button", { name: "Apply mapping" }));
	await waitFor(() =>
		expect(remote.map).toHaveBeenCalledWith({
			organizationId: "org",
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
			organizationId: "org",
			batchId: "batch",
			rowIds: ["unmatched"],
			decision: "rejected",
		}),
	);
});
