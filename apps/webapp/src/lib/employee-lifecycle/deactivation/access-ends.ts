import { and, eq } from "drizzle-orm";
import { expenseOfficerGrant, payrollAccessGrant, personnelFileOfficerGrant } from "@/db/schema";
import { lockDrivingLicenceOrganization } from "@/lib/organization/driving-licence/checks";
import {
	endDrivingLicenceEmployment,
	liveDrivingLicenceEmployment,
} from "@/lib/organization/driving-licence/lifecycle";
import { revokePayrollAccessGrantHeldBy } from "@/lib/payroll-access/grant-store";
import { revokePersonnelFileOfficerGrantHeldBy } from "@/lib/personnel-file/officer-grant-store";
import {
	liveShareLinksOfCreator,
	revokeShareLinksOfCreator,
} from "@/lib/projects/report-share/report-share-links";
import {
	liveKioskBadgesOfEmploymentPeriod,
	revokeKioskBadgesOfEmploymentPeriod,
} from "@/lib/time-tracking/kiosk/badge-store";
import { endKioskFobLinks, liveKioskFobsOfEmployment } from "@/lib/time-tracking/kiosk/fob-store";
import { revokeExpenseOfficerGrantHeldBy } from "@/lib/travel-expenses/expense-officer-grant-store";
import {
	type AccessEndsApplied,
	type AccessEndsPlan,
	type AreaApplyResult,
	type DeactivationApplyContext,
	type DeactivationPlanContext,
	type DeactivationReader,
	type DeactivationWriter,
	deactivationAuditMetadata,
} from "./types";

/**
 * Access ends at a deactivation as at a departure (#1440 item 5 and 6,
 * Organization ADR 0006): the expense officer, payroll access, personnel file
 * officer and driving licence verifier grants the person holds, their driving
 * authorizations (also suspended ones), their kiosk badges, their kiosk fob
 * (#1509) and their report share links. The departure's own revocations are
 * reused; each change is
 * audited in the deactivation transaction under the acting admin with
 * `{ reason, deactivationId, employmentPeriodId }`. Grants of others that name
 * the person in their scope stay, as at a departure.
 */

type GrantKind = AccessEndsPlan["grants"][number]["kind"];

/** Everything `applyAccessEnds` ends, read with the predicates it ends them by. */
export async function planAccessEnds(
	reader: DeactivationReader,
	ctx: DeactivationPlanContext,
): Promise<AccessEndsPlan> {
	const employment = {
		organizationId: ctx.organizationId,
		employeeId: ctx.employeeId,
		employmentPeriodId: ctx.employmentPeriodId,
	};
	// One after another: inside the transaction the reader is a single connection.
	const expense = await reader
		.select({ id: expenseOfficerGrant.id })
		.from(expenseOfficerGrant)
		.where(
			and(
				eq(expenseOfficerGrant.organizationId, ctx.organizationId),
				eq(expenseOfficerGrant.officerEmployeeId, ctx.employeeId),
				eq(expenseOfficerGrant.isActive, true),
			),
		);
	const payroll = await reader
		.select({ id: payrollAccessGrant.id })
		.from(payrollAccessGrant)
		.where(
			and(
				eq(payrollAccessGrant.organizationId, ctx.organizationId),
				eq(payrollAccessGrant.payrollEmployeeId, ctx.employeeId),
				eq(payrollAccessGrant.isActive, true),
			),
		);
	const personnelFile = await reader
		.select({ id: personnelFileOfficerGrant.id })
		.from(personnelFileOfficerGrant)
		.where(
			and(
				eq(personnelFileOfficerGrant.organizationId, ctx.organizationId),
				eq(personnelFileOfficerGrant.officerEmployeeId, ctx.employeeId),
				eq(personnelFileOfficerGrant.isActive, true),
			),
		);
	const driving = await liveDrivingLicenceEmployment(reader, employment);
	const badgeIds = await liveKioskBadgesOfEmploymentPeriod(reader, employment);
	const fobIds = await liveKioskFobsOfEmployment(reader, employment);
	const links = await liveShareLinksOfCreator(reader, {
		organizationId: ctx.organizationId,
		creatorEmployeeId: ctx.employeeId,
		now: ctx.at,
	});
	const grant = (kind: GrantKind) => (row: { id: string }) => ({ kind, grantId: row.id });
	return {
		grants: [
			...expense.map(grant("expense_officer")),
			...payroll.map(grant("payroll_access")),
			...personnelFile.map(grant("personnel_file_officer")),
			...driving.verifierGrantIds.map((id) => grant("driving_licence_verifier")({ id })),
		],
		drivingAuthorizations: driving.authorizations.map((row) => ({
			authorizationId: row.id,
			state: row.state,
		})),
		kioskBadges: badgeIds.map((badgeId) => ({ badgeId })),
		kioskFobs: fobIds.map((fobId) => ({ fobId })),
		shareLinks: links.map((link) => ({ linkId: link.id, kind: link.kind })),
	};
}

