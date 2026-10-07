"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { saveTripDetailsDraftAction } from "@/app/[locale]/(app)/travel-expenses/report-actions";
import type { DraftSaveOutcome } from "@/lib/travel-expenses/draft-saver";
import type { TripDetailsView } from "@/lib/travel-expenses/report-store";
import {
	parseTripDetailsDraft,
	type TripDetailsDraft,
	type TripDetailsDraftInput,
} from "@/lib/travel-expenses/trip-report";
import { toDraftInput, toFormValues, withSavedValues } from "./trip-details-form";
import { useDraftSaver } from "./use-draft-saver";

/**
 * The trip details editor's autosaving form: entered details save through one
 * draft saver, and malformed fields keep their last saved value so valid edits still save.
 */
export function useTripDetailsDraft({
	reportId,
	details,
	onDetailsChange,
	onSaved,
}: {
	reportId: string;
	details: TripDetailsView;
	onDetailsChange: (details: TripDetailsDraft | null) => void;
	onSaved?: () => void;
}) {
	const { t } = useTranslate();
	const [initialSaved] = useState(() => toDraftInput(toFormValues(details)));
	const lastSaved = useRef<TripDetailsDraftInput>(initialSaved);

	const { saver, state } = useDraftSaver<TripDetailsDraftInput, TripDetailsView>({
		version: details.version,
		onUnsavedAfterClose: () =>
			toast.error(
				t(
					"travelExpenses.report.trip.unsavedAfterClose",
					"Your latest changes to the trip details could not be saved. Open the trip again to check them.",
				),
			),
		save: async (values, expectedVersion): Promise<DraftSaveOutcome<TripDetailsView>> => {
			const parsed = parseTripDetailsDraft(values);
			const errors = parsed.ok ? null : parsed.errors;
			const saveable = errors ? withSavedValues(values, errors, lastSaved.current) : values;
			if (errors && !parseTripDetailsDraft(saveable).ok) return { status: "invalid", errors };
			const result = await saveTripDetailsDraftAction({
				reportId,
				expectedVersion,
				values: saveable,
			});
			if (!result.success) return { status: "failed", error: result.error };
			switch (result.data.status) {
				case "saved":
					lastSaved.current = toDraftInput(toFormValues(result.data.details));
					onSaved?.();
					return errors
						? { status: "invalid", errors, version: result.data.details.version }
						: { status: "saved", version: result.data.details.version };
				case "conflict":
					return {
						status: "conflict",
						version: result.data.details.version,
						item: result.data.details,
					};
				case "invalid":
					return { status: "invalid", errors: result.data.errors };
			}
		},
	});

	const [defaultValues] = useState(() => toFormValues(details));
	const form = useForm({
		defaultValues,
		listeners: { onChange: () => changed() },
	});

	/** Saves the entered details and reports them; also for changes outside listeners. */
	function changed() {
		const values = toDraftInput(form.state.values);
		saver.change(values);
		const parsed = parseTripDetailsDraft(values);
		onDetailsChange(parsed.ok ? parsed.draft : null);
	}

	/** Resolves a save conflict with the other version and shows its details. */
	function resolveWithTheirs() {
		const theirs = state.conflict?.item;
		saver.resolveConflict("use_theirs");
		if (theirs) {
			lastSaved.current = toDraftInput(toFormValues(theirs));
			form.reset(toFormValues(theirs), { keepDefaultValues: true });
			onDetailsChange(theirs);
		}
	}

	return { saver, state, form, changed, resolveWithTheirs };
}
