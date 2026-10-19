import {
	instantToCanonicalString,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { sameWorkVehicleUse } from "@/lib/time-tracking/vehicle-use/work-vehicle-use";
import type {
	TimeCorrectionRevisionComparison,
	TimeCorrectionSubmittedFacts,
} from "../evidence/time-correction-facts";
import type { ApprovalDatabase } from "../server/types";
import type { ApprovalTriageEvidence } from "../triage-assessment";
import type {
	ApprovalInboxTriageEvidenceResult,
	ApprovalInboxTriageTarget,
} from "./triage-evidence";
export interface TimeCorrectionTriageSnapshot {
	organizationId: string;
	requestId: string;
	workPeriodId: string;
	status: string;
	authority: "compatibility_request" | "canonical_assignment";
	currentAuthority: "legacy" | "canonical";
	comparison: TimeCorrectionRevisionComparison;
	revision: {
		id: string;
		materialFingerprint: string;
		facts: TimeCorrectionSubmittedFacts;
	} | null;
}
export interface TimeCorrectionTriageOptions {
	database?: ApprovalDatabase;
	/** Current database facts, not a reused assessment or a client-provided snapshot. */
	readSnapshot?: (
		target: ApprovalInboxTriageTarget,
	) => Promise<TimeCorrectionTriageSnapshot | null>;
}
type Endpoint = {
	at: string;
	utcOffsetMinutes: number;
	timezone: string | null;
	timezoneSource: string;
};
function localDate(endpoint: Endpoint): string {
	if (
		!Number.isSafeInteger(endpoint.utcOffsetMinutes) ||
		Math.abs(endpoint.utcOffsetMinutes) >= 1440
	)
		throw new Error("Invalid captured offset");
	return parseInstant(endpoint.at)
		.add({ minutes: endpoint.utcOffsetMinutes })
		.toZonedDateTimeISO("UTC")
		.toPlainDate()
		.toString();
}
function verifiedCapture(endpoint: Endpoint): boolean {
	try {
		if (!endpoint.timezone || !endpoint.timezoneSource) return false;
		parseInstant(endpoint.at).toZonedDateTimeISO(endpoint.timezone);
		localDate(endpoint);
		return true;
	} catch {
		return false;
	}
}
export async function loadTimeCorrectionTriageEvidence(
	target: ApprovalInboxTriageTarget,
	options: TimeCorrectionTriageOptions = {},
): Promise<ApprovalInboxTriageEvidenceResult> {
	const unknown = (
		validity: "stale" | "unverifiable" = "unverifiable",
	): ApprovalInboxTriageEvidenceResult => ({
		context: target.context,
		evidence: [
			{
				check: "correction",
				state: "unknown",
				validity,
				context: target.context,
			},
		],
	});
	if (target.requestKind !== "time_correction") return unknown();
	let snapshot: TimeCorrectionTriageSnapshot | null;
	try {
		snapshot = options.readSnapshot
			? await options.readSnapshot(target)
			: await (
					await import("./time-correction-source")
				).readTimeCorrectionTriageSnapshot(target, options.database);
	} catch {
		return unknown();
	}
	if (
		!snapshot?.revision ||
		snapshot.organizationId !== target.context.organizationId ||
		snapshot.requestId !== target.context.requestId ||
		snapshot.workPeriodId !== target.context.entityId ||
		snapshot.status !== "pending" ||
		snapshot.authority !== target.authority
	)
		return unknown();
	const revision = snapshot.revision;
	const context = {
		...target.context,
		revision: `${revision.id}:${revision.materialFingerprint}`,
	};
	if (
		(target.context.revision && target.context.revision !== context.revision) ||
		snapshot.currentAuthority !==
			(target.authority === "canonical_assignment" ? "canonical" : "legacy") ||
		snapshot.comparison.kind !== "current"
	)
		return unknown("stale");
	const facts = revision.facts;
	if (
		facts.organizationId !== context.organizationId ||
		facts.workPeriodId !== context.entityId
	)
		return unknown();
	const assessedAt = instantToCanonicalString(systemClock.nowInstant());
	const attribution = facts.baseline.attribution;
	const attributionComplete =
		!!attribution &&
		["projectId", "workCategoryId", "workLocationType"].every((key) => {
			const value = Object.getOwnPropertyDescriptor(attribution, key)?.value;
			return (
				Object.hasOwn(attribution, key) &&
				(value === null || typeof value === "string")
			);
		});
	const evidence: ApprovalTriageEvidence[] = [];
	const finding = (
		reason: string,
		detail: NonNullable<ApprovalTriageEvidence["facts"]> = {},
	) =>
		evidence.push({
			check: "correction",
			state: "finding",
			validity: "current",
			context,
			assessedAt,
			reason,
			riskLevel: "high",
			facts: { intent: facts.intent, ...detail },
		});
	if (facts.intent === "delete") finding("time_entry_deleted");
	if (
		facts.changeMask.workCategory ||
		(attributionComplete &&
			facts.requested.workCategoryId.kind === "set" &&
			facts.requested.workCategoryId.value !== attribution?.workCategoryId)
	)
		finding("work_category_changed", {
			originalValue: attribution?.workCategoryId,
			proposedValue:
				facts.requested.workCategoryId.kind === "set"
					? facts.requested.workCategoryId.value
					: attribution?.workCategoryId,
		});
	if (
		facts.changeMask.workLocation ||
		(attributionComplete &&
			facts.requested.workLocationType.kind === "set" &&
			facts.requested.workLocationType.value !== attribution?.workLocationType)
	)
		finding("work_location_changed", {
			originalValue: attribution?.workLocationType,
			proposedValue:
				facts.requested.workLocationType.kind === "set"
					? facts.requested.workLocationType.value
					: attribution?.workLocationType,
		});
	if (
		facts.changeMask.vehicleUse ||
		(facts.requested.vehicleUse &&
			!sameWorkVehicleUse(
				facts.requested.vehicleUse.value,
				attribution?.vehicleUse ?? null,
			))
	)
		finding("vehicle_use_changed");
	let complete = attributionComplete;
	for (const [endpoint, original, requested] of [
		["clock_in", facts.baseline.clockIn, facts.requested.clockIn],
		["clock_out", facts.baseline.clockOut, facts.requested.clockOut],
	] as const) {
		if (!original) {
			complete = false;
			continue;
		}
		const proposed = requested ?? original;
		if (!verifiedCapture(original) || !verifiedCapture(proposed))
			complete = false;
		if (!requested) continue;
		if (requested.originalEntryId !== original.entryId) {
			complete = false;
			continue;
		}
		try {
			const originalLocalDate = localDate(original);
			const proposedLocalDate = localDate(proposed);
			const detail = {
				endpoint,
				originalAt: original.at,
				proposedAt: proposed.at,
				originalOffsetMinutes: original.utcOffsetMinutes,
				proposedOffsetMinutes: proposed.utcOffsetMinutes,
				originalLocalDate,
				proposedLocalDate,
			};
			if (original.utcOffsetMinutes !== proposed.utcOffsetMinutes)
				finding("utc_offset_changed", detail);
			if (originalLocalDate !== proposedLocalDate)
				finding("event_local_date_changed", detail);
		} catch {
			complete = false;
		}
	}
	const originalEnd = facts.baseline.clockOut?.at;
	const proposedStart =
		facts.requested.clockIn?.at ?? facts.baseline.clockIn.at;
	const proposedEnd = facts.requested.clockOut?.at ?? originalEnd;
	try {
		if (
			!originalEnd ||
			!proposedEnd ||
			parseInstant(originalEnd).epochNanoseconds <=
				parseInstant(facts.baseline.clockIn.at).epochNanoseconds ||
			(facts.intent !== "delete" &&
				parseInstant(proposedEnd).epochNanoseconds <=
					parseInstant(proposedStart).epochNanoseconds)
		)
			complete = false;
	} catch {
		complete = false;
	}
	if (!complete)
		evidence.push({
			check: "correction",
			state: "unknown",
			validity: "current",
			context,
			assessedAt,
			facts: { limitation: "endpoint_capture_unverified" },
		});
	else if (!evidence.length && originalEnd && proposedEnd)
		evidence.push({
			check: "correction",
			state: "clear",
			validity: "current",
			context,
			assessedAt,
			correction: {
				plainTimeEdit:
					facts.intent === "edit" &&
					!!(facts.requested.clockIn || facts.requested.clockOut),
				originalStart: facts.baseline.clockIn.at,
				originalEnd,
				proposedStart,
				proposedEnd,
			},
		});
	return { context, evidence };
}
