/**
 * Wage-isolation boundary for statutory data (A1, #1988). Only org admins and owners (`full`)
 * see EUR amounts, hourly wages, external earnings, EUR baselines and acknowledgement reasons.
 * Everyone else (`restricted`: scoped managers, planners, the employee, anyone without settings
 * access) gets the wage-free summary. Redact before data leaves the server for any loader,
 * Scheduling or Staffing payload, or UI. Restricted readers never get the input fingerprint: it
 * hashes wages and EUR amounts, and a low-entropy wage could be confirmed by guessing.
 */
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	loadSettingsAccessFacts,
	meetsSettingsAccess,
	type SettingsAccess,
	settingsAccessOf,
} from "@/lib/organization-action/settings-access";
import type { StatutoryFinding, StatutoryFindingSummary, StatutoryQuantity } from "./finding";
import { isMoneyThreshold } from "./threshold-catalog";
import type { StatutoryThresholdRow } from "./thresholds";

export type StatutoryAudience = "full" | "restricted";

/** A finding as a restricted audience receives it. */
export type RedactedStatutoryFinding<Kind extends string = string> = Omit<
	StatutoryFinding<Kind>,
	"adminDetail" | "inputFingerprint"
> & { readonly adminDetail: null; readonly inputFingerprint: null };

export function statutoryAudienceOf(settingsAccess: SettingsAccess | null): StatutoryAudience {
	return meetsSettingsAccess(settingsAccess, "orgAdmin") ? "full" : "restricted";
}

/** The audience of `userId` in `organizationId`, by the shared settings-access rule. */
export async function loadStatutoryAudience(
	db: Pick<DatabaseClient, "select">,
	input: { readonly organizationId: string; readonly userId: string },
): Promise<StatutoryAudience> {
	return statutoryAudienceOf(settingsAccessOf(await loadSettingsAccessFacts(db, input)));
}

const SAFE_UNITS: ReadonlySet<StatutoryQuantity["unit"]> = new Set([
	"minutes",
	"days",
	"weeks",
	"months",
	"calls",
]);

function safeQuantity(quantity: StatutoryQuantity | undefined): StatutoryQuantity | undefined {
	return quantity && SAFE_UNITS.has(quantity.unit)
		? { unit: quantity.unit, value: quantity.value }
		: undefined;
}

/** Keeps only the documented wage-free summary fields, even if a monitor misplaced data. */
export function safeSummary(summary: StatutoryFindingSummary): StatutoryFindingSummary {
	const safe: {
		-readonly [K in keyof StatutoryFindingSummary]: StatutoryFindingSummary[K];
	} = {};
	if (summary.tier !== undefined) safe.tier = summary.tier;
	if (summary.usedPercent !== undefined) safe.usedPercent = summary.usedPercent;
	const used = safeQuantity(summary.used);
	if (used) safe.used = used;
	const limit = safeQuantity(summary.limit);
	if (limit) safe.limit = limit;
	const remaining = safeQuantity(summary.remaining);
	if (remaining) safe.remaining = remaining;
	return safe;
}

export function redactStatutoryFinding<F extends StatutoryFinding>(
	finding: F,
	audience: StatutoryAudience,
): F | RedactedStatutoryFinding<F["kind"]> {
	if (audience === "full") return finding;
	const { acknowledgement, ...rest } = finding;
	return {
		...rest,
		summary: safeSummary(finding.summary),
		adminDetail: null,
		inputFingerprint: null,
		...(acknowledgement
			? {
					acknowledgement: {
						status: acknowledgement.status,
						acknowledgedAt: acknowledgement.acknowledgedAt,
					},
				}
			: {}),
	};
}

export function redactStatutoryFindings<F extends StatutoryFinding>(
	findings: readonly F[],
	audience: StatutoryAudience,
): (F | RedactedStatutoryFinding<F["kind"]>)[] {
	return findings.map((finding) => redactStatutoryFinding(finding, audience));
}

/** Drops EUR baselines (e.g. the Minijob cap) for restricted audiences. */
export function redactStatutoryThresholds(
	rows: readonly StatutoryThresholdRow[],
	audience: StatutoryAudience,
): StatutoryThresholdRow[] {
	return audience === "full" ? [...rows] : rows.filter((row) => !isMoneyThreshold(row.key));
}
