import { formatRecordedPositionInstant } from "@/components/position-capture/format";
import { PositionNoticeText } from "@/components/position-capture/position-notice-text";
import type {
	PositionCaptureReview,
	PositionCaptureReviewAccessEntry,
	PositionCaptureReviewIdentity,
} from "@/lib/works-council/position-capture-review";
import type { getTranslate } from "@/tolgee/server";

type Translate = Awaited<ReturnType<typeof getTranslate>>;

function identityLabel(
	identity: PositionCaptureReviewIdentity | { kind: "deleted" },
	role: "viewer" | "employee",
	t: Translate,
): string {
	if (identity.kind === "named") return identity.name;
	if (identity.kind === "pseudonym") {
		return role === "viewer"
			? t("common.worksCouncil.positionStamps.viewerPseudonym", "Viewer {ref}", {
					ref: identity.ref,
				})
			: t("common.worksCouncil.positionStamps.employeePseudonym", "Employee {ref}", {
					ref: identity.ref,
				});
	}
	if (identity.kind === "deleted") {
		return t("common.worksCouncil.positionStamps.deletedViewer", "A deleted user");
	}
	return t("common.worksCouncil.identityHidden", "Identity hidden");
}

function CountTile({ label, value, t }: { label: string; value: number | null; t: Translate }) {
	return (
		<section aria-label={label} className="rounded-md border p-3">
			<p className="text-muted-foreground text-sm">{label}</p>
			{value === null ? (
				<p className="mt-1 font-medium text-muted-foreground text-sm">
					{t("common.worksCouncil.insufficientData", "Insufficient data")}
				</p>
			) : (
				<p className="mt-1 font-semibold text-xl tabular-nums">{value}</p>
			)}
		</section>
	);
}

function AccessEntry({
	entry,
	locale,
	t,
}: {
	entry: PositionCaptureReviewAccessEntry;
	locale: string;
	t: Translate;
}) {
	return (
		<li className="space-y-1 px-4 py-3">
			<p className="font-medium">
				{entry.kind === "data_export"
					? t("common.worksCouncil.positionStamps.accessKindExport", "Data export")
					: t(
							"common.worksCouncil.positionStamps.accessKindDetail",
							"Work period detail ({count, plural, one {# work period} other {# work periods}})",
							{ count: entry.workPeriodCount },
						)}
			</p>
			<dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
				<dt className="text-muted-foreground">
					{t("common.worksCouncil.positionStamps.accessViewer", "Viewed by")}
				</dt>
				<dd>{identityLabel(entry.viewer, "viewer", t)}</dd>
				<dt className="text-muted-foreground">
					{t("common.worksCouncil.positionStamps.accessEmployees", "Positions of")}
				</dt>
				<dd>
					{entry.employees.state === "counted" ? (
						t(
							"common.worksCouncil.positionStamps.employeeCount",
							"{count, plural, one {# employee} other {# employees}}",
							{ count: entry.employees.count },
						)
					) : (
						<ul className="flex flex-wrap gap-x-3">
							{entry.employees.identities.map((identity, index) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat as "Identity hidden"
								<li key={index}>{identityLabel(identity, "employee", t)}</li>
							))}
						</ul>
					)}
				</dd>
				<dt className="text-muted-foreground">
					{t("common.worksCouncil.positionStamps.accessAt", "When")}
				</dt>
				<dd>
					<time dateTime={entry.accessedAt}>
						{formatRecordedPositionInstant(locale, entry.accessedAt)}
					</time>
				</dd>
			</dl>
		</li>
	);
}

/**
 * The works-council portal's read-only position capture section (#834). It
 * renders only what the review model holds: configuration, notices, consent
 * counts and the access log. No position ever reaches it.
 */
