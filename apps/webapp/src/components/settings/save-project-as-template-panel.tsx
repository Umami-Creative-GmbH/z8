"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { saveProjectAsTemplate } from "@/app/[locale]/(app)/settings/projects/from-template-actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { PROJECT_TEMPLATE_NAME_MAX_LENGTH } from "@/lib/projects/project-template-model";
import { queryKeys } from "@/lib/query";
import { useSkippedMembersMessage } from "./project-template-preview";

interface SaveProjectAsTemplatePanelProps {
	organizationId: string;
	project: { id: string; name: string } | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/**
 * Saves a project as a new template (#880, org owners and admins): its icon,
 * colour, budget, open tasks, managers and assignments, without a deadline.
 */
export function SaveProjectAsTemplatePanel({
	organizationId,
	project,
	open,
	onOpenChange,
}: SaveProjectAsTemplatePanelProps) {
	const { t } = useTranslate();

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("settings.projects.saveAsTemplate.title", "Save as template")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.projects.saveAsTemplate.description",
							"The template gets this project's icon, colour, budget, open tasks, managers and assignments. It has no deadline offset.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				{project && (
					<SaveProjectAsTemplateForm
						key={project.id}
						organizationId={organizationId}
						project={project}
						onDone={() => onOpenChange(false)}
					/>
				)}
			</ActionPanelContent>
		</ActionPanel>
	);
}

function SaveProjectAsTemplateForm({
	organizationId,
	project,
	onDone,
}: {
	organizationId: string;
	project: { id: string; name: string };
	onDone: () => void;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const skippedMembersMessage = useSkippedMembersMessage();

	const form = useForm({
		defaultValues: { name: project.name },
		onSubmit: async ({ value }) => {
			const result = await saveProjectAsTemplate(project.id, { name: value.name.trim() }).catch(
				() => null,
			);
			if (!result?.success) {
				toast.error(
					result?.error ||
						t("settings.projects.saveAsTemplate.failed", "Failed to save the template"),
				);
				return;
			}
			toast.success(
				t("settings.projects.saveAsTemplate.saved", "Template {name} saved", {
					name: result.data.name,
				}),
			);
			if (result.data.skipped.length > 0) {
				toast.warning(skippedMembersMessage(result.data.skipped));
			}
			queryClient.invalidateQueries({ queryKey: queryKeys.projects.templates(organizationId) });
			onDone();
		},
	});

	return (
		// TanStack Form owns the submission lifecycle; see .react-doctor/false-positives.md.
		// react-doctor-disable-next-line react-doctor/no-prevent-default
		<form
			aria-label={t("settings.projects.saveAsTemplate.formLabel", "Save {name} as a template", {
				name: project.name,
			})}
			noValidate
			className="flex min-h-0 flex-1 flex-col"
			onSubmit={(event) => {
				event.preventDefault();
				form.handleSubmit();
			}}
		>
			<ActionPanelBody className="grid gap-4">
				<form.Field
					name="name"
					validators={{
						onSubmit: ({ value }) =>
							value.trim()
								? undefined
								: t("settings.projects.templates.field.nameRequired", "Enter a template name"),
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)} required>
								{t("settings.projects.saveAsTemplate.name", "Template name")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<Input
									value={field.state.value}
									maxLength={PROJECT_TEMPLATE_NAME_MAX_LENGTH}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
			</ActionPanelBody>
			<ActionPanelFooter>
				<Button type="button" variant="outline" onClick={onDone}>
					{t("common.cancel", "Cancel")}
				</Button>
				<form.Subscribe selector={(state) => state.isSubmitting}>
					{(isSubmitting) => (
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							{t("settings.projects.saveAsTemplate.submit", "Save as template")}
						</Button>
					)}
				</form.Subscribe>
			</ActionPanelFooter>
		</form>
	);
}
