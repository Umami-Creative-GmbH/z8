import { type Instant, plainDateAt } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { GO_LIVE_CHECKS } from "./checks";
import type { GoLiveCheck } from "./checks/types";
import { resolveGoLiveGroup } from "./group";
import type { GoLiveAsOf, GoLiveCheckResult, GoLiveFixLinkResolver, GoLiveGroup } from "./types";

const logger = createLogger("GoLiveChecks");

/** The moment checks run for, with "today" in the organization's timezone. */
export function goLiveAsOf(instant: Instant, timezone: string): GoLiveAsOf {
	return { instant, timezone, today: plainDateAt(instant, timezone) };
}

export interface GoLiveRun {
	results: GoLiveCheckResult[];
	/** How many members the group has; null when it could not be resolved. */
	memberCount: number | null;
}

/**
 * Works out every go-live check live, over one go-live group. A lookup failure
 * (the group, or any check) makes the affected checks unavailable: it is
 * logged and never counts as a pass. Nothing is stored.
 */
export async function runGoLiveChecks(input: {
	db: DatabaseClient;
	organizationId: string;
	asOf: GoLiveAsOf;
	fixLink: GoLiveFixLinkResolver;
	checks?: readonly GoLiveCheck[];
}): Promise<GoLiveRun> {
	const checks = input.checks ?? GO_LIVE_CHECKS;
	let group: GoLiveGroup;
	try {
		group = await resolveGoLiveGroup(input.db, input.organizationId, input.asOf);
	} catch (error) {
		logger.error(
			{ organizationId: input.organizationId, error },
			"Go-live group could not be resolved",
		);
		return unavailableGoLiveRun(checks);
	}

	const results = await Promise.all(
		checks.map(async (check): Promise<GoLiveCheckResult> => {
			try {
				const outcome = await check.run({ ...input, group });
				if (outcome.outcome === "unavailable") return unavailable(check);
				return {
					...outcome,
					checkId: check.id,
					itemId: check.itemId,
					severity: outcome.severity ?? check.severity,
					checkedMemberCount: group.members.length,
				};
			} catch (error) {
				logger.error(
					{ organizationId: input.organizationId, checkId: check.id, error },
					"Go-live check lookup failed",
				);
				return unavailable(check);
			}
		}),
	);
	return { results, memberCount: group.members.length };
}

/** Every check unavailable, for when the checks could not even start. */
export function unavailableGoLiveRun(checks: readonly GoLiveCheck[] = GO_LIVE_CHECKS): GoLiveRun {
	return { results: checks.map((check) => unavailable(check)), memberCount: null };
}

function unavailable(check: GoLiveCheck): GoLiveCheckResult {
	return {
		outcome: "unavailable",
		checkId: check.id,
		itemId: check.itemId,
		severity: check.severity,
		checkedMemberCount: 0,
	};
}
