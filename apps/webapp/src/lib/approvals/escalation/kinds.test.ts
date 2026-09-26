import { describe, expect, it } from "vitest";
import {
	ESCALATION_WORKFLOW_TYPES,
	isCanonicalEscalationWorkflowType,
	isEscalationWorkflowType,
	isLegacyEscalationEntityType,
	isUntransferableEscalationRoute,
	LEGACY_ESCALATION_ENTITY_TYPES,
	legacyEntityTypeAdmits,
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

	it("transfers legacy absence, expense and time requests (#439)", () => {
		expect(LEGACY_ESCALATION_ENTITY_TYPES).toEqual({
			absence_entry: ["absence"],
			travel_expense_claim: ["travel_expense"],
			time_entry: ["manual_time_submission", "policy_clock_out", "time_correction"],
		});
		expect(legacyEntityTypeAdmits("time_entry", "policy_clock_out")).toBe(true);
		expect(legacyEntityTypeAdmits("time_entry", "absence")).toBe(false);
		expect(legacyEntityTypeAdmits("absence_entry", "time_correction")).toBe(false);
		expect(isLegacyEscalationEntityType("time_entry")).toBe(true);
		expect(isLegacyEscalationEntityType("travel_expense_claim")).toBe(true);
		expect(isLegacyEscalationEntityType("shift_request")).toBe(false);
		expect(isLegacyEscalationEntityType("toString")).toBe(false);
	});

	it("offers management transfers for every transferred kind, never on untransferable holds", () => {
		expect([...ESCALATION_WORKFLOW_TYPES].sort()).toEqual([
			"absence",
			"manual_time_submission",
			"policy_clock_out",
			"time_correction",
			"travel_expense",
		]);
		expect(isEscalationWorkflowType("travel_expense")).toBe(true);
		expect(isEscalationWorkflowType(null)).toBe(false);
		// #326 holds of legacy time requests are re-evaluated since #439.
		expect(isUntransferableEscalationRoute("legacy_time_authority")).toBe(false);
		expect(isUntransferableEscalationRoute("legacy_time_without_legacy_authority")).toBe(true);
		expect(isUntransferableEscalationRoute("legacy_time_unclassified")).toBe(true);
		expect(isUntransferableEscalationRoute("travel_expense_without_legacy_authority")).toBe(true);
		expect(isUntransferableEscalationRoute("legacy_chain_stage")).toBe(false);
		expect(isUntransferableEscalationRoute(undefined)).toBe(false);
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
