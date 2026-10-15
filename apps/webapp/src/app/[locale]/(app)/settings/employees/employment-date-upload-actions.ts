"use server";
import { requireOrganizationAdmin } from "@/lib/auth/current-organization-actor";
import { systemClock } from "@/lib/datetime/temporal-core";
import { runRefusalAction } from "@/lib/effect/refusal-action";
import {
	previewEmploymentDateUpload,
	commitEmploymentDateUpload,
} from "@/lib/employee-lifecycle/employment-date-upload";
import type { EmploymentDateUploadOutcome } from "@/lib/employee-lifecycle/employment-date-upload-types";
import {
	TrackingDateRefusal,
	type TrackingDateActionResult,
} from "@/lib/time-tracking/tracking-date-review-types";
const denied = () =>
	new TrackingDateRefusal(
		"not_permitted",
		"Only an organization admin can upload actual employment date corrections.",
	);
function requireCsv(input: { csv: string }): string {
	if (typeof input?.csv !== "string")
		throw new TrackingDateRefusal("invalid_input", "Choose a readable CSV file.");
	return input.csv;
}
export async function previewEmploymentDateUploadAction(input: {
	csv: string;
}): Promise<TrackingDateActionResult<EmploymentDateUploadOutcome>> {
	return runRefusalAction("employmentDateUpload.preview", TrackingDateRefusal, async (database) => {
		const actor = await requireOrganizationAdmin(denied);
		return previewEmploymentDateUpload(database, {
			organizationId: actor.organizationId,
			actorUserId: actor.userId,
			now: systemClock.nowInstant(),
			csv: requireCsv(input),
		});
	});
}
export async function commitEmploymentDateUploadAction(input: {
	csv: string;
	fingerprint: string;
}): Promise<TrackingDateActionResult<EmploymentDateUploadOutcome>> {
	return runRefusalAction("employmentDateUpload.commit", TrackingDateRefusal, async (database) => {
		const actor = await requireOrganizationAdmin(denied);
		return commitEmploymentDateUpload(database, {
			organizationId: actor.organizationId,
			actorUserId: actor.userId,
			now: systemClock.nowInstant(),
			csv: requireCsv(input),
			fingerprint: input.fingerprint,
		});
	});
}
