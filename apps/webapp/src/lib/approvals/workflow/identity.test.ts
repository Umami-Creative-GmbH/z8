import { describe, expect, it } from "vitest";
import {
	deriveApprovalAssignmentId,
	deriveApprovalChildId,
	deriveApprovalEventId,
	deriveApprovalStageId,
	deriveApprovalWorkflowId,
	deriveTimeCorrectionRowId,
} from "./identity";

const organizationId = "org-1";
const workflowId = "10000000-0000-4000-8000-000000000001";
const sourceId = "20000000-0000-4000-8000-000000000001";
const canonicalUuid =
	/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("approval workflow identities", () => {
	it("exports one child derivation path while preserving every existing helper output", () => {
		const expected = {
			stage: "1e73eb85-0d3f-5756-a6f6-f2f76e285ee5",
			assignment: "7e21cf15-399f-52d6-be8b-7175f8ffb168",
			event: "8174ea50-404a-5ea8-9c08-235e49e3054b",
		} as const;
		for (const entityKind of ["stage", "assignment", "event"] as const) {
			const input = {
				organizationId,
				workflowId,
				entityKind,
				allocationKey: "same-key",
			};
			expect(deriveApprovalChildId(input)).toBe(expected[entityKind]);
			const helper =
				entityKind === "stage"
					? deriveApprovalStageId
					: entityKind === "assignment"
						? deriveApprovalAssignmentId
						: deriveApprovalEventId;
			expect(helper(input)).toBe(expected[entityKind]);
		}
	});

	it("scopes child IDs by organization, workflow, entity kind, and allocation key", () => {
		const input = {
			organizationId,
			workflowId,
			entityKind: "stage" as const,
			allocationKey: "same-key",
		};
		const id = deriveApprovalChildId(input);
		const variants = [
			deriveApprovalChildId({ ...input, organizationId: "org-2" }),
			deriveApprovalChildId({
				...input,
				workflowId: "10000000-0000-4000-8000-000000000002",
			}),
			deriveApprovalChildId({ ...input, entityKind: "assignment" }),
			deriveApprovalChildId({ ...input, allocationKey: "other-key" }),
		];

		expect(id).toMatch(canonicalUuid);
		expect(new Set([id, ...variants])).toHaveLength(variants.length + 1);
	});

	it("reproduces the repository's existing assignment and event allocations", () => {
		expect(
			deriveApprovalEventId({
				organizationId,
				workflowId,
				allocationKey: "same-key",
			}),
		).toBe("8174ea50-404a-5ea8-9c08-235e49e3054b");
		expect(
			deriveApprovalAssignmentId({
				organizationId,
				workflowId,
				allocationKey: "same-key",
			}),
		).toBe("7e21cf15-399f-52d6-be8b-7175f8ffb168");
	});

	it("scopes canonical deterministic IDs by every identity component", () => {
		const workflowInput = {
			organizationId,
			workflowType: "absence",
			sourceType: "absence_entry",
			sourceId,
			allocationKey: "legacy-workflow",
		};
		const workflow = deriveApprovalWorkflowId(workflowInput);
		const variants = [
			deriveApprovalWorkflowId({ ...workflowInput, organizationId: "org-2" }),
			deriveApprovalWorkflowId({
				...workflowInput,
				workflowType: "travel_expense",
			}),
			deriveApprovalWorkflowId({ ...workflowInput, sourceType: "other" }),
			deriveApprovalWorkflowId({
				...workflowInput,
				sourceId: "20000000-0000-4000-8000-000000000002",
			}),
			deriveApprovalWorkflowId({ ...workflowInput, allocationKey: "other" }),
		];
		expect(workflow).toBe("bd409b34-9fb9-59d6-bf41-b3604eaecad2");
		expect(workflow).toMatch(canonicalUuid);
		expect(new Set([workflow, ...variants])).toHaveLength(variants.length + 1);

		const scoped = [
			deriveApprovalStageId({
				organizationId,
				workflowId,
				allocationKey: "stage-1",
			}),
			deriveApprovalAssignmentId({
				organizationId,
				workflowId,
				allocationKey: "assignment-1",
			}),
			deriveApprovalEventId({
				organizationId,
				workflowId,
				allocationKey: "event-1",
			}),
		];
		expect(scoped.every((id) => canonicalUuid.test(id))).toBe(true);
		expect(
			deriveApprovalStageId({
				organizationId,
				workflowId,
				allocationKey: "stage-1",
			}),
		).toBe(scoped[0]);
		expect(
			deriveApprovalStageId({
				organizationId: "org-2",
				workflowId,
				allocationKey: "stage-1",
			}),
		).not.toBe(scoped[0]);
		expect(
			deriveApprovalStageId({
				organizationId,
				workflowId: "10000000-0000-4000-8000-000000000002",
				allocationKey: "stage-1",
			}),
		).not.toBe(scoped[0]);
	});

	it("keeps one source cycle stable while assigning another cycle a distinct workflow", () => {
		const cycle = {
			organizationId,
			workflowType: "time_correction",
			sourceType: "time_entry",
			sourceId,
			allocationKey: "correction-cycle-1",
		};

		const first = deriveApprovalWorkflowId(cycle);
		expect(deriveApprovalWorkflowId({ ...cycle })).toBe(first);
		expect(
			deriveApprovalWorkflowId({
				...cycle,
				allocationKey: "correction-cycle-2",
			}),
		).not.toBe(first);
	});

	it("isolates deterministic correction rows from existing identity namespaces", () => {
		const input = {
			submissionKey: "time-correction-submission:v1:stable",
			endpointType: "clock_in" as const,
		};
		const clockInId = deriveTimeCorrectionRowId(input);

		expect(clockInId).toMatch(canonicalUuid);
		expect(deriveTimeCorrectionRowId({ ...input })).toBe(clockInId);
		expect(
			deriveTimeCorrectionRowId({ ...input, endpointType: "clock_out" }),
		).not.toBe(clockInId);
		expect(clockInId).not.toBe(
			deriveApprovalEventId({
				organizationId,
				workflowId,
				allocationKey: input.submissionKey,
			}),
		);
	});
});
