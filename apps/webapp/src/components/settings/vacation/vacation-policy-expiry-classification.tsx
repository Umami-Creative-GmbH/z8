"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { classifyVacationPolicyExpiryRules } from "@/app/[locale]/(app)/settings/vacation/expiry-classification-actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { LeaveExpiryClassificationRefusalCode } from "@/lib/absences/earning-year-leave-store";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";
import { runWithBusyState } from "../run-with-busy-state";

/** A policy's designation of the leave-expiry rules for the leave earned under it (#2080). */
export interface VacationPolicyExpiryClassificationValue {
	expiryRules: "german" | "policy_terms";
	extraDaysSeparateTerms: boolean;
}

const CLASSIFY_REFUSALS = {
	already_classified: [
		"settings.vacation.expiryRules.alreadyClassified",
		"This policy's leave-expiry rules are already designated.",
	],
	policy_not_found: ["settings.vacation.expiryRules.policyNotFound", "Vacation policy not found."],
	separate_terms_need_basis: [
		"settings.vacation.expiryRules.basisRequired",
		"Record where the separate terms for extra days are agreed.",
	],
	separate_terms_need_german_rules: [
		"settings.vacation.expiryRules.separateNeedsGerman",
		"Separate terms for extra days apply only under German leave-expiry rules.",
	],
} satisfies RefusalMessages<LeaveExpiryClassificationRefusalCode>;

/** The designation as a badge; unclassified policies keep their leave outstanding. */
export function VacationPolicyExpiryBadge({
	classification,
}: {
	classification: VacationPolicyExpiryClassificationValue | null | undefined;
}) {
	const { t } = useTranslate();
	if (!classification)
		return (
			<Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
				{t("settings.vacation.expiryRules.unclassified", "Unclassified")}
			</Badge>
		);
	if (classification.expiryRules === "policy_terms")
		return (
			<Badge variant="secondary">
				{t("settings.vacation.expiryRules.policyTerms", "Policy terms")}
			</Badge>
		);
	return (
		<Badge variant="secondary">
			{classification.extraDaysSeparateTerms
				? t("settings.vacation.expiryRules.germanSeparate", "German rules, extra days separate")
				: t("settings.vacation.expiryRules.german", "German rules")}
		</Badge>
	);
}

/**
 * HR designates once whether German leave-expiry rules apply to a policy's leave. Unclassified
 * leave stays outstanding; German rules protect statutory and extra days alike unless HR records
 * separate terms for the extra days.
 */
