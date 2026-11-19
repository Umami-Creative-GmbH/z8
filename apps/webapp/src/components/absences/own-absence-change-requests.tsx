"use client";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { AbsenceChangeHistory } from "./absence-change-history";
import { useOwnAbsenceActions } from "./own-absence-actions";

/**
 * The employee's own absence change requests, as an attention section that
 * does not depend on the selected view (#1862). Renders nothing when there are none.
 */
export function OwnAbsenceChangeRequests() {
	const { t } = useTranslate();
	const { changes, changed } = useOwnAbsenceActions();
	const requests = changes.data ?? [];
	if (!changes.isError && requests.length === 0) return null;
	return (
		<div className="space-y-2">
			{changes.isError ? (
				<p role="alert" className="text-sm text-destructive">
					{t("absences.change.historyFailed", "Could not load change requests.")}{" "}
					<Button variant="link" onClick={() => void changes.refetch()}>
						{t("common.retry", "Retry")}
					</Button>
				</p>
			) : null}
			{requests.length > 0 ? (
				<AbsenceChangeHistory requests={requests} onChanged={changed} />
			) : null}
		</div>
	);
}
