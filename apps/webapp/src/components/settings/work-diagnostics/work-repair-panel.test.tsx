/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoricalGapRepairPlan } from "@/lib/time-tracking/historical-gap-repair";
import { WorkRepairPanel } from "./work-repair-panel";

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
const fingerprint = "f".repeat(64);

const plan: HistoricalGapRepairPlan = {
	version: 1,
	employees: [
		{
			employeeId: worker,
			fingerprint,
			units: [
				{
					employeeId: worker,
					workPeriodId: periodId,
					canonicalRecordId: periodId,
					expected: {
						period: {
							graphRevision: 0,
							canonicalRecordId: null,
							endTime: "2026-07-02T16:00:00Z",
							durationMinutes: 480,
							approvalStatus: "approved",
						},
						record: null,
					},
					fills: [
						{
							kind: "canonical_record",
							findingId: `canonical_missing:${periodId}`,
							recordId: periodId,
							record: {
								startAt: "2026-07-02T08:00:00Z",
								endAt: "2026-07-02T16:00:00Z",
								durationMinutes: 480,
								approvalState: "approved",
							},
							detail: { workCategoryId: null, workLocationType: null },
							projectId: null,
						},
					],
					originalActor: {
						kind: "human",
						userId: "worker-user",
						evidence: { entryId: "e1", side: "end" },
					},
					fingerprint: "a".repeat(64),
				},
			],
		},
	],
	held: [
		{
			findingId: "duration_missing:b0000000-0000-4000-8000-000000000002",
			kind: "duration_missing",
			employeeIds: [worker],
			workPeriodIds: ["b0000000-0000-4000-8000-000000000002"],
			timeRecordIds: [],
			reason: "original_rule_unknown",
			heldBy: [],
		},
	],
};

const props = {
	plan,
	period: { startDate: "2026-07-01", endDate: "2026-07-31" },
	selectedEmployeeId: worker,
	employeeLabels: { [worker]: "Wanda Worker" },
};

describe("WorkRepairPanel", () => {
	const fetchMock = vi.fn();
	beforeEach(() => {
		fetchMock.mockReset();
		refresh.mockReset();
		vi.stubGlobal("fetch", fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	it("shows the plan and held gaps but cannot repair without authorization", () => {
		render(<WorkRepairPanel {...props} authorized={false} />);

		expect(screen.getByText("Not authorized")).toBeTruthy();
		expect(screen.getByText("Wanda Worker")).toBeTruthy();
		expect(screen.getByText("Create time record")).toBeTruthy();
		expect(screen.getByText("Author of the clock-out entry")).toBeTruthy();
		expect(
			screen.getByText("No representation holds the minutes; the original rounding is unknown"),
		).toBeTruthy();
		expect(
			(screen.getByRole("button", { name: "Repair 1 work periods" }) as HTMLButtonElement).disabled,
		).toBe(true);
		expect((screen.getByLabelText("Reason") as HTMLTextAreaElement).disabled).toBe(true);
	});

	it("requires a reason, sends the reviewed plan identity and reports a stale plan", async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ outcomes: [{ employeeId: worker, status: "stale" }] }), {
				status: 200,
			}),
		);
		render(<WorkRepairPanel {...props} authorized />);

		fireEvent.click(screen.getByRole("button", { name: "Repair 1 work periods" }));
		expect(await screen.findByText("Enter the reason for this repair.")).toBeTruthy();
		expect(fetchMock).not.toHaveBeenCalled();

		fireEvent.change(screen.getByLabelText("Reason"), {
			target: { value: "  Restore missing July records  " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Repair 1 work periods" }));

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("/api/time-entries/diagnostics/repair");
		expect(JSON.parse(init.body)).toEqual({
			action: "apply",
			startDate: "2026-07-01",
			endDate: "2026-07-31",
			employeeId: worker,
			expected: [{ employeeId: worker, fingerprint }],
			reason: "Restore missing July records",
		});
		expect(
			await screen.findByText(
				"Wanda Worker: Evidence changed since this plan was read. Nothing was written; review the refreshed plan.",
			),
		).toBeTruthy();
		expect(refresh).toHaveBeenCalled();
	});

	it("reports a refused authorization from the server", async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ code: "repair_not_authorized" }), { status: 409 }),
		);
		render(<WorkRepairPanel {...props} authorized />);

		fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Repair" } });
		fireEvent.click(screen.getByRole("button", { name: "Repair 1 work periods" }));

		expect(
			await screen.findByText("Repair has not been authorized for this organization."),
		).toBeTruthy();
		expect(refresh).not.toHaveBeenCalled();
	});
});
