"use client";

import { IconChevronLeft, IconChevronRight, IconFileText, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useId, useTransition } from "react";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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
import { formatDays } from "@/lib/absences/date-utils";
import type { SickDetail } from "@/lib/absences/types";
import { personnelFilePath } from "@/lib/personnel-file/paths";
import {
	SICK_LEAVE_PAGE_SIZES,
	type SickLeaveNotesFilter,
	type SickLeaveOverviewFilters,
	type SickLeaveOverviewRow,
	type SickLeaveStatus,
} from "@/lib/personnel-file/sick-leave-overview";
import { formatAbsenceDateRange } from "@/lib/personnel-file/sick-note-labels";
import { Link, useRouter } from "@/navigation";
import { personnelDocumentUrl } from "./document-labels";

const PATH = "/personnel-files/sick-leave";
const ALL = "all";

export interface SickLeaveOverviewProps {
	filters: SickLeaveOverviewFilters;
	/** The default range, to leave it out of the URL. */
	defaultRange: { from: string; to: string };
	rows: SickLeaveOverviewRow[];
	total: number;
	page: number;
	pageCount: number;
	employees: Array<{ id: string; name: string; isActive: boolean }>;
	teams: Array<{ id: string; name: string }>;
}

function useSickLeaveLabels() {
	const { t } = useTranslate();
	const sickDetails: Record<SickDetail, string> = {
		child_sick: t("settings.personnelFiles.sickLeave.sickDetail.childSick", "Child sick"),
		with_certificate: t(
			"settings.personnelFiles.sickLeave.sickDetail.withCertificate",
			"With certificate",
		),
		without_certificate: t(
			"settings.personnelFiles.sickLeave.sickDetail.withoutCertificate",
			"Without certificate",
		),
		other: t("settings.personnelFiles.sickLeave.sickDetail.other", "Other"),
	};
	const statuses: Record<SickLeaveStatus, string> = {
		pending: t("settings.personnelFiles.sickLeave.status.pending", "Pending"),
		approved: t("settings.personnelFiles.sickLeave.status.approved", "Approved"),
	};
	const notes: Record<SickLeaveNotesFilter, string> = {
		all: t("settings.personnelFiles.sickLeave.filters.notesAll", "All"),
		missing: t(
			"settings.personnelFiles.sickLeave.filters.notesMissing",
			"With certificate, no note",
		),
		present: t("settings.personnelFiles.sickLeave.filters.notesPresent", "Has note"),
	};
	return { sickDetails, statuses, notes };
}

function FilterField({ label, children }: { label: string; children: (id: string) => ReactNode }) {
	const id = useId();
	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			<span id={id} className="text-sm font-medium">
				{label}
			</span>
			{children(id)}
		</div>
	);
}

