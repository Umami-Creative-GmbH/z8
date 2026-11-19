"use client";

import { IconCar, IconLoader2, IconPlaneDeparture, IconReceipt } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createStandaloneMileageReportAction } from "@/app/[locale]/(app)/travel-expenses/mileage-actions";
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
	description,
	variant,
}: {
	create: () => Promise<ServerActionResult<{ reportId: string }>>;
	icon: ReactNode;
	label: string;
	description: string;
	variant?: "outline";
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const [creating, setCreating] = useState(false);
	const [failed, setFailed] = useState(false);
	const lifetime = useRef<object | null>(null);
	const pending = useRef(false);
	useLayoutEffect(() => {
		lifetime.current = {};
		pending.current = false;
		return () => {
			lifetime.current = null;
		};
	}, []);

	async function open() {
		const arrival = lifetime.current;
		if (!arrival || pending.current) return;
		pending.current = true;
		setCreating(true);
		setFailed(false);
		try {
			const result = await create();
			if (lifetime.current !== arrival) return;
			if (result.success) {
				router.push(`/travel-expenses/reports/${result.data.reportId}`);
				return;
			}
		} catch {
			// Reported below.
		}
		if (lifetime.current !== arrival) return;
		toast.error(
			t("travelExpenses.report.errors.create", "The expense could not be created. Please retry."),
		);
		setCreating(false);
		pending.current = false;
		setFailed(true);
	}

	return (
		<div className="min-w-0 space-y-2">
			<Button
				variant={variant}
				onClick={() => void open()}
				disabled={creating}
				aria-busy={creating}
				className="min-h-12 w-full justify-start px-4"
			>
				{creating ? <IconLoader2 className="size-4 animate-spin" aria-hidden="true" /> : icon}
				{label}
			</Button>
			<p className="px-1 text-sm text-muted-foreground">{description}</p>
			{failed && (
				<div role="alert" className="max-w-xs space-y-2 text-sm">
					<p>
						{t(
							"travelExpenses.report.errors.create",
							"The expense could not be created. Please retry.",
						)}
					</p>
					<Button variant="outline" size="sm" onClick={() => void open()}>
						{t("common.retry", "Retry")}
					</Button>
				</div>
			)}
		</div>
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
			description={t(
				"travelExpenses.workspace.receiptDescription",
				"Record one expense with its receipt.",
			)}
			variant="outline"
		/>
	);
}

/** Creates a standalone mileage report (#606) and opens its editor. */
export function NewMileageExpenseButton() {
	const { t } = useTranslate();
	return (
		<NewReportButton
			create={createStandaloneMileageReportAction}
			icon={<IconCar className="mr-2 size-4" aria-hidden="true" />}
			label={t("travelExpenses.report.actions.newMileage", "New mileage")}
			description={t(
				"travelExpenses.workspace.mileageDescription",
				"Record a business drive outside a trip.",
			)}
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
			description={t(
				"travelExpenses.workspace.tripDescription",
				"Collect expenses with shared travel details.",
			)}
		/>
	);
}
