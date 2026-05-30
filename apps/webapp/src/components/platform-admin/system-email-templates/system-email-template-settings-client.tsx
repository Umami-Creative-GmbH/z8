"use client";

import { useTranslate } from "@tolgee/react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
	resetPlatformSystemEmailTemplate,
	savePlatformSystemEmailTemplate,
	sendPlatformSystemEmailTemplateTest,
} from "@/app/[locale]/(admin)/platform-admin/system-email-templates/actions";
import {
	EmailTemplateEditor,
	type EmailTemplateEditorHandle,
} from "@/components/settings/email-templates/email-template-editor";
import { EmailTemplateList } from "@/components/settings/email-templates/email-template-list";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EmailTemplateEditorDocument, PlatformSystemEmailTemplateKey } from "@/db/schema";
import type { PlatformSystemEmailTemplateDefinition } from "@/lib/email/system-template-registry";
import { useRouter } from "@/navigation";

export interface PlatformSystemEmailTemplateOverride {
	subject: string;
	editorDocument: EmailTemplateEditorDocument;
	html: string;
	plainText: string | null;
	isEnabled: boolean;
}

interface SystemEmailTemplateSettingsClientProps {
	templates: Array<{
		definition: Omit<PlatformSystemEmailTemplateDefinition, "renderDefault"> & {
			starterDraftHtml: string;
			starterDraftPlainText: string;
		};
		override: PlatformSystemEmailTemplateOverride | null;
	}>;
}

type Draft = {
	subject: string;
	html: string;
	plainText: string;
	editorDocument: EmailTemplateEditorDocument;
};

const createDraft = ({
	definition,
	override,
}: SystemEmailTemplateSettingsClientProps["templates"][number]): Draft => ({
	subject: override?.subject ?? definition.defaultSubject,
	html: override?.html ?? definition.starterDraftHtml,
	plainText: override?.plainText ?? definition.starterDraftPlainText,
	editorDocument: override?.editorDocument ?? {
		type: "doc",
		content: [
			{ type: "paragraph", content: [{ type: "text", text: definition.starterDraftPlainText }] },
		],
	},
});

const hasUnchangedDefaultStarterBody = (
	template: SystemEmailTemplateSettingsClientProps["templates"][number],
	draft: Draft,
) =>
	!template.override &&
	draft.html === template.definition.starterDraftHtml &&
	draft.plainText === template.definition.starterDraftPlainText;

