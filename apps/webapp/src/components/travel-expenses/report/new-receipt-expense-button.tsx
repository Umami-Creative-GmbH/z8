"use client";

import { IconLoader2, IconReceipt } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { createStandaloneReceiptReportAction } from "@/app/[locale]/(app)/travel-expenses/report-actions";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/navigation";

/** Creates a standalone receipt report (no trip details) and opens its editor. */
export function NewReceiptExpenseButton() {
	const { t } = useTranslate();
	const router = useRouter();
	const [creating, setCreating] = useState(false);

	async function create() {
		setCreating(true);
		try {
			const result = await createStandaloneReceiptReportAction();
			if (!result.success) {
				toast.error(
					t(
						"travelExpenses.report.errors.create",
						"The expense could not be created. Please retry.",
					),
				);
				setCreating(false);
				return;
			}
			router.push(`/travel-expenses/reports/${result.data.reportId}`);
		} catch {
			toast.error(
				t("travelExpenses.report.errors.create", "The expense could not be created. Please retry."),
			);
			setCreating(false);
		}
	}

	return (
		<Button onClick={() => void create()} disabled={creating}>
			{creating ? (
				<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
			) : (
				<IconReceipt className="mr-2 size-4" aria-hidden="true" />
			)}
			{t("travelExpenses.report.actions.newReceipt", "New receipt")}
		</Button>
	);
}