/**
 * Ends what `plan` lists, inside the deactivation transaction, which already
 * holds the lifecycle organization row. In the departure's order: driving
 * licence (under its organization lock), the held grants, kiosk badges and
 * the kiosk fob, then share links. Idempotent: a second run finds nothing live.
 */
export async function applyAccessEnds(
	tx: DeactivationWriter,
	plan: AccessEndsPlan,
	ctx: DeactivationApplyContext,
): Promise<AreaApplyResult<AccessEndsApplied>> {
	const auditMetadata = {
		...deactivationAuditMetadata(ctx),
		employmentPeriodId: ctx.employmentPeriodId,
	};
	const planned = new Set(plan.grants.map((grant) => grant.kind));
	const employment = {
		organizationId: ctx.organizationId,
		employeeId: ctx.employeeId,
		employmentPeriodId: ctx.employmentPeriodId,
	};

	// Always, as at a departure: it also clears person-wide suspensions and
	// pending driving licence tasks, which the plan does not list.
	await lockDrivingLicenceOrganization(tx, ctx.organizationId);
	const driving = await endDrivingLicenceEmployment(
		tx,
		employment,
		ctx.actorUserId,
		ctx.at,
		ctx.at,
		{ trail: ctx.audit, metadata: deactivationAuditMetadata(ctx) },
	);

	// The ids each revocation actually ended (null: nothing was live any more).
	const revoked: Array<string | null> = [];
	if (planned.has("expense_officer")) {
		revoked.push(
			await revokeExpenseOfficerGrantHeldBy(tx, {
				organizationId: ctx.organizationId,
				actorUserId: ctx.actorUserId,
				officerEmployeeId: ctx.employeeId,
				auditMetadata,
			}),
		);
	}
	if (planned.has("payroll_access")) {
		revoked.push(
			await revokePayrollAccessGrantHeldBy(tx, {
				organizationId: ctx.organizationId,
				actorUserId: ctx.actorUserId,
				payrollEmployeeId: ctx.employeeId,
				auditMetadata,
			}),
		);
	}
	if (planned.has("personnel_file_officer")) {
		revoked.push(
			await revokePersonnelFileOfficerGrantHeldBy(tx, {
				organizationId: ctx.organizationId,
				actorUserId: ctx.actorUserId,
				officerEmployeeId: ctx.employeeId,
				auditMetadata,
			}),
		);
	}
	const grantIds = [
		...revoked.filter((id): id is string => id !== null),
		...driving.revokedVerifierGrantIds,
	];

	const kioskBadgeIds =
		plan.kioskBadges.length === 0
			? []
			: await revokeKioskBadgesOfEmploymentPeriod(tx, ctx.audit, {
					...employment,
					actorUserId: ctx.actorUserId,
					cutoff: ctx.at,
					revokedReason: "revoked",
					auditMetadata,
				});

	// As a badge (decision O6): the column says `removed`, the audit names the
	// deactivation. The deactivation holds no employee key; a registration racing
	// it leaves a link no kiosk selects, which the next registration of that card
	// ends (decision O7).
	const kioskFobIds =
		plan.kioskFobs.length === 0
			? []
			: await endKioskFobLinks(tx, ctx.audit, {
					organizationId: ctx.organizationId,
					employeeId: ctx.employeeId,
					employmentPeriodId: ctx.employmentPeriodId ?? undefined,
					reason: "removed",
					at: ctx.at,
					actorUserId: ctx.actorUserId,
					auditMetadata,
				});

	const shareLinkIds =
		plan.shareLinks.length === 0
			? []
			: await revokeShareLinksOfCreator(tx, ctx.audit, {
					organizationId: ctx.organizationId,
					creatorEmployeeId: ctx.employeeId,
					now: ctx.at,
					actorUserId: ctx.actorUserId,
					auditMetadata,
				});

	return {
		applied: {
			grantIds,
			drivingAuthorizationIds: driving.endedAuthorizationIds,
			kioskBadgeIds,
			kioskFobIds,
			shareLinkIds,
		},
		afterCommit: [],
	};
}
