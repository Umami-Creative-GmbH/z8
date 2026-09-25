import { describe, expect, it } from "vitest";
import {
	isCanonicalEscalationWorkflowType,
	isLegacyEscalationEntityType,
	LEGACY_ESCALATION_ENTITY_TYPES,
	TRANSFERABLE_ESCALATION_APPROVAL_TYPES,
	unsupportedCanonicalReplacementRoute,
} from "./kinds";

describe("admitted escalation kinds (#326)", () => {
	it("admits absences and the three time kinds canonically, never expenses or shifts", () => {
		for (const kind of [
			"absence",
			"manual_time_submission",
			"policy_clock_out",
			"time_correction",
		]) {
			expect(isCanonicalEscalationWorkflowType(kind)).toBe(true);
		}
		for (const kind of ["travel_expense", "shift_request", "compliance_exception", null]) {
			expect(isCanonicalEscalationWorkflowType(kind)).toBe(false);
		}
	});

	it("transfers legacy absence and expense requests and only discovers time requests", () => {
		expect(LEGACY_ESCALATION_ENTITY_TYPES).toEqual({
			absence_entry: "absence",
			travel_expense_claim: "travel_expense",
			time_entry: null,
		});
		expect(isLegacyEscalationEntityType("travel_expense_claim")).toBe(true);
		expect(isLegacyEscalationEntityType("shift_request")).toBe(false);
		expect(isLegacyEscalationEntityType("toString")).toBe(false);
	});

	it("offers management transfers for every transferred kind", () => {
		expect([...TRANSFERABLE_ESCALATION_APPROVAL_TYPES].sort()).toEqual([
			"absence",
			"manual_time_submission",
			"policy_clock_out",
			"time_correction",
			"travel_expense",
		]);
	});

	it("holds routes without the representative mirror or beside parallel assignments", () => {
		expect(
			unsupportedCanonicalReplacementRoute({
				workflowType: "policy_clock_out",
				mirror: "canonical_to_legacy",
				pendingSiblingCount: 0,
			}),
		).toBeNull();
		expect(
			unsupportedCanonicalReplacementRoute({
				workflowType: "time_correction",
				mirror: "none",
				pendingSiblingCount: 0,
			}),
		).toBe("time_inbox_requires_compatibility_mirror");
		expect(
			unsupportedCanonicalReplacementRoute({
				workflowType: "absence",
				mirror: "none",
				pendingSiblingCount: 0,
			}),
		).toBe("absence_inbox_requires_compatibility_mirror");
		expect(
			unsupportedCanonicalReplacementRoute({
				workflowType: "manual_time_submission",
				mirror: "canonical_to_legacy",
				pendingSiblingCount: 1,
			}),
		).toBe("parallel_assignments_without_replacement_inbox");
	});
});
