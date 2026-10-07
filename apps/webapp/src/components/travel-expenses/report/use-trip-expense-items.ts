"use client";

import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { addTripMileageItemAction } from "@/app/[locale]/(app)/travel-expenses/mileage-actions";
import { addTripPerDiemItemAction } from "@/app/[locale]/(app)/travel-expenses/per-diem-actions";
import {
	addTripReportItemAction,
	removeTripReportItemAction,
} from "@/app/[locale]/(app)/travel-expenses/report-actions";
import type { ReportItemView } from "@/lib/travel-expenses/report-store";

/**
 * Adds and removes the expenses of a trip report, keeping each removal's
 * failure per expense and moving keyboard focus along with the change.
 */
export function useTripExpenseItems({
	reportId,
	items,
	refreshReport,
	refreshDrafts,
}: {
	reportId: string;
	/** The rendered expenses; focus moves are retried whenever they change. */
	items: ReportItemView[];
	refreshReport: () => Promise<unknown>;
	refreshDrafts: () => Promise<unknown>;
}) {
	const { t } = useTranslate();
	const [adding, setAdding] = useState(false);
	const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});
	const [focusTarget, setFocusTarget] = useState<{ itemId: string } | "add" | null>(null);
	const addButton = useRef<HTMLButtonElement>(null);

	// Moves focus once the added expense is rendered, or back to the add
	// action once the removed one is gone, so keyboard users keep their place.
	// biome-ignore lint/correctness/useExhaustiveDependencies: retried whenever the rendered expenses change
	useEffect(() => {
		if (focusTarget === "add") {
			if (addButton.current) addButton.current.focus();
			// Focus can only move once the change is in the DOM, i.e. after render.
			// react-doctor-disable-next-line react-hooks-js/set-state-in-effect
			setFocusTarget(null);
		} else if (focusTarget) {
			const heading = document.getElementById(`expense-${focusTarget.itemId}`);
			if (heading) {
				heading.focus();
				setFocusTarget(null);
			}
		}
	}, [focusTarget, items]);

	async function addItem(type: "receipt" | "mileage" | "per_diem" = "receipt") {
		setAdding(true);
		// No `finally`: the React Compiler cannot compile try statements with one.
		try {
			const add =
				type === "per_diem"
					? addTripPerDiemItemAction
					: type === "mileage"
						? addTripMileageItemAction
						: addTripReportItemAction;
			const result = await add({ reportId });
			if (result.success) {
				setFocusTarget({ itemId: result.data.item.id });
				await Promise.all([refreshReport(), refreshDrafts()]);
			} else {
				toast.error(
					t(
						"travelExpenses.report.items.addFailed",
						"The expense could not be added. Please retry.",
					),
				);
			}
		} catch {
			toast.error(
				t("travelExpenses.report.items.addFailed", "The expense could not be added. Please retry."),
			);
		}
		setAdding(false);
	}

	async function removeItem(itemId: string, expectedVersion: number): Promise<boolean> {
		setRemoveErrors((errors) =>
			Object.fromEntries(Object.entries(errors).filter(([id]) => id !== itemId)),
		);
		const failed = (message: string) => {
			setRemoveErrors((errors) => ({ ...errors, [itemId]: message }));
			return false;
		};
		try {
			const result = await removeTripReportItemAction({
				reportId,
				itemId,
				expectedVersion,
			});
			if (!result.success) {
				return failed(
					t(
						"travelExpenses.report.items.removeFailed",
						"The expense could not be removed. Please retry.",
					),
				);
			}
			if (result.data.status === "conflict") {
				void refreshReport();
				return failed(
					t(
						"travelExpenses.report.items.removeConflict",
						"This expense changed elsewhere and was not removed. Check it and try again.",
					),
				);
			}
			setFocusTarget("add");
			await Promise.all([refreshReport(), refreshDrafts()]);
			return true;
		} catch {
			return failed(
				t(
					"travelExpenses.report.items.removeFailed",
					"The expense could not be removed. Please retry.",
				),
			);
		}
	}

	return { adding, removeErrors, addButton, addItem, removeItem };
}
