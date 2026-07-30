import { and, eq, inArray, type SQL } from "drizzle-orm";
import { payrollBlockerDismissal } from "@/db/schema";
import {
	filterDismissedPayrollBlockers,
	type PayrollBlockerDismissalKey,
} from "./blocker-dismissals";
import type { PayrollBlocker } from "./types";

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

	const candidateSourceIds = Array.from(
		new Set(input.blockerCandidates.map((blocker) => blocker.id)),
	);
	const dismissals = await input.findDismissals({
		where: and(
			eq(payrollBlockerDismissal.organizationId, input.organizationId),
			inArray(payrollBlockerDismissal.sourceId, candidateSourceIds),
		),
		columns: { blockerType: true, sourceId: true },
	});

	return filterDismissedPayrollBlockers(input.blockerCandidates, dismissals);
}