export function PositionCaptureReviewSection({
	review,
	locale,
	t,
}: {
	review: PositionCaptureReview;
	locale: string;
	t: Translate;
}) {
	const onOff = (enabled: boolean) =>
		enabled
			? t("common.worksCouncil.positionStamps.on", "On")
			: t("common.worksCouncil.positionStamps.off", "Off");
	const counts = review.consentCounts;
	const current = review.currentNotice;

	return (
		<section
			aria-labelledby="works-council-position-capture-title"
			className="rounded-lg border bg-card text-card-foreground shadow-sm"
		>
			<div className="border-b px-4 py-3">
				<h2 id="works-council-position-capture-title" className="font-semibold tracking-tight">
					{t("common.worksCouncil.positionStamps.title", "Position capture")}
				</h2>
				<p className="text-muted-foreground text-sm">
					{t(
						"common.worksCouncil.positionStamps.description",
						"How the organization records employees' positions with their clock events, and who looked at them. The works council never sees individual positions.",
					)}
				</p>
			</div>

			<div className="space-y-6 px-4 py-4">
				<dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
					<dt className="text-muted-foreground">
						{t("common.worksCouncil.positionStamps.enabled", "Capture")}
					</dt>
					<dd className="font-medium">{onOff(review.enabled)}</dd>
					<dt className="text-muted-foreground">
						{t("common.worksCouncil.positionStamps.retention", "Retention")}
					</dt>
					<dd className="font-medium">
						{t(
							"common.worksCouncil.positionStamps.retentionDays",
							"{days, plural, one {# day} other {# days}}",
							{ days: review.retentionDays },
						)}
					</dd>
					<dt className="text-muted-foreground">
						{t("common.worksCouncil.positionStamps.organizationAssignment", "Whole organization")}
					</dt>
					<dd className="font-medium">
						{review.organizationAssignment === null
							? t("common.worksCouncil.positionStamps.notAssigned", "Not assigned")
							: onOff(review.organizationAssignment)}
					</dd>
				</dl>

				<div className="grid gap-6 md:grid-cols-2">
					<section className="space-y-2">
						<h3 className="font-medium text-sm">
							{t("common.worksCouncil.positionStamps.teamAssignments", "Team assignments")}
						</h3>
						{review.teamAssignments.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								{t("common.worksCouncil.positionStamps.noTeamAssignments", "No team assignments.")}
							</p>
						) : (
							<ul className="divide-y rounded-md border text-sm">
								{review.teamAssignments.map((row) => (
									<li key={row.teamName} className="flex justify-between gap-4 px-3 py-2">
										<span className="break-words">{row.teamName}</span>
										<span className="font-medium">{onOff(row.captureEnabled)}</span>
									</li>
								))}
							</ul>
						)}
					</section>
					<section className="space-y-2">
						<h3 className="font-medium text-sm">
							{t("common.worksCouncil.positionStamps.employeeAssignments", "Employee assignments")}
						</h3>
						{review.employeeAssignments.state === "counted" ? (
							<p className="text-sm">
								{t(
									"common.worksCouncil.positionStamps.employeeAssignmentCounts",
									"{on} switched on, {off} switched off individually",
									{
										on: review.employeeAssignments.switchedOn,
										off: review.employeeAssignments.switchedOff,
									},
								)}
							</p>
						) : review.employeeAssignments.rows.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								{t(
									"common.worksCouncil.positionStamps.noEmployeeAssignments",
									"No employee assignments.",
								)}
							</p>
						) : (
							<ul className="divide-y rounded-md border text-sm">
								{review.employeeAssignments.rows.map((row, index) => (
									<li
										// biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat as "Identity hidden"
										key={index}
										className="flex justify-between gap-4 px-3 py-2"
									>
										<span className="break-words">
											{identityLabel(row.employee, "employee", t)}
										</span>
										<span className="font-medium">{onOff(row.captureEnabled)}</span>
									</li>
								))}
							</ul>
						)}
					</section>
				</div>

				<section className="space-y-2">
					<h3 className="font-medium text-sm">
						{t("common.worksCouncil.positionStamps.consentTitle", "Position consent")}
					</h3>
					<p className="text-muted-foreground text-sm">
						{t(
							"common.worksCouncil.positionStamps.consentDescription",
							"Among the {count, plural, one {# active employee} other {# active employees}} capture is switched on for. Undecided includes employees who chose Not now or agreed only to an earlier notice version.",
							{ count: counts.switchedOnEmployees },
						)}
					</p>
					<div className="grid gap-3 sm:grid-cols-3">
						<CountTile
							t={t}
							label={t("common.worksCouncil.positionStamps.consentActive", "Active consent")}
							value={counts.state === "available" ? counts.active : null}
						/>
						<CountTile
							t={t}
							label={t("common.worksCouncil.positionStamps.consentWithdrawn", "Withdrawn")}
							value={counts.state === "available" ? counts.withdrawn : null}
						/>
						<CountTile
							t={t}
							label={t("common.worksCouncil.positionStamps.consentUndecided", "Undecided")}
							value={counts.state === "available" ? counts.undecided : null}
						/>
					</div>
				</section>

				<section className="space-y-2">
					<h3 className="font-medium text-sm">
						{t("common.worksCouncil.positionStamps.currentNotice", "Current notice")}
					</h3>
					{current ? (
						<div className="rounded-md border p-3">
							<PositionNoticeText
								version={current.version}
								purposeStatement={current.purposeStatement}
								retentionDays={Math.min(review.retentionDays, current.retentionDays)}
							/>
						</div>
					) : (
						<p className="text-muted-foreground text-sm">
							{t("common.worksCouncil.positionStamps.noNotice", "No notice has been published.")}
						</p>
					)}
				</section>

				{review.noticeHistory.length > 0 && (
					<section className="space-y-2">
						<h3 className="font-medium text-sm">
							{t("common.worksCouncil.positionStamps.noticeHistory", "Notice versions")}
						</h3>
						<ul className="divide-y rounded-md border text-sm">
							{review.noticeHistory.map((notice) => (
								<li key={notice.version} className="space-y-1 px-3 py-2">
									<p className="font-medium">
										{t(
											"common.worksCouncil.positionStamps.noticeVersion",
											"Version {version}, published {publishedAt}, positions kept {days, plural, one {# day} other {# days}}",
											{
												version: notice.version,
												publishedAt: formatRecordedPositionInstant(locale, notice.publishedAt),
												days: notice.retentionDays,
											},
										)}
									</p>
									<p className="whitespace-pre-line break-words text-muted-foreground">
										{notice.purposeStatement}
									</p>
								</li>
							))}
						</ul>
					</section>
				)}

				<section className="space-y-2">
					<h3 className="font-medium text-sm">
						{t("common.worksCouncil.positionStamps.accessLog", "Position access log")}
					</h3>
					<p className="text-muted-foreground text-sm">
						{t(
							"common.worksCouncil.positionStamps.accessLogDescription",
							"Every time someone other than the employee viewed or exported positions, newest first.",
						)}
					</p>
					{review.accessLog.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							{t(
								"common.worksCouncil.positionStamps.accessLogEmpty",
								"No one has viewed positions.",
							)}
						</p>
					) : (
						<ul className="divide-y rounded-md border">
							{review.accessLog.map((entry) => (
								<AccessEntry key={entry.id} entry={entry} locale={locale} t={t} />
							))}
						</ul>
					)}
				</section>
			</div>
		</section>
	);
}
