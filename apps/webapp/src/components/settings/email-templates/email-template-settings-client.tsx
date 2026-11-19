"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog";
import { AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmailTemplateEditor } from "./email-template-editor";
import { EmailTemplateList } from "./email-template-list";
import {
	type EmailTemplateAction,
	type EmailTemplateSettingsTemplate,
	useEmailTemplateSettings,
} from "./use-email-template-settings";

export type { EmailTemplateOverride } from "./use-email-template-settings";

interface EmailTemplateSettingsClientProps {
	templates: EmailTemplateSettingsTemplate[];
}

function DefaultFallbackNotice({ defaultSubject }: { defaultSubject: string }) {
	const { t } = useTranslate();

	return (
		<div className="rounded-xl border bg-muted/25 p-4 text-sm">
			<p className="font-medium">
				{t("settings.emailTemplates.defaultFallback", "Default fallback")}
			</p>
			<p className="mt-1 break-words text-muted-foreground">
				{t(
					"settings.emailTemplates.defaultFallbackDescription",
					"If this template uses the system default, Z8 sends the system copy and subject:",
				)}{" "}
				<span className="font-medium text-foreground">{defaultSubject}</span>
			</p>
		</div>
	);
}

function PendingIcon() {
	return (
		<IconLoader2
			className="mr-2 size-4 motion-safe:animate-spin"
			aria-hidden="true"
		/>
	);
}

interface EmailTemplateActionsProps {
	templateLabel: string;
	isCustomized: boolean;
	isPending: boolean;
	pendingAction: EmailTemplateAction | null;
	/** Resolves to the worded failure, or null once the template is reset. */
	onReset: () => Promise<string | null>;
	onSendTest: () => void;
	onSave: () => void;
}

function EmailTemplateActions({
	templateLabel,
	isCustomized,
	isPending,
	pendingAction,
	onReset,
	onSendTest,
	onSave,
}: EmailTemplateActionsProps) {
	const { t } = useTranslate();
	const [resetOpen, setResetOpen] = useState(false);
	const [resetError, setResetError] = useState<string | null>(null);
	const resetting = isPending && pendingAction === "reset";

	return (
		<div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
			<ConfirmActionDialog
				open={resetOpen}
				onOpenChange={(open) => {
					setResetOpen(open);
					if (!open) setResetError(null);
				}}
				trigger={
					<AlertDialogTrigger asChild>
						<Button
							type="button"
							variant="outline"
							disabled={isPending || !isCustomized}
						>
							{pendingAction === "reset" ? <PendingIcon /> : null}
							{t(
								"settings.emailTemplates.actions.reset",
								"Reset to system template",
							)}
						</Button>
					</AlertDialogTrigger>
				}
				title={t(
					"settings.emailTemplates.resetDialog.title",
					"Reset “{template}” to the system template?",
					{ template: templateLabel },
				)}
				description={t(
					"settings.emailTemplates.resetDialog.description",
					"This deletes your organization's custom subject and body for this email. Emails sent afterwards use the system template.",
				)}
				confirmLabel={t("settings.emailTemplates.resetDialog.confirm", "Reset template")}
				isPending={resetting}
				confirmDisabled={isPending}
				error={resetError}
				onConfirm={() =>
					void (async () => {
						setResetError(null);
						const failure = await onReset();
						if (failure === null) setResetOpen(false);
						else setResetError(failure);
					})()
				}
			/>
			<Button
				type="button"
				variant="secondary"
				onClick={onSendTest}
				disabled={isPending}
			>
				{pendingAction === "sendTest" ? <PendingIcon /> : null}
				{t("settings.emailTemplates.actions.sendTest", "Send test")}
			</Button>
			<Button type="button" onClick={onSave} disabled={isPending}>
				{pendingAction === "save" ? <PendingIcon /> : null}
				{t("settings.emailTemplates.actions.save", "Save")}
			</Button>
		</div>
	);
}

export function EmailTemplateSettingsClient({
	templates,
}: EmailTemplateSettingsClientProps) {
	const { t } = useTranslate();
	const {
		editorRef,
		isPending,
		pendingAction,
		effectiveTemplates,
		selectedTemplate,
		draft,
		isCustomized,
		selectTemplate,
		updateDraft,
		handleSave,
		handleSendTest,
		handleReset,
		handleInsertVariable,
	} = useEmailTemplateSettings(templates);

	if (!selectedTemplate || !draft) {
		return (
			<Card>
				<CardContent className="py-10 text-center text-muted-foreground">
					{t(
						"settings.emailTemplates.empty",
						"No email templates are available for this organization.",
					)}
				</CardContent>
			</Card>
		);
	}

	const selectedStatus = isCustomized
		? t("settings.emailTemplates.status.customized", "Customized")
		: t("settings.emailTemplates.status.default", "Default");

	return (
		<div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
			<Card className="min-w-0 gap-4 py-4">
				<CardHeader className="px-4">
					<CardTitle as="h2" className="text-base">
						{t("settings.emailTemplates.systemTemplates", "System templates")}
					</CardTitle>
				</CardHeader>
				<CardContent className="px-4">
					<EmailTemplateList
						templates={effectiveTemplates}
						selectedKey={selectedTemplate.definition.key}
						onSelect={selectTemplate}
						headingLevel="h3"
					/>
				</CardContent>
			</Card>

			<Card className="min-w-0">
				<CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0 space-y-2">
						<CardTitle as="h2" className="text-xl">
							{selectedTemplate.definition.label}
						</CardTitle>
						<p className="break-words text-muted-foreground text-sm leading-6">
							{selectedTemplate.definition.description}
						</p>
					</div>
					<Badge
						variant={isCustomized ? "secondary" : "outline"}
						className="h-7 shrink-0 px-3"
						data-testid="email-template-selected-status"
					>
						{selectedStatus}
					</Badge>
				</CardHeader>
				<CardContent className="space-y-6">
					<DefaultFallbackNotice
						defaultSubject={selectedTemplate.definition.defaultSubject}
					/>

					<EmailTemplateEditor
						key={selectedTemplate.definition.key}
						ref={editorRef}
						definition={selectedTemplate.definition}
						subject={draft.subject}
						html={draft.html}
						plainText={draft.plainText}
						editorDocument={draft.editorDocument}
						variables={selectedTemplate.definition.variables}
						onSubjectChange={(subject) => updateDraft({ subject })}
						onHtmlChange={(html) => updateDraft({ html })}
						onPlainTextChange={(plainText) => updateDraft({ plainText })}
						onEditorDocumentChange={(editorDocument) =>
							updateDraft({ editorDocument })
						}
						onInsertVariable={handleInsertVariable}
						onSubjectFocus={() => undefined}
					/>

					<EmailTemplateActions
						templateLabel={selectedTemplate.definition.label}
						isCustomized={isCustomized}
						isPending={isPending}
						pendingAction={pendingAction}
						onReset={handleReset}
						onSendTest={handleSendTest}
						onSave={handleSave}
					/>
				</CardContent>
			</Card>
		</div>
	);
}
