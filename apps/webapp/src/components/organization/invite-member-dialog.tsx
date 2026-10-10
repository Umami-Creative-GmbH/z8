"use client";

import { IconLoader2, IconMail } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	type CreateKioskOnlyEmployeeActionInput,
	createKioskOnlyEmployeeAction,
	getKioskOnlyEmployeeLocationsAction,
} from "@/app/[locale]/(app)/settings/employees/kiosk-actions";
import { sendInvitation } from "@/app/[locale]/(app)/settings/organizations/actions";
import { listTeams } from "@/app/[locale]/(app)/settings/teams/actions";
import { kioskPinErrorMessage } from "@/components/settings/kiosk/kiosk-pin-error-message";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { queryKeys } from "@/lib/query";
import { useRouter } from "@/navigation";

interface InviteMemberDialogProps {
	organizationId: string;
	organizationName: string;
	currentMemberRole: "owner" | "admin" | "member";
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function InviteMemberDialog({
	organizationId,
	organizationName,
	currentMemberRole,
	open,
	onOpenChange,
}: InviteMemberDialogProps) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const queryClient = useQueryClient();

	const { data: teamsResult } = useQuery({
		queryKey: queryKeys.teams.list(organizationId),
		queryFn: () => listTeams(organizationId),
		enabled: open,
	});
	const teams = teamsResult?.success ? teamsResult.data : [];
	const { data: locationsResult } = useQuery({
		queryKey: ["kioskOnlyEmployeeLocations", organizationId],
		queryFn: () => getKioskOnlyEmployeeLocationsAction(),
		enabled: open,
	});
	const kioskLocations = locationsResult?.success ? locationsResult.data : [];

