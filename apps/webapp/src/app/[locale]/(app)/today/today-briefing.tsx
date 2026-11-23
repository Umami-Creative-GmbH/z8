"use client";

import {
	IconAlertTriangle,
	IconArrowRight,
	IconCalendarCheck,
	IconClipboardCheck,
	IconClockExclamation,
	IconCurrencyEuro,
	IconShieldCheck,
	IconUsersGroup,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import type { ComponentType, SVGProps } from "react";
import { Temporal } from "temporal-polyfill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import type {
	BriefingActionItem,
	BriefingActionSeverity,
	BriefingSection,
	ManagerDailyBriefing,
} from "@/lib/manager-daily-briefing/types";
import { Link } from "@/navigation";
import { TodayApprovalsPanel } from "./today-approvals-panel";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

type TodayBriefingProps = {
	briefing: ManagerDailyBriefing;
	onRetry?: () => void;
	isRefreshing?: boolean;
	readError?: string;
	onDecision?: () => void;
};

type SummaryCardProps = {
	title: string;
	value: number | undefined;
	description: string;
	icon: IconComponent;
	tone?: "default" | "critical" | "warning";
};

type TFunction = ReturnType<typeof useTranslate>["t"];

type SectionCardProps = {
	section: BriefingSection;
	icon: IconComponent;
	onRetry?: () => void;
};

type EmptyStateProps = {
	message: string;
};

const summaryCards: Array<{
	key: keyof ManagerDailyBriefing["summary"];
	titleKey: string;
	fallbackTitle: string;
	descriptionKey: string;
	fallbackDescription: string;
	icon: IconComponent;
	tone?: SummaryCardProps["tone"];
}> = [
	{
		key: "criticalIssues",
		titleKey: "today.briefing.summary.criticalIssues.title",
		fallbackTitle: "Critical issues",
		descriptionKey: "today.briefing.summary.criticalIssues.description",
		fallbackDescription: "Highest-priority items across today.",
		icon: IconAlertTriangle,
		tone: "critical",
	},
	{
		key: "openApprovals",
		titleKey: "today.briefing.summary.openApprovals.title",
		fallbackTitle: "Open approvals",
		descriptionKey: "today.briefing.summary.openApprovals.description",
		fallbackDescription: "Requests waiting for a decision.",
		icon: IconClipboardCheck,
	},
	{
		key: "attendanceExceptions",
		titleKey: "today.briefing.summary.attendanceExceptions.title",
		fallbackTitle: "Clock-in exceptions",
		descriptionKey: "today.briefing.summary.attendanceExceptions.description",
		fallbackDescription: "Published shifts needing attention.",
		icon: IconClockExclamation,
		tone: "warning",
	},
	{
		key: "payrollIssues",
		titleKey: "today.briefing.summary.payrollIssues.title",
		fallbackTitle: "Payroll issues",
		descriptionKey: "today.briefing.summary.payrollIssues.description",
		fallbackDescription: "Setup gaps before export readiness.",
		icon: IconCurrencyEuro,
		tone: "warning",
	},
	{
		key: "coverageRisks",
		titleKey: "today.briefing.summary.coverageRisks.title",
		fallbackTitle: "Coverage risks",
		descriptionKey: "today.briefing.summary.coverageRisks.description",
		fallbackDescription: "Minimum staffing risks for today.",
		icon: IconShieldCheck,
		tone: "warning",
	},
	{
		key: "overtimeWarnings",
		titleKey: "today.briefing.summary.overtimeWarnings.title",
		fallbackTitle: "Overtime warnings",
		descriptionKey: "today.briefing.summary.overtimeWarnings.description",
		fallbackDescription: "Employees nearing overtime thresholds.",
		icon: IconUsersGroup,
	},
];

const supportingSections: Array<{
	key: Exclude<keyof ManagerDailyBriefing["sections"], "approvals">;
	icon: IconComponent;
}> = [
	{ key: "attendance", icon: IconClockExclamation },
	{ key: "absences", icon: IconCalendarCheck },
	{ key: "coverage", icon: IconShieldCheck },
	{ key: "overtime", icon: IconUsersGroup },
	{ key: "payroll", icon: IconCurrencyEuro },
];

