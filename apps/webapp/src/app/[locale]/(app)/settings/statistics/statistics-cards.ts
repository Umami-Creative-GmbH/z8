import type { KpiProgress, KpiTone, KpiTrend } from "@/components/ui/kpi-card";
import { numberFormatter } from "@/lib/intl-number-format";
import {
	changeDirection,
	formatComparisonDays,
	formatHours,
	formatPercent,
	formatSignedCount,
} from "./statistics-format";
import type {
	AdoptionStatistics,
	ApprovalInboxSummary,
	AttentionStatistics,
	Kpi,
	LikeForLike,
	MonthStatistics,
	WorkforceStatistics,
} from "./statistics-types";

/** The translate function of `getTranslate()`: a key, its English default and ICU params. */
export type Translate = (
	key: string,
	defaultValue: string,
	params?: Record<string, string | number>,
) => string;

/** One KPI card, ready to render. */
export interface StatisticsCard {
	key: string;
	label: string;
	value: string;
	/** A unit written after the value. */
	unit?: string;
	tone: KpiTone;
	caption?: string;
	trend?: KpiTrend;
	progress?: KpiProgress;
	/** Where to act on the figure, only when the viewer can act there. */
	link?: { href: string; label: string };
}

/** What the viewer may open from the page. */
export interface StatisticsLinks {
	approvals: boolean;
	payrollReadiness: boolean;
	workPolicies: boolean;
}

interface CardContext {
	t: Translate;
	locale: string;
}

const NOT_LOADED = "—";

function failedCard(key: string, label: string, { t }: CardContext): StatisticsCard {
	return {
		key,
		label,
		value: NOT_LOADED,
		tone: "neutral",
		caption: t("settings.statistics.kpi.failed", "Couldn't load"),
	};
}

function count(value: number, locale: string) {
	return numberFormatter(locale).format(value);
}

/** Amber when something waits, otherwise no status: zero waiting is not an achievement. */
function attentionTone(value: number): KpiTone {
	return value > 0 ? "warning" : "neutral";
}

// ── Needs attention ───────────────────────────────────────────────────────────

export interface AttentionCards {
	cards: StatisticsCard[];
	/** True when every figure loaded and is zero: the group shows "All clear". */
	allClear: boolean;
}

export function attentionCards(
	data: AttentionStatistics,
	approvals: ApprovalInboxSummary,
	links: StatisticsLinks,
	context: CardContext,
): AttentionCards {
	const { t, locale } = context;
	const cards: StatisticsCard[] = [];

	const approvalsLabel = t("settings.statistics.kpi.pendingApprovals", "Pending approvals");
	if (approvals.status === "failed") {
		cards.push(failedCard("pendingApprovals", approvalsLabel, context));
	} else if (approvals.value) {
		const { pending, absenceRequests } = approvals.value;
		cards.push({
			key: "pendingApprovals",
			label: approvalsLabel,
			value: count(pending, locale),
			tone: attentionTone(pending),
			caption: t(
				"settings.statistics.kpi.pendingApprovalsCaption",
				"{count, plural, =0 {No absence requests} one {Including # absence request} other {Including # absence requests}}",
				{ count: absenceRequests },
			),
			link: links.approvals
				? {
						href: "/approvals/inbox",
						label: t("settings.statistics.kpi.openInbox", "Open inbox"),
					}
				: undefined,
		});
	}

	const staleLabel = t("settings.statistics.kpi.staleLiveWork", "Stale live work");
	if (data.staleLiveWork.status === "failed") {
		cards.push(failedCard("staleLiveWork", staleLabel, context));
	} else {
		cards.push({
			key: "staleLiveWork",
			label: staleLabel,
			value: count(data.staleLiveWork.value, locale),
			tone: attentionTone(data.staleLiveWork.value),
			caption: t(
				"settings.statistics.kpi.staleLiveWorkCaption",
				"Employees clocked in for more than 24 hours",
			),
			link: links.payrollReadiness
				? {
						href: "/settings/payroll-readiness",
						label: t("settings.statistics.kpi.openPayrollReadiness", "Review in payroll readiness"),
					}
				: undefined,
		});
	}

	const violationsLabel = t("settings.statistics.kpi.openViolations", "Open policy violations");
	if (data.openViolations.status === "failed") {
		cards.push(failedCard("openViolations", violationsLabel, context));
	} else {
		cards.push({
			key: "openViolations",
			label: violationsLabel,
			value: count(data.openViolations.value, locale),
			tone: attentionTone(data.openViolations.value),
			caption: t(
				"settings.statistics.kpi.openViolationsCaption",
				"Not yet acknowledged this month",
			),
			link: links.workPolicies
				? {
						href: "/settings/work-policies",
						label: t("settings.statistics.kpi.openWorkPolicies", "Review in work policies"),
					}
				: undefined,
		});
	}

	const figures = [
		approvals.status === "ok" ? (approvals.value?.pending ?? 0) : null,
		valueOrNull(data.staleLiveWork),
		valueOrNull(data.openViolations),
	];
	return { cards, allClear: figures.every((figure) => figure === 0) };
}

