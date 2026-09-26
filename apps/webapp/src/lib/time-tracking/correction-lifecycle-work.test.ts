import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { ConflictError } from "@/lib/effect/errors";
import { CompletedWorkCollisionError } from "./close-active-work";
import {
	correctedDurationMinutes,
	deriveTimeCorrectionOperationId,
	resolveCorrectionWorkScope,
	timeCorrectionLifecycleKey,
	translateCorrectionWorkError,
} from "./correction-lifecycle-work";
import { TimeEntryAppendReviewRequiredError } from "./time-entry-append";
import { WorkOccupancyConflictError } from "./work-occupancy";
import { sealWorkTransactionScope } from "./work-transaction";

describe("correction lifecycle receipt identity", () => {
	it("is stable per organization, stage and lifecycle key", () => {
		const input = { organizationId: "org-1", stage: "finalize" as const, key: "canonical:wf-1" };
		const id = deriveTimeCorrectionOperationId(input);

		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(deriveTimeCorrectionOperationId(input)).toBe(id);
		expect(deriveTimeCorrectionOperationId({ ...input, stage: "cancel" })).not.toBe(id);
		expect(deriveTimeCorrectionOperationId({ ...input, organizationId: "org-2" })).not.toBe(id);
	});

	it("keys a legacy chain lifecycle by its chain and a direct request by the request", () => {
		expect(
			timeCorrectionLifecycleKey({
				authority: "legacy",
				approvalRequestId: "request-2",
				chainInstanceId: "chain-1",
				observedWorkflowId: null,
			}),
		).toBe("legacy:chain-1");
		expect(
			timeCorrectionLifecycleKey({
				authority: "legacy",
				approvalRequestId: "request-1",
				chainInstanceId: null,
				observedWorkflowId: "wf-observed",
			}),
		).toBe("legacy:request-1");
		expect(timeCorrectionLifecycleKey({ authority: "canonical", workflowId: "wf-1" })).toBe(
			"canonical:wf-1",
		);
	});
});

describe("approved correction minutes", () => {
	const start = parseInstant("2026-09-01T08:00:00Z");

	it("rounds fresh adopted minutes half up from the exact UTC endpoints", () => {
		expect(correctedDurationMinutes(true, start, parseInstant("2026-09-01T09:00:40Z"))).toBe(61);
		expect(correctedDurationMinutes(true, start, parseInstant("2026-09-01T08:00:29Z"))).toBe(0);
		expect(correctedDurationMinutes(true, start, parseInstant("2026-09-01T08:00:30Z"))).toBe(1);
	});

	it("keeps the legacy floor for organizations that have not adopted", () => {
		expect(correctedDurationMinutes(false, start, parseInstant("2026-09-01T09:00:40Z"))).toBe(60);
		expect(correctedDurationMinutes(false, start, parseInstant("2026-09-01T08:00:30Z"))).toBe(0);
	});
});

describe("adopted correction scope", () => {
	it("is only the append scope of a coordinated transaction", () => {
		const appendClient = {};
		const legacyClient = {};
		sealWorkTransactionScope({
			db: appendClient as never,
			admission: "append" as const,
			assertEmployee: () => undefined,
		});
		sealWorkTransactionScope({
			db: legacyClient as never,
			admission: "legacy" as const,
			assertEmployee: () => undefined,
		});
		const route = { organizationId: "org-1", employeeId: "employee-1" };

		expect(resolveCorrectionWorkScope(appendClient, route)?.admission).toBe("append");
		expect(resolveCorrectionWorkScope(legacyClient, route)).toBeNull();
		expect(resolveCorrectionWorkScope({}, route)).toBeNull();
	});

	it("refuses an employee outside the coordinated scope", () => {
		const client = {};
		sealWorkTransactionScope({
			db: client as never,
			admission: "append" as const,
			assertEmployee: (_organizationId: string, employeeId: string) => {
				if (employeeId !== "employee-1") throw new Error("outside scope");
			},
		});

		expect(() =>
			resolveCorrectionWorkScope(client, { organizationId: "org-1", employeeId: "employee-2" }),
		).toThrow("outside scope");
	});
});

describe("adopted correction outcomes", () => {
	it("answers collisions, occupied intervals and held appends as typed conflicts", () => {
		const collision = translateCorrectionWorkError(new CompletedWorkCollisionError());
		const occupied = translateCorrectionWorkError(new WorkOccupancyConflictError([]));
		const held = translateCorrectionWorkError(
			new TimeEntryAppendReviewRequiredError({
				organizationId: "org-1",
				employeeId: "employee-1",
				reasons: [],
			}),
		);

		expect(collision).toBeInstanceOf(ConflictError);
		expect(collision).toMatchObject({ conflictType: "completed_work_collision" });
		expect(occupied).toMatchObject({
			conflictType: "work_interval_occupied",
			message: "The time range overlaps other recorded work",
		});
		expect(held).toMatchObject({ conflictType: "completed_work_review_required" });
	});

	it("passes other errors through", () => {
		const error = new Error("unexpected");
		expect(translateCorrectionWorkError(error)).toBe(error);
	});
});
