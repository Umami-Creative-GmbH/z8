/**
 * The publication's own publish-block refusal (#1993, #2026): a `ValidationError` with the
 * `STATUTORY_PUBLICATION_BLOCKED` refusal, as every caller and client already reads it. Its
 * blocking findings concern every employee in the range, so they ride on their own field, which
 * `toServerActionResult` never serializes: only the Scheduling action lists them, scoped to its
 * viewer.
 */
import { ValidationError } from "@/lib/effect/errors";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import { STATUTORY_PUBLICATION_BLOCKED } from "./publication-block";

export class StatutoryPublicationBlockedError extends ValidationError {
	/** Unscoped: list them for a viewer (`scheduleStatutoryFindingsFor`), never send them as is. */
	readonly blockingFindings: readonly StatutoryComplianceFinding[];

	constructor(input: {
		readonly message: string;
		readonly blockingFindings: readonly StatutoryComplianceFinding[];
	}) {
		super({ message: input.message, field: "shifts", refusal: STATUTORY_PUBLICATION_BLOCKED });
		this.blockingFindings = input.blockingFindings;
	}
}
