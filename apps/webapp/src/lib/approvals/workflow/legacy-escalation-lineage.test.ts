import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	appendLegacyEscalationLineage,
	readLegacyEscalationLineage,
} from "./legacy-escalation-lineage";

const approverA = "30000000-0000-4000-8000-00000000000a";
const approverB = "30000000-0000-4000-8000-00000000000b";
const approverC = "30000000-0000-4000-8000-00000000000c";
const managerD = "30000000-0000-4000-8000-00000000000d";
const pendingSince = parseInstant("2026-09-01T08:00:00Z");
const firstTransfer = parseInstant("2026-09-03T08:00:00Z");
const secondTransfer = parseInstant("2026-09-05T09:30:00Z");

describe("legacy escalation lineage on approval_request.metadata", () => {
	it("reads a request that was never transferred as having no lineage", () => {
		expect(readLegacyEscalationLineage(null)).toEqual({ kind: "none" });
		expect(readLegacyEscalationLineage({ source: "absence" })).toEqual({ kind: "none" });
	});

	it("appends the first transfer, keeping unrelated metadata and the prior pending instant", () => {
		const metadata = appendLegacyEscalationLineage(
			{ source: "absence" },
			{
				pendingSince,
				transfer: {
					fromApproverEmployeeId: approverA,
					toApproverEmployeeId: approverB,
					transferredAt: firstTransfer,
					initiator: "scheduled",
					actorEmployeeId: null,
				},
			},
		);

		expect(metadata).toEqual({
			source: "absence",
			escalation: {
				version: 1,
				pendingSince: "2026-09-01T08:00:00Z",
				transfers: [
					{
						sequence: 0,
						fromApproverEmployeeId: approverA,
						toApproverEmployeeId: approverB,
						transferredAt: "2026-09-03T08:00:00Z",
						initiator: "scheduled",
						actorEmployeeId: null,
					},
				],
			},
		});
		expect(readLegacyEscalationLineage(metadata)).toEqual({
			kind: "lineage",
			pendingSince,
			transfers: [
				{
					sequence: 0,
					fromApproverEmployeeId: approverA,
					toApproverEmployeeId: approverB,
					transferredAt: firstTransfer,
					initiator: "scheduled",
					actorEmployeeId: null,
				},
			],
		});
	});

	it("appends a later transfer with the next sequence and never rewrites the original pending instant", () => {
		const once = appendLegacyEscalationLineage(null, {
			pendingSince,
			transfer: {
				fromApproverEmployeeId: approverA,
				toApproverEmployeeId: approverB,
				transferredAt: firstTransfer,
				initiator: "human",
				actorEmployeeId: managerD,
			},
		});
		const twice = appendLegacyEscalationLineage(once, {
			pendingSince: firstTransfer,
			transfer: {
				fromApproverEmployeeId: approverB,
				toApproverEmployeeId: approverC,
				transferredAt: secondTransfer,
				initiator: "scheduled",
				actorEmployeeId: null,
			},
		});

		const read = readLegacyEscalationLineage(twice);
		expect(read.kind).toBe("lineage");
		if (read.kind !== "lineage") return;
		expect(read.pendingSince.toString()).toBe("2026-09-01T08:00:00Z");
		expect(read.transfers.map((entry) => [entry.sequence, entry.toApproverEmployeeId])).toEqual([
			[0, approverB],
			[1, approverC],
		]);
	});

	it("refuses to append to a lineage it cannot read", () => {
		expect(() =>
			appendLegacyEscalationLineage(
				{ escalation: { version: 2 } },
				{
					pendingSince,
					transfer: {
						fromApproverEmployeeId: approverA,
						toApproverEmployeeId: approverB,
						transferredAt: firstTransfer,
						initiator: "human",
						actorEmployeeId: managerD,
					},
				},
			),
		).toThrow();
	});

	it.each([
		[
			"unknown version",
			{ escalation: { version: 2, pendingSince: "2026-09-01T08:00:00Z", transfers: [] } },
		],
		[
			"empty transfers",
			{ escalation: { version: 1, pendingSince: "2026-09-01T08:00:00Z", transfers: [] } },
		],
		[
			"sequence gap",
			{
				escalation: {
					version: 1,
					pendingSince: "2026-09-01T08:00:00Z",
					transfers: [
						{
							sequence: 1,
							fromApproverEmployeeId: approverA,
							toApproverEmployeeId: approverB,
							transferredAt: "2026-09-03T08:00:00Z",
							initiator: "human",
							actorEmployeeId: managerD,
						},
					],
				},
			},
		],
		[
			"broken chain of approvers",
			{
				escalation: {
					version: 1,
					pendingSince: "2026-09-01T08:00:00Z",
					transfers: [
						{
							sequence: 0,
							fromApproverEmployeeId: approverA,
							toApproverEmployeeId: approverB,
							transferredAt: "2026-09-03T08:00:00Z",
							initiator: "human",
							actorEmployeeId: managerD,
						},
						{
							sequence: 1,
							fromApproverEmployeeId: approverC,
							toApproverEmployeeId: approverA,
							transferredAt: "2026-09-05T08:00:00Z",
							initiator: "human",
							actorEmployeeId: managerD,
						},
					],
				},
			},
		],
		["not an object", { escalation: "transferred" }],
		[
			"human transfer without its actor",
			{
				escalation: {
					version: 1,
					pendingSince: "2026-09-01T08:00:00Z",
					transfers: [
						{
							sequence: 0,
							fromApproverEmployeeId: approverA,
							toApproverEmployeeId: approverB,
							transferredAt: "2026-09-03T08:00:00Z",
							initiator: "human",
							actorEmployeeId: null,
						},
					],
				},
			},
		],
		[
			"scheduled transfer attributed to a person",
			{
				escalation: {
					version: 1,
					pendingSince: "2026-09-01T08:00:00Z",
					transfers: [
						{
							sequence: 0,
							fromApproverEmployeeId: approverA,
							toApproverEmployeeId: approverB,
							transferredAt: "2026-09-03T08:00:00Z",
							initiator: "scheduled",
							actorEmployeeId: managerD,
						},
					],
				},
			},
		],
	])("reports a %s as malformed rather than guessing", (_label, metadata) => {
		expect(readLegacyEscalationLineage(metadata).kind).toBe("malformed");
	});
});
