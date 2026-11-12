"use server";

import { Effect } from "effect";
import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { rehearseGoLiveMember } from "@/lib/implementation-checklist/go-live/rehearsal";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { loadGoLiveViewer } from "./queries";

/** Longer than any `goLiveMemberKey` ("employee:" or "invitee:" and a uuid). */
const MEMBER_KEY_MAX_LENGTH = 200;

/**
 * The go-live rehearsal for one checked member of the caller's organization, as of now. Org
 * admins only; the organization comes from the session, and a member outside its go-live group
 * (former, excluded, another organization's, unknown) is refused with
 * `refusal: "member_not_checked"`. A failed lookup fails without a refusal. Nothing is written.
 */
export const rehearseGoLiveMemberAction = organizationAction(
	{
		name: "goLiveRehearsal.rehearse",
		requires: "orgAdmin",
		schema: z.string({ error: "Unknown member" }).max(MEMBER_KEY_MAX_LENGTH, "Unknown member"),
	},
	({ organizationId, input: memberKey }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query("goLiveRehearsal.rehearse", async () => {
				const { asOf, fixLink } = await loadGoLiveViewer(organizationId, systemClock.nowInstant());
				return rehearseGoLiveMember(dbService.db, { organizationId, asOf, memberKey, fixLink });
			});
			if (!result.ok) {
				return yield* Effect.fail(
					new ValidationError({
						message: "This person isn't in the go-live group.",
						refusal: result.refusal,
					}),
				);
			}
			return result.rehearsal;
		}),
);
