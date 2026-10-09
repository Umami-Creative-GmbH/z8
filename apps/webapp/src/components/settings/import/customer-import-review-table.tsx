"use client";

import { IconChevronLeft, IconChevronRight, IconLink, IconPlus } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useTransition } from "react";
import { toast } from "sonner";
import { applyImportDecisionAction } from "@/app/[locale]/(app)/settings/import/review-actions";
import type {
	ImportReviewIssueSeverity,
	ImportReviewRowStatus,
} from "@/components/settings/import/import-review-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { StagedCustomer } from "@/lib/import-review/staged-customer";
import { Link, useRouter } from "@/navigation";
import { currentCustomerDecision, customerDecisionOptions } from "./customer-import-decisions";

/** A staged customer row of a customer import (#906), as the review screen shows it. */
export interface CustomerImportReviewRow {
	id: string;
	rowStatus: ImportReviewRowStatus;
	issueSeverity: ImportReviewIssueSeverity;
	commitChoice: { kind: "link"; targetId: string } | null;
	commitHold: { reason?: unknown } | null;
	customer: StagedCustomer;
}

/** A Z8 customer a contact can be linked to: not linked for this tool account yet. */
export interface CustomerLinkTarget {
	customerId: string;
	name: string;
}

export type CustomerDecision = "create" | "skip" | `link:${string}`;

export interface CustomerDecisionOption {
	value: CustomerDecision;
	kind: "create" | "suggested_link" | "link" | "skip";
	customerName?: string;
	disabled: boolean;
}

const LOCKED_STATUSES: ReadonlySet<ImportReviewRowStatus> = new Set(["committing", "committed"]);

const holdReasonLabels: Record<string, { key: string; fallback: string }> = {
	customer_name_taken: {
		key: "settings.import.review.customers.hold.customerNameTaken",
		fallback: "A customer with this name already exists. Link it instead, or skip the contact.",
	},
	contact_already_linked: {
		key: "settings.import.review.customers.hold.contactAlreadyLinked",
		fallback: "This contact was linked to a customer in the meantime.",
	},
	customer_already_linked: {
		key: "settings.import.review.customers.hold.customerAlreadyLinked",
		fallback: "The chosen customer is already linked to another contact.",
	},
	link_target_missing: {
		key: "settings.import.review.customers.hold.linkTargetMissing",
		fallback: "The chosen customer no longer exists.",
	},
	connection_changed: {
		key: "settings.import.review.customers.hold.connectionChanged",
		fallback: "The accounting connection changed. Start a new customer import.",
	},
	billable_time_off: {
		key: "settings.import.review.customers.hold.billableTimeOff",
		fallback: "Billable Time was switched off.",
	},
	invalid_row: {
		key: "settings.import.review.customers.hold.invalidRow",
		fallback: "The contact has no usable name.",
	},
};

const statusLabels: Record<ImportReviewRowStatus, { key: string; fallback: string }> = {
	accepted: { key: "settings.import.review.status.accepted", fallback: "Accepted" },
	blocked: { key: "settings.import.review.status.blocked", fallback: "Blocked" },
	commit_failed: { key: "settings.import.review.status.commitFailed", fallback: "Commit failed" },
	committed: { key: "settings.import.review.status.committed", fallback: "Committed" },
	committing: { key: "settings.import.review.status.committing", fallback: "Committing" },
	needs_mapping: { key: "settings.import.review.status.needsMapping", fallback: "Needs mapping" },
	rejected: { key: "settings.import.review.status.rejected", fallback: "Rejected" },
	staged: { key: "settings.import.review.status.staged", fallback: "Staged" },
};

/** Which page of the import's contacts the table shows (1-based). */
export interface CustomerImportPaging {
	page: number;
	pageCount: number;
}

interface CustomerImportReviewTableProps {
	organizationId: string;
	batchId: string;
	/** The contacts of the current page. */
	rows: CustomerImportReviewRow[];
	linkTargets: CustomerLinkTarget[];
	/** The batch is waiting for review decisions. */
	editable: boolean;
	paging?: CustomerImportPaging;
}

