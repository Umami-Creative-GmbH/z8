"use client";

import { IconCertificate, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { toast } from "sonner";
import {
	type CertificateSkill,
	listCertificateSkillOptionsAction,
	setCertificateSkillAction,
} from "@/app/[locale]/(app)/personnel-files/skill-certificate-actions";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { TFormItem } from "@/components/ui/tanstack-form";
import type { EmployeeDocumentView } from "@/lib/personnel-file/document-store";
import { queryKeys } from "@/lib/query/keys";

/**
 * Naming the employee skill a certificate proves, changing or clearing it
 * (#1144, Scheduling ADR 0001), for whoever manages the employee's
 * certificates. Only the employee's own skills are offered; an undated
 * certificate cannot prove a skill that requires an expiry date. The server
 * decides who may and refuses everything else.
 */

const NO_SKILL = "none";

export function CertificateSkillDialog({
	document,
	open,
	onOpenChange,
	onSaved,
}: {
	document: EmployeeDocumentView;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved: () => void;
}) {
	const { t } = useTranslate();
	const labelId = useId();
	const query = useQuery({
		queryKey: queryKeys.personnelFile.certificateSkills(document.employeeId),
		queryFn: async (): Promise<CertificateSkill[]> => {
			const result = await listCertificateSkillOptionsAction(document.employeeId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: open,
	});
	const form = useForm({
		defaultValues: { selection: document.skill?.employeeSkillId ?? NO_SKILL },
		onSubmit: async ({ value }) => {
			const result = await setCertificateSkillAction({
				documentId: document.id,
				employeeSkillId: value.selection === NO_SKILL ? null : value.selection,
			});
			if (!result.success) {
				toast.error(
					result.error ||
						t(
							"settings.personnelFiles.skillCertificates.saveFailed",
							"The skill of the certificate could not be saved.",
						),
				);
				return;
			}
			toast.success(t("settings.personnelFiles.skillCertificates.saved", "Skill saved"));
			onSaved();
			close();
		},
	});

	function close() {
		form.reset();
		onOpenChange(false);
	}

	const undated = document.expiryDate === null;
	const title = t(
		"settings.personnelFiles.skillCertificates.title",
		"Skill this certificate proves",
	);

	return (
		<form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
			{(busy: boolean) => (
				<ActionPanel
					open={open}
					onOpenChange={(next) => (next ? onOpenChange(true) : !busy && close())}
				>
					<ActionPanelContent>
						<form
							className="flex min-h-0 flex-1 flex-col"
							action={() => {
								void form.handleSubmit();
							}}
							onSubmit={(event) => {
								event.stopPropagation();
							}}
						>
							<ActionPanelHeader>
								<ActionPanelTitle>{title}</ActionPanelTitle>
								<ActionPanelDescription>
									{t(
										"settings.personnelFiles.skillCertificates.description",
										'Choose the skill of this employee that "{title}" proves. Scheduling then shows that a certificate is on file, never its content.',
										{ title: document.title },
									)}
								</ActionPanelDescription>
							</ActionPanelHeader>
							<ActionPanelBody className="space-y-4">
								{query.isPending ? (
									<div className="space-y-2" aria-busy="true">
										<Skeleton className="h-10 w-full" />
										<Skeleton className="h-10 w-full" />
									</div>
								) : query.isError ? (
									<p role="alert" className="text-sm text-destructive">
										{t(
											"settings.personnelFiles.skillCertificates.loadFailed",
											"The employee's skills could not be loaded.",
										)}
									</p>
								) : (
									<form.Field name="selection">
										{(field) => (
											<TFormItem>
												<RadioGroup
													aria-label={title}
													value={field.state.value}
													onValueChange={(value) => field.handleChange(value)}
													disabled={busy}
												>
													<div className="flex items-start gap-3">
														<RadioGroupItem
															id={`${labelId}-${NO_SKILL}`}
															value={NO_SKILL}
															className="mt-0.5"
														/>
														<label
															htmlFor={`${labelId}-${NO_SKILL}`}
															className="text-sm font-medium"
														>
															{t("settings.personnelFiles.skillCertificates.none", "No skill")}
														</label>
													</div>
													{query.data.map((option) => {
														const id = `${labelId}-${option.employeeSkillId}`;
														const unavailable = undated && option.requiresExpiry;
														return (
															<div key={option.employeeSkillId} className="flex items-start gap-3">
																<RadioGroupItem
																	id={id}
																	value={option.employeeSkillId}
																	disabled={unavailable}
																	className="mt-0.5"
																/>
																<label htmlFor={id} className="space-y-0.5 text-sm">
																	<span className="block font-medium">{option.name}</span>
																	{unavailable ? (
																		<span className="block text-muted-foreground">
																			{t(
																				"settings.personnelFiles.skillCertificates.needsExpiry",
																				"Requires an expiry date. Add one to this certificate first.",
																			)}
																		</span>
																	) : null}
																</label>
															</div>
														);
													})}
												</RadioGroup>
												{query.data.length === 0 ? (
													<p className="text-sm text-muted-foreground">
														{t(
															"settings.personnelFiles.skillCertificates.noSkills",
															"This employee has no skills yet. Assign skills on the employee's page.",
														)}
													</p>
												) : null}
											</TFormItem>
										)}
									</form.Field>
								)}
							</ActionPanelBody>
							<ActionPanelFooter>
								<Button type="button" variant="outline" onClick={close} disabled={busy}>
									{t("common.cancel", "Cancel")}
								</Button>
								<Button type="submit" disabled={busy || query.isPending || query.isError}>
									{busy ? (
										<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
									) : (
										<IconCertificate aria-hidden="true" className="size-4" />
									)}
									{t("settings.personnelFiles.skillCertificates.save", "Save")}
								</Button>
							</ActionPanelFooter>
						</form>
					</ActionPanelContent>
				</ActionPanel>
			)}
		</form.Subscribe>
	);
}
