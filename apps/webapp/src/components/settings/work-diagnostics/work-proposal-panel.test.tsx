/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppendAssuranceReport } from "@/lib/time-tracking/append-assurance";
import type { HistoricalWorkProposalView } from "@/lib/time-tracking/historical-work-proposals";
import { WorkProposalPanel } from "./work-proposal-panel";
import { continuationTargetsOf } from "./work-proposal-targets";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string, params?: Record<string, string | number>) =>
			(defaultValue ?? _key).replace(/\{(\w+)\}/g, (_match, name: string) =>
				String(params?.[name]),
			),
	}),
}));

const worker = "a0000000-0000-4000-8000-000000000001";
const periodId = "b0000000-0000-4000-8000-000000000001";
const proposalId = "c0000000-0000-4000-8000-000000000001";
const fingerprint = "f".repeat(64);
const labels = { [worker]: "Wanda Worker" };

function repairProposal(status: HistoricalWorkProposalView["status"]): HistoricalWorkProposalView {
	return {
		id: proposalId,
		employeeId: worker,
		kind: "field_repair",
		status,
		workPeriodId: periodId,
		fingerprint,
		reason: "Resolve the July minutes conflict",
		proposedBy: { id: "u1", name: "Olga Owner" },
		proposedAt: "2026-09-25T10:00:00.000Z",
		approvedBy: status === "proposed" ? null : { id: "u2", name: "Anton Admin" },
		approvedAt: status === "proposed" ? null : "2026-09-25T10:05:00.000Z",
		resolvedBy: null,
		resolvedAt: null,
		outcome: null,
		proposal: {
			version: 1,
			scope: { organizationId: "org-1", employeeId: worker },
			work: { workPeriodId: periodId, timeRecordId: periodId },
			changes: [
				{ target: "time_record", id: periodId, field: "duration_minutes", before: 200, after: 240 },
			],
			evidence: {
				note: "Signed paper timesheet",
				findings: [
					{
						id: "f1",
						kind: "duration_conflict",
						shape: "conflicting",
						treatment: "review_required",
					},
				],
			},
			uncertainty: { remainingFindings: [] },
			consequences: {
				approval: {
					periodStatus: "approved",
					recordState: "approved",
					effects: ["approved_work_changes", "no_decision_recorded"],
				},
				allocation: { projectIds: [], effects: [] },
				replay: { receiptIds: [], effects: ["committed_replay_returns_recorded_result"] },
				payroll: { effects: ["payable_minutes_change", "finalized_exports_unchanged"] },
				audit: {
					receiptKind: "apply_historical_repair_proposal",
					writer: "historical_repair_proposal",
				},
			},
			expected: {
				period: {
					id: periodId,
					graphRevision: 1,
					startTime: "2026-07-06T06:00:00Z",
					endTime: "2026-07-06T10:00:00Z",
					durationMinutes: 240,
					approvalStatus: "approved",
					hasPendingChanges: false,
					canonicalRecordId: periodId,
					projectId: null,
					workCategoryId: null,
					workLocationType: null,
				},
				record: null,
			},
		},
	};
}

