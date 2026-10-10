import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { ApprovalWorkflowSnapshot } from "../workflow/ports";
import {
	decidedEarlierStage,
	decideDeputyRight,
	deputyActorLabel,
	deputyDecisionRefusalError,
	isDeputyDecisionRefusal,
} from "./deputy-decision";

const X = "approver-x";
const Y = "deputy-y";
const cover = { approverId: X, absenceId: "absence-1" };

describe("decideDeputyRight", () => {
	it("lets the covering deputy decide for the approver, naming the absence", () => {
		expect(
			decideDeputyRight({
				actorEmployeeId: Y,
				approverEmployeeId: X,
				cover,
				actorDecidedEarlierStage: false,
			}),
		).toEqual({ kind: "deputy", actingFor: { approverEmployeeId: X, absenceId: "absence-1" } });
	});

	it("refuses a deputy who is not covering for the approver", () => {
		expect(
			decideDeputyRight({
				actorEmployeeId: Y,
				approverEmployeeId: X,
				cover: null,
				actorDecidedEarlierStage: false,
			}),
		).toEqual({ kind: "refused", reason: "not_covering" });
	});

	it("refuses when the cover is for someone else than the current approver (after a transfer)", () => {
		expect(
			decideDeputyRight({
				actorEmployeeId: Y,
				approverEmployeeId: "replacement-z",
				cover,
				actorDecidedEarlierStage: false,
			}),
		).toEqual({ kind: "refused", reason: "not_covering" });
	});

	it("refuses the four-eyes case: the deputy already decided an earlier stage", () => {
		expect(
			decideDeputyRight({
				actorEmployeeId: Y,
				approverEmployeeId: X,
				cover,
				actorDecidedEarlierStage: true,
			}),
		).toEqual({ kind: "refused", reason: "four_eyes" });
	});

	it("never makes the approver their own deputy", () => {
		expect(
			decideDeputyRight({
				actorEmployeeId: X,
				approverEmployeeId: X,
				cover: { approverId: X, absenceId: "absence-1" },
				actorDecidedEarlierStage: false,
			}),
		).toEqual({ kind: "refused", reason: "not_covering" });
	});
});

describe("refusal errors", () => {
	it("explains the four-eyes refusal with a message safe to show", () => {
		const error = deputyDecisionRefusalError("four_eyes", {
			actorEmployeeId: Y,
			resource: "absence_entry",
			action: "approve",
		});
		expect(error.message).toBe(
			"You already decided an earlier stage of this request, so you cannot decide it as a deputy",
		);
		expect(isDeputyDecisionRefusal(error.message)).toBe(true);
	});

	it("keeps the generic refusal for someone not covering", () => {
		const error = deputyDecisionRefusalError("not_covering", {
			actorEmployeeId: Y,
			resource: "absence_entry",
			action: "approve",
		});
		expect(error.message).toBe("You are not authorized to decide this request");
	});
});

describe("decidedEarlierStage", () => {
	const at = parseInstant("2026-06-04T10:00:00Z");
	function stage(id: string, sequence: number, assignments: Array<Record<string, unknown>>) {
		return {
			id,
			sequence,
			status: sequence === 1 ? "approved" : "pending",
			assignments: assignments.map((assignment, index) => ({
				id: `${id}-a${index}`,
				stageId: id,
				status: "pending",
				approverEmployeeId: X,
				resolvedAt: null,
				resolvedBy: null,
				assignedAt: at,
				...assignment,
			})),
		};
	}
	function workflow(stages: unknown[]) {
		return { stages } as unknown as ApprovalWorkflowSnapshot;
	}

	it("finds the deputy's approval on an earlier stage", () => {
		const snapshot = workflow([
			stage("s1", 1, [
				{
					approverEmployeeId: Y,
					status: "approved",
					resolvedBy: { kind: "employee", employeeId: Y, userId: null },
				},
			]),
			stage("s2", 2, [{}]),
		]);
		expect(decidedEarlierStage(snapshot, "s2", Y)).toBe(true);
	});

	it("ignores the current and later stages and other deciders", () => {
		const snapshot = workflow([
			stage("s1", 1, [
				{
					status: "approved",
					resolvedBy: { kind: "employee", employeeId: "someone-else", userId: null },
				},
			]),
			stage("s2", 2, [{}]),
		]);
		expect(decidedEarlierStage(snapshot, "s2", Y)).toBe(false);
		expect(decidedEarlierStage(snapshot, "s1", "someone-else")).toBe(false);
	});
});

describe("deputyActorLabel", () => {
	it("reads 'Y (deputy for X)' when acting for someone", () => {
		expect(deputyActorLabel("Yara", "Xaver")).toBe("Yara (deputy for Xaver)");
	});

	it("is just the actor without acting for", () => {
		expect(deputyActorLabel("Yara", null)).toBe("Yara");
	});
});
