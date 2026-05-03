import { describe, expect, it } from "vitest";
import { IMPLEMENTATION_CHECKLIST_ITEMS } from "./definition";
import { resolveImplementationChecklistItems } from "./status";

describe("implementation checklist status resolver", () => {
	it("keeps the expected customer rollout checklist order", () => {
		expect(IMPLEMENTATION_CHECKLIST_ITEMS.map((item) => item.id)).toEqual([
			"organization-structure",
			"holidays",
			"work-policies",
			"approval-rules",
			"payroll-readiness",
			"integrations",
			"notifications",
			"employee-import",
		]);
	});

	it("marks automatic items complete from detector output", () => {
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(["holidays", "work-policies", "employee-import"]),
			manualCompleteIds: new Set(),
		});

		expect(items.find((item) => item.id === "holidays")).toMatchObject({
			status: "complete",
			completionSource: "automatic",
		});
		expect(items.find((item) => item.id === "work-policies")).toMatchObject({
			status: "complete",
			completionSource: "automatic",
		});
		expect(items.find((item) => item.id === "employee-import")).toMatchObject({
			status: "complete",
			completionSource: "automatic",
		});
	});

	it("uses manual completion only for manually completable items", () => {
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(),
			manualCompleteIds: new Set(["organization-structure", "approval-rules", "holidays"]),
		});

		expect(items.find((item) => item.id === "organization-structure")).toMatchObject({
			status: "complete",
			completionSource: "manual",
			canToggleManualCompletion: true,
		});
		expect(items.find((item) => item.id === "approval-rules")).toMatchObject({
			status: "complete",
			completionSource: "manual",
			canToggleManualCompletion: true,
		});
		expect(items.find((item) => item.id === "holidays")).toMatchObject({
			status: "not-started",
			completionSource: null,
			canToggleManualCompletion: false,
		});
	});

	it("prefers automatic completion over stale manual state", () => {
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(["integrations"]),
			manualCompleteIds: new Set(["integrations"]),
		});

		expect(items.find((item) => item.id === "integrations")).toMatchObject({
			status: "complete",
			completionSource: "automatic",
		});
	});

	it("returns a progress summary", () => {
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(["holidays", "work-policies"]),
			manualCompleteIds: new Set(["approval-rules"]),
		});

		const completedCount = items.filter((item) => item.status === "complete").length;

		expect(completedCount).toBe(3);
		expect(items).toHaveLength(8);
	});
});
