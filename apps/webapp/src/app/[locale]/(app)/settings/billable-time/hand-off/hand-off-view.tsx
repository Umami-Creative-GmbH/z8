"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
	HandOffForm,
	type HandOffFormActions,
} from "@/components/billable-time/hand-off/hand-off-form";
import { useHandOffLabels } from "@/components/billable-time/hand-off/hand-off-labels";
import {
	InvoiceDraftPanel,
	type InvoiceDraftPanelActions,
	MarkedWork,
} from "@/components/billable-time/hand-off/invoice-draft-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useDisplayContext } from "@/hooks/use-display-context";
import { formatBillableAmount } from "@/lib/billable-time/format";
import { queryKeys } from "@/lib/query/keys";
import {
	checkInvoiceDraftStatusAction,
	clearChangedAfterInvoicingAction,
	confirmHandOffAction,
	getHandOffOverview,
	getInvoiceDraftAction,
	type HandOffOverview,
	previewHandOffAction,
	releaseInvoiceDraftAction,
	retryHandOffAction,
} from "./actions";

const formActions: HandOffFormActions = {
	async preview(input) {
		const result = await previewHandOffAction(input);
		return result.success ? { ok: true, preview: result.data } : { ok: false, error: result.error };
	},
	async confirm(input) {
		const result = await confirmHandOffAction(input);
		return result.success
			? { ok: true, draftId: result.data.draftId, pending: result.data.status === "pending" }
			: { ok: false, error: result.error };
	},
};

const panelActions: InvoiceDraftPanelActions = {
	load: (draftId) => getInvoiceDraftAction({ draftId }),
	checkStatus: (draftId) => checkInvoiceDraftStatusAction({ draftId }),
	retry: (draftId) => retryHandOffAction({ draftId }),
	release: (draftId, reason) => releaseInvoiceDraftAction({ draftId, reason }),
	clearMarks: (invoicedWorkIds) => clearChangedAfterInvoicingAction({ invoicedWorkIds }),
};

/** Billable Time → Hand-off (#903): new hand-offs, past hand-offs and marked work. */
export function HandOffView() {
	const { t } = useTranslate();
	const { locale } = useDisplayContext();
	const labels = useHandOffLabels();
	const queryClient = useQueryClient();
	const [openDraftId, setOpenDraftId] = useState<string | null>(null);
	const [isClearing, startClearing] = useTransition();

	const overview = useQuery({
		queryKey: queryKeys.billableTime.handOffOverview(),
		queryFn: async (): Promise<HandOffOverview> => {
			const result = await getHandOffOverview();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.billableTime.all });
	};

	if (overview.isPending) {
		return (
			<div className="flex justify-center p-6">
				<IconLoader2
					aria-label={t("common.loading", "Loading")}
					className="size-6 animate-spin text-muted-foreground"
				/>
			</div>
		);
	}
	if (overview.isError) {
		return (
			<p className="text-sm text-destructive" role="alert">
				{overview.error.message}
			</p>
		);
	}

	const { customers, drafts, changedAfterInvoicing } = overview.data;

	return (
		<div className="space-y-6">
			<HandOffForm
				customers={customers}
				actions={formActions}
				onHandedOff={(draftId) => {
					refresh();
					setOpenDraftId(draftId);
				}}
			/>

			{changedAfterInvoicing.length > 0 && (
				<Card>
					<CardContent className="pt-6">
						<MarkedWork
							marked={changedAfterInvoicing}
							disabled={isClearing}
							onClear={(invoicedWorkIds) =>
								startClearing(async () => {
									const result = await clearChangedAfterInvoicingAction({ invoicedWorkIds });
									if (!result.success) {
										toast.error(result.error);
										return;
									}
									toast.success(
										t("settings.billableTime.handOff.marks.cleared", "{count} marks cleared", {
											count: result.data.cleared,
										}),
									);
									refresh();
								})
							}
						/>
					</CardContent>
				</Card>
			)}

			<Card>
				<CardHeader>
					<CardTitle>{t("settings.billableTime.handOff.list.title", "Hand-offs")}</CardTitle>
					<CardDescription>
						{t(
							"settings.billableTime.handOff.list.description",
							"Invoice drafts created in the accounting tool. Open one to check its status, download its timesheet or release it.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{drafts.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t("settings.billableTime.handOff.list.empty", "No hand-offs yet")}
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>
										{t("settings.billableTime.handOff.list.customer", "Customer")}
									</TableHead>
									<TableHead>{t("settings.billableTime.handOff.list.period", "Period")}</TableHead>
									<TableHead>{t("settings.billableTime.handOff.list.status", "Status")}</TableHead>
									<TableHead className="text-right">
										{t("settings.billableTime.handOff.list.total", "Net total")}
									</TableHead>
									<TableHead className="sr-only">
										{t("settings.billableTime.handOff.list.actions", "Actions")}
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{drafts.map((draft) => (
									<TableRow key={draft.id}>
										<TableCell className="font-medium">{draft.customerName}</TableCell>
										<TableCell className="tabular-nums">
											{draft.period.from} – {draft.period.to}
										</TableCell>
										<TableCell>
											<div className="flex flex-wrap gap-1">
												<Badge variant={draft.status === "created" ? "default" : "secondary"}>
													{labels.status(draft.status)}
												</Badge>
												{draft.changedCount > 0 && (
													<Badge variant="outline">
														{t(
															"settings.billableTime.handOff.list.changed",
															"{count} changed after invoicing",
															{ count: draft.changedCount },
														)}
													</Badge>
												)}
												{draft.toolStatus === "gone" && draft.status === "created" && (
													<Badge variant="destructive">
														{t("settings.billableTime.handOff.list.gone", "Deleted in the tool")}
													</Badge>
												)}
											</div>
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatBillableAmount(locale, draft.netTotal, draft.currency)}
										</TableCell>
										<TableCell className="text-right">
											<Button size="sm" variant="outline" onClick={() => setOpenDraftId(draft.id)}>
												{t("settings.billableTime.handOff.list.open", "Open")}
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<InvoiceDraftPanel
				draftId={openDraftId}
				onOpenChange={(open) => {
					if (!open) setOpenDraftId(null);
				}}
				actions={panelActions}
				onChanged={refresh}
			/>
		</div>
	);
}