function valueOrNull(kpi: Kpi<number>) {
	return kpi.status === "ok" ? kpi.value : null;
}

// ── This month ────────────────────────────────────────────────────────────────

function likeForLikeCard(
	key: string,
	label: string,
	kpi: Kpi<LikeForLike>,
	comparedWith: string,
	format: (value: number) => string,
	unit: string,
	context: CardContext,
): StatisticsCard {
	if (kpi.status === "failed") {
		return failedCard(key, label, context);
	}
	const { t, locale } = context;
	const { current, previous } = kpi.value;
	return {
		key,
		label,
		value: format(current),
		unit,
		// A change in volume is neither good nor bad, so it stays neutral.
		tone: "neutral",
		trend: {
			direction: changeDirection(kpi.value),
			label: t("settings.statistics.kpi.vsComparison", "{change} vs. {days}", {
				change: formatSignedCount(current - previous, locale, 1),
				days: comparedWith,
			}),
			detail: t("settings.statistics.kpi.comparisonDetail", "{days}: {previous}", {
				days: comparedWith,
				previous: format(previous),
			}),
		},
	};
}

export function monthCards(data: MonthStatistics, context: CardContext): StatisticsCard[] {
	const { t, locale } = context;
	const comparedWith = formatComparisonDays(data.comparison, locale);
	const hours = (minutes: number) => formatHours(minutes, locale);
	const days = (value: number) =>
		numberFormatter(locale, { maximumFractionDigits: 1 }).format(value);
	const whole = (value: number) => count(value, locale);
	// The like-for-like change of hours is in hours, not minutes.
	const workedHours: Kpi<LikeForLike> =
		data.workedMinutes.status === "ok"
			? {
					status: "ok",
					value: {
						current: data.workedMinutes.value.current / 60,
						previous: data.workedMinutes.value.previous / 60,
					},
				}
			: data.workedMinutes;
	return [
		likeForLikeCard(
			"hoursWorked",
			t("settings.statistics.kpi.hoursWorked", "Hours worked"),
			workedHours,
			comparedWith,
			(value) => hours(value * 60),
			t("settings.statistics.kpi.hoursUnit", "h"),
			context,
		),
		likeForLikeCard(
			"absenceDays",
			t("settings.statistics.kpi.absenceDays", "Absence days"),
			data.absenceDays,
			comparedWith,
			days,
			t("settings.statistics.kpi.daysUnit", "days"),
			context,
		),
		likeForLikeCard(
			"completedWorkPeriods",
			t("settings.statistics.kpi.completedWorkPeriods", "Completed work periods"),
			data.completedWorkPeriods,
			comparedWith,
			whole,
			"",
			context,
		),
	];
}

// ── Tracking adoption ─────────────────────────────────────────────────────────

