import type {
	TravelExpenseReportItemType,
	TravelExpenseReportKind,
} from "@/db/schema/travel-expense";

/** The translate function of `useTranslate`, narrowed to what these labels need. */
type Translate = (key: string, fallback: string) => string;

/** What names an expense report: its kind, a standalone report's one item type, and its title. */
export interface ReportNameSource {
	kind: TravelExpenseReportKind;
	/** The standalone report's item type; null for a trip report. */
	itemType: TravelExpenseReportItemType | null;
	/** The trip purpose, or the standalone item's description (receipt) or route (mileage). */
	title: string | null;
}

/** The name the expense history and the report header show, or an "Untitled …" fallback. */
export function reportName(t: Translate, source: ReportNameSource): string {
	if (source.title?.trim()) return source.title;
	if (source.kind === "trip")
		return t("travelExpenses.report.drafts.untitledTrip", "Untitled trip");
	if (source.itemType === "mileage")
		return t("travelExpenses.history.untitledMileage", "Untitled mileage");
	return t("travelExpenses.report.drafts.untitled", "Untitled receipt");
}

/** The kind line above a report's name: trip report, standalone receipt or mileage. */
export function reportKindLabel(
	t: Translate,
	source: Pick<ReportNameSource, "kind" | "itemType">,
): string {
	if (source.kind === "trip") return t("travelExpenses.report.kind.trip", "Trip report");
	if (source.itemType === "mileage")
		return t("travelExpenses.report.kind.standaloneMileage", "Standalone mileage");
	return t("travelExpenses.report.standaloneTitle", "Standalone receipt");
}