	const inviteMutation = useMutation({
		mutationFn: (data: {
			organizationId: string;
			email: string;
			role: "owner" | "admin" | "member";
			canCreateOrganizations: boolean;
			targetTeamId: string | null;
		}) => sendInvitation(data),
		onSuccess: async (result) => {
			if (result.success) {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: queryKeys.invitations.list(organizationId),
					}),
					queryClient.invalidateQueries({
						queryKey: queryKeys.employees.organization(organizationId),
					}),
				]);
			}
		},
		onError: () => {
			toast.error(t("organization.invite.error", "Failed to send invitation"));
		},
	});

	const kioskOnlyMutation = useMutation({
		mutationFn: (data: CreateKioskOnlyEmployeeActionInput) => createKioskOnlyEmployeeAction(data),
		onSuccess: async (result) => {
			if (result.success) {
				await queryClient.invalidateQueries({
					queryKey: queryKeys.employees.organization(organizationId),
				});
			}
		},
		onError: () => {
			toast.error(kioskPinErrorMessage(t, "failed"));
		},
	});

	const form = useForm({
		defaultValues: {
			email: "",
			role: "member" as "owner" | "admin" | "member",
			canCreateOrganizations: false,
			targetTeamId: "none",
			// Kiosk-only employees (#857): no email, no sign-in, clock only at kiosks.
			kioskOnly: false,
			firstName: "",
			lastName: "",
			locationIds: [] as string[],
		},
		onSubmit: async ({ value }) => {
			if (value.kioskOnly) {
				const created = await kioskOnlyMutation
					.mutateAsync({
						firstName: value.firstName,
						lastName: value.lastName,
						teamId: value.targetTeamId === "none" ? null : value.targetTeamId,
						locationIds: value.locationIds,
					})
					.catch(() => null);
				if (!created) return;
				if (created.success) {
					toast.success(t("organization.invite.kioskOnly.success", "Kiosk-only employee created"));
					form.reset();
					onOpenChange(false);
					refresh();
				} else {
					toast.error(kioskPinErrorMessage(t, created.code));
				}
				return;
			}

			const result = await inviteMutation
				.mutateAsync({
					organizationId,
					email: value.email,
					role: value.role,
					canCreateOrganizations: value.canCreateOrganizations,
					targetTeamId: value.targetTeamId === "none" ? null : value.targetTeamId,
				})
				.catch(() => null);

			if (!result) {
				return;
			}

			if (result.success) {
				toast.success(t("organization.invite.success", "Invitation sent successfully"));
				form.reset();
				onOpenChange(false);
				refresh();
			} else {
				toast.error(result.error || t("organization.invite.error", "Failed to send invitation"));
			}
		},
	});

	const isPending = inviteMutation.isPending || kioskOnlyMutation.isPending;

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{t("organization.invite.title", "Invite Member")}</ActionPanelTitle>
					<ActionPanelDescription>
						{t("organization.invite.description", "Send an invitation to join {organizationName}", {
							organizationName,
						})}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						void form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="space-y-5">
						<form.Field name="kioskOnly">
							{(field) => (
								<div className="flex items-start gap-x-2">
									<Checkbox
										id="kioskOnly"
										checked={field.state.value}
										onCheckedChange={(checked) => field.handleChange(checked === true)}
										aria-describedby="kioskOnlyDescription"
									/>
									<div className="space-y-1">
										<label htmlFor="kioskOnly" className="text-sm font-medium leading-none">
											{t("organization.invite.kioskOnly.label", "Kiosk only, no email")}
										</label>
										<p id="kioskOnlyDescription" className="text-xs text-muted-foreground">
											{t(
												"organization.invite.kioskOnly.description",
												"For staff without a company email. They cannot sign in and clock only at kiosks with their PIN. You can add an email later.",
											)}
										</p>
									</div>
								</div>
							)}
						</form.Field>

						<form.Subscribe selector={(state) => state.values.kioskOnly}>
							{(kioskOnly) =>
								kioskOnly ? (
									<>
										<form.Field name="firstName">
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor="kioskOnlyFirstName">
														{t("organization.invite.kioskOnly.firstName", "First name")}
													</Label>
													<Input
														id="kioskOnlyFirstName"
														autoComplete="off"
														value={field.state.value}
														onChange={(e) => field.handleChange(e.target.value)}
														maxLength={100}
														required
													/>
												</div>
											)}
										</form.Field>
										<form.Field name="lastName">
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor="kioskOnlyLastName">
														{t("organization.invite.kioskOnly.lastName", "Last name")}
													</Label>
													<Input
														id="kioskOnlyLastName"
														autoComplete="off"
														value={field.state.value}
														onChange={(e) => field.handleChange(e.target.value)}
														maxLength={100}
													/>
												</div>
											)}
										</form.Field>
										<form.Field name="locationIds">
											{(field) => (
												<fieldset className="space-y-2">
													<legend className="text-sm font-medium leading-none">
														{t("organization.invite.kioskOnly.locations", "Assigned locations")}
													</legend>
													<p className="text-xs text-muted-foreground">
														{t(
															"organization.invite.kioskOnly.locationsDescription",
															"The kiosks at these locations list the employee.",
														)}
													</p>
													{kioskLocations.length === 0 ? (
														<p className="text-sm text-muted-foreground">
															{t(
																"organization.invite.kioskOnly.noLocations",
																"No active locations yet. You can assign locations later.",
															)}
														</p>
													) : (
														kioskLocations.map((option) => {
															const id = `kioskOnlyLocation-${option.id}`;
															return (
																<div key={option.id} className="flex items-center gap-x-2">
																	<Checkbox
																		id={id}
																		checked={field.state.value.includes(option.id)}
																		onCheckedChange={(checked) =>
																			field.handleChange(
																				checked === true
																					? [...field.state.value, option.id]
																					: field.state.value.filter(
																							(locationId) => locationId !== option.id,
																						),
																			)
																		}
																	/>
																	<label htmlFor={id} className="text-sm leading-none">
																		{option.name}
																	</label>
																</div>
															);
														})
													)}
												</fieldset>
											)}
										</form.Field>
									</>
								) : null
							}
						</form.Subscribe>

						<form.Subscribe selector={(state) => state.values.kioskOnly}>
							{(kioskOnly) =>
								kioskOnly ? null : (
									<>
										<form.Field name="email">
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor="email">
														{t("organization.invite.emailLabel", "Email Address")}
													</Label>
													<div className="relative">
														<IconMail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
														<Input
															id="email"
															type="email"
															autoComplete="email"
															value={field.state.value}
															onChange={(e) => field.handleChange(e.target.value)}
															placeholder="colleague@example.com"
															className="pl-9"
															required
														/>
													</div>
												</div>
											)}
										</form.Field>

										<form.Field name="role">
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor="role">{t("organization.members.role", "Role")}</Label>
													<Select
														value={field.state.value}
														onValueChange={(value: "owner" | "admin" | "member") =>
															field.handleChange(value)
														}
													>
														<SelectTrigger id="role">
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															<SelectItem value="member">
																<div className="flex flex-col items-start">
																	<span className="font-medium">
																		{t("organization.members.roles.member", "Member")}
																	</span>
																	<span className="text-xs text-muted-foreground">
																		{t(
																			"organization.invite.roleDescriptions.member",
																			"Basic access to organization",
																		)}
																	</span>
																</div>
															</SelectItem>
															<SelectItem value="admin">
																<div className="flex flex-col items-start">
																	<span className="font-medium">
																		{t("organization.members.roles.admin", "Admin")}
																	</span>
																	<span className="text-xs text-muted-foreground">
																		{t(
																			"organization.invite.roleDescriptions.admin",
																			"Can invite members and manage settings",
																		)}
																	</span>
																</div>
															</SelectItem>
															{currentMemberRole === "owner" && (
																<SelectItem value="owner">
																	<div className="flex flex-col items-start">
																		<span className="font-medium">
																			{t("organization.members.roles.owner", "Owner")}
																		</span>
																		<span className="text-xs text-muted-foreground">
																			{t(
																				"organization.invite.roleDescriptions.owner",
																				"Full control of organization",
																			)}
																		</span>
																	</div>
																</SelectItem>
															)}
														</SelectContent>
													</Select>
												</div>
											)}
										</form.Field>
									</>
								)
							}
						</form.Subscribe>

						<form.Field name="targetTeamId">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="targetTeam">
										{t("organization.invite.targetTeam", "Target team")}
									</Label>
									<Select value={field.state.value} onValueChange={field.handleChange}>
										<SelectTrigger
											id="targetTeam"
											aria-label={t("organization.invite.targetTeam", "Target team")}
										>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="none">
												{t("organization.invite.noTargetTeam", "No team")}
											</SelectItem>
											{teams.map((team) => (
												<SelectItem key={team.id} value={team.id}>
													{team.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}
						</form.Field>

						{currentMemberRole === "owner" && (
							<form.Subscribe selector={(state) => state.values.kioskOnly}>
								{(kioskOnly) =>
									kioskOnly ? null : (
										<form.Field name="canCreateOrganizations">
											{(field) => (
												<div className="flex items-center gap-x-2">
													<Checkbox
														id="canCreateOrganizations"
														checked={field.state.value}
														onCheckedChange={(checked) => field.handleChange(checked === true)}
													/>
													<label
														htmlFor="canCreateOrganizations"
														className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
													>
														{t(
															"organization.invite.allowCreateOrganizations",
															"Allow this user to create organizations",
														)}
													</label>
												</div>
											)}
										</form.Field>
									)
								}
							</form.Subscribe>
						)}
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={isPending}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => state.values.kioskOnly}>
							{(kioskOnly) => (
								<Button type="submit" disabled={isPending}>
									{isPending && <IconLoader2 className="mr-2 size-4 animate-spin" />}
									{kioskOnly
										? t("organization.invite.kioskOnly.submit", "Create employee")
										: t("organization.invite.submit", "Send Invitation")}
								</Button>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
