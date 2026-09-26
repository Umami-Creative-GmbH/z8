import type { ImportedWorkProviderEvidence } from "@/lib/time-tracking/imported-work-interval";
import type { ImportProvider } from "./types";

function seconds(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Provider duration evidence from the retained raw source payload (#284). The
 * staged normalized payload carries only the endpoints, so the provider's own
 * statements about duration, breaks and corrections are read from the payload the
 * reviewer staged. Absent or non-numeric fields are "not stated", never zero.
 */
export function importedWorkProviderEvidence(
	provider: ImportProvider,
	sourcePayload: Record<string, unknown>,
): ImportedWorkProviderEvidence {
	switch (provider) {
		case "clockodo":
			return {
				durationSeconds: seconds(sourcePayload.duration),
				breakSeconds: null,
				workSeconds: null,
				correctionSeconds: seconds(sourcePayload.offset),
			};
		case "clockin":
			return {
				durationSeconds: null,
				breakSeconds: seconds(sourcePayload.break_seconds),
				workSeconds: seconds(sourcePayload.work_seconds),
				correctionSeconds: null,
			};
		default:
			throw new Error(`Unsupported import provider: ${String(provider)}`);
	}
}