export function SystemEmailTemplateSettingsClient({
	templates,
}: SystemEmailTemplateSettingsClientProps) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const editorRef = useRef<EmailTemplateEditorHandle>(null);
	const [isPending, startTransition] = useTransition();
	const [selectedKey, setSelectedKey] = useState<PlatformSystemEmailTemplateKey | null>(
		templates[0]?.definition.key ?? null,
	);
	const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
		Object.fromEntries(
			templates.map((template) => [template.definition.key, createDraft(template)]),
		),
	);
	const [overrideKeys, setOverrideKeys] = useState<Set<PlatformSystemEmailTemplateKey>>(
		() =>
			new Set(
				templates.reduce<PlatformSystemEmailTemplateKey[]>((keys, template) => {
					if (template.override) {
						keys.push(template.definition.key);
					}
					return keys;
				}, []),
			),
	);

	const effectiveTemplates = templates.map((template) =>
		overrideKeys.has(template.definition.key) ? template : { ...template, override: null },
	);
	const selectedTemplate =
		effectiveTemplates.find((template) => template.definition.key === selectedKey) ?? null;
	const draft = selectedKey ? drafts[selectedKey] : null;
	const selectedHasOverride = selectedKey ? overrideKeys.has(selectedKey) : false;

	const updateDraft = (partial: Partial<Draft>) => {
		if (!selectedKey) {
			return;
		}

		setDrafts((current) => ({
			...current,
			[selectedKey]: { ...current[selectedKey], ...partial },
		}));
	};

	const selectedStatus = selectedHasOverride
		? t("admin:admin.systemEmailTemplates.status.customized", "Customized")
		: t("admin:admin.systemEmailTemplates.status.default", "Default");

	const actionInput = () => {
		if (!selectedTemplate || !draft) {
			return null;
		}

		return {
			templateKey: selectedTemplate.definition.key,
			subject: draft.subject,
			html: draft.html,
			plainText: draft.plainText,
			editorDocument: draft.editorDocument,
		};
	};

	const handleSave = () => {
		if (selectedTemplate && draft && hasUnchangedDefaultStarterBody(selectedTemplate, draft)) {
			toast.error(
				t(
					"admin:admin.systemEmailTemplates.editBodyBeforeSaving",
					"Edit the email body before saving a first custom template.",
				),
			);
			return;
		}

		const input = actionInput();
		if (!input) {
			return;
		}

		startTransition(async () => {
			const result = await savePlatformSystemEmailTemplate(input);
			if (result.success) {
				setOverrideKeys((current) => new Set(current).add(input.templateKey));
				toast.success(t("admin:admin.systemEmailTemplates.saved", "System email template saved"));
				refresh();
				return;
			}
			toast.error(
				result.errors?.join("\n") ??
					t("admin:admin.systemEmailTemplates.saveFailed", "Failed to save system email template"),
			);
		});
	};

	const handleSendTest = () => {
		const input = actionInput();
		if (!input) {
			return;
		}

		startTransition(async () => {
			const result = await sendPlatformSystemEmailTemplateTest(input);
			if (result.success) {
				toast.success(
					t("admin:admin.systemEmailTemplates.testSent", "Test email sent to your account"),
				);
				return;
			}
			toast.error(
				result.errors?.join("\n") ??
					t("admin:admin.systemEmailTemplates.testFailed", "Failed to send test email"),
			);
		});
	};

	const handleReset = () => {
		if (!selectedTemplate) {
			return;
		}

		startTransition(async () => {
			const result = await resetPlatformSystemEmailTemplate(selectedTemplate.definition.key);
			if (result.success) {
				setOverrideKeys((current) => {
					const next = new Set(current);
					next.delete(selectedTemplate.definition.key);
					return next;
				});
				setDrafts((current) => ({
					...current,
					[selectedTemplate.definition.key]: createDraft({
						definition: selectedTemplate.definition,
						override: null,
					}),
				}));
				toast.success(
					t("admin:admin.systemEmailTemplates.reset", "System email template reset to default"),
				);
				refresh();
				return;
			}
			toast.error(
				result.errors?.join("\n") ??
					t(
						"admin:admin.systemEmailTemplates.resetFailed",
						"Failed to reset system email template",
					),
			);
		});
	};

	const handleInsertVariable = (name: string) => {
		editorRef.current?.insertIntoBody(`{{${name}}}`);
	};

	if (!selectedTemplate || !draft) {
		return (
			<Card>
				<CardContent className="py-10 text-center text-muted-foreground">
					{t(
						"admin:admin.systemEmailTemplates.empty",
						"No platform system email templates are available.",
					)}
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="grid gap-6 lg:grid-cols-[minmax(260px,360px)_1fr]">
			<Card className="gap-4 py-4">
				<CardHeader className="px-4">
					<CardTitle className="text-base">
						{t("admin:admin.systemEmailTemplates.systemTemplates", "System templates")}
					</CardTitle>
				</CardHeader>
				<CardContent className="px-4">
					<EmailTemplateList
						templates={effectiveTemplates}
						selectedKey={selectedTemplate.definition.key}
						onSelect={(key) => setSelectedKey(key as PlatformSystemEmailTemplateKey)}
					/>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div className="space-y-2">
						<CardTitle className="text-xl">{selectedTemplate.definition.label}</CardTitle>
						<p className="text-muted-foreground text-sm leading-6">
							{selectedTemplate.definition.description}
						</p>
					</div>
					<Badge variant="outline" className="h-7 px-3">
						{selectedStatus}
					</Badge>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="rounded-xl border bg-muted/25 p-4 text-sm">
						<p className="font-medium">
							{t("admin:admin.systemEmailTemplates.defaultFallback", "Default fallback")}
						</p>
						<p className="mt-1 text-muted-foreground">
							{t(
								"admin:admin.systemEmailTemplates.defaultFallbackDescription",
								"If this template uses the system default, Z8 sends the platform copy and subject:",
							)}{" "}
							<span className="font-medium text-foreground">
								{selectedTemplate.definition.defaultSubject}
							</span>
						</p>
					</div>

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
						onEditorDocumentChange={(editorDocument) => updateDraft({ editorDocument })}
						onInsertVariable={handleInsertVariable}
						onSubjectFocus={() => undefined}
					/>

					<div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button
									type="button"
									variant="outline"
									disabled={isPending || !selectedHasOverride}
								>
									{t("admin:admin.systemEmailTemplates.actions.reset", "Reset to system template")}
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>
										{t(
											"admin:admin.systemEmailTemplates.resetDialog.title",
											"Reset Platform System Template?",
										)}
									</AlertDialogTitle>
									<AlertDialogDescription>
										{t(
											"admin:admin.systemEmailTemplates.resetDialog.description",
											"This deletes the global platform override for this system email template and restores the built-in subject and body. Live billing and system emails will use the default platform copy after reset.",
										)}
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
									<AlertDialogAction onClick={handleReset} disabled={isPending}>
										{t(
											"admin:admin.systemEmailTemplates.resetDialog.confirm",
											"Reset platform system template",
										)}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
						<Button type="button" variant="secondary" onClick={handleSendTest} disabled={isPending}>
							{t("admin:admin.systemEmailTemplates.actions.sendTest", "Send test")}
						</Button>
						<Button type="button" onClick={handleSave} disabled={isPending}>
							{t("admin:admin.systemEmailTemplates.actions.save", "Save")}
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
