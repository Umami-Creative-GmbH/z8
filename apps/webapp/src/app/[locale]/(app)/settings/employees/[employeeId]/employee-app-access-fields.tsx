"use client";

import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { TFormDescription, TFormItem, TFormLabel } from "@/components/ui/tanstack-form";
import type { Translate } from "./employee-section-shared";
import type { EmployeeDetailFormApi } from "./page-utils";

export function EmployeeAppAccessFields({
	form,
	isUpdating,
	t,
}: {
	form: EmployeeDetailFormApi;
	isUpdating: boolean;
	t: Translate;
}) {
	return (
		<>
			<Separator className="my-4" />
			<div className="space-y-4">
				<div>
					<h4 className="text-sm font-medium">
						{t("settings.employees.detailView.appAccessPermissions", "App Access Permissions")}
					</h4>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.employees.detailView.appAccessDescription",
							"Control which applications this employee can access",
						)}
					</p>
				</div>
				<AccessSwitchField
					form={form}
					name="canUseWebapp"
					label={t("settings.employees.detailView.webApplication", "Web Application")}
					description={t(
						"settings.employees.detailView.webApplicationDescription",
						"Access to the browser-based application",
					)}
					ariaLabel={t(
						"settings.employees.detailView.toggleWebApplicationAccess",
						"Toggle web application access",
					)}
					isUpdating={isUpdating}
				/>
				<AccessSwitchField
					form={form}
					name="canUseDesktop"
					label={t("settings.employees.detailView.desktopApplication", "Desktop Application")}
					description={t(
						"settings.employees.detailView.desktopApplicationDescription",
						"Access to the desktop app for time tracking",
					)}
					ariaLabel={t(
						"settings.employees.detailView.toggleDesktopApplicationAccess",
						"Toggle desktop application access",
					)}
					isUpdating={isUpdating}
				/>
				<AccessSwitchField
					form={form}
					name="canUseMobile"
					label={t("settings.employees.detailView.mobileApplication", "Mobile Application")}
					description={t(
						"settings.employees.detailView.mobileApplicationDescription",
						"Access to mobile apps for time tracking",
					)}
					ariaLabel={t(
						"settings.employees.detailView.toggleMobileApplicationAccess",
						"Toggle mobile application access",
					)}
					isUpdating={isUpdating}
				/>
			</div>
		</>
	);
}

function AccessSwitchField({
	form,
	name,
	label,
	description,
	ariaLabel,
	isUpdating,
}: {
	form: EmployeeDetailFormApi;
	name: "canUseWebapp" | "canUseDesktop" | "canUseMobile";
	label: string;
	description: string;
	ariaLabel: string;
	isUpdating: boolean;
}) {
	return (
		<form.Field name={name}>
			{(field) => (
				<TFormItem>
					<div className="flex items-center justify-between rounded-lg border p-3">
						<div className="space-y-0.5">
							<TFormLabel>{label}</TFormLabel>
							<TFormDescription>{description}</TFormDescription>
						</div>
						<Switch
							checked={field.state.value ?? true}
							onCheckedChange={field.handleChange}
							disabled={isUpdating}
							aria-label={ariaLabel}
						/>
					</div>
				</TFormItem>
			)}
		</form.Field>
	);
}
