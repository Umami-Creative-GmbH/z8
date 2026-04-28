type ReviewState = "draft" | "pending" | "confirmed";

export type EmploymentTimelineRow = {
	id: string;
	validFrom: Date;
	validUntil: Date | null;
	reviewState: ReviewState;
};

export type TimelineUpdate = {
	id: string;
	validUntil: Date | null;
};

export function findEffectiveEmploymentHistory<T extends EmploymentTimelineRow>(
	rows: T[],
	at: Date,
): T | null {
	return (
		rows
			.filter((row) => row.reviewState === "confirmed")
			.filter((row) => row.validFrom.getTime() <= at.getTime())
			.filter((row) => !row.validUntil || row.validUntil.getTime() > at.getTime())
			.sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0] ?? null
	);
}

export function adjustConfirmedTimeline<T extends EmploymentTimelineRow>({
	existing,
	next,
}: {
	existing: T[];
	next: T;
}): { next: T; updates: TimelineUpdate[] } {
	if (next.reviewState !== "confirmed") {
		return { next, updates: [] };
	}

	const confirmed = existing
		.filter((row) => row.reviewState === "confirmed" && row.id !== next.id)
		.sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
	const previous = confirmed
		.filter((row) => row.validFrom.getTime() < next.validFrom.getTime())
		.at(-1);
	const following = confirmed.find((row) => row.validFrom.getTime() > next.validFrom.getTime());
	const replacements = confirmed.filter(
		(row) => row.validFrom.getTime() === next.validFrom.getTime(),
	);
	const updates: TimelineUpdate[] = [];

	if (
		previous &&
		(!previous.validUntil || previous.validUntil.getTime() > next.validFrom.getTime())
	) {
		updates.push({ id: previous.id, validUntil: next.validFrom });
	}

	for (const replacement of replacements) {
		updates.push({ id: replacement.id, validUntil: next.validFrom });
	}

	return {
		next: {
			...next,
			validUntil: following ? following.validFrom : next.validUntil,
		},
		updates,
	};
}
