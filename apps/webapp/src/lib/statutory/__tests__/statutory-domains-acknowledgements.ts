/**
 * Acknowledges the seeded Minijob, short-term and JArbSchG review findings of
 * `statutoryDomainsFixture` through the monitors' own actions, and invalidates them again with
 * newer work or a changed shift (#1994). For the Reviews inbox and Command Center suites.
 */
import type { Pool } from "pg";
import { db } from "@/db";
import { acknowledgeMinijobExceedance } from "../minijob/acknowledge-minijob-exceedance";
import { loadMinijobExceedanceReviews } from "../minijob/minijob-reviews";
import {
	acknowledgeShortTermBerufsmaessigkeit,
	listShortTermBerufsmaessigkeitReviews,
} from "../short-term/monitor";
import {
	acknowledgeYouthSectorException,
	listOpenYouthSectorExceptions,
} from "../youth/sector-exception-review";
import {
	STATUTORY_DOMAINS_NOW as now,
	type StatutoryDomainsSeed,
	type statutoryDomainsFixture,
} from "./statutory-domains-fixture";

const timezone = "Europe/Berlin";

/** Documents November's Minijob exceedance and Berufsmäßigkeit prompt and the Saturday shift. */
export async function acknowledgeMinijobShortTermAndYouth(seed: StatutoryDomainsSeed) {
	const organizationId = seed.org.id;
	const actorUserId = seed.owner.userId;

	const november = (await loadMinijobExceedanceReviews(db, { organizationId, now })).find(
		(review) => review.employeeId === seed.mini.employeeId && review.month === "2026-11",
	);
	if (!november) throw new Error("no Minijob exceedance in November");
	await acknowledgeMinijobExceedance(db, {
		organizationId,
		actorUserId,
		employeeId: seed.mini.employeeId,
		month: "2026-11",
		reason: "Covered a sick colleague",
		expectedFingerprint: november.inputFingerprint,
		expectedTotalCents: november.totalCents,
		now,
	});

	const prompt = (
		await listShortTermBerufsmaessigkeitReviews(db, { organizationId, timezone, now })
	).find((review) => review.employeeId === seed.seasonal.employeeId && review.month === "2026-11");
	if (!prompt) throw new Error("no Berufsmäßigkeit prompt in November");
	await acknowledgeShortTermBerufsmaessigkeit(db, {
		organizationId,
		actorUserId,
		employeeId: seed.seasonal.employeeId,
		timezone,
		month: "2026-11",
		reason: "Seasonal work between semesters, not professional",
		expectedFingerprint: prompt.finding.inputFingerprint,
		expectedTotalCents: prompt.finding.adminDetail?.amountsCents?.total ?? 0,
		now,
	});

	const saturday = (
		await listOpenYouthSectorExceptions(db, { organizationId, timezone, now })
	).find((finding) => finding.employeeId === seed.minor.employeeId);
	if (!saturday) throw new Error("no JArbSchG sector exception for the Saturday shift");
	await acknowledgeYouthSectorException(db, {
		organizationId,
		actorUserId,
		timezone,
		now,
		employeeId: seed.minor.employeeId,
		findingKind: saturday.findingKind,
		subjectKey: saturday.subjectKey,
		periodStart: saturday.periodStart,
		expectedFingerprint: saturday.inputFingerprint,
		reason: "Retail: Saturday work allowed under § 16 Abs. 2 JArbSchG",
	});
	return { saturdayFindingId: saturday.findingId };
}

/**
 * Changes what those acknowledgements documented: two more hours of Minijob and short-term work
 * in November (30 EUR each, still within twice the Minijob limit) and a Saturday shift that ends
 * an hour later.
 */
export async function invalidateMinijobShortTermAndYouth(
	admin: Pool,
	domains: ReturnType<typeof statutoryDomainsFixture>,
	seed: StatutoryDomainsSeed,
) {
	await domains.work(seed.org, seed.mini, "2026-11-09", 120);
	await domains.work(seed.org, seed.seasonal, "2026-11-09", 120);
	await admin.query(`UPDATE shift SET end_time = '15:00' WHERE id = $1`, [seed.saturdayShiftId]);
}