function jsonResponse(status: number, body: unknown) {
	return { ok: status < 400, status, json: async () => body } as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
	fetchMock.mockReset();
	refresh.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function renderPanel(overrides: Partial<Parameters<typeof WorkProposalPanel>[0]> = {}) {
	return render(
		<WorkProposalPanel
			proposals={[]}
			authorized={false}
			employeeLabels={labels}
			repairTargets={[
				{ workPeriodId: periodId, employeeId: worker, findingKinds: ["duration_conflict"] },
			]}
			continuationTargets={[]}
			{...overrides}
		/>,
	);
}

function requestBody(call = 0) {
	return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

describe("WorkProposalPanel", () => {
	it("shows the exact before/after change and approves by the reviewed fingerprint", async () => {
		fetchMock.mockResolvedValue(jsonResponse(200, { status: "approved" }));
		renderPanel({ proposals: [repairProposal("proposed")] });

		const item = screen.getByText("Resolve the July minutes conflict").closest("li") as HTMLElement;
		expect(within(item).getByText("200")).toBeTruthy();
		expect(within(item).getByText("240")).toBeTruthy();
		expect(within(item).getByText(/Proposed by Olga Owner/)).toBeTruthy();
		expect(within(item).queryByRole("button", { name: "Apply" })).toBeNull();

		fireEvent.click(within(item).getByRole("button", { name: "Approve this proposal" }));
		await waitFor(() => expect(refresh).toHaveBeenCalled());
		expect(fetchMock.mock.calls[0][0]).toBe("/api/time-entries/diagnostics/proposals");
		expect(requestBody()).toEqual({ proposalId, action: "approve", fingerprint });
	});

	it("keeps application disabled until the organization authorizes it, and reports staleness", async () => {
		const { rerender } = renderPanel({ proposals: [repairProposal("approved")] });
		expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(
			true,
		);

		fetchMock.mockResolvedValue(jsonResponse(200, { status: "stale" }));
		rerender(
			<WorkProposalPanel
				proposals={[repairProposal("approved")]}
				authorized
				employeeLabels={labels}
				repairTargets={[]}
				continuationTargets={[]}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		expect(await screen.findByText(/Evidence changed since this proposal was made/)).toBeTruthy();
		expect(requestBody()).toEqual({ proposalId, action: "apply" });
	});

	it("requires a note to reject", async () => {
		fetchMock.mockResolvedValue(jsonResponse(200, { status: "rejected" }));
		renderPanel({ proposals: [repairProposal("proposed")] });
		fireEvent.click(screen.getByRole("button", { name: "Reject" }));
		const confirm = screen.getByRole("button", { name: "Reject proposal" }) as HTMLButtonElement;
		expect(confirm.disabled).toBe(true);
		fireEvent.change(screen.getByLabelText("Why is it rejected?"), {
			target: { value: "Timesheet unsigned" },
		});
		fireEvent.click(confirm);
		await waitFor(() => expect(refresh).toHaveBeenCalled());
		expect(requestBody()).toEqual({ proposalId, action: "reject", note: "Timesheet unsigned" });
	});

	it("creates a repair proposal with typed values and requires evidence and a reason", async () => {
		fetchMock.mockResolvedValue(jsonResponse(200, { status: "proposed" }));
		renderPanel();

		fireEvent.click(screen.getByRole("button", { name: "Create proposal" }));
		expect(await screen.findByText("Enter the new value.")).toBeTruthy();
		expect(screen.getByText("Describe the evidence that establishes the new values.")).toBeTruthy();
		expect(fetchMock).not.toHaveBeenCalled();

		fireEvent.change(screen.getByLabelText("New value"), { target: { value: "240" } });
		fireEvent.change(screen.getByLabelText("Evidence for the new values"), {
			target: { value: "Signed paper timesheet" },
		});
		fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Minutes conflict" } });
		fireEvent.click(screen.getByRole("button", { name: "Create proposal" }));

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const body = requestBody();
		expect(body).toEqual({
			action: "propose_repair",
			proposalId: expect.stringMatching(/^[0-9a-f-]{36}$/),
			workPeriodId: periodId,
			changes: [{ target: "time_record", field: "duration_minutes", after: 240 }],
			evidenceNote: "Signed paper timesheet",
			reason: "Minutes conflict",
		});
	});

	it("rejects minutes that are not whole numbers before sending", async () => {
		renderPanel();
		fireEvent.change(screen.getByLabelText("New value"), { target: { value: "abc" } });
		fireEvent.click(screen.getByRole("button", { name: "Create proposal" }));
		expect(await screen.findByText("Enter whole minutes (0 or more).")).toBeTruthy();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("offers only the fields each representation may change", () => {
		renderPanel();
		const target = screen.getByLabelText("Representation");
		const field = screen.getByLabelText("Field") as HTMLSelectElement;
		expect([...field.options].map((option) => option.value)).not.toContain("project_id");
		fireEvent.change(target, { target: { value: "work_period" } });
		const periodFields = [...(screen.getByLabelText("Field") as HTMLSelectElement).options].map(
			(option) => option.value,
		);
		expect(periodFields).toContain("project_id");
		expect(periodFields).not.toContain("end_at");
	});

	it("shows why the server refused a continuation proposal", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(422, { code: "proposal_refused", reasons: ["anchor_has_successor"] }),
		);
		renderPanel({
			repairTargets: [],
			continuationTargets: [
				{ employeeId: worker, candidates: [{ entryId: "e-1", hash: "a".repeat(64) }] },
			],
		});
		fireEvent.change(screen.getByLabelText("Why this anchor is suitable"), {
			target: { value: "Latest reviewed clock-out" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create continuation proposal" }));
		expect(await screen.findByText(/anchor_has_successor/)).toBeTruthy();
		expect(requestBody()).toEqual({
			action: "propose_continuation",
			proposalId: expect.any(String),
			employeeId: worker,
			anchorEntryId: "e-1",
			anchorHash: "a".repeat(64),
			reason: "Latest reviewed clock-out",
		});
	});
});

describe("continuationTargetsOf", () => {
	function report(
		entries: {
			id: string;
			hash: string;
			previousHash: string | null;
			previousEntryId: string | null;
		}[],
		options: {
			lineage?: "review_required" | "single";
			continuity?: "not_adopted" | "established";
		} = {},
	) {
		return {
			entries: entries.map((entry) => ({
				entryId: entry.id,
				stored: {
					hash: entry.hash,
					previousHash: entry.previousHash,
					previousEntryId: entry.previousEntryId,
				},
				hash: "reproduced",
				link: { kind: "root" },
			})),
			lineage: { status: options.lineage ?? "review_required", issues: [] },
			continuity: { status: options.continuity ?? "not_adopted" },
		} as unknown as AppendAssuranceReport;
	}

	it("lists the entries nothing follows for unadmitted histories that need review", () => {
		const entries = [
			{ id: "r", hash: "hr", previousHash: null, previousEntryId: null },
			{ id: "a", hash: "ha", previousHash: "hr", previousEntryId: "r" },
			{ id: "b", hash: "hb", previousHash: "hr", previousEntryId: null },
			{ id: "c", hash: "hc", previousHash: "hb", previousEntryId: null },
		];
		expect(continuationTargetsOf([{ employeeId: worker, report: report(entries) }])).toEqual([
			{
				employeeId: worker,
				candidates: [
					{ entryId: "a", hash: "ha" },
					{ entryId: "c", hash: "hc" },
				],
			},
		]);
		expect(
			continuationTargetsOf([
				{ employeeId: worker, report: report(entries, { lineage: "single" }) },
				{ employeeId: "other", report: report(entries, { continuity: "established" }) },
			]),
		).toEqual([]);
	});
});
