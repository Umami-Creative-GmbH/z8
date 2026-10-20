"use client";
import { IconUserSearch } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useSession } from "@/lib/auth-client";
import { getDrivingLicenceCheckWorklistAction } from "@/lib/organization/driving-licence/check-actions";
import type { AuthorizationStatus } from "@/lib/organization/driving-licence/check-types";
import { drivingLicenceCheckPath } from "@/lib/organization/driving-licence/paths";
import {
	DRIVING_LICENCE_WORKLIST_STATUSES,
	type DrivingLicenceWorklistStatus,
} from "@/lib/organization/driving-licence/worklist-query";
import { Link } from "@/navigation";
import { DrivingDeadlineDate } from "./deadline-date";

const SEARCH_DELAY_MS = 300;
type StatusFilter = DrivingLicenceWorklistStatus | "all";

function useStatusLabels(): Record<AuthorizationStatus, string> {
	const { t } = useTranslate();
	return {
		not_yet_checked: t("drivingLicence.checks.status.notYetChecked", "Not yet checked"),
		active: t("drivingLicence.checks.status.active", "Active"),
		partially_active: t("drivingLicence.checks.status.partiallyActive", "Partially active"),
		suspended: t("drivingLicence.checks.status.suspended", "Suspended"),
		ended: t("drivingLicence.checks.status.ended", "Ended"),
		not_enrolled: t("drivingLicence.checks.status.notIntended", "Not an intended driver"),
	};
}
const STATUS_BADGE: Record<
	AuthorizationStatus,
	"default" | "secondary" | "destructive" | "outline"
> = {
	not_yet_checked: "outline",
	active: "secondary",
	partially_active: "outline",
	suspended: "destructive",
	ended: "outline",
	not_enrolled: "outline",
};

/**
 * The verifier's Checks table (#1428): intended drivers in scope, searched and filtered on
 * the server, checks due now first, then the soonest deadline. A row's action opens that
 * employee's check page (#1429).
 */
export function DrivingLicenceVerifierWorklist() {
	const { t } = useTranslate();
	const { data: session } = useSession();
	const identity = [session?.session.activeOrganizationId, session?.user.id];
	const searchId = useId();
	const statusId = useId();
	const statusLabels = useStatusLabels();
	const [search, setSearch] = useState("");
	const [submittedSearch, setSubmittedSearch] = useState("");
	const [status, setStatus] = useState<StatusFilter>("all");
	useEffect(() => {
		const timer = setTimeout(() => setSubmittedSearch(search.trim()), SEARCH_DELAY_MS);
		return () => clearTimeout(timer);
	}, [search]);
	const query = {
		search: submittedSearch,
		status: status === "all" ? undefined : status,
	};
	const worklist = useQuery({
		queryKey: ["driving-licence-worklist", ...identity, query],
		queryFn: () => getDrivingLicenceCheckWorklistAction(query),
		placeholderData: (previous) => previous,
	});
	const rows = worklist.data?.success ? worklist.data.data : null;
	const filtered = !!query.search || !!query.status;
	const filterOptions: { value: StatusFilter; label: string }[] = [
		{ value: "all", label: t("drivingLicence.checks.filter.all", "All statuses") },
		...DRIVING_LICENCE_WORKLIST_STATUSES.map((value) => ({
			value,
			label: statusLabels[value],
		})),
	];

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2 className="text-lg font-semibold">
						{t("drivingLicence.checks.title", "Intended drivers to check")}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"drivingLicence.checks.help",
						"Intended drivers covered by your current verifier responsibility. You never appear in your own list.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-wrap items-end gap-3">
					<div className="flex min-w-56 flex-1 flex-col gap-1.5">
						<Label htmlFor={searchId}>{t("drivingLicence.checks.search", "Search by name")}</Label>
						<Input
							id={searchId}
							type="search"
							name="driving-check-search"
							autoComplete="off"
							maxLength={100}
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
					</div>
					<div className="flex min-w-48 flex-col gap-1.5">
						<span id={statusId} className="text-sm font-medium">
							{t("drivingLicence.checks.filter.status", "Status")}
						</span>
						<Select
							value={status}
							items={filterOptions}
							onValueChange={(value) => setStatus((value as StatusFilter | null) ?? "all")}
						>
							<SelectTrigger aria-labelledby={statusId} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{filterOptions.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>
				{worklist.isPending ? (
					<p role="status" className="text-sm text-muted-foreground">
						{t("drivingLicence.checks.loading", "Loading intended drivers…")}
					</p>
				) : !rows ? (
					<p role="alert" className="text-sm text-destructive">
						{t(
							"drivingLicence.checks.loadError",
							"The list could not be loaded. Check your current verifier responsibility.",
						)}
					</p>
				) : !rows.length ? (
					filtered ? (
						<p role="status" className="text-sm text-muted-foreground">
							{t(
								"drivingLicence.checks.noMatches",
								"No intended drivers match the search or filter.",
							)}
						</p>
					) : (
						<Empty className="border">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<IconUserSearch aria-hidden="true" />
								</EmptyMedia>
								<EmptyTitle>
									{t("drivingLicence.checks.empty.title", "Nobody to check yet")}
								</EmptyTitle>
								<EmptyDescription>
									{t(
										"drivingLicence.checks.empty.description",
										"Intended drivers in your verifier responsibility appear here. Ask an administrator if someone is missing.",
									)}
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					)
				) : (
					<Table aria-busy={worklist.isFetching} mobileLayout="stacked">
						<TableHeader>
							<TableRow>
								<TableHead>{t("drivingLicence.checks.column.name", "Name")}</TableHead>
								<TableHead>{t("drivingLicence.checks.column.status", "Status")}</TableHead>
								<TableHead>{t("drivingLicence.checks.column.deadline", "Next deadline")}</TableHead>
								<TableHead>{t("drivingLicence.checks.column.team", "Team")}</TableHead>
								<TableHead>
									<span className="sr-only">
										{t("drivingLicence.checks.column.action", "Action")}
									</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((person) => (
								<TableRow key={person.employeeId}>
									<TableCell className="font-medium">{person.name}</TableCell>
									<TableCell>
										<Badge variant={STATUS_BADGE[person.status]}>
											{statusLabels[person.status]}
										</Badge>
									</TableCell>
									<TableCell>
										{person.nextDeadline ? (
											<DrivingDeadlineDate
												validThrough={person.nextDeadline.validThrough}
												timezone={person.nextDeadline.timezone}
											/>
										) : person.status === "ended" ? (
											"—"
										) : (
											t("drivingLicence.checks.dueNow", "Check due now")
										)}
									</TableCell>
									<TableCell>{person.team ? person.team.name : "—"}</TableCell>
									<TableCell className="text-right">
										<Button asChild variant="outline" size="sm">
											<Link href={drivingLicenceCheckPath(person.employeeId)}>
												{person.canVerify
													? t("drivingLicence.worklist.open", "Check {name}", {
															name: person.name,
														})
													: t("drivingLicence.worklist.viewEnded", "View ended record for {name}", {
															name: person.name,
														})}
											</Link>
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
