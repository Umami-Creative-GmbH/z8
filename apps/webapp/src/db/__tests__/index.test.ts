import { describe, expect, it } from "vitest";

import {
	approvalInboxProjection,
	approvalOutbox,
	approvalOutboxDelivery,
	approvalOutboxExpansionStatusEnum,
	approvalRequesterProjection,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowCommand,
	approvalWorkflowEvent,
	approvalWorkflowMigrationIssue,
	approvalWorkflowRollout,
	approvalWorkflowStage,
	scimConnectionStateEnum,
	scimOutboxStatusEnum,
	scimProviderConfig,
	scimRoleProjectionState,
	scimSeatSyncOutbox,
	scimUserLifecycleState,
	timeRecord,
	timeRecordAbsence,
	timeRecordAllocation,
	timeRecordApprovalDecision,
	timeRecordWork,
} from "../index";

describe("db barrel exports", () => {
	it("re-exports canonical time record tables", () => {
		expect(timeRecord).toBeDefined();
		expect(timeRecordWork).toBeDefined();
		expect(timeRecordAbsence).toBeDefined();
		expect(timeRecordAllocation).toBeDefined();
		expect(timeRecordApprovalDecision).toBeDefined();
	});

	it("re-exports canonical approval workflow tables", () => {
		for (const table of [
			approvalWorkflow,
			approvalWorkflowStage,
			approvalStageAssignment,
			approvalWorkflowEvent,
			approvalWorkflowCommand,
			approvalRequesterProjection,
			approvalInboxProjection,
			approvalOutbox,
			approvalOutboxDelivery,
			approvalWorkflowRollout,
			approvalWorkflowMigrationIssue,
		]) {
			expect(table).toBeDefined();
		}
		expect(approvalOutboxExpansionStatusEnum.enumValues).toEqual([
			"pending",
			"expanded",
		]);
	});

	it("re-exports managed SCIM application state", () => {
		for (const table of [
			scimProviderConfig,
			scimUserLifecycleState,
			scimRoleProjectionState,
			scimSeatSyncOutbox,
		]) {
			expect(table).toBeDefined();
		}
		expect(scimConnectionStateEnum.enumValues).toContain("decommissioned");
		expect(scimOutboxStatusEnum.enumValues).toEqual([
			"pending",
			"processing",
			"completed",
		]);
	});
});
