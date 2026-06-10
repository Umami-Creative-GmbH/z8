"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateOrganizationDefaultNotificationLanguage } from "@/app/[locale]/(app)/settings/organizations/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { LANGUAGE_CONFIG } from "@/lib/language-config";
import { useRouter } from "@/navigation";
import { ALL_LANGUAGES } from "@/tolgee/shared";

interface OrganizationLanguageCardProps {
	organizationId: string;
	defaultLanguage: string;
	currentMemberRole: "owner" | "admin" | "member";
}

export function OrganizationLanguageCard({
	organizationId,
	defaultLanguage: initialDefaultLanguage,
	currentMemberRole,
}: OrganizationLanguageCardProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [isSaving, setIsSaving] = useState(false);
	const [defaultLanguage, setDefaultLanguage] = useState(initialDefaultLanguage);

	const canEdit = currentMemberRole === "admin" || currentMemberRole === "owner";

	const handleLanguageChange = async (newDefaultLanguage: string) => {
		if (!canEdit || isSaving || newDefaultLanguage === defaultLanguage) return;

		const previousDefaultLanguage = defaultLanguage;
		setDefaultLanguage(newDefaultLanguage);
		setIsSaving(true);

		try {
			const result = await updateOrganizationDefaultNotificationLanguage(
				organizationId,
				newDefaultLanguage,
			);

			if (result.success) {
				toast.success(
					t("organization.language.updated", "Organization notification language updated"),
				);
				startTransition(() => {
					router.refresh();
				});
				setIsSaving(false);
				return;
			}

			setDefaultLanguage(previousDefaultLanguage);
			toast.error(
				result.error ||
					t(
						"organization.language.updateFailed",
						"Failed to update organization notification language",
					),
			);
			setIsSaving(false);
		} catch (error) {
			setIsSaving(false);
			throw error;
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("organization.language.title", "Notification language")}</CardTitle>
				<CardDescription>
					{t(
						"organization.language.description",
						"Set the fallback language for email, Telegram, and other outbound notifications when a user has not selected a UI language.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<Label htmlFor="notification-language-select">
							{t("organization.language.default", "Default notification language")}
						</Label>
						{(isPending || isSaving) && (
							<IconLoader2
								aria-hidden="true"
								className="size-4 animate-spin text-muted-foreground"
							/>
						)}
					</div>
					<Select
						value={defaultLanguage}
						onValueChange={handleLanguageChange}
						disabled={!canEdit || isPending || isSaving}
					>
						<SelectTrigger id="notification-language-select" className="w-full sm:w-72">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{ALL_LANGUAGES.map((language) => {
								const config = LANGUAGE_CONFIG[language];
								const Flag = config?.Flag;

								return (
									<SelectItem key={language} value={language}>
										{Flag && <Flag aria-hidden="true" className="size-4 rounded-xs" />}
										<span>{config?.name ?? language}</span>
									</SelectItem>
								);
							})}
						</SelectContent>
					</Select>
				</div>

				{!canEdit && (
					<p className="text-xs text-muted-foreground">
						{t(
							"organization.language.adminOnly",
							"Only organization admins and owners can change the notification language setting.",
						)}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