export function TodayBriefing({
	briefing,
	onRetry,
	isRefreshing,
	readError,
	onDecision,
}: TodayBriefingProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	// Display the already-resolved business day; never convert it through the viewer's zone.
	const briefingDate = Temporal.PlainDate.from(briefing.date).toLocaleString(locale, {
		weekday: "short",
		year: "numeric",
		month: "short",
		day: "numeric",
	});
	// Keep the source instant's offset explicit instead of relabeling it as device-local time.
	const generatedAt = `${Temporal.Instant.from(briefing.generatedAt)
		.toZonedDateTimeISO("UTC")
		.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })} UTC`;
	const incomplete = Boolean(
		readError ||
		briefing.needsActionError ||
		Object.values(briefing.sections).some((section) => section.error),
	);

	return (
		<div className="@container/main page-frame flex flex-1 flex-col gap-6" aria-busy={isRefreshing}>
			<PageHeader
				title={t("today.briefing.title", "Manager Daily Briefing")}
				scope={briefingDate}
				description={
					<div className="space-y-1">
						<p>
							{t(
								"today.briefing.scope",
								"Operational follow-up for the employees you may oversee in the active organization.",
							)}
						</p>
						<p className="break-words text-xs">
							{t(
								"today.briefing.snapshot",
								"Snapshot updated {time}. Use Refresh data to check for changes.",
								{ time: generatedAt },
							)}
						</p>
					</div>
				}
			/>
			{isRefreshing ? (
				<p role="status" className="text-sm text-muted-foreground">
					{t("today.briefing.refreshing", "Refreshing briefing. Previous results remain visible.")}
				</p>
			) : null}
			{readError ? <SectionError message={readError} onRetry={onRetry} /> : null}
			<section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
				<NeedsActionCard
					items={briefing.needsAction}
					t={t}
					incomplete={incomplete}
					error={
						briefing.needsActionError
							? t("today.briefing.drivingUnavailable", "Driving details could not be checked.")
							: undefined
					}
					onRetry={onRetry}
				/>
				<TodayApprovalsPanel
					items={briefing.sections.approvals.items}
					// Every pending approval, as the summary counts them; the list shows the first.
					total={briefing.summary.openApprovals}
					error={briefing.sections.approvals.error}
					unavailableTypes={briefing.sections.approvals.unavailableTypes}
					stale={Boolean(readError)}
					onRetry={onRetry}
					onDecision={onDecision}
				/>
			</section>

			<section
				className="grid overflow-hidden rounded-xl border bg-card sm:grid-cols-2 xl:grid-cols-6"
				aria-label={t("today.briefing.summaryAriaLabel", "Today summary")}
			>
				{summaryCards.map(
					({ key, titleKey, fallbackTitle, descriptionKey, fallbackDescription, ...card }) => (
						<SummaryCard
							key={key}
							{...card}
							title={t(titleKey, fallbackTitle)}
							description={t(descriptionKey, fallbackDescription)}
							value={
								readError ||
								(key === "criticalIssues"
									? incomplete
									: briefing.sections[summarySection[key]].error)
									? undefined
									: briefing.summary[key]
							}
						/>
					),
				)}
			</section>

			<section
				className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
				aria-label={t("today.briefing.supportingSectionsAriaLabel", "Supporting sections")}
			>
				{supportingSections.map(({ key, icon }) => (
					<SectionCard key={key} section={briefing.sections[key]} icon={icon} onRetry={onRetry} />
				))}
			</section>
		</div>
	);
}

function SummaryCard({
	title,
	value,
	description,
	icon: Icon,
	tone = "default",
}: SummaryCardProps) {
	const { t } = useTranslate();
	const toneClass = tone === "critical" && value ? "text-destructive" : "";

	return (
		<div className="min-w-0 border-b p-4 sm:odd:border-r xl:border-r xl:border-b-0 xl:last:border-r-0">
			<div className="space-y-3">
				<div className="flex items-center justify-between gap-3">
					<Icon className="size-4 text-muted-foreground" aria-hidden="true" />
					<span
						className={`break-words font-semibold tabular-nums ${value === undefined ? "text-sm" : "text-2xl"} ${toneClass}`}
					>
						{value ?? t("today.briefing.unavailable", "Unavailable")}
					</span>
				</div>
				<div className="space-y-1">
					<h2 className="font-medium text-sm">{title}</h2>
					<p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
				</div>
			</div>
		</div>
	);
}

function NeedsActionCard({
	items,
	t,
	incomplete,
	error,
	onRetry,
}: {
	items: BriefingActionItem[];
	t: TFunction;
	incomplete: boolean;
	error?: string;
	onRetry?: () => void;
}) {
	return (
		<Card className="gap-4">
			<CardHeader className="gap-2">
				<div className="flex items-start justify-between gap-3">
					<div className="space-y-1">
						<h2 className="font-semibold text-base leading-none">
							{t("today.briefing.needsAction.title", "Needs Action")}
						</h2>
						<CardDescription>
							{t(
								"today.briefing.needsAction.description",
								"Start here for the most urgent operational follow-up.",
							)}
						</CardDescription>
					</div>
					<Badge variant={items.length > 0 ? "default" : "secondary"}>
						{incomplete ? t("today.briefing.partial", "Partial") : items.length}
					</Badge>
				</div>
			</CardHeader>
			<CardContent>
				{error ? <SectionError message={error} onRetry={onRetry} /> : null}
				{incomplete ? (
					<p role="status" className="mb-3 text-sm text-muted-foreground">
						{t(
							"today.briefing.incomplete",
							"Some checks are unavailable. Review section errors; these results are incomplete.",
						)}
					</p>
				) : null}
				{items.length > 0 ? (
					<div className="divide-y rounded-lg border">
						{items.map((item) => (
							<ActionRow key={item.id} item={item} />
						))}
					</div>
				) : !incomplete ? (
					<EmptyState
						message={t(
							"today.briefing.needsAction.noExceptions",
							"No operational follow-up detected in this snapshot. This does not confirm employee presence.",
						)}
					/>
				) : null}
			</CardContent>
		</Card>
	);
}

