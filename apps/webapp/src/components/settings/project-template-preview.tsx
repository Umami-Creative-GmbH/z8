"use client";

import { useTranslate } from "@tolgee/react";
import type {
	ProjectTemplate,
	ProjectTemplateMemberAvailability,
	SkippedProjectMember,
} from "@/lib/projects/project-template-model";

/** The reason a member is not copied, as a short lower-case phrase. */
function useSkipReason() {
	const { t } = useTranslate();
	return (reason: Exclude<ProjectTemplateMemberAvailability, "available">) =>
		reason === "departed"
			? t("settings.projects.fromTemplate.reasonDeparted", "left the organization")
			: t("settings.projects.fromTemplate.reasonRemoved", "no longer exists");
}

/** One sentence naming the managers and assignments that were not copied, and why. */
export function useSkippedMembersMessage() {
	const { t } = useTranslate();
	const reasonOf = useSkipReason();
	return (skipped: readonly SkippedProjectMember[]) =>
		t("settings.projects.fromTemplate.skipped", "Not copied: {members}", {
			members: skipped.map((member) => `${member.name} (${reasonOf(member.reason)})`).join(", "),
		});
}

/**
 * What creating a project from this template copies, and which of its
 * managers and assignments will be skipped because they are gone.
 */
export function ProjectTemplatePreview({ template }: { template: ProjectTemplate }) {
	const { t } = useTranslate();
	const reasonOf = useSkipReason();
	const members = [...template.managers, ...template.assignments];
	const copied = members.filter((member) => member.availability === "available").length;
	const skipped = members.flatMap((member) =>
		member.availability === "available"
			? []
			: [{ id: member.id, name: member.name, reason: member.availability }],
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
