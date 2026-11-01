import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { ImplementationChecklistItemId } from "../../definition";
import type {
	GoLiveAsOf,
	GoLiveCheckOutcome,
	GoLiveCheckSeverity,
	GoLiveFixLinkResolver,
	GoLiveGroup,
} from "../types";

/** What a go-live check runs with. Read-only: a check never writes. */
export interface GoLiveCheckContext {
	db: DatabaseClient;
	organizationId: string;
	asOf: GoLiveAsOf;
	/** The go-live group, resolved once for every check. */
	group: GoLiveGroup;
	fixLink: GoLiveFixLinkResolver;
}

/**
 * One go-live check. `run` loads its organization-wide inputs once, then works
 * out each member in memory, so its query count doesn't grow with the group.
 * A throw counts as a failed lookup: the runner reports it as unavailable.
 */
export interface GoLiveCheck {
	id: string;
	itemId: ImplementationChecklistItemId;
	/** Declared severity; a run may override it in its outcome. */
	severity: GoLiveCheckSeverity;
	run(context: GoLiveCheckContext): Promise<GoLiveCheckOutcome>;
}
