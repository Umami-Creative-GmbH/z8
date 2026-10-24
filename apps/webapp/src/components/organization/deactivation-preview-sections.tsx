"use client";

import { useTolgee, useTranslate } from "@tolgee/react";
import { type ReactNode, useId } from "react";
import { useOffboardingLabels } from "@/components/settings/employee-offboarding/labels";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate, formatPlainDateRange } from "@/lib/datetime/temporal-format";
import type {
	AbsencePlanItem,
	AccessEndsPlan,
	ApprovalDutiesPlan,
	DeactivationPreview,
} from "@/lib/employee-lifecycle/deactivation/types";
import { useGrantKindLabel } from "./use-grant-kind-label";

/** Every consequence of the plan except the replacement pickers; empty areas are left out. */
export function DeactivationConsequences({ plan }: { plan: DeactivationPreview }) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() || "en";
	const names = knownNames(plan);

	if (!hasConsequences(plan)) {
		return (
			<p className="text-sm text-muted-foreground">
				{t("settings.employees.lifecycle.deactivationPreview.nothingElse", "Nothing else changes.")}
			</p>
		);
	}

	return (
		<div className="space-y-5">
			<ManagerLinksSection plan={plan} names={names} />
			<TeamLinksSection plan={plan} />
			<ApprovalDutiesSection duties={plan.approvalDuties} names={names} />
			<ShiftsSection plan={plan} locale={locale} />
			<AbsencesSection plan={plan} locale={locale} />
			<AccessEndsSection access={plan.accessEnds} />
			<RecordsSection plan={plan} />
		</div>
	);
}

function hasConsequences(plan: DeactivationPreview): boolean {
	const { managerLinks, teamLinks, approvalDuties, shifts, absences, accessEnds } = plan;
	return (
		[
			managerLinks.reportsNeedingReplacement,
			managerLinks.reportsKeepingAnotherManager,
			managerLinks.formerReports,
			managerLinks.ownManagerLinks,
			teamLinks.teams,
			teamLinks.projectAssignments,
			teamLinks.projectManagerLinks,
			approvalDuties.handovers,
			approvalDuties.reviews,
			shifts.shiftsToOpen,
			absences.absencesToCancel,
			absences.absencesSpanning,
			absences.absencesInClosedMonths,
			accessEnds.grants,
			accessEnds.drivingAuthorizations,
			accessEnds.kioskBadges,
			accessEnds.shareLinks,
		].some((items) => items.length > 0) ||
		plan.retentionStarts ||
		plan.seatReleased
	);
}

/** Names the plan already carries, to name approval targets and new primary managers. */
function knownNames(plan: DeactivationPreview): ReadonlyMap<string, string> {
	const names = new Map<string, string>();
	const links = plan.managerLinks;
	for (const person of [
		...links.replacementOptions,
		...links.reportsNeedingReplacement,
		...links.reportsKeepingAnotherManager,
		...links.formerReports,
		...links.ownManagerLinks,
	]) {
		if (person.name) names.set(person.employeeId, person.name);
	}
	return names;
}

function PreviewSection({
	title,
	description,
	children,
}: {
	title: string;
	description?: ReactNode;
	children: ReactNode;
}) {
	const headingId = useId();
	return (
		<section aria-labelledby={headingId} className="space-y-2">
			<h3 id={headingId} className="text-sm font-semibold">
				{title}
			</h3>
			{description && <p className="text-sm text-muted-foreground">{description}</p>}
			{children}
		</section>
	);
}

function ItemList({ children }: { children: ReactNode }) {
	return <ul className="list-disc space-y-1 pl-5 text-sm">{children}</ul>;
}

