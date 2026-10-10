import type { db } from "@/db";
import { type Instant, plainDateAt } from "@/lib/datetime/temporal-core";
import { loadExpectedSubmissionPeriodFacts } from "./employee-expected-periods";
import { buildEmployeePeriodView, type EmployeePeriodViewRow } from "./employee-period-view";
import { deriveExpectedSubmissionPeriods } from "./expected-periods";
import { listEmployeePeriodSubmissions } from "./submission-store";

/** How far back the view looks, and how many periods it shows. */
const VIEW_LOOKBACK_DAYS = 100;
const VIEW_PERIOD_LIMIT = 6;

export interface EmployeePeriodView {
	timezone: string;
	periods: EmployeePeriodViewRow[];
}

/**
 * The employee's period view (#1059): their recent periods with each one's status, newest
 * first. Null when the organization does not collect period submissions from them (no cadence
 * ever, or kiosk-only) and nothing was submitted.
 */
export async function loadEmployeePeriodView(
	database: typeof db,
	input: { organizationId: string; employeeId: string; now: Instant },
): Promise<EmployeePeriodView | null> {
	// The window is widened by a day each side: the employee's zone is read with the facts.
	const utcToday = plainDateAt(input.now, "UTC");
	const window = {
		from: utcToday.subtract({ days: VIEW_LOOKBACK_DAYS + 1 }),
		to: utcToday.add({ days: 1 }),
	};
	const facts = await loadExpectedSubmissionPeriodFacts(database, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		window,
	});
	if (!facts) return null;
	const [periods, submissions] = await Promise.all([
		Promise.resolve(deriveExpectedSubmissionPeriods(facts, window)),
		listEmployeePeriodSubmissions(database, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			from: window.from.toString(),
			to: window.to.toString(),
		}),
	]);
	if (periods.length === 0 && submissions.length === 0) return null;
	const rows = buildEmployeePeriodView({
		periods,
		submissions,
		today: plainDateAt(input.now, facts.timezone),
	});
	return { timezone: facts.timezone, periods: rows.slice(0, VIEW_PERIOD_LIMIT) };
}
