"use client";

import { IconAlertTriangle, IconCalendarDue } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import type { OwnSkills } from "@/lib/scheduling/own-skills";
import { skillExpiryBadge } from "@/lib/scheduling/skill-expiry";

/**
 * The employee's own skills on their profile (#1143): where a skill expiry
 * reminder links them. Read-only; admins and managers assign and edit skills.
 */
export function OwnSkillsCard({ ownSkills }: { ownSkills: OwnSkills }) {
	const { t } = useTranslate();
	const locale = useTolgee().getLanguage() || "en";
	const formatDate = (day: string) => formatPlainDate(parsePlainDate(day), locale, "dateMedium");

	return (
		<Card id="skills" className="scroll-mt-6">
			<CardHeader>
				<CardTitle>{t("settings.profile.skills.title", "My skills")}</CardTitle>
				<CardDescription>
					{t(
						"settings.profile.skills.description",
						"Your employee skills, as recorded by your organization. Ask an admin or your manager to renew one that expires.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ul className="space-y-2">
					{ownSkills.skills.map((ownSkill) => {
						const badge = skillExpiryBadge({
							expiresAt: ownSkill.expiresAt,
							today: ownSkills.today,
							expiringSoonDays: ownSkills.expiringSoonDays,
						});
						return (
							<li
								key={ownSkill.id}
								className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
							>
								<div className="flex flex-wrap items-center gap-2">
									<span className="font-medium">{ownSkill.name}</span>
									{badge === "expired" && (
										<Badge variant="destructive">
											<IconAlertTriangle className="mr-1 size-3" aria-hidden="true" />
											{t("settings.profile.skills.expired", "Expired")}
										</Badge>
									)}
									{badge === "expiringSoon" && (
										<Badge variant="secondary" className="bg-yellow-500/20 text-yellow-700">
											<IconCalendarDue className="mr-1 size-3" aria-hidden="true" />
											{t("settings.profile.skills.expiringSoon", "Expiring soon")}
										</Badge>
									)}
								</div>
								<span className="text-sm text-muted-foreground">
									{ownSkill.expiresAt
										? t("settings.profile.skills.validUntil", "Valid until {date}", {
												date: formatDate(ownSkill.expiresAt),
											})
										: t("settings.profile.skills.noExpiry", "Does not expire")}
								</span>
							</li>
						);
					})}
				</ul>
			</CardContent>
		</Card>
	);
}
