"use client";

import { useTranslate } from "@tolgee/react";
import { IconAlertTriangle, IconCertificate, IconLoader2 } from "@tabler/icons-react";
import { DateTime } from "luxon";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { SkillValidationResult } from "@/lib/effect/services/skill.service";

interface SkillWarningAlertProps {
	validation: SkillValidationResult | undefined;
	isLoading?: boolean;
}

export function SkillWarningAlert({ validation, isLoading }: SkillWarningAlertProps) {
	const { t } = useTranslate();

	if (isLoading) {
		return (
			<Alert>
				<IconLoader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
				<AlertTitle>{t("scheduling.skills.validating", "Validating Skills…")}</AlertTitle>
				<AlertDescription>
					{t("scheduling.skills.validatingDescription", "Checking employee qualifications")}
				</AlertDescription>
			</Alert>
		);
	}

	if (!validation) {
		return null;
	}

	if (validation.isQualified) {
		return null;
	}

	// Pre-compute filtered arrays once (js-combine-iterations)
	const requiredMissing: typeof validation.missingSkills = [];
	const preferredMissing: typeof validation.missingSkills = [];
	for (const skill of validation.missingSkills) {
		if (skill.isRequired) {
			requiredMissing.push(skill);
		} else {
			preferredMissing.push(skill);
		}
	}

	const hasExpired = validation.expiredSkills.length > 0;

	return (
		<Alert variant={requiredMissing.length > 0 || hasExpired ? "destructive" : "default"}>
			<IconAlertTriangle className="h-4 w-4" aria-hidden="true" />
			<AlertTitle>
				{requiredMissing.length > 0 || hasExpired
					? t("scheduling.skills.requirementsNotMet", "Skill Requirements Not Met")
					: t("scheduling.skills.preferredSkillsMissing", "Preferred Skills Missing")}
			</AlertTitle>
			<AlertDescription>
				<div className="space-y-3 mt-2">
					{/* Missing Required Skills */}
					{requiredMissing.length > 0 && (
						<div>
							<p className="font-medium text-sm mb-1.5 flex items-center gap-1.5">
								<IconCertificate className="h-4 w-4" aria-hidden="true" />
								{t("scheduling.skills.missingRequired", "Missing Required Skills:")}
							</p>
							<ul className="space-y-1 pl-5">
								{requiredMissing.map((skill) => (
									<li key={skill.id} className="text-sm flex items-center gap-2">
										<span className="w-1.5 h-1.5 rounded-full bg-destructive" />
										{skill.name}
										<Badge variant="outline" className="text-xs">
											{skill.category}
										</Badge>
									</li>
								))}
							</ul>
						</div>
					)}

					{/* Missing Preferred Skills */}
					{preferredMissing.length > 0 && (
						<div>
							<p className="font-medium text-sm mb-1.5">
								{t("scheduling.skills.missingPreferred", "Missing Preferred Skills:")}
							</p>
							<ul className="space-y-1 pl-5">
								{preferredMissing.map((skill) => (
									<li key={skill.id} className="text-sm flex items-center gap-2">
										<span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
										{skill.name}
										<Badge variant="secondary" className="text-xs">
											{t("scheduling.skills.preferred", "Preferred")}
										</Badge>
									</li>
								))}
							</ul>
						</div>
					)}

					{/* Expired Certifications */}
					{hasExpired && (
						<div>
							<p className="font-medium text-sm mb-1.5">
								{t("scheduling.skills.expiredCertifications", "Expired Certifications:")}
							</p>
							<ul className="space-y-1 pl-5">
								{validation.expiredSkills.map((skill) => (
									<li key={skill.id} className="text-sm flex items-center gap-2">
										<span className="w-1.5 h-1.5 rounded-full bg-destructive" />
										{skill.name}
										<span className="text-xs text-muted-foreground">
											{t("scheduling.skills.expiredOn", "(Expired {{date}})", {
												date: DateTime.fromJSDate(skill.expiresAt).toLocaleString(DateTime.DATE_SHORT),
											})}
										</span>
									</li>
								))}
							</ul>
						</div>
					)}

					{/* Warning Message */}
					{(requiredMissing.length > 0 || hasExpired) && (
						<p className="text-xs text-muted-foreground mt-2 pt-2 border-t">
							{t(
								"scheduling.skills.warningMessage",
								"You can still assign this shift, but it will be logged as an override."
							)}
						</p>
					)}
				</div>
			</AlertDescription>
		</Alert>
	);
}

/**
 * Compact version for inline display in employee lists
 */
export function SkillWarningBadge({ validation }: { validation: SkillValidationResult | undefined }) {
	const { t } = useTranslate();

	if (!validation || validation.isQualified) {
		return null;
	}

	const hasMissingRequired = validation.missingSkills.some((s) => s.isRequired);
	const hasExpired = validation.expiredSkills.length > 0;
	const totalIssues = validation.missingSkills.length + validation.expiredSkills.length;

	if (hasMissingRequired || hasExpired) {
		return (
			<Badge variant="destructive" className="text-xs">
				<IconAlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />
				{t("scheduling.skills.unqualified", "Unqualified")}
			</Badge>
		);
	}

	return (
		<Badge variant="secondary" className="text-xs">
			{t("scheduling.skills.missingPreferredCount", "{{count}} preferred missing", { count: totalIssues })}
		</Badge>
	);
}
