"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useTransition } from "react";
import { toast } from "sonner";
import type { PayrollSettlementCounts } from "@/app/[locale]/(app)/payroll/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { ServerActionResult } from "@/lib/effect/result";
import { SettlePreview } from "./payroll-settle-preview";
import type { PayrollTranslate } from "./state";
import { usePayrollSettlementChanged } from "./use-payroll-settlement-changed";

type SettleAction<Request> = (
	request: Request,
) => Promise<ServerActionResult<PayrollSettlementCounts>>;

/**
 * Settling by hand in two steps: a preview of a request, then settling exactly that
 * request after the officer confirms. Shared by the Settlement tab and the Days tab's
 * selection of days.
 */
export function usePayrollSettle<Request>({
	onSettled,
	preview,
	settle,
	t,
}: {
	onSettled?: (counts: PayrollSettlementCounts) => void;
	preview: SettleAction<Request>;
	settle: SettleAction<Request>;
	t: PayrollTranslate;
}) {
	const settlementChanged = usePayrollSettlementChanged();
	const previewRequest = useMutation({
		mutationFn: async (request: Request) => {
			const result = await preview(request);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});
	const [isSettling, startSettling] = useTransition();
	const request = previewRequest.variables;

	function confirm() {
		if (request === undefined) return;
		startSettling(async () => {
			const result = await settle(request);
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			toast.success(
				t("payroll.settle.settled", "{count} days settled", { count: result.data.newDays }),
			);
			previewRequest.reset();
			onSettled?.(result.data);
			await settlementChanged();
		});
	}

	return {
		/** Previews the request; the confirm dialog opens with its counts. */
		requestPreview: (next: Request) => previewRequest.mutate(next),
		preview: previewRequest.data,
		isPreviewing: previewRequest.isPending,
		isSettling,
		close: () => previewRequest.reset(),
		confirm,
	};
}

/** The confirmation before settling, with the preview's counts and warnings. */
export function PayrollSettleConfirmDialog({
	description,
	settle,
	t,
}: {
	description: string;
	settle: Pick<ReturnType<typeof usePayrollSettle>, "preview" | "isSettling" | "close" | "confirm">;
	t: PayrollTranslate;
}) {
	const { preview, isSettling, close, confirm } = settle;
	return (
		<Dialog open={preview !== undefined} onOpenChange={(open) => !open && close()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("payroll.settle.confirmTitle", "Settle these days?")}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{preview ? <SettlePreview preview={preview} t={t} /> : null}
				<DialogFooter>
					<Button type="button" variant="outline" onClick={close}>
						{t("payroll.settle.cancel", "Cancel")}
					</Button>
					<Button
						type="button"
						disabled={isSettling || !preview || preview.newDays === 0}
						onClick={confirm}
					>
						{isSettling ? <IconLoader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
						{t("payroll.settle.confirm", "Settle {count} days", {
							count: preview?.newDays ?? 0,
						})}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