function ManagerLinksSection({
	plan,
	names,
}: {
	plan: DeactivationPreview;
	names: ReadonlyMap<string, string>;
}) {
	const { t } = useTranslate();
	const { reportsKeepingAnotherManager, formerReports, ownManagerLinks } = plan.managerLinks;
	if (reportsKeepingAnotherManager.length + formerReports.length + ownManagerLinks.length === 0) {
		return null;
	}

	return (
		<PreviewSection
			title={t(
				"settings.employees.lifecycle.deactivationPreview.managerLinksTitle",
				"Manager links that end",
			)}
		>
			{reportsKeepingAnotherManager.length > 0 && (
				<ItemList>
					{reportsKeepingAnotherManager.map((report) => {
						const newPrimary = report.newPrimaryManagerId
							? names.get(report.newPrimaryManagerId)
							: undefined;
						return (
							<li key={report.employeeId}>
								{newPrimary
									? t(
											"settings.employees.lifecycle.deactivationPreview.reportKeepsNewPrimary",
											"{name} keeps {manager}, who becomes the primary manager.",
											{ name: report.name, manager: newPrimary },
										)
									: t(
											"settings.employees.lifecycle.deactivationPreview.reportKeepsManager",
											"{name} keeps their other manager.",
											{ name: report.name },
										)}
							</li>
						);
					})}
				</ItemList>
			)}
			{formerReports.length > 0 && (
				<ItemList>
					{formerReports.map((report) => (
						<li key={report.employeeId}>
							{t(
								"settings.employees.lifecycle.deactivationPreview.reportFormer",
								"{name} is a former employee; the link just ends.",
								{ name: report.name },
							)}
						</li>
					))}
				</ItemList>
			)}
			{ownManagerLinks.length > 0 && (
				<>
					<p className="text-sm font-medium">
						{t(
							"settings.employees.lifecycle.deactivationPreview.ownManagers",
							"Their own managers",
						)}
					</p>
					<ItemList>
						{ownManagerLinks.map((manager) => (
							<li key={manager.employeeId}>
								{manager.isPrimary
									? t(
											"settings.employees.lifecycle.deactivationPreview.ownPrimaryManager",
											"{name} (primary manager)",
											{ name: manager.name },
										)
									: manager.name}
							</li>
						))}
					</ItemList>
				</>
			)}
		</PreviewSection>
	);
}

function TeamLinksSection({ plan }: { plan: DeactivationPreview }) {
	const { t } = useTranslate();
	const { teams, projectAssignments, projectManagerLinks } = plan.teamLinks;
	if (teams.length + projectAssignments.length + projectManagerLinks.length === 0) return null;

	return (
		<PreviewSection
			title={t(
				"settings.employees.lifecycle.deactivationPreview.teamLinksTitle",
				"Teams and projects",
			)}
			description={t(
				"settings.employees.lifecycle.deactivationPreview.teamLinksDescription",
				"These memberships end.",
			)}
		>
			<ItemList>
				{teams.map((team) => (
					<li key={`team:${team.teamId}`}>
						{t("settings.employees.lifecycle.deactivationPreview.team", "Team: {name}", {
							name: team.name,
						})}
					</li>
				))}
				{projectAssignments.map((project) => (
					<li key={`member:${project.projectId}`}>
						{t(
							"settings.employees.lifecycle.deactivationPreview.projectMember",
							"Project member: {name}",
							{ name: project.name },
						)}
					</li>
				))}
				{projectManagerLinks.map((project) => (
					<li key={`manager:${project.projectId}`}>
						{t(
							"settings.employees.lifecycle.deactivationPreview.projectManager",
							"Project manager: {name}",
							{ name: project.name },
						)}
					</li>
				))}
			</ItemList>
		</PreviewSection>
	);
}

