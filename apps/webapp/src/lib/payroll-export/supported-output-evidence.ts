/** Historical supported output, captured by the formatter that emits the file. */
export interface SupportedPayrollOutputEvidence {
	version: 1;
	formatId: "datev_lohn" | "lexware_lohn" | "sage_lohn";
	formatterVersion: string;
	excludedLineKinds: ["expense"];
	rows: SupportedPayrollOutputRow[];
}

export interface SupportedPayrollOutputRow {
	personnelNumber: string;
	wageTypeCode: string;
	date: string;
	/** Canonical decimal value after the formatter aggregates and rounds. */
	quantity: string;
	unit: "hours";
	note: string;
	/** Exact rendered file cells, including configured empty optional columns. */
	renderedColumns?: Record<string, string>;
	contributions: SupportedPayrollContribution[];
}

interface ContributionIdentity {
	sourceId: string;
	/** Null means the formatter input did not carry a reliable revision. */
	sourceRevision: string | null;
	/** Actor recorded by the source, when supplied; absence means unavailable. */
	sourceActorId?: string | null;
	employeeId: string;
	firstName: string | null;
	lastName: string | null;
	/** Unrounded share of this row; only the final row is rendered at two decimals. */
	hours: number;
	/** Available explanation, never inferred from today's source record. */
	reason: string | null;
}

export type SupportedPayrollContribution = ContributionIdentity &
	(
		| {
				kind: "work";
				facts: {
					startAt: string | null;
					endAt: string | null;
					durationMinutes: number;
					workCategoryId: string | null;
					workCategoryName: string | null;
					projectId: string | null;
					projectName: string | null;
					mappingId: string | null;
				};
		  }
		| {
				kind: "absence";
				facts: {
					startDate: string;
					endDate: string;
					absenceCategoryId: string;
					absenceCategoryName: string | null;
					absenceType: string | null;
					status: string;
					mappingId: string;
				};
		  }
		| {
				kind: "overtime_payout";
				facts: { day: string; minutes: number; mappingId: string | null };
		  }
	);
