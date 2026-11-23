"use client";

import {
	IconAlertTriangle,
	IconCircleCheck,
	IconClockHour4,
	IconDeviceMobile,
	IconDeviceTablet,
	IconFingerprint,
	IconSearch,
	IconUserShield,
} from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useDeferredValue, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHeaderRow,
	TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
	type CoverageFilter,
	type CoverageRow,
	type CoverageSummary,
	formatCoverageInstant,
	matchesCoverageFilter,
	matchesCoverageSearch,
	type MemberCoverageStatus,
} from "./coverage-model";

/** One shared surface with dividers: enrollment progress, attention and administrator readiness. */
export function MfaCoverageSummary({
	summary,
	policyEnabled,
}: {
	summary: CoverageSummary;
	policyEnabled: boolean;
}) {
	const { t } = useTranslate();
	const attention = summary.blocked + summary.due + summary.unenrolled;
	return (
		<section
			aria-labelledby="mfa-coverage-summary-title"
			className="grid rounded-xl border bg-card text-card-foreground shadow-sm sm:grid-cols-3 sm:divide-x max-sm:divide-y"
		>
			<h2 id="mfa-coverage-summary-title" className="sr-only">
				{t("mfa.summary.title", "Enrollment summary")}
			</h2>
			<div className="min-w-0 space-y-3 p-5">
				<p className="text-sm text-muted-foreground">
					{t("mfa.summary.enrolled", "Members enrolled")}
				</p>
				<p className="text-2xl font-semibold tabular-nums">
					{t("mfa.summary.enrolledValue", "{enrolled} of {total}", {
						enrolled: summary.enrolled,
						total: summary.inScope,
					})}
				</p>
				<Progress
					value={summary.percentEnrolled}
					aria-label={t("mfa.summary.progress", "{percent}% of members in scope are enrolled", {
						percent: summary.percentEnrolled,
					})}
				/>
				{summary.outside > 0 && (
					<p className="text-xs text-muted-foreground">
						{t(
							"mfa.summary.outside",
							"{count, plural, one {# kiosk account} other {# kiosk accounts}} outside scope",
							{ count: summary.outside },
						)}
					</p>
				)}
			</div>
			<div className="min-w-0 space-y-3 p-5">
				<p className="text-sm text-muted-foreground">
					{t("mfa.summary.attention", "Without a method")}
				</p>
				<p
					className={cn(
						"text-2xl font-semibold tabular-nums",
						summary.blocked > 0 && "text-destructive",
					)}
				>
					{attention}
				</p>
				<p className="text-xs text-muted-foreground">
					{policyEnabled
						? t(
								"mfa.summary.attentionDetail",
								"{blocked} blocked now · {due} within their enrollment window",
								{ blocked: summary.blocked, due: summary.due },
							)
						: t("mfa.summary.attentionOff", "Would need to enroll once the requirement is on")}
				</p>
			</div>
			<div className="min-w-0 space-y-3 p-5">
				<p className="text-sm text-muted-foreground">
					{t("mfa.summary.administrators", "Administrators enrolled")}
				</p>
				<p
					className={cn(
						"text-2xl font-semibold tabular-nums",
						summary.administrators > 0 && summary.administratorsEnrolled < 2 && "text-warning",
					)}
				>
					{t("mfa.summary.enrolledValue", "{enrolled} of {total}", {
						enrolled: summary.administratorsEnrolled,
						total: summary.administrators,
					})}
				</p>
				<p className="text-xs text-muted-foreground">
					{summary.administratorsEnrolled < 2
						? t(
								"mfa.summary.administratorsLow",
								"Add or enroll a second administrator so one lost device cannot lock the organization.",
							)
						: t(
								"mfa.summary.administratorsOk",
								"Enrollment alone does not prove a working sign-in route.",
							)}
				</p>
			</div>
		</section>
	);
}