export function adoptionCards(data: AdoptionStatistics, context: CardContext): StatisticsCard[] {
	const { t, locale } = context;
	const cards: StatisticsCard[] = [];

	const coverageLabel = t("settings.statistics.kpi.trackingCoverage", "Tracking coverage");
	if (data.coverage.status === "failed") {
		cards.push(failedCard("trackingCoverage", coverageLabel, context));
	} else {
		const { tracked, expected } = data.coverage.value;
		cards.push(
			expected === 0
				? {
						key: "trackingCoverage",
						label: coverageLabel,
						value: NOT_LOADED,
						tone: "neutral",
						caption: t(
							"settings.statistics.kpi.trackingCoverageNone",
							"No one has required time yet this month",
						),
					}
				: {
						key: "trackingCoverage",
						label: coverageLabel,
						value: formatPercent(tracked, expected, locale),
						// No invented target: coverage carries no status colour.
						tone: "neutral",
						progress: {
							value: tracked,
							max: expected,
							label: t(
								"settings.statistics.kpi.trackingCoverageProgress",
								"Employees who recorded work this month",
							),
						},
						caption: t(
							"settings.statistics.kpi.trackingCoverageCaption",
							"{tracked} of {expected} employees with required time recorded work",
							{ tracked: count(tracked, locale), expected: count(expected, locale) },
						),
					},
		);
	}

	const clockedInLabel = t("settings.statistics.kpi.clockedIn", "Clocked in now");
	cards.push(
		data.clockedIn.status === "failed"
			? failedCard("clockedIn", clockedInLabel, context)
			: {
					key: "clockedIn",
					label: clockedInLabel,
					value: count(data.clockedIn.value, locale),
					tone: "neutral",
					caption: t("settings.statistics.kpi.clockedInCaption", "Employees with live work"),
				},
	);

	const manualLabel = t("settings.statistics.kpi.manualEntryShare", "Manual entry share");
	if (data.manualEntryShare.status === "failed") {
		cards.push(failedCard("manualEntryShare", manualLabel, context));
	} else {
		const { manualMinutes, totalMinutes } = data.manualEntryShare.value;
		cards.push(
			totalMinutes === 0
				? {
						key: "manualEntryShare",
						label: manualLabel,
						value: NOT_LOADED,
						tone: "neutral",
						caption: t(
							"settings.statistics.kpi.manualEntryShareNone",
							"No completed work this month yet",
						),
					}
				: {
						key: "manualEntryShare",
						label: manualLabel,
						value: formatPercent(manualMinutes, totalMinutes, locale),
						tone: "neutral",
						caption: t(
							"settings.statistics.kpi.manualEntryShareCaption",
							"{manual} h of {total} h recorded as manual entries",
							{
								manual: formatHours(manualMinutes, locale),
								total: formatHours(totalMinutes, locale),
							},
						),
					},
		);
	}
	return cards;
}

// ── Workforce & setup ─────────────────────────────────────────────────────────

export function workforceCards(
	data: WorkforceStatistics,
	{ organizationWide }: { organizationWide: boolean },
	context: CardContext,
): StatisticsCard[] {
	const { t, locale } = context;
	const cards: StatisticsCard[] = [];

	const employeesLabel = t("settings.statistics.kpi.employees", "Employees");
	if (data.roster.status === "failed") {
		cards.push(failedCard("employees", employeesLabel, context));
	} else {
		const { roster, joined, left } = data.roster.value;
		cards.push({
			key: "employees",
			label: employeesLabel,
			value: count(roster, locale),
			tone: "neutral",
			caption: t(
				"settings.statistics.kpi.employeesCaption",
				"+{joined} joined, −{left} left this month",
				{ joined: count(joined, locale), left: count(left, locale) },
			),
		});
	}

	const teamsLabel = t("settings.statistics.kpi.teams", "Teams");
	cards.push(
		data.teams.status === "failed"
			? failedCard("teams", teamsLabel, context)
			: {
					key: "teams",
					label: teamsLabel,
					value: count(data.teams.value, locale),
					tone: "neutral",
				},
	);

	const setupLabel = t("settings.statistics.kpi.incompleteSetup", "Incomplete setup");
	cards.push(
		data.incompleteSetup.status === "failed"
			? failedCard("incompleteSetup", setupLabel, context)
			: {
					key: "incompleteSetup",
					label: setupLabel,
					value: count(data.incompleteSetup.value, locale),
					tone: attentionTone(data.incompleteSetup.value),
					// Everyone in a manager's scope has a team, so only the work policy can be missing.
					caption: organizationWide
						? t(
								"settings.statistics.kpi.incompleteSetupCaption",
								"Employees with no primary team or no work policy",
							)
						: t(
								"settings.statistics.kpi.incompleteSetupManagerCaption",
								"Employees with no work policy",
							),
				},
	);

	if (data.usersSignedIn) {
		const signedInLabel = t("settings.statistics.kpi.usersSignedIn", "Users signed in");
		cards.push(
			data.usersSignedIn.status === "failed"
				? failedCard("usersSignedIn", signedInLabel, context)
				: {
						key: "usersSignedIn",
						label: signedInLabel,
						value: count(data.usersSignedIn.value, locale),
						tone: "neutral",
						caption: t(
							"settings.statistics.kpi.usersSignedInCaption",
							"Distinct users with an unexpired session",
						),
					},
		);
	}
	return cards;
}
