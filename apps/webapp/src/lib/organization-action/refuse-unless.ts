import { Effect } from "effect";
import { AuthorizationError } from "@/lib/effect/errors";

/** What an access refusal inside an `organizationAction` handler reports. */
export interface AccessRefusal {
	readonly userId: string;
	readonly message: string;
	readonly resource: string;
	readonly action: string;
}

/**
 * The one shape of an access check inside an `organizationAction` handler:
 * work out `allowed` with a shared loader (`organizationAbility`,
 * `actor.managedScope()`, a feature's scope predicate), then refuse here. Settings
 * action files keep no `require*`/`ensure*`/`assert*` guards of their own (#1592).
 */
export function refuseUnless(
	allowed: boolean,
	refusal: AccessRefusal,
): Effect.Effect<void, AuthorizationError> {
	return allowed ? Effect.void : Effect.fail(new AuthorizationError({ ...refusal }));
}
