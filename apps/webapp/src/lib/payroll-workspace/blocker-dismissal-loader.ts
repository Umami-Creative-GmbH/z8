import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { payrollBlockerDismissal } from "@/db/schema";
import {
	filterDismissedPayrollBlockers,
	type PayrollBlockerDismissalKey,
} from "./blocker-dismissals";
import type { PayrollBlocker, PayrollBlockerType } from "./types";

interface PayrollBlockerDismissalQuery {
	where: SQL | undefined;
	columns: { blockerType: true; sourceId: true };
}

export async function filterDismissedPayrollBlockerCandidates(input: {
	organizationId: string;
	blockerCandidates: PayrollBlocker[];
	findDismissals: (
		query: PayrollBlockerDismissalQuery,
	) => Promise<PayrollBlockerDismissalKey[]>;
}): Promise<PayrollBlocker[]> {
	if (input.blockerCandidates.length === 0) return input.blockerCandidates;

	const sourceIdsByType = new Map<PayrollBlockerType, Set<string>>();
	for (const blocker of input.blockerCandidates) {
		const sourceIds = sourceIdsByType.get(blocker.type) ?? new Set();
		sourceIds.add(blocker.id);
		sourceIdsByType.set(blocker.type, sourceIds);
	}
	const typePredicates = Array.from(
		sourceIdsByType,
		([blockerType, sourceIds]) =>
			and(
				eq(payrollBlockerDismissal.blockerType, blockerType),
				inArray(payrollBlockerDismissal.sourceId, Array.from(sourceIds)),
			),
	);
	if (typePredicates.length === 0) return input.blockerCandidates;

	const dismissals = await input.findDismissals({
		where: and(
			eq(payrollBlockerDismissal.organizationId, input.organizationId),
			or(...typePredicates),
		),
		columns: { blockerType: true, sourceId: true },
	});

	return filterDismissedPayrollBlockers(input.blockerCandidates, dismissals);
}
