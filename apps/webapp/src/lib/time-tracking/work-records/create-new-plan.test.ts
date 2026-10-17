import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { type CreateNewWork, planNewWork } from "./create-new-plan";
import { recordAgreement } from "./record-agreement";

const PROJECT = "00000000-0000-4000-8000-000000000001";
const TASK = "00000000-0000-4000-8000-000000000002";
const CATEGORY = "00000000-0000-4000-8000-000000000003";
const UTC = { utcOffsetMinutes: 0, timezone: "UTC", timezoneSource: "backfill" } as const;

/** 08:00:40 to 17:00:31 UTC: 8h59m51s. */
function change(overrides: Partial<CreateNewWork> = {}): CreateNewWork {
	return {
		kind: "create_new",
		organizationId: "org",
		employeeId: "employee",
		start: { at: parseInstant("2026-07-22T08:00:40Z"), notes: null, capture: UTC },
		end: { at: parseInstant("2026-07-22T17:00:31Z"), notes: null, capture: UTC },
		approval: { state: "approved" },
		origin: "import",
		recordedBy: "user",
		actorUserId: "user",
		entries: { createdBy: "user", ipAddress: null, deviceInfo: null },
		appendOperation: "reviewed_import",
		...overrides,
	};
}

describe("planNewWork (#1223)", () => {
	it("rounds the minutes by the admission's arithmetic: half up in append, floored in legacy", () => {
		const halfUp = planNewWork(change(), "half_up");
		const floor = planNewWork(change(), "floor");

		expect(halfUp).toMatchObject({
			kind: "create_new",
			completed: { durationMinutes: 540, canonical: { record: { durationMinutes: 540 } } },
		});
		expect(floor).toMatchObject({
			kind: "create_new",
			completed: { durationMinutes: 539, canonical: { record: { durationMinutes: 539 } } },
		});
	});

	it("plans an agreeing pending pair with the whole project allocation", () => {
		const plan = planNewWork(
			change({
				attribution: {
					project: { projectId: PROJECT, billableDefault: false },
					billable: true,
					task: TASK,
					workCategoryId: CATEGORY,
					workLocationType: "home",
				},
				approval: {
					state: "pending",
					pendingChanges: {
						originalStartTime: "2026-07-22T08:00:40.000Z",
						originalEndTime: "2026-07-22T17:00:31.000Z",
						originalDurationMinutes: 540,
						requestedAt: "2026-07-23T08:00:00.000Z",
						requestedBy: "user",
					},
				},
			}),
			"half_up",
		);

		if (plan.kind !== "create_new") throw new Error(`refused: ${plan.kind}`);
		const { completed } = plan;
		expect(completed.period).toMatchObject({
			approvalStatus: "pending",
			projectId: PROJECT,
			taskId: TASK,
			isBillable: true,
			workCategoryId: CATEGORY,
			workLocationType: "home",
		});
		expect(completed.canonical.record.approvalState).toBe("pending");
		expect(completed.canonical.allocations).toEqual([
			{
				allocationKind: "project",
				projectId: PROJECT,
				taskId: TASK,
				costCenterId: null,
				weightPercent: 100,
				isBillable: true,
				// New work is never missing a task (#884).
				missingTask: false,
			},
		]);
		expect(recordAgreement(completed.period, completed.canonical)).toEqual({
			agrees: true,
			disagreements: [],
		});
	});

	it("records no attribution and no allocation when none is named", () => {
		const plan = planNewWork(change(), "half_up");

		if (plan.kind !== "create_new") throw new Error(`refused: ${plan.kind}`);
		expect(plan.completed.attribution.project).toBeNull();
		expect(plan.completed.canonical.allocations).toEqual([]);
	});

	it.each([
		["ends before it starts", "2026-07-22T07:00:00Z"],
		["ends at its start", "2026-07-22T08:00:40Z"],
	])("refuses work that %s", (_label, end) => {
		const refusal = planNewWork(
			change({ end: { at: parseInstant(end), notes: null, capture: UTC } }),
			"floor",
		);

		expect(refusal).toEqual({ kind: "interval_invalid" });
	});

	it("refuses billable work without a project", () => {
		expect(planNewWork(change({ attribution: { billable: true } }), "half_up")).toEqual({
			kind: "attribution_unrepresentable",
			reason: "billable_without_project",
		});
	});
});