function SickNotesCell({ row }: { row: SickLeaveOverviewRow }) {
	const { t } = useTranslate();
	if (row.sickNoteCount === 0) {
		return (
			<span className="text-muted-foreground">
				{t("settings.personnelFiles.sickLeave.notes.none", "No note")}
			</span>
		);
	}
	return (
		<div className="flex flex-col gap-1">
			<span className="tabular-nums">
				{t(
					"settings.personnelFiles.sickLeave.notes.count",
					"{count, plural, one {# note} other {# notes}}",
					{ count: row.sickNoteCount },
				)}
			</span>
			<ul className="flex flex-col gap-0.5">
				{row.sickNotes.map((note) => (
					<li key={note.id}>
						<a
							href={personnelDocumentUrl(note.id)}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex max-w-56 items-center gap-1 text-sm underline-offset-4 hover:underline"
							aria-label={t("settings.personnelFiles.list.open", "Open {title}", {
								title: note.title,
							})}
						>
							<IconFileText aria-hidden="true" className="size-3.5 shrink-0" />
							<span className="truncate">{note.title}</span>
						</a>
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * The officer "Sick leave" overview (#985): sick-leave absences in the
 * viewer's sick note scope with their linked sick notes. Read-only; filters
 * and paging live in the URL, so the page reloads the list on the server.
 */
export function SickLeaveOverview(props: SickLeaveOverviewProps) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const { push } = useRouter();
	const searchParams = useSearchParams();
	const [isPending, startTransition] = useTransition();
	const labels = useSickLeaveLabels();
	const { filters } = props;

	function update(changes: Record<string, string | number | null>) {
		const params = new URLSearchParams(searchParams.toString());
		for (const [key, value] of Object.entries(changes)) {
			if (value === null || value === "" || value === ALL) params.delete(key);
			else params.set(key, String(value));
		}
		if (!Object.hasOwn(changes, "page")) params.delete("page");
		const query = params.toString();
		startTransition(() => {
			push(query ? `${PATH}?${query}` : PATH);
		});
	}

	const filtered =
		filters.from !== props.defaultRange.from ||
		filters.to !== props.defaultRange.to ||
		filters.employeeId !== null ||
		filters.teamId !== null ||
		filters.sickDetail !== null ||
		filters.notes !== "all" ||
		filters.status !== null;
	const firstItem = props.total === 0 ? 0 : (props.page - 1) * filters.pageSize + 1;
	const lastItem = Math.min(props.page * filters.pageSize, props.total);

	return (
		<div className="flex flex-col gap-4" aria-busy={isPending}>
			<div className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
				<FilterField label={t("settings.personnelFiles.sickLeave.filters.from", "From")}>
					{(id) => (
						<DatePicker
							aria-labelledby={id}
							value={filters.from}
							max={filters.to}
							required
							disabled={isPending}
							onChange={(from) => update({ from: from === props.defaultRange.from ? null : from })}
						/>
					)}
				</FilterField>
				<FilterField label={t("settings.personnelFiles.sickLeave.filters.to", "To")}>
					{(id) => (
						<DatePicker
							aria-labelledby={id}
							value={filters.to}
							min={filters.from}
							required
							disabled={isPending}
							onChange={(to) => update({ to: to === props.defaultRange.to ? null : to })}
						/>
					)}
				</FilterField>
				<FilterField label={t("settings.personnelFiles.sickLeave.filters.employee", "Employee")}>
					{(id) => (
						<Select
							value={filters.employeeId ?? ALL}
							onValueChange={(employeeId) => update({ employeeId })}
							disabled={isPending}
						>
							<SelectTrigger aria-labelledby={id} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={ALL}>
									{t("settings.personnelFiles.sickLeave.filters.allEmployees", "All employees")}
								</SelectItem>
								{props.employees.map((employee) => (
									<SelectItem key={employee.id} value={employee.id}>
										{employee.isActive
											? employee.name
											: t(
													"settings.personnelFiles.sickLeave.filters.formerEmployee",
													"{name} (former)",
													{ name: employee.name },
												)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
				</FilterField>
				<FilterField label={t("settings.personnelFiles.sickLeave.filters.team", "Team")}>
					{(id) => (
						<Select
							value={filters.teamId ?? ALL}
							onValueChange={(teamId) => update({ teamId })}
							disabled={isPending}
						>
							<SelectTrigger aria-labelledby={id} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={ALL}>
									{t("settings.personnelFiles.sickLeave.filters.allTeams", "All teams")}
								</SelectItem>
								{props.teams.map((team) => (
									<SelectItem key={team.id} value={team.id}>
										{team.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
				</FilterField>
				<FilterField
					label={t("settings.personnelFiles.sickLeave.filters.sickDetail", "Sick detail")}
				>
					{(id) => (
						<Select
							value={filters.sickDetail ?? ALL}
							onValueChange={(sickDetail) => update({ sickDetail })}
							disabled={isPending}
						>
							<SelectTrigger aria-labelledby={id} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={ALL}>
									{t(
										"settings.personnelFiles.sickLeave.filters.allSickDetails",
										"All sick details",
									)}
								</SelectItem>
								{(Object.keys(labels.sickDetails) as SickDetail[]).map((detail) => (
									<SelectItem key={detail} value={detail}>
										{labels.sickDetails[detail]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
				</FilterField>
				<FilterField label={t("settings.personnelFiles.sickLeave.filters.notes", "Sick notes")}>
					{(id) => (
						<Select
							value={filters.notes}
							onValueChange={(notes) => update({ notes })}
							disabled={isPending}
						>
							<SelectTrigger aria-labelledby={id} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{(Object.keys(labels.notes) as SickLeaveNotesFilter[]).map((notes) => (
									<SelectItem key={notes} value={notes}>
										{labels.notes[notes]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
				</FilterField>
				<FilterField label={t("settings.personnelFiles.sickLeave.filters.status", "Status")}>
					{(id) => (
						<Select
							value={filters.status ?? ALL}
							onValueChange={(status) => update({ status })}
							disabled={isPending}
						>
							<SelectTrigger aria-labelledby={id} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={ALL}>
									{t(
										"settings.personnelFiles.sickLeave.filters.allStatuses",
										"Pending and approved",
									)}
								</SelectItem>
								{(Object.keys(labels.statuses) as SickLeaveStatus[]).map((status) => (
									<SelectItem key={status} value={status}>
										{labels.statuses[status]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
				</FilterField>
				<div className="flex items-end">
					{filtered ? (
						<Button
							type="button"
							variant="ghost"
							disabled={isPending}
							onClick={() =>
								startTransition(() => {
									push(PATH);
								})
							}
						>
							<IconX aria-hidden="true" className="size-4" />
							{t("settings.personnelFiles.sickLeave.filters.reset", "Reset filters")}
						</Button>
					) : null}
				</div>
			</div>

			{props.rows.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.personnelFiles.sickLeave.empty",
						"No sick leave in this period matches the filters.",
					)}
				</p>
			) : (
				<div className="rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>
									{t("settings.personnelFiles.sickLeave.columns.employee", "Employee")}
								</TableHead>
								<TableHead>
									{t("settings.personnelFiles.sickLeave.columns.dates", "Dates")}
								</TableHead>
								<TableHead className="text-right">
									{t("settings.personnelFiles.sickLeave.columns.duration", "Duration")}
								</TableHead>
								<TableHead>
									{t("settings.personnelFiles.sickLeave.columns.status", "Status")}
								</TableHead>
								<TableHead>
									{t("settings.personnelFiles.sickLeave.columns.sickDetail", "Sick detail")}
								</TableHead>
								<TableHead>
									{t("settings.personnelFiles.sickLeave.columns.sickNotes", "Sick notes")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{props.rows.map((row) => (
								<TableRow key={row.absenceId}>
									<TableCell className="align-top">
										<div className="flex flex-wrap items-center gap-2">
											<Link
												href={personnelFilePath(row.employeeId, { category: "sick_note" })}
												className="font-medium underline-offset-4 hover:underline"
											>
												{row.employeeName}
											</Link>
											{row.isFormer ? (
												<Badge variant="secondary">
													{t("settings.personnelFiles.area.former", "Former employee")}
												</Badge>
											) : null}
										</div>
										{row.employeeNumber ? (
											<span className="block text-sm text-muted-foreground tabular-nums">
												{row.employeeNumber}
											</span>
										) : null}
									</TableCell>
									<TableCell className="align-top whitespace-nowrap">
										{formatAbsenceDateRange(row.startDate, row.endDate, locale)}
									</TableCell>
									<TableCell className="align-top text-right tabular-nums whitespace-nowrap">
										{formatDays(row.absenceDays, t)}
									</TableCell>
									<TableCell className="align-top">
										<Badge variant={row.status === "approved" ? "outline" : "secondary"}>
											{labels.statuses[row.status]}
										</Badge>
									</TableCell>
									<TableCell className="align-top">
										{row.sickDetail ? labels.sickDetails[row.sickDetail] : null}
									</TableCell>
									<TableCell className="align-top">
										<SickNotesCell row={row} />
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			<div className="flex flex-wrap items-center justify-between gap-3 text-sm">
				<span className="text-muted-foreground tabular-nums">
					{t("settings.personnelFiles.sickLeave.pagination.summary", "{first}–{last} of {total}", {
						first: firstItem,
						last: lastItem,
						total: props.total,
					})}
				</span>
				<div className="flex flex-wrap items-center gap-2">
					<FilterField
						label={t("settings.personnelFiles.sickLeave.pagination.pageSize", "Rows per page")}
					>
						{(id) => (
							<Select
								value={String(filters.pageSize)}
								onValueChange={(pageSize) => update({ pageSize })}
								disabled={isPending}
							>
								<SelectTrigger aria-labelledby={id} className="w-20">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{SICK_LEAVE_PAGE_SIZES.map((size) => (
										<SelectItem key={size} value={String(size)}>
											{size}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					</FilterField>
					<span className="self-end pb-2 tabular-nums">
						{t("settings.personnelFiles.sickLeave.pagination.page", "Page {page} of {pageCount}", {
							page: props.page,
							pageCount: props.pageCount,
						})}
					</span>
					<div className="flex gap-1 self-end">
						<Button
							type="button"
							variant="outline"
							size="icon"
							disabled={isPending || props.page <= 1}
							onClick={() => update({ page: props.page - 1 })}
							aria-label={t(
								"settings.personnelFiles.sickLeave.pagination.previous",
								"Previous page",
							)}
						>
							<IconChevronLeft aria-hidden="true" className="size-4" />
						</Button>
						<Button
							type="button"
							variant="outline"
							size="icon"
							disabled={isPending || props.page >= props.pageCount}
							onClick={() => update({ page: props.page + 1 })}
							aria-label={t("settings.personnelFiles.sickLeave.pagination.next", "Next page")}
						>
							<IconChevronRight aria-hidden="true" className="size-4" />
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