function ApprovalDutiesSection({
	duties,
	names,
}: {
	duties: ApprovalDutiesPlan;
	names: ReadonlyMap<string, string>;
}) {
	const { t } = useTranslate();
	const labels = useOffboardingLabels();
	if (duties.handovers.length === 0 && duties.reviews.length === 0) return null;

	const byTarget = new Map<string, number>();
	let fallbackCount = 0;
	let reviewCount = duties.reviews.length;
	for (const handover of duties.handovers) {
		if (!handover.targetEmployeeId) {
			reviewCount += 1;
		} else if (names.has(handover.targetEmployeeId)) {
			byTarget.set(handover.targetEmployeeId, (byTarget.get(handover.targetEmployeeId) ?? 0) + 1);
		} else {
			fallbackCount += 1;
		}
	}
	const reasons = [
		...new Set(
			duties.reviews.map((review) => labels.reason(review.reason)).filter((text) => text !== null),
		),
	];

	return (
		<PreviewSection
			title={t(
				"settings.employees.lifecycle.deactivationPreview.approvalsTitle",
				"Approval duties",
			)}
			description={t(
				"settings.employees.lifecycle.deactivationPreview.approvalsDescription",
				"Their own submitted requests stay decidable.",
			)}
		>
			<ItemList>
				{[...byTarget].map(([targetId, count]) => (
					<li key={targetId}>
						{t(
							"settings.employees.lifecycle.deactivationPreview.approvalsMoveTo",
							"{count, plural, one {# pending approval moves} other {# pending approvals move}} to {name}.",
							{ count, name: names.get(targetId) ?? "" },
						)}
					</li>
				))}
				{fallbackCount > 0 && (
					<li>
						{t(
							"settings.employees.lifecycle.deactivationPreview.approvalsMoveToFallback",
							"{count, plural, one {# pending approval moves} other {# pending approvals move}} to the workflow's fallback approver.",
							{ count: fallbackCount },
						)}
					</li>
				)}
				{reviewCount > 0 && (
					<li>
						{t(
							"settings.employees.lifecycle.deactivationPreview.approvalsToReview",
							"{count, plural, one {# approval duty needs a replacement and is listed for review} other {# approval duties need a replacement and are listed for review}} ({review}).",
							{ count: reviewCount, review: labels.review("approval_handover") },
						)}
						{reasons.length > 0 && (
							<ul className="mt-1 list-[circle] space-y-1 pl-5 text-muted-foreground">
								{reasons.map((reason) => (
									<li key={reason}>{reason}</li>
								))}
							</ul>
						)}
					</li>
				)}
			</ItemList>
		</PreviewSection>
	);
}

function ShiftsSection({ plan, locale }: { plan: DeactivationPreview; locale: string }) {
	const { t } = useTranslate();
	const shifts = plan.shifts.shiftsToOpen;
	if (shifts.length === 0) return null;

	return (
		<PreviewSection
			title={t(
				"settings.employees.lifecycle.deactivationPreview.shiftsTitle",
				"Shifts that become open",
			)}
			description={t(
				"settings.employees.lifecycle.deactivationPreview.shiftsDescription",
				"{count, plural, one {# future shift is unassigned and stays as an open shift.} other {# future shifts are unassigned and stay as open shifts.}} Planners are notified once.",
				{ count: shifts.length },
			)}
		>
			<ItemList>
				{shifts.map((shift) => (
					<li key={shift.shiftId}>
						{t(
							"settings.employees.lifecycle.deactivationPreview.shiftItem",
							"{date}, {start}–{end}",
							{
								date: formatPlainDate(parsePlainDate(shift.date), locale, "dateMedium"),
								start: shift.startTime,
								end: shift.endTime,
							},
						)}
					</li>
				))}
			</ItemList>
		</PreviewSection>
	);
}

function AbsencesSection({ plan, locale }: { plan: DeactivationPreview; locale: string }) {
	const { t } = useTranslate();
	const { absencesToCancel, absencesSpanning, absencesInClosedMonths } = plan.absences;
	if (absencesToCancel.length + absencesSpanning.length + absencesInClosedMonths.length === 0) {
		return null;
	}

	return (
		<PreviewSection
			title={t("settings.employees.lifecycle.deactivationPreview.absencesTitle", "Absences")}
		>
			{absencesToCancel.length > 0 && (
				<>
					<p className="text-sm font-medium">
						{t(
							"settings.employees.lifecycle.deactivationPreview.absencesCancelled",
							"Cancelled, allowance restored",
						)}
					</p>
					<AbsenceList absences={absencesToCancel} locale={locale} />
				</>
			)}
			{absencesSpanning.length > 0 && (
				<>
					<p className="text-sm font-medium">
						{t(
							"settings.employees.lifecycle.deactivationPreview.absencesKept",
							"Kept, because they have already started",
						)}
					</p>
					<AbsenceList absences={absencesSpanning} locale={locale} />
				</>
			)}
			{absencesInClosedMonths.length > 0 && (
				<>
					<p className="text-sm font-medium">
						{t(
							"settings.employees.lifecycle.deactivationPreview.absencesInClosedMonth",
							"Kept, because they touch a closed month (reopen it to cancel them)",
						)}
					</p>
					<AbsenceList absences={absencesInClosedMonths} locale={locale} />
				</>
			)}
		</PreviewSection>
	);
}