export function CustomerImportReviewTable({
	organizationId,
	batchId,
	rows,
	linkTargets,
	editable,
	paging,
}: CustomerImportReviewTableProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const unmatched = rows.filter(
		(row) => row.rowStatus === "staged" && !row.customer.suggestion && !row.customer.nameTakenBy,
	);

	function decide(
		rowIds: string[],
		decision: "accepted" | "rejected",
		choice?: { kind: "link"; targetId: string },
	) {
		startTransition(async () => {
			const result = await applyImportDecisionAction({
				organizationId,
				batchId,
				rowIds,
				decision,
				choice,
			});
			if (!result.success) {
				toast.error(
					result.error ||
						t("settings.import.review.customers.decisionFailed", "The decision could not be saved"),
				);
				return;
			}
			router.refresh();
		});
	}

	function onDecision(row: CustomerImportReviewRow, value: string | null) {
		if (value === "create") decide([row.id], "accepted");
		else if (value === "skip") decide([row.id], "rejected");
		else if (value?.startsWith("link:")) {
			decide([row.id], "accepted", { kind: "link", targetId: value.slice("link:".length) });
		}
	}

	function optionLabel(option: CustomerDecisionOption) {
		switch (option.kind) {
			case "create":
				return t("settings.import.review.customers.decision.create", "Create new customer");
			case "suggested_link":
				return t(
					"settings.import.review.customers.decision.linkSuggested",
					"Link to {name} (suggested)",
					{
						name: option.customerName ?? "",
					},
				);
			case "link":
				return option.customerName
					? t("settings.import.review.customers.decision.link", "Link to {name}", {
							name: option.customerName,
						})
					: t(
							"settings.import.review.customers.decision.linkChosen",
							"Link to the chosen customer",
						);
			case "skip":
				return t("settings.import.review.customers.decision.skip", "Skip");
		}
	}

	return (
		<Card>
			<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="space-y-1.5">
					<CardTitle>{t("settings.import.review.customers.title", "Customer contacts")}</CardTitle>
					<CardDescription>
						{t(
							"settings.import.review.customers.description",
							"Choose for each contact whether to create a new customer, link it to an existing customer, or skip it. Created and linked customers get a contact link. Nothing is changed in the accounting tool.",
						)}
					</CardDescription>
				</div>
				{editable && unmatched.length > 0 ? (
					<Button
						type="button"
						variant="outline"
						disabled={isPending}
						onClick={() =>
							decide(
								unmatched.map((row) => row.id),
								"accepted",
							)
						}
					>
						<IconPlus aria-hidden="true" className="size-4" />
						{t(
							"settings.import.review.customers.createUnmatched",
							"{count, plural, one {Create a customer for # contact without a match} other {Create customers for # contacts without a match}}",
							{ count: unmatched.length },
						)}
					</Button>
				) : null}
			</CardHeader>
			<CardContent className="min-w-0">
				{rows.length === 0 ? (
					<div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
						{t(
							"settings.import.review.customers.empty",
							"Every customer contact of the accounting tool is already linked to a customer.",
						)}
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead scope="col">
									{t("settings.import.review.customers.contact", "Contact")}
								</TableHead>
								<TableHead scope="col">
									{t("settings.import.review.customers.details", "Details")}
								</TableHead>
								<TableHead scope="col">
									{t("settings.import.review.customers.match", "Match in Z8")}
								</TableHead>
								<TableHead scope="col">
									{t("settings.import.review.customers.decision.label", "Decision")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => {
								const { customer } = row;
								const options = customerDecisionOptions(row, linkTargets);
								const hold =
									row.rowStatus === "blocked" && typeof row.commitHold?.reason === "string"
										? holdReasonLabels[row.commitHold.reason]
										: undefined;
								const status = statusLabels[row.rowStatus];
								return (
									<TableRow key={row.id} data-row-id={row.id}>
										<TableCell className="align-top">
											<div className="font-medium">{customer.name}</div>
											{customer.customerNumber ? (
												<div className="text-muted-foreground text-xs tabular-nums">
													{customer.customerNumber}
												</div>
											) : null}
										</TableCell>
										<TableCell className="max-w-64 whitespace-normal align-top text-sm">
											{customer.vatId ? <div>{customer.vatId}</div> : null}
											{customer.email ? <div className="break-all">{customer.email}</div> : null}
											{customer.address ? (
												<div className="whitespace-pre-line text-muted-foreground">
													{customer.address}
												</div>
											) : null}
										</TableCell>
										<TableCell className="max-w-64 whitespace-normal align-top text-sm">
											{customer.suggestion ? (
												<div className="flex items-start gap-1.5">
													<IconLink aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
													<span>
														{customer.suggestion.reason === "customer_number"
															? t(
																	"settings.import.review.customers.suggestion.customerNumber",
																	"{name} has a contact link with the same customer number",
																	{ name: customer.suggestion.customerName },
																)
															: t(
																	"settings.import.review.customers.suggestion.name",
																	"{name} has the same name",
																	{ name: customer.suggestion.customerName },
																)}
													</span>
												</div>
											) : customer.nameTakenBy ? (
												<span className="text-muted-foreground">
													{t(
														"settings.import.review.customers.nameTaken",
														"{name} has the same name and is already linked to another contact",
														{ name: customer.nameTakenBy.customerName },
													)}
												</span>
											) : (
												<span className="text-muted-foreground">
													{t("settings.import.review.customers.noMatch", "No match")}
												</span>
											)}
											{customer.duplicateNameInTool ? (
												<p className="mt-1 text-muted-foreground text-xs">
													{t(
														"settings.import.review.customers.duplicateInTool",
														"Another contact in the accounting tool has the same name; only one customer can have it.",
													)}
												</p>
											) : null}
										</TableCell>
										<TableCell className="min-w-56 align-top">
											<Select
												value={currentCustomerDecision(row)}
												disabled={!editable || isPending || LOCKED_STATUSES.has(row.rowStatus)}
												items={options.map((option) => ({
													value: option.value,
													label: optionLabel(option),
												}))}
												onValueChange={(value) => onDecision(row, value)}
											>
												<SelectTrigger
													className="w-full"
													aria-label={t(
														"settings.import.review.customers.decision.for",
														"Decision for {name}",
														{ name: customer.name },
													)}
												>
													<SelectValue
														placeholder={t(
															"settings.import.review.customers.decision.placeholder",
															"Choose…",
														)}
													/>
												</SelectTrigger>
												<SelectContent>
													{options.map((option) => (
														<SelectItem
															key={option.value}
															value={option.value}
															disabled={option.disabled}
														>
															{optionLabel(option)}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<div className="mt-1.5">
												<Badge variant={row.rowStatus === "blocked" ? "destructive" : "secondary"}>
													{t(status.key, status.fallback)}
												</Badge>
											</div>
											{hold ? (
												<p className="mt-1 max-w-64 whitespace-normal text-muted-foreground text-xs">
													{t(hold.key, hold.fallback)}
												</p>
											) : null}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				)}
				{paging && paging.pageCount > 1 ? (
					<nav
						aria-label={t("settings.import.review.customers.paging.label", "Contact pages")}
						className="mt-4 flex flex-wrap items-center justify-between gap-3"
					>
						<span className="text-muted-foreground text-sm tabular-nums">
							{t("settings.import.review.customers.paging.position", "Page {page} of {pageCount}", {
								page: paging.page,
								pageCount: paging.pageCount,
							})}
						</span>
						<div className="flex gap-2">
							{paging.page > 1 ? (
								<Button asChild variant="outline" size="sm">
									<Link href={`/settings/import/${batchId}?page=${paging.page - 1}`}>
										<IconChevronLeft aria-hidden="true" className="size-4" />
										{t("settings.import.review.customers.paging.previous", "Previous page")}
									</Link>
								</Button>
							) : null}
							{paging.page < paging.pageCount ? (
								<Button asChild variant="outline" size="sm">
									<Link href={`/settings/import/${batchId}?page=${paging.page + 1}`}>
										{t("settings.import.review.customers.paging.next", "Next page")}
										<IconChevronRight aria-hidden="true" className="size-4" />
									</Link>
								</Button>
							) : null}
						</div>
					</nav>
				) : null}
			</CardContent>
		</Card>
	);
}
