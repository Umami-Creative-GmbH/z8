"use client";

import { DateTime } from "luxon";
import { useState, useTransition } from "react";

import { Link } from "@/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type {
	SelfServiceRequestItem,
	SelfServiceRequestResult,
	SelfServiceRequestSourceType,
	SelfServiceRequestStatus,
} from "@/lib/self-service-requests/types";
import { cancelMyAbsenceRequest } from "./actions";

interface MyRequestsClientProps {
	initialResult: SelfServiceRequestResult;
}

type StatusFilter = SelfServiceRequestStatus | "all";
type SourceTypeFilter = SelfServiceRequestSourceType | "all";

const sourceTypeLabels: Record<SelfServiceRequestSourceType, string> = {
	absence: "Absence",
	time_correction: "Time",
	travel_expense: "Expense",
};

const statusLabels: Record<SelfServiceRequestStatus, string> = {
	pending: "Pending",
	approved: "Approved",
	rejected: "Rejected",
	cancelled: "Cancelled",
};

export function MyRequestsClient({ initialResult }: MyRequestsClientProps) {
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [sourceTypeFilter, setSourceTypeFilter] = useState<SourceTypeFilter>("all");
	const [search, setSearch] = useState("");

	const normalizedSearch = search.trim().toLowerCase();
	const filteredItems = initialResult.items.filter((item) => {
		const matchesStatus = statusFilter === "all" || item.status === statusFilter;
		const matchesSourceType =
			sourceTypeFilter === "all" || item.sourceType === sourceTypeFilter;
		const searchableText = [
			item.title,
			item.subtitle,
			item.decisionReason ?? "",
			sourceTypeLabels[item.sourceType],
			statusLabels[item.status],
		]
			.join(" ")
			.toLowerCase();

		return (
			matchesStatus && matchesSourceType && searchableText.includes(normalizedSearch)
		);
	});
	const rejectedItems = filteredItems.filter((item) => item.status === "rejected");

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<header className="px-4 lg:px-6">
				<h1 className="text-2xl font-semibold tracking-tight">My Requests</h1>
				<p className="text-sm text-muted-foreground">
					Track pending requests, required fixes, and recent decisions in one place.
				</p>
			</header>

			<section
				aria-label="Request summary"
				className="grid gap-4 px-4 sm:grid-cols-2 lg:grid-cols-4 lg:px-6"
			>
				<SummaryCard label="Pending" value={initialResult.counts.pending} />
				<SummaryCard label="Required fixes" value={initialResult.counts.requiredFixes} />
				<SummaryCard label="Recent decisions" value={initialResult.counts.recentDecisions} />
				<SummaryCard label="Total loaded" value={initialResult.counts.total} />
			</section>

			{initialResult.sourceErrors.length > 0 ? (
				<section className="px-4 lg:px-6">
					<Alert variant="destructive">
						<AlertTitle>Some requests could not be loaded.</AlertTitle>
						<AlertDescription>
							<ul className="list-disc space-y-1 pl-4">
								{initialResult.sourceErrors.map((error) => (
									<li key={`${error.sourceType}-${error.message}`}>{error.message}</li>
								))}
							</ul>
						</AlertDescription>
					</Alert>
				</section>
			) : null}

			{rejectedItems.length > 0 ? (
				<section className="px-4 lg:px-6">
					<Card className="border-destructive/30 bg-destructive/5">
						<CardHeader>
							<CardTitle>Needs attention</CardTitle>
							<CardDescription>
								Rejected requests that may require a correction before resubmission.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-3">
							{rejectedItems.map((item) => (
								<div
									key={item.id}
									className="flex flex-col gap-3 rounded-lg border bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
								>
									<div className="min-w-0 space-y-1">
										<div className="flex flex-wrap items-center gap-2">
											<p className="font-medium">{item.title}</p>
											<Badge variant="destructive">Rejected</Badge>
										</div>
										<p className="text-sm text-muted-foreground">{item.subtitle}</p>
										<p className="text-sm">
											{item.decisionReason?.trim() || "No reason provided."}
										</p>
									</div>
									<RequestAction item={item} preferFix />
								</div>
							))}
						</CardContent>
					</Card>
				</section>
			) : null}

			<section className="px-4 lg:px-6">
				<Card>
					<CardHeader>
						<CardTitle>All requests</CardTitle>
						<CardDescription>
							Review requests across absences, time corrections, and expenses.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
							<label className="grid gap-2 text-sm font-medium">
								Search
								<Input
									name="request-search"
									autoComplete="off"
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									placeholder="Search by title…"
								/>
							</label>
							<label className="grid gap-2 text-sm font-medium">
								Status
								<select
									className="h-9 rounded-md border border-input bg-background px-3 text-foreground text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
									value={statusFilter}
									onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
								>
									<option value="all">All statuses</option>
									<option value="pending">Pending requests</option>
									<option value="approved">Approved requests</option>
									<option value="rejected">Rejected requests</option>
									<option value="cancelled">Cancelled requests</option>
								</select>
							</label>
							<label className="grid gap-2 text-sm font-medium">
								Type
								<select
									className="h-9 rounded-md border border-input bg-background px-3 text-foreground text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
									value={sourceTypeFilter}
									onChange={(event) =>
										setSourceTypeFilter(event.target.value as SourceTypeFilter)
									}
								>
									<option value="all">All types</option>
									<option value="absence">Absence</option>
									<option value="time_correction">Time</option>
									<option value="travel_expense">Expense</option>
								</select>
							</label>
						</div>

						{initialResult.items.length === 0 ? (
							<EmptyState title="No requests yet" />
						) : filteredItems.length === 0 ? (
							<EmptyState title="No requests match your filters" />
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Type</TableHead>
										<TableHead>Request</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Submitted</TableHead>
										<TableHead>Decision</TableHead>
										<TableHead className="text-right">Action</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{filteredItems.map((item) => (
										<TableRow key={item.id}>
											<TableCell>{sourceTypeLabels[item.sourceType]}</TableCell>
											<TableCell className="max-w-[320px] whitespace-normal">
												<div className="space-y-1">
													<p className="font-medium">{item.title}</p>
													<p className="text-muted-foreground text-sm">{item.subtitle}</p>
													{item.decisionReason ? (
														<p className="text-sm">Reason: {item.decisionReason}</p>
													) : null}
												</div>
											</TableCell>
											<TableCell>
												<StatusBadge status={item.status} />
											</TableCell>
											<TableCell>{formatDate(item.submittedAt)}</TableCell>
											<TableCell>{formatDate(item.resolvedAt)}</TableCell>
											<TableCell className="text-right">
												<RequestAction item={item} />
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>
			</section>
		</div>
	);
}

function SummaryCard({ label, value }: { label: string; value: number }) {
	return (
		<Card>
			<CardHeader className="pb-0">
				<CardDescription>{label}</CardDescription>
				<CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
			</CardHeader>
		</Card>
	);
}

function StatusBadge({ status }: { status: SelfServiceRequestStatus }) {
	if (status === "rejected") {
		return <Badge variant="destructive">Rejected</Badge>;
	}

	if (status === "approved") {
		return <Badge variant="default">Approved</Badge>;
	}

	if (status === "pending") {
		return <Badge variant="secondary">In review</Badge>;
	}

	return <Badge variant="outline">Cancelled</Badge>;
}

function RequestAction({
	item,
	preferFix = false,
}: {
	item: SelfServiceRequestItem;
	preferFix?: boolean;
}) {
	const [isCancelPending, startCancelTransition] = useTransition();
	const canFix = item.availableActions.includes("fix");
	const canView = item.availableActions.includes("view");
	const canCancel = item.availableActions.includes("cancel");
	const label = preferFix && canFix ? "Fix" : canView ? "View" : canFix ? "Fix" : null;

	if (!label && !canCancel) {
		return <span className="text-sm text-muted-foreground">Not available</span>;
	}

	function handleCancel() {
		startCancelTransition(() => {
			void cancelMyAbsenceRequest(item.sourceId);
		});
	}

	return (
		<div className="flex flex-wrap justify-end gap-2">
			{label ? (
				<Button asChild size="sm" variant={label === "Fix" ? "default" : "outline"}>
					<Link href={item.sourceHref}>{label}</Link>
				</Button>
			) : null}
			{canCancel ? (
				<Button
					type="button"
					size="sm"
					variant="destructive"
					disabled={isCancelPending}
					onClick={handleCancel}
				>
					Cancel
				</Button>
			) : null}
		</div>
	);
}

function EmptyState({ title }: { title: string }) {
	return (
		<div className="rounded-lg border border-dashed p-8 text-center">
			<p className="font-medium">{title}</p>
			<p className="mt-1 text-sm text-muted-foreground">
				Requests will appear here when they are submitted or loaded.
			</p>
		</div>
	);
}

function formatDate(date: Date | null) {
	if (!date) {
		return "-";
	}

	return DateTime.fromJSDate(date).toLocaleString(DateTime.DATE_MED);
}