function StatusBadge({ row, policyEnabled }: { row: CoverageRow; policyEnabled: boolean }) {
	const { t } = useTranslate();
	const config: Record<
		MemberCoverageStatus,
		{ label: string; className: string; icon: typeof IconCircleCheck }
	> = {
		blocked: {
			label: t("mfa.status.blocked", "Blocked until enrolled"),
			className: "border-destructive/40 bg-destructive/10 text-destructive",
			icon: IconAlertTriangle,
		},
		due: {
			label: t("mfa.status.due", "Enrollment due"),
			className: "border-warning/40 bg-warning/10 text-warning",
			icon: IconClockHour4,
		},
		unenrolled: {
			label: t("mfa.status.unenrolled", "Not enrolled"),
			className: "text-muted-foreground",
			icon: IconClockHour4,
		},
		enrolled: {
			label: t("mfa.status.enrolled", "Enrolled"),
			className: "border-success/40 bg-success/10 text-success",
			icon: IconCircleCheck,
		},
		outside: {
			label: t("mfa.status.outside", "Outside scope"),
			className: "text-muted-foreground",
			icon: IconDeviceTablet,
		},
	};
	const { label, className, icon: Icon } = config[row.status];
	// Only say what the badge does not already imply.
	const detail =
		row.status === "outside"
			? t("mfa.status.kiosk", "Kiosk only")
			: !policyEnabled
				? null
				: row.status === "enrolled" && !row.enforced && row.deadline
					? t("mfa.status.grace", "In enrollment window")
					: row.status === "unenrolled"
						? t("mfa.status.notApplied", "Not applied yet")
						: null;
	return (
		<div className="space-y-1">
			<Badge variant="outline" className={className}>
				<Icon aria-hidden="true" />
				{label}
			</Badge>
			{detail && <p className="text-xs text-muted-foreground">{detail}</p>}
		</div>
	);
}

function MethodBadges({ methods }: { methods: readonly string[] }) {
	const { t } = useTranslate();
	if (methods.length === 0)
		return <span className="text-muted-foreground">{t("mfa.coverage.none", "None")}</span>;
	return (
		<div className="flex flex-wrap gap-1.5">
			{methods.map((method) => (
				<Badge key={method} variant="secondary">
					{method === "passkey" ? (
						<IconFingerprint aria-hidden="true" />
					) : (
						<IconDeviceMobile aria-hidden="true" />
					)}
					{method === "passkey"
						? t("mfa.method.passkey", "Passkey")
						: method === "totp"
							? t("mfa.method.totp", "Authenticator app")
							: method}
				</Badge>
			))}
		</div>
	);
}