function SectionCard({ section, icon: Icon, onRetry }: SectionCardProps) {
	const { t } = useTranslate();
	const title = section.titleKey ? t(section.titleKey, section.title) : section.title;

	return (
		<Card className="gap-4">
			<CardHeader className="gap-2">
				<div className="flex items-start justify-between gap-3">
					<div className="space-y-1">
						<h2 className="flex items-center gap-2 font-semibold text-base leading-snug">
							<Icon className="size-4 text-primary" aria-hidden="true" />
							{title}
						</h2>
						<CardDescription>
							{section.descriptionKey
								? t(section.descriptionKey, section.description)
								: section.description}
						</CardDescription>
					</div>
					<Badge variant={section.items.length > 0 ? "outline" : "secondary"}>
						{section.error ? t("today.briefing.unavailable", "Unavailable") : section.items.length}
					</Badge>
				</div>
			</CardHeader>
			<SectionItems section={section} onRetry={onRetry} title={title} />
		</Card>
	);
}

function SectionItems({
	section,
	onRetry,
	title,
}: Pick<SectionCardProps, "section" | "onRetry"> & { title: string }) {
	const { t } = useTranslate();
	return (
		<CardContent className="space-y-3">
			{section.error ? (
				<SectionError message={section.error} onRetry={onRetry} title={title} />
			) : null}
			{section.error && section.items.length > 0 ? (
				<p role="status" className="text-sm text-muted-foreground">
					{t(
						"today.briefing.retainedSection",
						"Previous results shown. Retry to check for changes.",
					)}
				</p>
			) : null}
			{section.items.length > 0 ? (
				<div className="divide-y rounded-lg border">
					{section.items.map((item) => (
						<ActionRow key={item.id} item={item} compact />
					))}
				</div>
			) : !section.error ? (
				<EmptyState
					message={
						section.emptyStateKey
							? t(section.emptyStateKey, section.emptyState ?? "No issues detected.")
							: (section.emptyState ?? t("today.briefing.sections.empty", "No issues detected."))
					}
				/>
			) : null}
		</CardContent>
	);
}

function ActionRow({ item, compact = false }: { item: BriefingActionItem; compact?: boolean }) {
	const { t } = useTranslate();
	const title = item.titleKey ? t(item.titleKey, item.title, item.titleParams) : item.title;
	const description = item.descriptionKey
		? t(item.descriptionKey, item.description, item.descriptionParams)
		: item.description;

	return (
		<Link
			href={item.href}
			className="group flex items-start justify-between gap-3 p-3 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
		>
			<div className="min-w-0 space-y-1 break-words">
				<div className="flex flex-wrap items-center gap-2">
					<SeverityBadge severity={item.severity} />
					<span className="min-w-0 break-words font-medium text-sm leading-snug">{title}</span>
				</div>
				<p
					className={`break-words text-muted-foreground text-sm leading-relaxed ${compact ? "line-clamp-2" : ""}`}
				>
					{description}
				</p>
			</div>
			<IconArrowRight
				className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
				aria-hidden="true"
			/>
		</Link>
	);
}

function SeverityBadge({ severity }: { severity: BriefingActionSeverity }) {
	const { t } = useTranslate();
	const label = {
		critical: t("today.briefing.severity.critical", "Critical"),
		high: t("today.briefing.severity.high", "High"),
		warning: t("today.briefing.severity.warning", "Warning"),
		info: t("today.briefing.severity.info", "Info"),
	}[severity];
	const variant =
		severity === "critical" ? "destructive" : severity === "info" ? "secondary" : "outline";

	return <Badge variant={variant}>{label}</Badge>;
}

function EmptyState({ message }: EmptyStateProps) {
	return (
		<div className="rounded-lg border border-dashed bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
			{message}
		</div>
	);
}

export function SectionError({
	message,
	onRetry,
	title,
}: {
	message: string;
	onRetry?: () => void;
	title?: string;
}) {
	const { t } = useTranslate();
	return (
		<div
			role="alert"
			className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm"
		>
			<p>{message}</p>
			<Button
				type="button"
				size="sm"
				variant="outline"
				onClick={onRetry}
				aria-label={
					title
						? t("today.briefing.retrySection", "Retry {title}", { title })
						: t("today.briefing.retry", "Retry briefing")
				}
			>
				{t("common.retry", "Retry")}
			</Button>
		</div>
	);
}

const summarySection = {
	criticalIssues: "attendance",
	openApprovals: "approvals",
	attendanceExceptions: "attendance",
	payrollIssues: "payroll",
	coverageRisks: "coverage",
	overtimeWarnings: "overtime",
	absencesToday: "absences",
} as const;
