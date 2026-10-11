"use client";

import { IconShare } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useMemo } from "react";
import { Temporal } from "temporal-polyfill";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
import {
	ReportDocumentExportButtons,
	useProjectReportExportLabels,
} from "@/components/reports/report-document-export-buttons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { formatInstant } from "@/lib/datetime/temporal-format";
import type { SharedSnapshot } from "@/lib/projects/report-share/shared-snapshot";
import { buildSharedSnapshotDocument } from "@/lib/projects/report-share/shared-snapshot-document";
import {
	formatReportCell,
	type ReportColumnKind,
	type ReportTable,
} from "@/lib/reports/exporters/report-document";
import { cn } from "@/lib/utils";

interface SharedReportViewProps {
	locale: string;
	organizationName: string;
	organizationTimeZone: string;
	creatorName: string;
	/** When the snapshot was taken (ISO instant). */
	createdAt: string;
	/** When the link expires (ISO instant). */
	expiresAt: string;
	snapshot: SharedSnapshot;
}

const NUMERIC_KINDS: ReadonlySet<ReportColumnKind> = new Set(["hours", "money", "count", "percent"]);

/**
 * The recipient page of a report share link (#806): the shared snapshot as
 * the same report document its PDF, CSV and Excel downloads contain, with
 * who shared it, when it was taken and until when the link works.
 */
export function SharedReportView(props: SharedReportViewProps) {
	return (
		<UserPreferencesProvider timezone={props.organizationTimeZone}>
			<SharedReportContent {...props} />
		</UserPreferencesProvider>
	);
}

function SharedReportContent({
	locale,
	organizationName,
	organizationTimeZone,
	creatorName,
	createdAt,
	expiresAt,
	snapshot,
}: SharedReportViewProps) {
	const { t } = useTranslate();
	const labels = useProjectReportExportLabels();
	const display = { locale, timezone: organizationTimeZone, timeFormat: "24h" as const };
	const takenAt = formatInstant(Temporal.Instant.from(createdAt), display, "dateTimeMedium");
	const expiresOn = formatInstant(Temporal.Instant.from(expiresAt), display, "dateTimeMedium");
	// The snapshot's time stands in for "generated on": the figures are as of then.
	const document = useMemo(
		() => buildSharedSnapshotDocument(snapshot, { labels, generatedAt: takenAt }),
		[snapshot, labels, takenAt],
	);

	return (
		<main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:py-10">
			<header className="space-y-3">
				<p className="text-sm font-medium text-muted-foreground">{organizationName}</p>
				<h1 className="text-2xl font-semibold tracking-tight text-balance">{document.title}</h1>
				<dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
					<div className="flex items-center gap-1.5">
						<IconShare aria-hidden="true" className="size-4" />
						<dt className="sr-only">{t("reports.share.page.sharedByLabel", "Shared by")}</dt>
						<dd>{t("reports.share.page.sharedBy", "Shared by {name}", { name: creatorName })}</dd>
					</div>
					<div>
						<dt className="inline">{t("reports.share.page.takenAt", "Snapshot taken")}: </dt>
						<dd className="inline">{takenAt}</dd>
					</div>
					<div>
						<dt className="inline">{t("reports.share.page.expiresAt", "Link expires")}: </dt>
						<dd className="inline">{expiresOn}</dd>
					</div>
				</dl>
				<ReportDocumentExportButtons
					buildDocument={(context) =>
						buildSharedSnapshotDocument(snapshot, { ...context, generatedAt: takenAt })
					}
				/>
			</header>

			<dl className="grid gap-3 rounded-xl border p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
				{document.facts.map((fact) => (
					<div key={fact.label} className="min-w-0">
						<dt className="text-muted-foreground">{fact.label}</dt>
						<dd className="truncate font-medium">{fact.value}</dd>
					</div>
				))}
			</dl>

			{document.tables.map((table) => (
				<SharedReportTable key={table.title} table={table} unknownLabel={document.unknownLabel} />
			))}

			{document.notes.length > 0 && (
				<ul className="space-y-1 text-xs text-muted-foreground">
					{document.notes.map((note) => (
						<li key={note}>{note}</li>
					))}
				</ul>
			)}

			<footer className="border-t pt-4 text-xs text-muted-foreground">
				{t(
					"reports.share.page.footer",
					"A read-only snapshot shared from Z8. Later changes to the work behind it are not shown.",
				)}
			</footer>
		</main>
	);
}

function SharedReportTable({ table, unknownLabel }: { table: ReportTable; unknownLabel: string }) {
	const cell = (value: ReportTable["rows"][number][number], index: number) => {
		const kind = table.columns[index]?.kind ?? "text";
		return (
			<TableCell
				key={table.columns[index]?.key ?? index}
				className={cn(NUMERIC_KINDS.has(kind) && "text-right tabular-nums")}
			>
				{formatReportCell(value, kind, unknownLabel)}
			</TableCell>
		);
	};
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">{table.title}</CardTitle>
			</CardHeader>
			<CardContent className="overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							{table.columns.map((column) => (
								<TableHead
									key={column.key}
									className={cn(NUMERIC_KINDS.has(column.kind) && "text-right")}
								>
									{column.header}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{table.rows.map((row, rowIndex) => (
							// Rows have no ids; their order is the document's.
							// biome-ignore lint/suspicious/noArrayIndexKey: static document rows
							<TableRow key={rowIndex}>{row.map(cell)}</TableRow>
						))}
					</TableBody>
					{table.totals && (
						<TableFooter>
							<TableRow className="font-medium">{table.totals.map(cell)}</TableRow>
						</TableFooter>
					)}
				</Table>
			</CardContent>
		</Card>
	);
}
