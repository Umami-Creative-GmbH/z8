"use client";

import { IconLoader2, IconUserShare } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveDeputyDecisionsEnabledAction } from "@/app/[locale]/(app)/settings/approval-policies/deputy-decisions-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";

/**
 * The "Deputies can decide approvals" approval setting (#1015, Approvals ADR
 * 0002). On by default; off, deputies stay contacts and never cover for an
 * absent approver.
 */
export function DeputyDecisionsSetting({ enabled }: { enabled: boolean }) {
	const { t } = useTranslate();
	const [checked, setChecked] = useState(enabled);
	const [isPending, startTransition] = useTransition();

	function change(next: boolean) {
		setChecked(next);
		startTransition(async () => {
			const result = await saveDeputyDecisionsEnabledAction({
				enabled: next,
			}).catch(() => null);
			if (!result?.success) {
				setChecked(!next);
				toast.error(actionErrorMessage(t, result));
				return;
			}
			toast.success(
				next
					? t(
							"settings.approvalEscalation.deputyDecisions.enabled",
							"Deputies can now decide approvals while the approver is away.",
						)
					: t(
							"settings.approvalEscalation.deputyDecisions.disabled",
							"Deputies can no longer decide approvals. They stay contacts.",
						),
			);
		});
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconUserShare aria-hidden="true" className="size-5" />
					{t("settings.approvalEscalation.deputyDecisions.title", "Deputies")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.approvalEscalation.deputyDecisions.description",
						"Employees name a deputy on their absences. While an approver is on an approved absence, their deputy can see and decide the approvals still assigned to them.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0 space-y-1">
						<Label htmlFor="deputy-decisions-enabled" className="text-sm font-medium">
							{t(
								"settings.approvalEscalation.deputyDecisions.toggle",
								"Deputies can decide approvals",
							)}
						</Label>
						<p id="deputy-decisions-enabled-description" className="text-sm text-muted-foreground">
							{t(
								"settings.approvalEscalation.deputyDecisions.help",
								"Only deputies who can use the approval inbox decide, and only on the approver's absence days. The approver keeps their approvals. When this is off, deputies are contacts only.",
							)}
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						{isPending ? (
							<IconLoader2
								aria-hidden="true"
								className="size-4 text-muted-foreground motion-safe:animate-spin"
							/>
						) : null}
						<Switch
							id="deputy-decisions-enabled"
							checked={checked}
							onCheckedChange={change}
							disabled={isPending}
							aria-describedby="deputy-decisions-enabled-description"
						/>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
