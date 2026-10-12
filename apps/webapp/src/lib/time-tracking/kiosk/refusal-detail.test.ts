import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { kioskRefusalDetail } from "./refusal-detail";

describe("what a kiosk receives of a Clocking refusal (#761)", () => {
	it("keeps the detail each code names, instants as UTC strings", () => {
		expect(
			kioskRefusalDetail({
				code: "already_clocked_in",
				since: parseInstant("2026-07-22T06:00:00Z"),
			}),
		).toEqual({ code: "already_clocked_in", since: "2026-07-22T06:00:00Z" });
		expect(kioskRefusalDetail({ code: "holiday_blocked", holidayName: "Labour Day" })).toEqual({
			code: "holiday_blocked",
			holidayName: "Labour Day",
		});
		expect(kioskRefusalDetail({ code: "billing_required", reason: "trial_expired" })).toEqual({
			code: "billing_required",
			reason: "trial_expired",
		});
		expect(kioskRefusalDetail({ code: "under_review", review: "approval" })).toEqual({
			code: "under_review",
			review: "approval",
		});
	});

	it("sends nothing else to the unauthenticated device", () => {
		expect(
			kioskRefusalDetail({ code: "failed", cause: new Error("connection to 10.0.0.5 refused") }),
		).toEqual({ code: "failed" });
		expect(
			kioskRefusalDetail({ code: "append_review_required", requirement: { policyId: "p-1" } }),
		).toEqual({ code: "append_review_required" });
		expect(
			kioskRefusalDetail({ code: "task_not_allowed", reason: { kind: "archived", taskId: "t-1" } }),
		).toEqual({ code: "task_not_allowed" });
		expect(
			kioskRefusalDetail({ code: "holiday_blocked", holidayName: "Labour Day", employeeId: "e-1" }),
		).toEqual({ code: "holiday_blocked", holidayName: "Labour Day" });
	});
});
