"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useMemo } from "react";
import type {
	ProjectTemplatePreviewData,
	SkippedManagerOrAssignment,
} from "@/lib/projects/project-template-model";

/** The reason a manager or assignment is not copied, as a short lower-case phrase. */
function useSkipReason() {
	const { t } = useTranslate();
	return (reason: SkippedManagerOrAssignment["reason"]) => {
		switch (reason) {
			case "departed":
				return t("settings.projects.fromTemplate.reasonDeparted", "left the organization");
			case "removed":
				return t("settings.projects.fromTemplate.reasonRemoved", "no longer exists");
			case "adminOnly":
				return t(
					"settings.projects.fromTemplate.reasonAdminOnly",
					"only organization admins assign project managers",
				);
		}
	};
}

/** One sentence naming the managers and assignments that were not copied, and why. */
export function useNotCopiedMessage() {
	const { t } = useTranslate();
	const locale = useLocale();
	const reasonOf = useSkipReason();
	const listFormat = useMemo(() => new Intl.ListFormat(locale, { type: "conjunction" }), [locale]);
	return (skipped: readonly Pick<SkippedManagerOrAssignment, "name" | "reason">[]) =>
		t("settings.projects.fromTemplate.skipped", "Not copied: {members}", {
			members: listFormat.format(
				skipped.map((member) =>
					t("settings.projects.fromTemplate.skippedMemberReason", "{name} ({reason})", {
						name: member.name,
						reason: reasonOf(member.reason),
					}),
				),
			),
		});
}

/**
 * What creating a project from this template copies, and which of its
 * managers and assignments will be skipped: because they are gone, or because
 * only org admins assign project managers.
 */
export function ProjectTemplatePreview({ template }: { template: ProjectTemplatePreviewData }) {
	const { t } = useTranslate();
	const reasonOf = useSkipReason();
	const members = [
		...template.managers.map((manager) => ({
			id: manager.id,
			name: manager.name,
			reason:
				manager.availability === "available" && !template.managersCopied
					? ("adminOnly" as const)
					: manager.availability,
		})),
		...template.assignments.map((assignment) => ({
			id: assignment.id,
			name: assignment.name,
			reason: assignment.availability,
		})),
	];
	const copied = members.filter((member) => member.reason === "available").length;
	const skipped = members.flatMap((member) =>
		member.reason === "available" ? [] : [{ ...member, reason: member.reason }],
	);

	return (
		<section
			aria-label={t("settings.projects.fromTemplate.previewLabel", "From {name}", {
				name: template.name,
			})}
			className="grid gap-2 rounded-md border bg-muted/40 p-3 text-sm"
		>
			<div className="flex items-center gap-2 font-medium">
				{template.color && (
					<span
						aria-hidden="true"
						className="size-3 rounded-full"
						style={{ backgroundColor: template.color }}
					/>
				)}
				{t("settings.projects.fromTemplate.copies", "Copied from the template")}
			</div>
			<ul className="grid gap-1 text-muted-foreground">
				<li>
					{t(
						"settings.projects.fromTemplate.taskCount",
						"{count, plural, one {# task} other {# tasks}}",
						{ count: template.tasks.length },
					)}
				</li>
				{template.budgetHours && (
					<li>
						{t("settings.projects.fromTemplate.budget", "{hours} h budget", {
							hours: Number(template.budgetHours),
						})}
					</li>
				)}
				{template.deadlineOffsetDays !== null && (
					<li>
						{template.deadlineOffsetDays === 0
							? t("settings.projects.fromTemplate.deadlineSameDay", "Deadline on the creation day")
							: t(
									"settings.projects.fromTemplate.deadline",
									"Deadline {days, plural, one {# day} other {# days}} after creation",
									{ days: template.deadlineOffsetDays },
								)}
					</li>
				)}
				<li>
					{t(
						"settings.projects.fromTemplate.memberCount",
						"{count, plural, one {# manager or assignment} other {# managers and assignments}}",
						{ count: copied },
					)}
				</li>
			</ul>
			{skipped.length > 0 && (
				<div className="grid gap-1">
					<div className="font-medium text-amber-700 dark:text-amber-400">
						{t("settings.projects.fromTemplate.willSkip", "Will not be copied")}
					</div>
					<ul className="grid gap-1 text-muted-foreground">
						{skipped.map((member) => (
							<li key={member.id}>
								{t("settings.projects.fromTemplate.skippedMember", "{name}: {reason}", {
									name: member.name,
									reason: reasonOf(member.reason),
								})}
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	);
}