export function MfaMemberCoverage({
	rows,
	summary,
	timezone,
	policyEnabled,
}: {
	rows: readonly CoverageRow[];
	summary: CoverageSummary;
	timezone: string;
	policyEnabled: boolean;
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const [search, setSearch] = useState("");
	const [filter, setFilter] = useState<CoverageFilter>("all");
	const deferredSearch = useDeferredValue(search);
	const visible = rows.filter(
		(row) => matchesCoverageFilter(row, filter) && matchesCoverageSearch(row, deferredSearch),
	);
	const filters: { value: CoverageFilter; label: string; count: number }[] = [
		{ value: "all", label: t("mfa.filter.all", "All"), count: rows.length },
		{
			value: "attention",
			label: t("mfa.filter.attention", "Needs attention"),
			count: summary.blocked + summary.due + summary.unenrolled,
		},
		{ value: "enrolled", label: t("mfa.filter.enrolled", "Enrolled"), count: summary.enrolled },
	];
	if (summary.outside > 0)
		filters.push({
			value: "outside",
			label: t("mfa.filter.outside", "Outside scope"),
			count: summary.outside,
		});
	const format = (value: string) => formatCoverageInstant(value, timezone, locale);
	return (
		<Card className="gap-4">
			<CardHeader>
				<CardTitle as="h2" className="text-base">
					{t("mfa.coverage.title", "Member enrollment and organization verification")}
				</CardTitle>
				<CardDescription>
					{t(
						"mfa.coverage.description",
						"Members who need attention are listed first. Times are shown in the organization time zone ({timezone}).",
						{ timezone },
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-wrap items-center gap-3">
					<InputGroup className="flex-[1_1_14rem]">
						<InputGroupAddon>
							<IconSearch aria-hidden="true" />
						</InputGroupAddon>
						<InputGroupInput
							type="search"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder={t("mfa.coverage.search", "Search by name or email")}
							aria-label={t("mfa.coverage.search", "Search by name or email")}
						/>
					</InputGroup>
					<ToggleGroup
						type="single"
						variant="outline"
						size="sm"
						value={filter}
						onValueChange={(value) => {
							if (value) setFilter(value as CoverageFilter);
						}}
						aria-label={t("mfa.filter.label", "Filter members")}
						className="max-w-full flex-wrap"
					>
						{filters.map((option) => (
							<ToggleGroupItem key={option.value} value={option.value} className="px-2.5">
								{option.label}
								<span className="tabular-nums text-muted-foreground">{option.count}</span>
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</div>
				<Table mobileLayout="stacked">
					<TableCaption className="sr-only">
						{t("mfa.coverage.title", "Member enrollment and organization verification")}
					</TableCaption>
					<TableHeaderRow
						columns={[
							{ id: "member", label: t("mfa.coverage.member", "Member") },
							{ id: "status", label: t("mfa.coverage.status", "Status") },
							{ id: "methods", label: t("mfa.coverage.methods", "Enrolled methods") },
							{ id: "deadline", label: t("mfa.coverage.deadline", "Assigned deadline") },
							{ id: "lastAccess", label: t("mfa.coverage.lastAccess", "Last verified access") },
						]}
					/>
					<TableBody>
						{visible.map((row) => (
							<TableRow key={row.userId} className="align-top">
								<TableCell className="min-w-48 max-w-72 whitespace-normal py-3">
									<div className="flex flex-wrap items-center gap-1.5">
										<span className="break-words font-medium">{row.name}</span>
										{row.isAdministrator && (
											<Badge variant="outline" className="text-muted-foreground">
												<IconUserShield aria-hidden="true" />
												{t("mfa.coverage.admin", "Admin")}
											</Badge>
										)}
									</div>
									{row.email && (
										<p className="break-words text-xs text-muted-foreground">{row.email}</p>
									)}
								</TableCell>
								<TableCell className="py-3">
									<StatusBadge row={row} policyEnabled={policyEnabled} />
								</TableCell>
								<TableCell className="whitespace-normal py-3">
									<MethodBadges methods={row.methods} />
								</TableCell>
								<TableCell className="py-3 tabular-nums">
									{row.deadline ? (
										<time dateTime={row.deadline}>{format(row.deadline)}</time>
									) : (
										<span className="text-muted-foreground">—</span>
									)}
								</TableCell>
								<TableCell className="py-3 tabular-nums">
									{row.lastQualifyingAccessAt ? (
										<time dateTime={row.lastQualifyingAccessAt}>
											{format(row.lastQualifyingAccessAt)}
										</time>
									) : (
										<span className="whitespace-normal text-muted-foreground">
											{t("mfa.coverage.unproven", "No qualifying access recorded")}
										</span>
									)}
								</TableCell>
							</TableRow>
						))}
						{visible.length === 0 && (
							<TableRow className="hover:bg-transparent">
								<TableCell colSpan={5} className="whitespace-normal py-10 text-center">
									<p className="font-medium">
										{rows.length === 0
											? t("mfa.coverage.empty", "This organization has no members yet.")
											: t("mfa.coverage.noMatch", "No members match this view.")}
									</p>
									{rows.length > 0 && (
										<Button
											type="button"
											variant="link"
											onClick={() => {
												setSearch("");
												setFilter("all");
											}}
										>
											{t("mfa.coverage.clear", "Show all members")}
										</Button>
									)}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}
