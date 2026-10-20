"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { reportDrivingImpedimentAction } from "@/lib/organization/driving-licence/impediment-actions";
import { queryKeys } from "@/lib/query";

/** *Unable to drive?* on My licence: reports a current inability to drive, without reasons. */
export function ReportDrivingImpediment() {
	const { t } = useTranslate();
	const titleId = useId();
	const router = useRouter();
	const queryClient = useQueryClient();
	const command = useRef<string | null>(null);
	const [pending, startTransition] = useTransition();
	const [reported, setReported] = useState(false);
	const failed = () =>
		toast.error(
			t(
				"drivingLicence.impediment.reportFailed",
				"The report could not be saved. Retry or contact your responsible verifier immediately.",
			),
		);
	const report = () =>
		startTransition(async () => {
			if (command.current === null) command.current = crypto.randomUUID();
			try {
				const response = await reportDrivingImpedimentAction({
					commandId: command.current,
				});
				if (!response.success) {
					failed();
					return;
				}
				setReported(true);
				toast.success(t("drivingLicence.impediment.reportedToast", "Report saved"));
				void queryClient.invalidateQueries({ queryKey: queryKeys.drivingLicence.status });
				router.refresh();
			} catch {
				failed();
			}
		});
	return (
		<Card role="region" aria-labelledby={titleId}>
			<CardHeader>
				<CardTitle>
					<h2 id={titleId} className="font-semibold">
						{t("drivingLicence.impediment.title", "Unable to drive?")}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"drivingLicence.impediment.reportHelp",
						"Report a current inability to drive. All class authorizations will be suspended immediately. You do not need to provide personal reasons.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{reported ? (
					<p role="status" className="text-sm font-medium">
						{t(
							"drivingLicence.impediment.reported",
							"All your class authorizations are suspended. Contact your responsible verifier for a new original check and explicit reinstatement after the impediment is resolved.",
						)}
					</p>
				) : (
					<Button variant="destructive" disabled={pending} onClick={report}>
						{pending
							? t("drivingLicence.impediment.reporting", "Saving report…")
							: t("drivingLicence.impediment.report", "Report that I cannot drive")}
					</Button>
				)}
			</CardContent>
		</Card>
	);
}
