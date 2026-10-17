"use client";

import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmailTemplateEditor } from "./email-template-editor";
import { EmailTemplateList } from "./email-template-list";
import {
	type EmailTemplateSettingsTemplate,
	useEmailTemplateSettings,
} from "./use-email-template-settings";

export type { EmailTemplateOverride } from "./use-email-template-settings";

interface EmailTemplateSettingsClientProps {
	templates: EmailTemplateSettingsTemplate[];
}

function EmailTemplateSettingsHeader({
	isCustomized,
}: {
	isCustomized: boolean;
}) {
	const { t } = useTranslate();
	const selectedStatus = isCustomized
		? t("settings.emailTemplates.status.customized", "Customized")
		: t("settings.emailTemplates.status.default", "Default");

	return (
		<div className="space-y-2">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div className="space-y-1">
					<p className="font-medium text-primary text-sm">
						{t("settings.emailTemplates.eyebrow", "Operational communications")}
					</p>
					<h2 className="font-semibold text-lg tracking-tight">
						{t("settings.emailTemplates.title", "Email Templates")}
					</h2>
					<p className="max-w-3xl text-muted-foreground text-sm leading-6">
						{t(
							"settings.emailTemplates.description",
							"Select a system email, customize the copy, and keep approved variables visible while preserving safe defaults.",
						)}
					</p>
				</div>
				<Badge variant="outline" className="h-7 px-3">
					{selectedStatus}
				</Badge>
			</div>
		</div>
	);
}

function DefaultFallbackNotice({ defaultSubject }: { defaultSubject: string }) {
	const { t } = useTranslate();

	return (
		<div className="rounded-xl border bg-muted/25 p-4 text-sm">
			<p className="font-medium">
				{t("settings.emailTemplates.defaultFallback", "Default fallback")}
			</p>
			<p className="mt-1 text-muted-foreground">
				{t(
					"settings.emailTemplates.defaultFallbackDescription",
					"If this template uses the system default, Z8 sends the system copy and subject:",
				)}{" "}
				<span className="font-medium text-foreground">{defaultSubject}</span>
			</p>
		</div>
	);
}

interface EmailTemplateActionsProps {
	isPending: boolean;
	onReset: () => void;
	onSendTest: () => void;
	onSave: () => void;
}

function EmailTemplateActions({
	isPending,
	onReset,
	onSendTest,
	onSave,
}: EmailTemplateActionsProps) {
	const { t } = useTranslate();

	return (
		<div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
			<Button
				type="button"
				variant="outline"
				onClick={onReset}
				disabled={isPending}
			>
				{t("settings.emailTemplates.actions.reset", "Reset to system template")}
			</Button>
			<Button
				type="button"
				variant="secondary"
				onClick={onSendTest}
				disabled={isPending}
			>
				{t("settings.emailTemplates.actions.sendTest", "Send test")}
			</Button>
			<Button type="button" onClick={onSave} disabled={isPending}>
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

	return (
		<div className="space-y-6">
			<EmailTemplateSettingsHeader isCustomized={isCustomized} />

			<div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
				<Card className="gap-4 py-4">
					<CardHeader className="px-4">
						<CardTitle className="text-base">
							{t("settings.emailTemplates.systemTemplates", "System templates")}
						</CardTitle>
					</CardHeader>
					<CardContent className="px-4">
						<EmailTemplateList
							templates={effectiveTemplates}
							selectedKey={selectedTemplate.definition.key}
							onSelect={selectTemplate}
						/>
					</CardContent>
				</Card>

				<div className="space-y-6">
					<Card>
						<CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
							<div className="space-y-2">
								<CardTitle className="text-xl">
									{selectedTemplate.definition.label}
								</CardTitle>
								<p className="text-muted-foreground text-sm leading-6">
									{selectedTemplate.definition.description}
								</p>
							</div>
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
								isPending={isPending}
								onReset={handleReset}
								onSendTest={handleSendTest}
								onSave={handleSave}
							/>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
