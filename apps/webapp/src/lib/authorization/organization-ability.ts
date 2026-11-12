import { Effect } from "effect";
import { type AppAbility, defineAbilityFor } from "@/lib/authorization/ability";
import { loadOrganizationPrincipalContext } from "@/lib/authorization/principal-loader";
import type { DatabaseError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";

/** The `DatabaseService.query` name the ability loads under; test stubs answer it. */
export const ORGANIZATION_ABILITY_QUERY = "organizationAbility.load";

/**
 * The CASL ability of a user in one organization, built from the database, for
 * object-level and separately grantable checks inside an `organizationAction`
 * handler (ADR 0002 keeps those in the handler).
 */
export function organizationAbility(input: {
	userId: string;
	organizationId: string;
}): Effect.Effect<AppAbility, DatabaseError, DatabaseService> {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return yield* dbService.query(ORGANIZATION_ABILITY_QUERY, async () =>
			defineAbilityFor(await loadOrganizationPrincipalContext(dbService.db, input)),
		);
	});
}
