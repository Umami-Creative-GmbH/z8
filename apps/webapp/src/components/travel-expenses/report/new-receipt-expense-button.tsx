"use client";

import { IconLoader2, IconPlaneDeparture, IconReceipt } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
	createStandaloneReceiptReportAction,
	createTripReportAction,
} from "@/app/[locale]/(app)/travel-expenses/report-actions";
import { Button } from "@/components/ui/button";
import type { ServerActionResult } from "@/lib/effect/result";
import { useRouter } from "@/navigation";

/** Creates a report draft and opens its editor. */
function NewReportButton({
	create,
	icon,
	label,
	variant,
}: {
	create: () => Promise<ServerActionResult<{ reportId: string }>>;
	icon: ReactNode;
	label: string;
	variant?: "outline";
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const [creating, setCreating] = useState(false);

	async function open() {
		setCreating(true);
		try {
			const result = await create();
			if (result.success) {
				router.push(`/travel-expenses/reports/${result.data.reportId}`);
				return;
			}
		} catch {
			// Reported below.
		}
		toast.error(
			t("travelExpenses.report.errors.create", "The expense could not be created. Please retry."),
		);
		setCreating(false);
	}

	return (
		<Button variant={variant} onClick={() => void open()} disabled={creating}>
			{creating ? <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : icon}
			{label}
		</Button>
	);
}

/** Creates a standalone receipt report (no trip details) and opens its editor. */
export function NewReceiptExpenseButton() {
	const { t } = useTranslate();
	return (
		<NewReportButton
			create={createStandaloneReceiptReportAction}
			icon={<IconReceipt className="mr-2 size-4" aria-hidden="true" />}
			label={t("travelExpenses.report.actions.newReceipt", "New receipt")}
			variant="outline"
		/>
	);
}

/** Creates a trip report, whose expenses share travel details, and opens its editor. */
export function NewTripReportButton() {
	const { t } = useTranslate();
	return (
		<NewReportButton
			create={createTripReportAction}
			icon={<IconPlaneDeparture className="mr-2 size-4" aria-hidden="true" />}
			label={t("travelExpenses.report.actions.newTrip", "New trip")}
		/>
	);
}
