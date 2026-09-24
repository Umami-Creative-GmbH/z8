import { type Instant, instantToCanonicalString, parseInstant } from "@/lib/datetime/temporal-core";
import type { JsonObject } from "./ports";

/**
 * Escalation history of a legacy-authoritative `approval_request` (#299).
 *
 * A legacy transfer changes the request's approver in place, so the request
 * itself must carry the lineage it replaced: which approver held it before
 * each transfer, when it moved and since when it was pending before the first
 * transfer. The escalation journal stays authoritative; this compatibility
 * representation lets the shadow observation rebuild the same history from
 * legacy rows alone and is checked against the journal before any new
 * transfer. It is written only together with the approver change.
 */
export interface LegacyEscalationLineageTransfer {
	/** 0 for the transfer away from the original approver. */
	sequence: number;
	fromApproverEmployeeId: string;
	toApproverEmployeeId: string;
	transferredAt: Instant;
	initiator: "scheduled" | "human";
	/** The management actor of a human transfer; null for the scheduled capability. */
	actorEmployeeId: string | null;
}

export type LegacyEscalationLineage =
	| { kind: "none" }
	| {
			kind: "lineage";
			/** The request's pending instant before its first transfer. */
			pendingSince: Instant;
			transfers: LegacyEscalationLineageTransfer[];
	  }
	| { kind: "malformed" };

const LINEAGE_KEY = "escalation";
const LINEAGE_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function instantOrNull(value: unknown): Instant | null {
	if (typeof value !== "string") return null;
	try {
		return parseInstant(value);
	} catch {
		return null;
	}
}

function readTransfer(value: unknown, expectedSequence: number) {
	if (!isRecord(value)) return null;
	const transferredAt = instantOrNull(value.transferredAt);
	if (
		value.sequence !== expectedSequence ||
		!nonEmpty(value.fromApproverEmployeeId) ||
		!nonEmpty(value.toApproverEmployeeId) ||
		value.fromApproverEmployeeId === value.toApproverEmployeeId ||
		!(
			(value.initiator === "scheduled" && value.actorEmployeeId === null) ||
			(value.initiator === "human" && nonEmpty(value.actorEmployeeId))
		) ||
		!transferredAt
	) {
		return null;
	}
	return {
		sequence: expectedSequence,
		fromApproverEmployeeId: value.fromApproverEmployeeId,
		toApproverEmployeeId: value.toApproverEmployeeId,
		transferredAt,
		initiator: value.initiator,
		actorEmployeeId: value.actorEmployeeId as string | null,
	} satisfies LegacyEscalationLineageTransfer;
}

/** Reads the lineage without guessing: anything unexpected is malformed. */
export function readLegacyEscalationLineage(
	metadata: JsonObject | Record<string, unknown> | null,
): LegacyEscalationLineage {
	if (!metadata || !Object.hasOwn(metadata, LINEAGE_KEY)) {
		return { kind: "none" };
	}
	const lineage = metadata[LINEAGE_KEY];
	if (!isRecord(lineage) || lineage.version !== LINEAGE_VERSION) {
		return { kind: "malformed" };
	}
	const pendingSince = instantOrNull(lineage.pendingSince);
	if (!pendingSince || !Array.isArray(lineage.transfers) || lineage.transfers.length === 0) {
		return { kind: "malformed" };
	}
	const transfers: LegacyEscalationLineageTransfer[] = [];
	for (const [index, value] of lineage.transfers.entries()) {
		const transfer = readTransfer(value, index);
		const previous = transfers[index - 1];
		if (
			!transfer ||
			(previous && previous.toApproverEmployeeId !== transfer.fromApproverEmployeeId)
		) {
			return { kind: "malformed" };
		}
		transfers.push(transfer);
	}
	return { kind: "lineage", pendingSince, transfers };
}

/**
 * Metadata after one more transfer. Unrelated metadata is kept; the original
 * pending instant is recorded by the first transfer and never rewritten.
 */
export function appendLegacyEscalationLineage(
	metadata: JsonObject | Record<string, unknown> | null,
	input: {
		/** The request's current pending instant; used only by the first transfer. */
		pendingSince: Instant;
		transfer: Omit<LegacyEscalationLineageTransfer, "sequence">;
	},
): JsonObject {
	const current = readLegacyEscalationLineage(metadata);
	if (current.kind === "malformed") {
		throw new Error("Legacy escalation lineage is malformed");
	}
	const previous = current.kind === "lineage" ? current.transfers : [];
	const pendingSince = current.kind === "lineage" ? current.pendingSince : input.pendingSince;
	const transfers = [...previous, { ...input.transfer, sequence: previous.length }];
	return {
		...(metadata ?? {}),
		[LINEAGE_KEY]: {
			version: LINEAGE_VERSION,
			pendingSince: instantToCanonicalString(pendingSince),
			transfers: transfers.map((transfer) => ({
				sequence: transfer.sequence,
				fromApproverEmployeeId: transfer.fromApproverEmployeeId,
				toApproverEmployeeId: transfer.toApproverEmployeeId,
				transferredAt: instantToCanonicalString(transfer.transferredAt),
				initiator: transfer.initiator,
				actorEmployeeId: transfer.actorEmployeeId,
			})),
		},
	} as JsonObject;
}
