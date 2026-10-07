"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { savePerDiemDraftAction } from "@/app/[locale]/(app)/travel-expenses/per-diem-actions";
import type { DraftSaveOutcome } from "@/lib/travel-expenses/draft-saver";
import {
	type PerDiemDraftInput,
	type PerDiemItinerary,
	parsePerDiemDraft,
} from "@/lib/travel-expenses/per-diem";
import type { ReportItemView } from "@/lib/travel-expenses/report-store";
import { perDiemDraftMatches, perDiemDraftOf } from "./per-diem-item-draft";
import { type PerDiemTrip, toDraftInput, toFormValues } from "./per-diem-item-form";
import { useDraftSaver } from "./use-draft-saver";

/**
 * The per diem editor's autosaving form: entered values save through one draft
 * saver, and a new per diem starts on the trip's travel days and in its zone.
 */
export function usePerDiemItemDraft({
	reportId,
	item,
	trip,
	onSaved,
	onDraftChange,
}: {
	reportId: string;
	item: ReportItemView;
	trip: PerDiemTrip;
	onSaved?: (item: ReportItemView) => void;
	onDraftChange?: (draft: PerDiemItinerary | null) => void;
}) {
	const { t } = useTranslate();
	const [lastSaved, setLastSaved] = useState(item);
	// The latest server view. A reload (e.g. after the trip's destinations changed)
	// recalculates the same version, so a loaded item wins a tie with this editor's save.
	const saved = item.version >= lastSaved.version ? item : lastSaved;

	const { saver, state } = useDraftSaver<PerDiemDraftInput, ReportItemView>({
		version: item.version,
		onUnsavedAfterClose: () =>
			toast.error(
				t(
					"travelExpenses.report.save.unsavedAfterClose",
					"Your latest changes to an expense could not be saved. Open it again to check it.",
				),
			),
		save: async (values, expectedVersion): Promise<DraftSaveOutcome<ReportItemView>> => {
			const parsed = parsePerDiemDraft(values);
			if (!parsed.ok) return { status: "invalid", errors: parsed.errors };
			const result = await savePerDiemDraftAction({
				reportId,
				itemId: item.id,
				expectedVersion,
				values,
			});
			if (!result.success) return { status: "failed", error: result.error };
			switch (result.data.status) {
				case "saved":
					setLastSaved(result.data.item);
					onSaved?.(result.data.item);
					return { status: "saved", version: result.data.item.version };
				case "conflict":
					return { status: "conflict", version: result.data.item.version, item: result.data.item };
				case "invalid":
					return { status: "invalid", errors: result.data.errors };
			}
		},
	});

	const [defaultValues] = useState(() => {
		const values = toFormValues(perDiemDraftOf(item));
		// A new per diem starts on the trip's travel days and in its zone.
		return {
			...values,
			startDate: values.startDate || (trip.startDate ?? ""),
			endDate: values.endDate || (trip.endDate ?? ""),
			startTimeZone: values.startTimeZone || trip.timeZone,
			endTimeZone: values.endTimeZone || trip.timeZone,
		};
	});
	const form = useForm({
		defaultValues,
		listeners: {
			onChange: ({ formApi }) => {
				const values = toDraftInput(formApi.state.values);
				saver.change(values);
				const parsed = parsePerDiemDraft(values);
				onDraftChange?.(parsed.ok ? parsed.itinerary : null);
			},
		},
	});

	// A new per diem is prefilled with the trip's days and zone: save that right away.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once for the first load
	useEffect(() => {
		const prefilled = toDraftInput(defaultValues);
		const parsed = parsePerDiemDraft(prefilled);
		if (parsed.ok && !perDiemDraftMatches(parsed.itinerary, item)) {
			saver.change(prefilled);
			// The report editor counts the prefilled draft like a typed one; the form owns the values.
			// react-doctor-disable-next-line react-doctor/no-pass-data-to-parent, react-doctor/no-pass-live-state-to-parent
			onDraftChange?.(parsed.itinerary);
		}
		// Runs once for the first load: later loads never reset or re-prefill entered values.
		// react-doctor-disable-next-line react-doctor/exhaustive-deps
	}, []);

	/** Resolves a save conflict with the other version and shows its values. */
	function resolveWithTheirs() {
		const theirs = state.conflict?.item;
		saver.resolveConflict("use_theirs");
		if (theirs) {
			setLastSaved(theirs);
			form.reset(toFormValues(perDiemDraftOf(theirs)), { keepDefaultValues: true });
			onDraftChange?.(perDiemDraftOf(theirs));
		}
	}

	return { saver, state, form, saved, resolveWithTheirs };
}
