"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { reportDrivingImpedimentAction } from "@/lib/organization/driving-licence/impediment-actions";

export function ReportDrivingImpediment() {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();
	const command = useRef<string | null>(null);
	const [pending, startTransition] = useTransition();
	const [result, setResult] = useState<"reported" | "error" | null>(null);
	const report = () =>
		startTransition(async () => {
			if (command.current === null) command.current = crypto.randomUUID();
			try {
				const response = await reportDrivingImpedimentAction({
					commandId: command.current,
				});
				setResult(response.success ? "reported" : "error");
				if (response.success) {
					void queryClient.invalidateQueries({
						queryKey: ["driving-authorization-status"],
					});
					router.refresh();
				}
			} catch {
				setResult("error");
			}
		});
	return (
		<section
			className="space-y-3 rounded-lg border p-4"
			aria-label={t("drivingLicence.impediment.title", "Unable to drive?")}
		>
			<h2 className="font-semibold">
				{t("drivingLicence.impediment.title", "Unable to drive?")}
			</h2>
			<p className="text-sm text-muted-foreground">
				{t(
					"drivingLicence.impediment.reportHelp",
					"Report a current inability to drive. All class authorizations will be suspended immediately. You do not need to provide personal reasons.",
				)}
			</p>
			{result === "reported" ? (
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
						: t(
								"drivingLicence.impediment.report",
								"Report that I cannot drive",
							)}
				</Button>
			)}
			{result === "error" && (
				<p role="alert" className="text-sm text-destructive">
					{t(
						"drivingLicence.impediment.reportFailed",
						"The report could not be saved. Retry or contact your responsible verifier immediately.",
					)}
				</p>
			)}
		</section>
	);
}