export function VacationPolicyExpiryClassificationPanel({
	open,
	onOpenChange,
	policy,
	onClassified,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	policy: { id: string; name: string };
	onClassified: () => void;
}) {
	const { t } = useTranslate();
	const [loading, setLoading] = useState(false);
	const form = useForm({
		defaultValues: {
			expiryRules: "german" as "german" | "policy_terms",
			extraDaysSeparateTerms: false,
			extraDaysTermsBasis: "",
		},
		onSubmit: async ({ value }) => {
			await runWithBusyState(setLoading, async () => {
				const separate = value.expiryRules === "german" && value.extraDaysSeparateTerms;
				const result = await classifyVacationPolicyExpiryRules({
					policyId: policy.id,
					expiryRules: value.expiryRules,
					extraDaysSeparateTerms: separate,
					extraDaysTermsBasis: separate ? value.extraDaysTermsBasis : null,
				});
				if (result.success) {
					toast.success(t("settings.vacation.expiryRules.saved", "Leave-expiry rules designated"));
					onClassified();
					onOpenChange(false);
				} else {
					toast.error(
						actionErrorMessage(t, result, CLASSIFY_REFUSALS, [
							"settings.vacation.expiryRules.saveFailed",
							"Failed to designate the leave-expiry rules",
						]),
					);
				}
			});
		},
	});
	const expiryRules = useStore(form.store, (state) => state.values.expiryRules);
	const separate = useStore(form.store, (state) => state.values.extraDaysSeparateTerms);

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("settings.vacation.expiryRules.title", 'Leave-expiry rules for "{name}"', {
							name: policy.name,
						})}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.vacation.expiryRules.description",
							"Applies to every year of leave earned under this policy, including leave carried after employees move to another policy. Until you decide, unused days stay outstanding. You cannot change the designation later.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="space-y-6">
						<form.Field name="expiryRules">
							{(field) => (
								<RadioGroup
									value={field.state.value}
									onValueChange={(value) => field.handleChange(value as "german" | "policy_terms")}
									className="space-y-3"
								>
									<div className="flex items-start gap-3 rounded-lg border p-4">
										<RadioGroupItem value="german" id="expiryRulesGerman" />
										<div className="space-y-1">
											<Label htmlFor="expiryRulesGerman">
												{t(
													"settings.vacation.expiryRules.germanOption",
													"German leave-expiry rules",
												)}
											</Label>
											<p className="text-sm text-muted-foreground">
												{t(
													"settings.vacation.expiryRules.germanHelp",
													"Unused days carry over in full and do not lapse at the policy's carryover cap or deadline. They lapse only once the employee was asked in time to take them and warned that they would lapse.",
												)}
											</p>
										</div>
									</div>
									<div className="flex items-start gap-3 rounded-lg border p-4">
										<RadioGroupItem value="policy_terms" id="expiryRulesPolicyTerms" />
										<div className="space-y-1">
											<Label htmlFor="expiryRulesPolicyTerms">
												{t(
													"settings.vacation.expiryRules.policyTermsOption",
													"The policy's own carryover terms",
												)}
											</Label>
											<p className="text-sm text-muted-foreground">
												{t(
													"settings.vacation.expiryRules.policyTermsHelp",
													"Carryover permission, cap and deadline of the policy decide what carries over and when it lapses.",
												)}
											</p>
										</div>
									</div>
								</RadioGroup>
							)}
						</form.Field>

						{expiryRules === "german" ? (
							<div className="space-y-4">
								<form.Field name="extraDaysSeparateTerms">
									{(field) => (
										<div className="flex flex-row items-start gap-x-3 rounded-lg border p-4">
											<Checkbox
												id="extraDaysSeparateTerms"
												checked={field.state.value}
												onCheckedChange={(checked) => field.handleChange(checked === true)}
											/>
											<div className="space-y-1">
												<Label htmlFor="extraDaysSeparateTerms">
													{t(
														"settings.vacation.expiryRules.separateTerms",
														"Extra days above the statutory minimum follow separate terms",
													)}
												</Label>
												<p className="text-sm text-muted-foreground">
													{t(
														"settings.vacation.expiryRules.separateTermsHelp",
														"Only when the contract clearly agrees it. Those days then follow this policy's carryover cap and deadline. A cap or deadline setting alone is not enough.",
													)}
												</p>
											</div>
										</div>
									)}
								</form.Field>
								{separate ? (
									<form.Field
										name="extraDaysTermsBasis"
										validators={{
											onSubmit: ({ value }) =>
												value.trim()
													? undefined
													: t(
															"settings.vacation.expiryRules.basisRequired",
															"Record where the separate terms for extra days are agreed.",
														),
										}}
									>
										{(field) => (
											<div className="space-y-2">
												<Label htmlFor="extraDaysTermsBasis">
													{t(
														"settings.vacation.expiryRules.basis",
														"Where the separate terms are agreed",
													)}
												</Label>
												<Textarea
													id="extraDaysTermsBasis"
													value={field.state.value}
													onChange={(event) => field.handleChange(event.target.value)}
													onBlur={field.handleBlur}
													aria-invalid={field.state.meta.errors.length > 0}
													placeholder={t(
														"settings.vacation.expiryRules.basisPlaceholder",
														"For example: employment contract, section 7",
													)}
												/>
												{field.state.meta.errors.length > 0 ? (
													<p className="text-sm text-destructive" role="alert">
														{String(field.state.meta.errors[0])}
													</p>
												) : null}
											</div>
										)}
									</form.Field>
								) : null}
							</div>
						) : null}
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={loading}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={loading}>
							{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							{t("settings.vacation.expiryRules.submit", "Designate rules")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
