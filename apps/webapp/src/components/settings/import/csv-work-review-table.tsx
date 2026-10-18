"use client";

import { useTranslate } from "@tolgee/react";
import type { Dispatch, SetStateAction } from "react";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CsvWorkReviewData } from "./csv-work-review";
import { CsvWorkReviewRow } from "./csv-work-review-row";

export function CsvWorkReviewTable({
	view,
	editable,
	selectedIds,
	setSelected,
}: {
	view: CsvWorkReviewData;
	editable: boolean;
	selectedIds: ReadonlySet<string>;
	setSelected: Dispatch<SetStateAction<string[]>>;
}) {
	const { t } = useTranslate();
	const openRows = view.rows.filter(
		(row) => row.rowStatus !== "committed" && row.rowStatus !== "rejected",
	);
	return (
		<div className="overflow-x-auto rounded-md border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>
							<input
								type="checkbox"
								aria-label={t("settings.import.csv.selectPage", "Select all rows on this page")}
								disabled={!editable || openRows.length === 0}
								checked={openRows.length > 0 && openRows.every((row) => selectedIds.has(row.id))}
								onChange={(event) =>
									setSelected(event.target.checked ? openRows.map((row) => row.id) : [])
								}
							/>
						</TableHead>
						<TableHead>{t("settings.import.csv.row", "CSV row")}</TableHead>
						<TableHead>{t("settings.import.csv.person", "Employee")}</TableHead>
						<TableHead>{t("settings.import.csv.interval", "Event-local start and end")}</TableHead>
						<TableHead>{t("settings.import.csv.vehicle", "Vehicle use")}</TableHead>
						<TableHead>{t("settings.import.csv.outcome", "Status and issues")}</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{view.rows.map((row) => (
						<CsvWorkReviewRow
							key={row.id}
							row={row}
							view={view}
							editable={editable}
							checked={selectedIds.has(row.id)}
							setSelected={setSelected}
						/>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
