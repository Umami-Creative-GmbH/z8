import { Effect } from "effect";
import { ValidationError } from "@/lib/effect/errors";
import { DRIVING_LICENCE_STALE_PREVIEW } from "./intended-driver-rules";

/**
 * A save whose outcome no longer matches the driving licence preview its viewer confirmed
 * (#1425): it would end other authorizations than the warning showed, or ends some without a
 * confirmed warning.
 */
export class DrivingLicenceStalePreviewError extends Error {
	constructor() {
		super(DRIVING_LICENCE_STALE_PREVIEW);
		this.name = "DrivingLicenceStalePreviewError";
	}
}

/** Whether `error`, or an error it wraps (e.g. a `DatabaseError`), is a stale preview. */
export function isDrivingLicenceStalePreview(error: unknown): boolean {
	let current = error;
	for (let depth = 0; current && depth < 5; depth++) {
		if (current instanceof DrivingLicenceStalePreviewError) return true;
		current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
	}
	return false;
}

/**
 * For actions outside driving licence control (team and employee saves): a stale preview
 * refuses as a `ValidationError` with `refusal: "stale_preview"`, which the screens map to
 * their own copy.
 */
export function keepDrivingLicenceStalePreview<A, E, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | ValidationError, R> {
	return effect.pipe(
		Effect.mapError((error) =>
			isDrivingLicenceStalePreview(error)
				? new ValidationError({
						message:
							"Who this change affects has changed in the meantime. Review it and try again.",
						field: "drivingLicencePreviewToken",
						refusal: DRIVING_LICENCE_STALE_PREVIEW,
					})
				: error,
		),
	);
}
