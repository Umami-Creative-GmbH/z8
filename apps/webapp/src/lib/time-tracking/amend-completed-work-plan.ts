/**
 * Pure planning for amending completed work (#286 / T22). Given the locked
 * source segment and the caller's intent, it decides what changes and derives
 * the resulting segment. It never reads storage.
 *
 * - Endpoint intents are absolute: `set` names the wanted instant, so a retry of
 *   the same submission produces the same intent after the first attempt
 *   committed. A `set` equal to the current instant (or, at minute precision,
 *   to its minute) changes nothing.
 * - Fresh minutes come from the exact UTC endpoints (nearest minute, half up)
 *   only when an endpoint moves. Metadata-only changes keep the stored,
 *   possibly historical, minutes.
 * - Attribution omission preserves, `clear` clears and `replace` replaces;
 *   replacing with the current value changes nothing.
 */
import type { Instant } from "@/lib/datetime/temporal-core";
import type { AttributionIntent } from "./close-active-work";
import { validateTimeCorrectionRange } from "./time-correction-temporal";
import { deriveWorkDurationMinutes } from "./work-duration";
import { isWorkLocationType, normalizeWorkLocationType } from "./work-location";

/**
 * `minute` is a wall-clock minute from an editing form: an endpoint whose stored
 * instant falls within that minute keeps its exact stored instant.
 */
export type EndpointIntent =
	| { kind: "preserve" }
	| { kind: "set"; at: Instant; precision: "exact" | "minute" };

export interface AmendmentIntent {
	clockIn: EndpointIntent;
	clockOut: EndpointIntent;
	project: AttributionIntent;
	workCategory: AttributionIntent;
	workLocation: AttributionIntent;
}

export interface AmendmentSource {
	startAt: Instant;
	endAt: Instant;
	durationMinutes: number | null;
	projectId: string | null;
	workCategoryId: string | null;
	workLocationType: string | null;
}

export interface AmendmentPlan {
	changes: {
		clockIn: boolean;
		clockOut: boolean;
		project: boolean;
		workCategory: boolean;
		workLocation: boolean;
	};
	result: {
		startAt: Instant;
		endAt: Instant;
		durationMinutes: number | null;
		projectId: string | null;
		workCategoryId: string | null;
		workLocationType: string | null;
	};
}

export class AmendmentNoChangeError extends Error {
	constructor() {
		super("At least one correction value must change");
		this.name = "AmendmentNoChangeError";
	}
}

export class AmendmentRangeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AmendmentRangeError";
	}
}

function resolveEndpoint(intent: EndpointIntent, current: Instant) {
	if (intent.kind === "preserve") return { changed: false, value: current };
	const unchanged =
		intent.precision === "minute"
			? intent.at.equals(current.round({ smallestUnit: "minute", roundingMode: "floor" }))
			: intent.at.equals(current);
	return unchanged ? { changed: false, value: current } : { changed: true, value: intent.at };
}

function resolveAttribution(
	intent: AttributionIntent,
	current: string | null,
	same: (left: string | null, right: string | null) => boolean = (left, right) => left === right,
) {
	const value = intent.kind === "preserve" ? current : intent.kind === "clear" ? null : intent.id;
	return same(value, current) ? { changed: false, value: current } : { changed: true, value };
}

export type AttributionSource = Pick<
	AmendmentSource,
	"projectId" | "workCategoryId" | "workLocationType"
>;
type AttributionChanges = Pick<
	AmendmentPlan["changes"],
	"project" | "workCategory" | "workLocation"
>;

function resolveAttributions(
	source: AttributionSource,
	intent: Pick<AmendmentIntent, "project" | "workCategory" | "workLocation">,
) {
	if (intent.workLocation.kind === "replace" && !isWorkLocationType(intent.workLocation.id)) {
		throw new AmendmentRangeError("Invalid work location type");
	}
	const project = resolveAttribution(intent.project, source.projectId);
	const workCategory = resolveAttribution(intent.workCategory, source.workCategoryId);
	// Legacy rows may hold no location or a retired alias; the UI shows and
	// submits the normalized value, which is not a change.
	const workLocation = resolveAttribution(
		intent.workLocation,
		source.workLocationType,
		(value, current) =>
			value === current || (value !== null && value === normalizeWorkLocationType(current)),
	);
	return {
		changes: {
			project: project.changed,
			workCategory: workCategory.changed,
			workLocation: workLocation.changed,
		} satisfies AttributionChanges,
		result: {
			projectId: project.value,
			workCategoryId: workCategory.value,
			workLocationType: workLocation.value,
		} satisfies AttributionSource,
	};
}

/** Attribution-only change, e.g. of active work that has no end yet. */
export function planAttributionChange(
	source: AttributionSource,
	intent: Pick<AmendmentIntent, "project" | "workCategory" | "workLocation">,
): { changes: AttributionChanges; result: AttributionSource } {
	const planned = resolveAttributions(source, intent);
	if (!planned.changes.project && !planned.changes.workCategory && !planned.changes.workLocation) {
		throw new AmendmentNoChangeError();
	}
	return planned;
}

export function planCompletedWorkAmendment(
	source: AmendmentSource,
	intent: AmendmentIntent,
): AmendmentPlan {
	const attribution = resolveAttributions(source, intent);
	const clockIn = resolveEndpoint(intent.clockIn, source.startAt);
	const clockOut = resolveEndpoint(intent.clockOut, source.endAt);

	const endpointsChanged = clockIn.changed || clockOut.changed;
	if (
		!endpointsChanged &&
		!attribution.changes.project &&
		!attribution.changes.workCategory &&
		!attribution.changes.workLocation
	) {
		throw new AmendmentNoChangeError();
	}

	let durationMinutes = source.durationMinutes;
	if (endpointsChanged) {
		durationMinutes = deriveWorkDurationMinutes(clockIn.value, clockOut.value);
		try {
			// The established correction range rule (at most 24 elapsed hours).
			validateTimeCorrectionRange(clockIn.value, clockOut.value);
		} catch (error) {
			throw new AmendmentRangeError(
				error instanceof Error ? error.message : "Invalid work period range",
			);
		}
	}

	return {
		changes: {
			clockIn: clockIn.changed,
			clockOut: clockOut.changed,
			...attribution.changes,
		},
		result: {
			startAt: clockIn.value,
			endAt: clockOut.value,
			durationMinutes,
			...attribution.result,
		},
	};
}
