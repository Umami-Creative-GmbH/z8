"use server";

import { Effect } from "effect";
import { z } from "zod";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { organizationAction } from "@/lib/organization-action/organization-action";
import {
	saveWorksCouncilSettings,
	type WorksCouncilSettingsFormValues,
} from "@/lib/works-council/settings";

const worksCouncilSettingsSchema = z.object({
	enabled: z.boolean(),
	identityVisibility: z.enum(["aggregated", "pseudonymized", "named"]),
	absenceVisibility: z.enum(["hidden", "grouped", "category"]),
	exportEnabled: z.boolean(),
	minimumAggregationThreshold: z.number().int().min(5).max(10_000),
	visibleTeamIds: z.array(z.string()),
	visibleLocationIds: z.array(z.string()),
}) satisfies z.ZodType<WorksCouncilSettingsFormValues>;

export const updateWorksCouncilSettings = organizationAction(
	{
		name: "worksCouncil.updateSettings",
		requires: "orgAdmin",
		schema: worksCouncilSettingsSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("worksCouncil.updateSettings", () =>
				saveWorksCouncilSettings(
					{
						...input,
						organizationId,
						actorUserId: actor.userId,
					},
					dbService.db,
				),
			);
			return undefined;
		}),
);
