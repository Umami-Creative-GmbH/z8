"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { saveMileageItemDraftAction } from "@/app/[locale]/(app)/travel-expenses/mileage-actions";
import type { DraftSaveOutcome } from "@/lib/travel-expenses/draft-saver";
import {
	type MileageItemDraft,
	type MileageItemDraftInput,
	parseMileageItemDraft,
} from "@/lib/travel-expenses/mileage";
import type { ReportItemView } from "@/lib/travel-expenses/report-store";
import { mileageDraftOf } from "./mileage-item-draft";
import { type MileageFieldName, toDraftInput, toFormValues } from "./mileage-item-form";
import { useDraftSaver } from "./use-draft-saver";

/**
 * The mileage editor's autosaving form: entered values save through one draft
 * saver, and malformed fields keep their last saved value so valid edits still save.
 */
export function useMileageItemDraft({
	reportId,
	item,
	onSaved,
	onDraftChange,
}: {
	reportId: string;
	item: ReportItemView;
	onSaved?: (item: ReportItemView) => void;
	onDraftChange?: (draft: MileageItemDraft | null) => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	// The latest server view: its calculation is shown while the entries match it.
	const [saved, setSaved] = useState(item);
	const [initialSaved] = useState(() => toDraftInput(toFormValues(mileageDraftOf(item), locale)));
	const lastSaved = useRef<MileageItemDraftInput>(initialSaved);

	const { saver, state } = useDraftSaver<MileageItemDraftInput, ReportItemView>({
		version: item.version,
		onUnsavedAfterClose: () =>
			toast.error(
				t(
					"travelExpenses.report.save.unsavedAfterClose",
					"Your latest changes to an expense could not be saved. Open it again to check it.",
				),
			),
		save: async (values, expectedVersion): Promise<DraftSaveOutcome<ReportItemView>> => {
			const parsed = parseMileageItemDraft(values);
			const errors = parsed.ok ? null : parsed.errors;
			// Malformed fields keep their last saved value so valid edits still save.
			const saveable = { ...values };
			for (const field of Object.keys(errors ?? {}) as MileageFieldName[]) {
				saveable[field] = lastSaved.current[field];
			}
			if (errors && !parseMileageItemDraft(saveable).ok) return { status: "invalid", errors };
			const result = await saveMileageItemDraftAction({
				reportId,
				itemId: item.id,
				expectedVersion,
				values: saveable,
			});
			if (!result.success) return { status: "failed", error: result.error };
			switch (result.data.status) {
				case "saved":
					lastSaved.current = toDraftInput(toFormValues(mileageDraftOf(result.data.item), locale));
					setSaved(result.data.item);
					onSaved?.(result.data.item);
					return errors
						? { status: "invalid", errors, version: result.data.item.version }
						: { status: "saved", version: result.data.item.version };
				case "conflict":
					return { status: "conflict", version: result.data.item.version, item: result.data.item };
				case "invalid":
					return { status: "invalid", errors: result.data.errors };
			}
		},
	});

	const [defaultValues] = useState(() => toFormValues(mileageDraftOf(item), locale));
	const form = useForm({
		defaultValues,
		listeners: {
			onChange: ({ formApi }) => {
				const values = toDraftInput(formApi.state.values);
				saver.change(values);
				const parsed = parseMileageItemDraft(values);
				onDraftChange?.(parsed.ok ? parsed.draft : null);
			},
		},
	});

	/** Resolves a save conflict with the other version and shows its values. */
	function resolveWithTheirs() {
		const theirs = state.conflict?.item;
		saver.resolveConflict("use_theirs");
		if (theirs) {
			lastSaved.current = toDraftInput(toFormValues(mileageDraftOf(theirs), locale));
			setSaved(theirs);
			form.reset(toFormValues(mileageDraftOf(theirs), locale), { keepDefaultValues: true });
			onDraftChange?.(mileageDraftOf(theirs));
		}
	}

	return { saver, state, form, saved, resolveWithTheirs };
}
