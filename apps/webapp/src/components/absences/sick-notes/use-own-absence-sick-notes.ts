"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getOwnAbsenceSickNotesAction } from "@/app/[locale]/(app)/absences/sick-note-actions";
import type { SickNoteMarker } from "@/lib/personnel-file/sick-note-store";
import { queryKeys } from "@/lib/query/keys";

const NO_MARKERS: Readonly<Record<string, SickNoteMarker>> = Object.freeze({});

/**
 * Sick notes on the employee's own sick-leave absences (#982): whether they may
 * attach them, and the "Sick note attached (n)" marker per absence.
 */
export function useOwnAbsenceSickNotes(
	absences: ReadonlyArray<{ id: string; category: { type: string } }>,
) {
	const queryClient = useQueryClient();
	const absenceIds = absences
		.filter((absence) => absence.category.type === "sick")
		.map((absence) => absence.id)
		.toSorted();
	const query = useQuery({
		queryKey: queryKeys.personnelFile.ownAbsenceSickNotes(absenceIds),
		queryFn: async () => {
			const result = await getOwnAbsenceSickNotesAction(absenceIds);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: absenceIds.length > 0,
	});
	return {
		canAttach: query.data?.canAttach ?? false,
		markers: query.data?.markers ?? NO_MARKERS,
		refresh: () =>
			queryClient.invalidateQueries({ queryKey: queryKeys.personnelFile.sickNotesAll() }),
	};
}
