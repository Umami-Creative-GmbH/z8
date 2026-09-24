import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { appendLegacyEscalationLineage } from "../workflow/legacy-escalation-lineage";
import type { JsonObject } from "../workflow/ports";
import {
	automaticEscalationOperationKey,
	classifyLegacyAssignmentEvidence,
	decideAutomaticEscalation,
	type LegacyJournalTransferFact,
	legacyAutomaticEscalationOperationKey,
} from "./transfer-evaluation";

const requestId = "90000000-0000-4000-8000-000000000001";
const approverA = "30000000-0000-4000-8000-00000000000a";
const approverB = "30000000-0000-4000-8000-00000000000b";
const approverC = "30000000-0000-4000-8000-00000000000c";
const createdAt = parseInstant("2026-09-01T08:00:00Z");
const firstTransfer = parseInstant("2026-09-03T08:00:00Z");
const secondTransfer = parseInstant("2026-09-05T08:00:00Z");
const policy = { enabled: true, responseWindowHours: 48, revision: 4 };

function journal(
	sourceSequence: number,
	from: string,
	to: string,
	transferredAt = firstTransfer,
	initiator: LegacyJournalTransferFact["initiator"] = "scheduled",
): LegacyJournalTransferFact {
	return {
		sourceSequence,
		sourceApproverEmployeeId: from,
		replacementApproverEmployeeId: to,
		transferredAt,
		initiator,
	};
}

function lineageMetadata(
	transfers: Array<[string, string, typeof firstTransfer, "scheduled" | "human"]>,
): JsonObject | null {
	let metadata: JsonObject | null = null;
	for (const [from, to, at, initiator] of transfers) {
		metadata = appendLegacyEscalationLineage(metadata, {
			pendingSince: createdAt,
			transfer: {
				fromApproverEmployeeId: from,
				toApproverEmployeeId: to,
				transferredAt: at,
				initiator,
				actorEmployeeId: initiator === "human" ? approverC : null,
			},
		});
	}
	return metadata;
}

function request(approverId: string, metadata: JsonObject | null = null) {
	return { id: requestId, approverId, createdAt, metadata };
}

describe("classifyLegacyAssignmentEvidence", () => {
	it("starts an untransferred request's clock at its persisted creation", () => {
		expect(
			classifyLegacyAssignmentEvidence({
				request: request(approverA),
				transfers: [],
				teamsEscalationAttempted: false,
			}),
		).toEqual({
			kind: "established",
			sourceSequence: 0,
			actionableAt: createdAt,
			actionableEvidence: "legacy_request_created_at",
			automaticTransferConsumed: false,
		});
	});

	it("starts a replacement's clock at its journaled transfer and records a consumed allowance", () => {
		const evidence = classifyLegacyAssignmentEvidence({
			request: request(approverB, lineageMetadata([[approverA, approverB, firstTransfer, "scheduled"]])),
			transfers: [journal(0, approverA, approverB)],
			teamsEscalationAttempted: false,
		});

		expect(evidence).toEqual({
			kind: "established",
			sourceSequence: 1,
			actionableAt: firstTransfer,
			actionableEvidence: "legacy_transfer_at",
			automaticTransferConsumed: true,
		});
	});

	it("keeps the allowance after a human transfer, which does not consume it", () => {
		const evidence = classifyLegacyAssignmentEvidence({
			request: request(
				approverC,
				lineageMetadata([
					[approverA, approverB, firstTransfer, "human"],
					[approverB, approverC, secondTransfer, "human"],
				]),
			),
			transfers: [
				journal(1, approverB, approverC, secondTransfer, "human"),
				journal(0, approverA, approverB, firstTransfer, "human"),
			],
			teamsEscalationAttempted: false,
		});

		expect(evidence).toMatchObject({
			kind: "established",
			sourceSequence: 2,
			actionableAt: secondTransfer,
			automaticTransferConsumed: false,
		});
	});

	it("holds a request that a Teams channel checker may have moved", () => {
		expect(
			classifyLegacyAssignmentEvidence({
				request: request(approverA),
				transfers: [],
				teamsEscalationAttempted: true,
			}),
		).toMatchObject({ kind: "ambiguous", cause: "teams_escalation_attempt" });
	});

	it("holds when the journal has a transfer the request does not represent", () => {
		expect(
			classifyLegacyAssignmentEvidence({
				request: request(approverB),
				transfers: [journal(0, approverA, approverB)],
				teamsEscalationAttempted: false,
			}),
		).toMatchObject({ kind: "ambiguous", cause: "journal_representation_mismatch" });
	});

	it("holds when the request represents a transfer the journal never committed", () => {
		expect(
			classifyLegacyAssignmentEvidence({
				request: request(approverB, lineageMetadata([[approverA, approverB, firstTransfer, "scheduled"]])),
				transfers: [],
				teamsEscalationAttempted: false,
			}),
		).toMatchObject({ kind: "ambiguous", cause: "journal_representation_mismatch" });
	});

	it("holds when the journaled transfers name different approvers than the request", () => {
		expect(
			classifyLegacyAssignmentEvidence({
				request: request(approverB, lineageMetadata([[approverA, approverB, firstTransfer, "scheduled"]])),
				transfers: [journal(0, approverC, approverB)],
				teamsEscalationAttempted: false,
			}),
		).toMatchObject({ kind: "ambiguous", cause: "journal_representation_mismatch" });
	});

	it("holds when the current approver is not the last replacement", () => {
		expect(
			classifyLegacyAssignmentEvidence({
				request: request(approverC, lineageMetadata([[approverA, approverB, firstTransfer, "scheduled"]])),
				transfers: [journal(0, approverA, approverB)],
				teamsEscalationAttempted: false,
			}),
		).toMatchObject({ kind: "ambiguous", cause: "compatibility_approver_mismatch" });
	});

	it("holds an unreadable lineage", () => {
		expect(
			classifyLegacyAssignmentEvidence({
				request: request(approverA, { escalation: { version: 9 } }),
				transfers: [],
				teamsEscalationAttempted: false,
			}),
		).toMatchObject({ kind: "ambiguous", cause: "malformed_lineage" });
	});
});

