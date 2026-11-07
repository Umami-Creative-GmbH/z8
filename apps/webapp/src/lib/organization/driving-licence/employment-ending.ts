import "server-only";

import {
	employmentEndingAuditMetadata,
	endingEmployment,
} from "@/lib/employee-lifecycle/employment-ending/cause";
import type { EmploymentEndingParticipant } from "@/lib/employee-lifecycle/employment-ending/types";
import { grantChecklistItem } from "@/lib/employee-lifecycle/reactivation-checklist";
import { endDrivingLicenceEmployment, liveDrivingLicenceEmployment } from "./lifecycle";
import { lockDrivingLicenceOrganization } from "./locks";

export type DrivingLicenceEndingPlan = {
	/** Not yet ended, also suspended ones. */
	authorizations: Array<{ authorizationId: string; state: string }>;
	verifierGrantIds: string[];
};
export type DrivingLicenceEndingApplied = {
	endedAuthorizationIds: string[];
	revokedVerifierGrantIds: string[];
};

/**
 * The driving licence employment ends under its organization lock: every
 * authorization (also suspended ones), person-wide suspensions, held verifier
 * grants and pending tasks. Always applied, not only what the plan lists. The
 * lock is safe after equipment's: every other holder of either lock takes the
 * organization row first, which the ending's cause holds exclusively. A
 * departure records driving events only; other causes also audit each change.
 */
export const drivingLicenceEndingParticipant: EmploymentEndingParticipant<
	DrivingLicenceEndingPlan,
	DrivingLicenceEndingApplied,
	"drivingLicence"
> = {
	key: "drivingLicence",
	async plan(reader, ctx) {
		const live = await liveDrivingLicenceEmployment(reader, endingEmployment(ctx));
		return {
			authorizations: live.authorizations.map((row) => ({
				authorizationId: row.id,
				state: row.state,
			})),
			verifierGrantIds: live.verifierGrantIds,
		};
	},
	async apply(tx, _plan, ctx) {
		await lockDrivingLicenceOrganization(tx, ctx.organizationId);
		const ended = await endDrivingLicenceEmployment(
			tx,
			endingEmployment(ctx),
			ctx.actorUserId,
			ctx.at,
			ctx.now,
			ctx.cause.kind === "departure"
				? undefined
				: { trail: ctx.audit, metadata: employmentEndingAuditMetadata(ctx) },
		);
		return { applied: ended };
	},
	reactivationItems: (applied, subject) => [
		...applied.revokedVerifierGrantIds.map(() => grantChecklistItem("driving_licence_verifier")),
		...(applied.endedAuthorizationIds.length > 0
			? [
					{
						group: "access" as const,
						kind: "driving_authorizations" as const,
						count: applied.endedAuthorizationIds.length,
						href: `/driving-licence/checks/${subject.employeeId}`,
					},
				]
			: []),
	],
};
