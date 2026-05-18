"use client";

import { IconArrowRight } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ApprovalPolicyPreview() {
	const { t } = useTranslate();
	const previewStages = [
		t("settings.approvalPolicies.preview.stage.requester", "Requester"),
		t("settings.approvalPolicies.preview.stage.directManager", "Direct manager"),
		t("settings.approvalPolicies.preview.stage.operationsAdmin", "Operations admin"),
		t("settings.approvalPolicies.preview.stage.approved", "Approved"),
	];

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
					<div className="space-y-1.5">
						<CardTitle>
							{t("settings.approvalPolicies.preview.title", "Preview chain summary")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.approvalPolicies.preview.description",
								"See how matching requests will move through each approval stage before you activate a policy.",
							)}
						</CardDescription>
					</div>
					<Badge variant="outline">
						{t("settings.approvalPolicies.preview.badge", "Preview shell")}
					</Badge>
				</div>
			</CardHeader>
			<CardContent>
				<ol
					className="flex flex-col gap-2 sm:flex-row sm:items-center"
					aria-label={t("settings.approvalPolicies.preview.ariaLabel", "Approval chain preview")}
				>
					{previewStages.map((stage, index) => (
						<li key={stage} className="flex items-center gap-2">
							<div className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">
								{stage}
							</div>
							{index < previewStages.length - 1 ? (
								<IconArrowRight
									className="hidden size-4 text-muted-foreground sm:block"
									aria-hidden="true"
								/>
							) : null}
						</li>
					))}
				</ol>
				<p className="mt-3 text-sm text-muted-foreground">
					{t(
						"settings.approvalPolicies.preview.footer",
						"Full request-context preview will resolve live approvers once policy conditions and employee groups are wired into the editor.",
					)}
				</p>
			</CardContent>
		</Card>
	);
}
