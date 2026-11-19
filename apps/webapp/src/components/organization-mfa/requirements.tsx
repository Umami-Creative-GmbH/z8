"use client";

import { useTranslate } from "@tolgee/react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { MemberMfaRequirement } from "@/lib/organization-mfa/queries";

export function MfaRequirements({
	requirements,
	organizationId,
	callbackUrl,
}: {
	requirements: MemberMfaRequirement[];
	organizationId: string | null;
	callbackUrl?: string;
}) {
	const { t } = useTranslate();
	return (
		<section aria-labelledby="mfa-requirements-title" className="space-y-3">
			<h2 id="mfa-requirements-title" className="text-sm font-semibold">
				{t("mfa.requirements.title", "Organization requirements")}
			</h2>
			{requirements.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"mfa.requirements.empty",
						"No organization requirements are listed for this account.",
					)}
				</p>
			) : (
				<ul className="divide-y rounded-lg border bg-muted/30">
					{requirements.map((requirement) => {
						const selected = requirement.organizationId === organizationId;
						const query = new URLSearchParams({
							organizationId: requirement.organizationId,
						});
						if (callbackUrl) query.set("callbackUrl", callbackUrl);
						return (
							<li key={requirement.organizationId} className="space-y-2 p-4">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<Link
										href={`?${query}`}
										aria-current={selected ? "true" : undefined}
										className="min-w-0 break-words rounded-sm font-medium underline decoration-border underline-offset-4 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-ring"
									>
										{requirement.organizationName}
									</Link>
									{selected && (
										<Badge
											variant="secondary"
											className="max-w-full whitespace-normal"
										>
											{t("mfa.requirements.selected", "Selected organization")}
										</Badge>
									)}
								</div>
								<p className="text-sm font-medium tabular-nums">
									{requirement.deadlineLabel ??
										t("mfa.deadline.required", "Verification required now")}
								</p>
								<p className="text-sm text-muted-foreground">
									{requirement.enforced
										? t(
												"mfa.deadline.enforced",
												"An authenticator must be verified before organization access.",
											)
										: t(
												"mfa.deadline.grace",
												"Enrollment window in progress. Verify an authenticator before this deadline.",
											)}
								</p>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
