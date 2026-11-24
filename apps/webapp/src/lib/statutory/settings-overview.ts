import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	type LoadedStatutoryPreferences,
	loadOrganizationStatutoryPreferences,
} from "./preferences";
import {
	type StatutoryDomain,
	type StatutoryThresholdKey,
	statutoryThresholdCatalog,
	statutoryThresholdKeys,
} from "./threshold-catalog";
import { loadStatutoryThresholds, type StatutoryThresholdRow } from "./thresholds";

export type StatutoryBaselineStatus = "past" | "current" | "upcoming";

export interface StatutoryBaselineView extends StatutoryThresholdRow {
	readonly domain: StatutoryDomain;
	readonly status: StatutoryBaselineStatus;
}

export interface StatutorySettingsOverview {
	/** Every German platform baseline, by catalog order then effective date. */
	readonly baselines: readonly StatutoryBaselineView[];
	readonly preferences: LoadedStatutoryPreferences;
	/** The organization-local day the statuses were judged on. */
	readonly today: string;
}

function statusOn(row: StatutoryThresholdRow, today: string): StatutoryBaselineStatus {
	const day = parsePlainDate(today);
	if (comparePlainDates(parsePlainDate(row.effectiveFromDate), day) > 0) return "upcoming";
	if (
		row.effectiveUntilDate &&
		comparePlainDates(parsePlainDate(row.effectiveUntilDate), day) <= 0
	) {
		return "past";
	}
	return "current";
}

/** Org-admin read model for Settings → Contracts → Statutory (EUR baselines included). */
export async function loadStatutorySettingsOverview(
	db: Pick<DatabaseClient, "select">,
	input: { readonly organizationId: string; readonly today: string },
): Promise<StatutorySettingsOverview> {
	const table = await loadStatutoryThresholds(db, {
		keys: statutoryThresholdKeys,
		from: "1900-01-01",
		until: "9999-12-31",
	});
	const baselines = statutoryThresholdKeys.flatMap((key: StatutoryThresholdKey) =>
		table.rows(key).map((row) => ({
			...row,
			domain: statutoryThresholdCatalog[key].domain,
			status: statusOn(row, input.today),
		})),
	);
	return {
		baselines,
		preferences: await loadOrganizationStatutoryPreferences(db, input.organizationId),
		today: input.today,
	};
}
