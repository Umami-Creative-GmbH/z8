"use client";

import { IconAlertTriangle, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { useId, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	DOCUMENT_REQUEST_STATUS_FILTERS,
	type DocumentRequestOverviewFilters,
	type DocumentRequestStatusFilter,
	type ManagedDocumentRequestView,
} from "@/lib/personnel-file/document-request-overview";
import { personnelFilePath } from "@/lib/personnel-file/paths";
import { Link, useRouter } from "@/navigation";
import { useDocumentRequestLabels } from "./document-request-labels";
import { DocumentRequestList } from "./document-request-list";
import { DocumentRequestOfficerActions } from "./document-request-officer-actions";

const PATH = "/personnel-files/document-requests";
const DEFAULT_STATUS: DocumentRequestStatusFilter = "active";

export interface DocumentRequestsOverviewProps {
	filters: DocumentRequestOverviewFilters;
	rows: ManagedDocumentRequestView[];
	total: number;
	page: number;
	pageCount: number;
	/** The organization's today (`YYYY-MM-DD`): the earliest new deadline. */
	today: string;
	/** The organization's timezone: history times are shown in it. */
	timezone: string;
}

/**
 * The officer "Document requests" page's list (#1403): the requests the
 * viewer covers, across employees, with status and overdue filters in the
 * URL (the page reloads the list on the server), and edit and cancel for open
 * and submitted requests.
 */
export function DocumentRequestsOverview(props: DocumentRequestsOverviewProps) {
	const { t } = useTranslate();
	const { push, refresh } = useRouter();
	const searchParams = useSearchParams();
	const [isPending, startTransition] = useTransition();
	const labels = useDocumentRequestLabels();
	const statusId = useId();
	const { filters } = props;

	const statusLabels: Record<DocumentRequestStatusFilter, string> = {
		active: t("settings.personnelFiles.requests.page.filters.active", "Open and submitted"),
		...labels.statuses,
		all: t("settings.personnelFiles.requests.page.filters.all", "All statuses"),
	};

	function update(changes: Record<string, string | number | null>) {
		const params = new URLSearchParams(searchParams.toString());
		for (const [key, value] of Object.entries(changes)) {
			if (value === null || value === "") params.delete(key);
			else params.set(key, String(value));
		}
		if (!Object.hasOwn(changes, "page")) params.delete("page");
		const query = params.toString();
		startTransition(() => {
			push(query ? `${PATH}?${query}` : PATH);
		});
	}

	return (
		<div className="flex flex-col gap-4" aria-busy={isPending}>
			<div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
				<div className="flex min-w-48 flex-col gap-1.5">
					<span id={statusId} className="text-sm font-medium">
						{t("settings.personnelFiles.requests.page.filters.status", "Status")}
					</span>
					<Select
						value={filters.status}
						onValueChange={(status) =>
							update({ status: status === DEFAULT_STATUS ? null : status })
						}
						disabled={isPending}
					>
						<SelectTrigger aria-labelledby={statusId} className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{DOCUMENT_REQUEST_STATUS_FILTERS.map((status) => (
								<SelectItem key={status} value={status}>
									{statusLabels[status]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<Button
					type="button"
					variant={filters.overdue ? "default" : "outline"}
					aria-pressed={filters.overdue}
					disabled={isPending}
					onClick={() => update({ overdue: filters.overdue ? null : "1" })}
				>
					<IconAlertTriangle aria-hidden="true" className="size-4" />
					{t("settings.personnelFiles.requests.page.filters.overdue", "Only overdue")}
				</Button>
			</div>

			{props.rows.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.personnelFiles.requests.page.empty",
						"No document requests match the filters.",
					)}
				</p>
			) : (
				<DocumentRequestList
					requests={props.rows}
					timezone={props.timezone}
					subject={(request) => {
						const row = props.rows.find((entry) => entry.id === request.id);
						return (
							<div className="flex flex-wrap items-center gap-2 text-sm">
								<Link
									href={personnelFilePath(request.employeeId)}
									className="font-medium underline-offset-4 hover:underline"
								>
									{row?.employeeName ?? request.employeeId}
								</Link>
								{row?.isFormer ? (
									<Badge variant="secondary">
										{t("settings.personnelFiles.area.former", "Former employee")}
									</Badge>
								) : null}
							</div>
						);
					}}
					actions={(request) => (
						<DocumentRequestOfficerActions
							request={request}
							today={props.today}
							onChanged={refresh}
						/>
					)}
				/>
			)}

			{props.pageCount > 1 ? (
				<div className="flex flex-wrap items-center justify-end gap-2 text-sm">
					<span className="tabular-nums">
						{t("settings.personnelFiles.requests.page.pagination", "Page {page} of {pageCount}", {
							page: props.page,
							pageCount: props.pageCount,
						})}
					</span>
					<Button
						type="button"
						variant="outline"
						size="icon"
						disabled={isPending || props.page <= 1}
						onClick={() => update({ page: props.page - 1 })}
						aria-label={t("settings.personnelFiles.requests.page.previous", "Previous page")}
					>
						<IconChevronLeft aria-hidden="true" className="size-4" />
					</Button>
					<Button
						type="button"
						variant="outline"
						size="icon"
						disabled={isPending || props.page >= props.pageCount}
						onClick={() => update({ page: props.page + 1 })}
						aria-label={t("settings.personnelFiles.requests.page.next", "Next page")}
					>
						<IconChevronRight aria-hidden="true" className="size-4" />
					</Button>
				</div>
			) : null}
		</div>
	);
}
