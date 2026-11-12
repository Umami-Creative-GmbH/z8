"use server";
import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	commitEmploymentDateUpload,
	previewEmploymentDateUpload,
} from "@/lib/employee-lifecycle/employment-date-upload";
import { refusalStep } from "@/lib/organization-action/action-refusal";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { TrackingDateRefusal } from "@/lib/time-tracking/tracking-date-review-types";

const csv = z.string("Choose a readable CSV file.");

export const previewEmploymentDateUploadAction = organizationAction(
	{
		name: "employmentDateUpload.preview",
		requires: "orgAdmin",
		schema: z.strictObject({ csv }),
	},
	({ actor, organizationId, input }) =>
		refusalStep("employmentDateUpload.preview", TrackingDateRefusal, (database) =>
			previewEmploymentDateUpload(database, {
				organizationId,
				actorUserId: actor.userId,
				now: systemClock.nowInstant(),
				csv: input.csv,
			}),
		),
);

export const commitEmploymentDateUploadAction = organizationAction(
	{
		name: "employmentDateUpload.commit",
		requires: "orgAdmin",
		schema: z.strictObject({ csv, fingerprint: z.string() }),
	},
	({ actor, organizationId, input }) =>
		refusalStep("employmentDateUpload.commit", TrackingDateRefusal, (database) =>
			commitEmploymentDateUpload(database, {
				organizationId,
				actorUserId: actor.userId,
				now: systemClock.nowInstant(),
				csv: input.csv,
				fingerprint: input.fingerprint,
			}),
		),
);