function AbsenceList({ absences, locale }: { absences: AbsencePlanItem[]; locale: string }) {
	const { t } = useTranslate();
	return (
		<ItemList>
			{absences.map((absence) => {
				const range = formatPlainDateRange(
					parsePlainDate(absence.startDate),
					parsePlainDate(absence.endDate),
					locale,
					"dateMedium",
				);
				return (
					<li key={absence.absenceId}>
						{absence.status === "pending"
							? t(
									"settings.employees.lifecycle.deactivationPreview.absencePending",
									"{category}, {range} (pending)",
									{ category: absence.categoryName, range },
								)
							: t(
									"settings.employees.lifecycle.deactivationPreview.absenceApproved",
									"{category}, {range} (approved)",
									{ category: absence.categoryName, range },
								)}
					</li>
				);
			})}
		</ItemList>
	);
}

function AccessEndsSection({ access }: { access: AccessEndsPlan }) {
	const { t } = useTranslate();
	const grantLabel = useGrantKindLabel();
	const grantKinds = [...new Set(access.grants.map((grant) => grant.kind))];
	const { drivingAuthorizations, kioskBadges, shareLinks } = access;
	if (
		grantKinds.length + drivingAuthorizations.length + kioskBadges.length + shareLinks.length ===
		0
	) {
		return null;
	}

	return (
		<PreviewSection
			title={t("settings.employees.lifecycle.deactivationPreview.accessTitle", "Access that ends")}
		>
			<ItemList>
				{grantKinds.map((kind) => (
					<li key={kind}>{grantLabel(kind)}</li>
				))}
				{drivingAuthorizations.length > 0 && (
					<li>
						{t(
							"settings.employees.lifecycle.deactivationPreview.drivingAuthorizations",
							"{count, plural, one {# driving authorization ends} other {# driving authorizations end}}, including suspended ones",
							{ count: drivingAuthorizations.length },
						)}
					</li>
				)}
				{kioskBadges.length > 0 && (
					<li>
						{t(
							"settings.employees.lifecycle.deactivationPreview.kioskBadges",
							"{count, plural, one {# kiosk badge is revoked} other {# kiosk badges are revoked}}",
							{ count: kioskBadges.length },
						)}
					</li>
				)}
				{shareLinks.length > 0 && (
					<li>
						{t(
							"settings.employees.lifecycle.deactivationPreview.shareLinks",
							"{count, plural, one {# report share link is revoked} other {# report share links are revoked}}",
							{ count: shareLinks.length },
						)}
					</li>
				)}
			</ItemList>
		</PreviewSection>
	);
}

function RecordsSection({ plan }: { plan: DeactivationPreview }) {
	const { t } = useTranslate();
	if (!plan.retentionStarts && !plan.seatReleased) return null;

	return (
		<PreviewSection
			title={t(
				"settings.employees.lifecycle.deactivationPreview.recordsTitle",
				"Records and billing",
			)}
		>
			<ItemList>
				{plan.retentionStarts && (
					<li>
						{t(
							"settings.employees.lifecycle.deactivationPreview.retentionStarts",
							"Personnel file retention starts now.",
						)}
					</li>
				)}
				{plan.seatReleased && (
					<li>
						{t(
							"settings.employees.lifecycle.deactivationPreview.seatReleased",
							"Their paid seat is released.",
						)}
					</li>
				)}
			</ItemList>
		</PreviewSection>
	);
}
