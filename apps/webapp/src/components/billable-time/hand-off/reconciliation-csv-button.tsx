"use client";

import { IconFileSpreadsheet, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ServerActionResult } from "@/lib/effect/result";

export type DownloadReconciliationCsv = () => Promise<
	ServerActionResult<{ fileName: string; content: string }>
>;

/**
 * Downloads a reconciliation CSV (#1504): the server builds it for owners and
 * admins, the browser saves it.
 */
export function ReconciliationCsvButton({ download }: { download: DownloadReconciliationCsv }) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();

	function save() {
		startTransition(async () => {
			const result = await download();
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			const url = window.URL.createObjectURL(
				new Blob([result.data.content], { type: "text/csv;charset=utf-8" }),
			);
			const link = document.createElement("a");
			link.href = url;
			link.download = result.data.fileName;
			document.body.appendChild(link);
			link.click();
			link.remove();
			window.URL.revokeObjectURL(url);
		});
	}

	return (
		<Button size="sm" variant="outline" disabled={isPending} onClick={save}>
			{isPending ? (
				<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
			) : (
				<IconFileSpreadsheet aria-hidden="true" className="size-4" />
			)}
			{t("settings.billableTime.handOff.csv.download", "Download reconciliation CSV")}
		</Button>
	);
}