describe("legacy automatic escalation decisions", () => {
	it("transfers an untransferred request exactly at its deadline", () => {
		const evidence = classifyLegacyAssignmentEvidence({
			request: request(approverA),
			transfers: [],
			teamsEscalationAttempted: false,
		});

		expect(
			decideAutomaticEscalation({
				evidence,
				policy,
				now: parseInstant("2026-09-03T07:59:59Z"),
				unsupportedRoute: null,
				orderedCandidates: [],
			}).kind,
		).toBe("not_due");
		expect(
			decideAutomaticEscalation({
				evidence,
				policy,
				now: parseInstant("2026-09-03T08:00:00Z"),
				unsupportedRoute: null,
				orderedCandidates: [
					{ employeeId: approverB, isPrimary: true, relationshipSince: null, hasDecisionPath: true },
				],
			}),
		).toEqual({
			kind: "transfer",
			recipientEmployeeId: approverB,
			deadlineAt: parseInstant("2026-09-03T08:00:00Z"),
			policyRevision: 4,
		});
	});

	it("holds an overdue replacement after the lineage's automatic transfer", () => {
		const evidence = classifyLegacyAssignmentEvidence({
			request: request(approverB, lineageMetadata([[approverA, approverB, firstTransfer, "scheduled"]])),
			transfers: [journal(0, approverA, approverB)],
			teamsEscalationAttempted: false,
		});

		expect(
			decideAutomaticEscalation({
				evidence,
				policy,
				now: parseInstant("2026-09-06T08:00:00Z"),
				unsupportedRoute: null,
				orderedCandidates: [],
			}),
		).toMatchObject({
			kind: "hold",
			reason: "replacement_overdue",
			evidence: { actionableEvidence: "legacy_transfer_at" },
		});
	});
});

describe("legacyAutomaticEscalationOperationKey", () => {
	it("identifies the request, lineage position and source approver, never time or the replacement", () => {
		expect(
			legacyAutomaticEscalationOperationKey({
				approvalRequestId: requestId,
				sourceSequence: 1,
				sourceApproverEmployeeId: approverB,
			}),
		).toBe(`escalation:auto:legacy:v1:${requestId}:1:${approverB}`);
	});

	it("cannot collide with a canonical automatic operation", () => {
		const legacy = legacyAutomaticEscalationOperationKey({
			approvalRequestId: requestId,
			sourceSequence: 0,
			sourceApproverEmployeeId: approverA,
		});
		const canonical = automaticEscalationOperationKey({
			workflowId: requestId,
			stageId: requestId,
			lineageRootAssignmentId: requestId,
			sourceAssignmentId: approverA,
		});
		expect(legacy).not.toBe(canonical);
	});
});
