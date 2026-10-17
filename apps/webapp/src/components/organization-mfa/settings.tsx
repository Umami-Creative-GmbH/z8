"use client";

import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
} from "@/components/ui/tanstack-form";
import { formatMfaDeadline } from "@/lib/organization-mfa/notices";
import { MFA_GRACE_PERIODS } from "@/lib/organization-mfa/policy";
import type { getOrganizationMfaCoverage } from "@/lib/organization-mfa/queries";

type Coverage = Awaited<ReturnType<typeof getOrganizationMfaCoverage>>;
export function OrganizationMfaSettings({
	organizationId,
	initial,
}: {
	organizationId: string;
	initial: Coverage;
}) {
	const { t } = useTranslate();
	const controlLabels = {
		enabled: t(
			"mfa.policy.enable",
			"Require an authenticator for local sign-ins",
		),
		recoveryAcknowledged: t(
			"mfa.policy.recoveryAck",
			"I have verified my sign-in route and arranged recovery.",
		),
		soleAdminLockoutAcknowledged: t(
			"mfa.policy.lockoutLabel",
			"Accept the risk of losing every administrator authentication route",
		),
	};
	const router = useRouter();
	const queryClient = useQueryClient();
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: {
			enabled: initial.enabled,
			gracePeriodDays: initial.gracePeriodDays,
			recoveryAcknowledged: false,
			soleAdminLockoutAcknowledged: false,
		},
		onSubmit: async ({ value }) => {
			setError(null);
			const response = await fetch("/api/organization-mfa/policy", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ organizationId, ...value }),
			});
			const result = await response.json();
			if (!response.ok) {
				setError(
					result.error || t("mfa.policy.failed", "Policy update refused"),
				);
				return;
			}
			await queryClient.invalidateQueries({
				queryKey: ["organization-mfa-policy", organizationId],
			});
			router.refresh();
		},
	});
	return (
		<div className="space-y-7">
			<h2 className="text-xl font-semibold">
				{t("mfa.policy.title", "Organization authentication")}
			</h2>
			<p>
				{t(
					"mfa.policy.description",
					"Require password plus TOTP, or a passkey verified with PIN/biometrics, for every human member's local organization access. Synced passkeys qualify. This policy is available on every plan.",
				)}
			</p>
			<Link
				className="underline"
				href={`/mfa?organizationId=${encodeURIComponent(organizationId)}`}
			>
				{t(
					"mfa.policy.verify",
					"Verify your authentication before changing this policy",
				)}
			</Link>
			<form
				className="space-y-5"
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void form.handleSubmit();
				}}
			>
				<form.Field name="enabled">
					{(field) => (
						<TFormItem>
							<TFormLabel>
								<input
									name={field.name}
									aria-label={controlLabels[field.name]}
									type="checkbox"
									checked={field.state.value}
									onChange={(event) => field.handleChange(event.target.checked)}
								/>{" "}
								{t(
									"mfa.policy.enable",
									"Require an authenticator for local sign-ins",
								)}
							</TFormLabel>
						</TFormItem>
					)}
				</form.Field>
				<form.Field name="gracePeriodDays">
					{(field) => (
						<TFormItem>
							<TFormLabel>
								{t(
									"mfa.policy.grace",
									"Enrollment window for future assignments",
								)}
							</TFormLabel>
							<TFormControl>
								<select
									name={field.name}
									aria-label={t(
										"mfa.policy.grace",
										"Enrollment window for future assignments",
									)}
									className="rounded-md border bg-background text-foreground p-2"
									value={field.state.value}
									onChange={(event) =>
										field.handleChange(Number(event.target.value))
									}
								>
									{MFA_GRACE_PERIODS.map((days) => (
										<option key={days} value={days}>
											{t("mfa.policy.days", "{days} days (24 hours each)", {
												days,
											})}
										</option>
									))}
								</select>
							</TFormControl>
						</TFormItem>
					)}
				</form.Field>
				<p>
					{t(
						"mfa.policy.windows",
						"Existing deadlines never move. Disabling suspends enforcement; re-enabling restores assigned deadlines, including expired ones. There are no individual exemptions.",
					)}
				</p>
				<p>
					{t(
						"mfa.policy.activation",
						"Changes need owner/admin authority and accepted authentication within five minutes. Arrange recovery and preferably another administrator who has demonstrated a working sign-in route; enrollment alone does not prove one.",
					)}
				</p>
				<form.Field name="recoveryAcknowledged">
					{(field) => (
						<TFormItem>
							<TFormLabel>
								<input
									name={field.name}
									aria-label={controlLabels[field.name]}
									type="checkbox"
									checked={field.state.value}
									onChange={(event) => field.handleChange(event.target.checked)}
								/>{" "}
								{t(
									"mfa.policy.recoveryAck",
									"I have verified my sign-in route and arranged recovery.",
								)}
							</TFormLabel>
						</TFormItem>
					)}
				</form.Field>
				<form.Field name="soleAdminLockoutAcknowledged">
					{(field) => (
						<TFormItem>
							<TFormLabel>
								<input
									name={field.name}
									aria-label={controlLabels[field.name]}
									type="checkbox"
									checked={field.state.value}
									onChange={(event) => field.handleChange(event.target.checked)}
								/>{" "}
								{t(
									"mfa.policy.lockoutAck",
									"If no other administrator has a confirmed route, I accept that losing every authentication and recovery route leaves this organization locked, without an administrator or support bypass.",
								)}
							</TFormLabel>
						</TFormItem>
					)}
				</form.Field>
				<form.Subscribe selector={(state) => state.isSubmitting}>
					{(submitting) => (
						<Button type="submit" disabled={submitting}>
							{submitting
								? t("mfa.policy.saving", "Saving…")
								: t("mfa.policy.save", "Save policy")}
						</Button>
					)}
				</form.Subscribe>
				{error && <p role="alert">{error}</p>}
			</form>
			<div className="overflow-x-auto">
				<table className="w-full text-left text-sm">
					<caption className="mb-3 text-left font-medium">
						{t(
							"mfa.coverage.title",
							"Member enrollment and organization verification",
						)}
					</caption>
					<thead>
						<tr>
							<th>{t("mfa.coverage.member", "Member")}</th>
							<th>{t("mfa.coverage.methods", "Enrolled methods")}</th>
							<th>{t("mfa.coverage.deadline", "Assigned deadline")}</th>
							<th>{t("mfa.coverage.enforced", "Enforced")}</th>
							<th>
								{t(
									"mfa.coverage.access",
									"Last qualifying organization access",
								)}
							</th>
						</tr>
					</thead>
					<tbody>
						{initial.members.map((person) => (
							<tr key={person.userId} className="border-t align-top">
								<td className="py-3 pr-3">
									{person.name}
									{person.kioskOnly && (
										<p>
											{t("mfa.coverage.kiosk", "Kiosk only · outside scope")}
										</p>
									)}
								</td>
								<td className="py-3 pr-3">
									{person.methods.join(", ") || t("mfa.coverage.none", "None")}
								</td>
								<td className="py-3 pr-3">
									{person.deadline
										? formatMfaDeadline(person.deadline, initial.timezone)
										: "—"}
								</td>
								<td className="py-3 pr-3">
									{person.enforced
										? t("common.yes", "Yes")
										: t("common.no", "No")}
								</td>
								<td className="py-3 pr-3">
									{person.lastQualifyingAccessAt
										? formatMfaDeadline(
												person.lastQualifyingAccessAt,
												initial.timezone,
											)
										: t(
												"mfa.coverage.unproven",
												"No qualifying access recorded",
											)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<p>
				{t(
					"mfa.policy.sso",
					"Verified sign-in through this organization's current SSO provider is outside the local MFA baseline. The organization enforces MFA at its identity provider; Z8 does not verify IdP MFA assurance. Require SSO remains separate and has no local fallback.",
				)}
			</p>
		</div>
	);
}

export function OrganizationMfaPolicyPanel({
	organizationId,
}: {
	organizationId: string;
}) {
	const { t } = useTranslate();
	const query = useQuery({
		queryKey: ["organization-mfa-policy", organizationId],
		queryFn: async (): Promise<Coverage> => {
			const response = await fetch(
				`/api/organization-mfa/policy?organizationId=${encodeURIComponent(organizationId)}`,
			);
			if (!response.ok)
				throw new Error(
					t(
						"mfa.coverage.failed",
						"Organization authentication coverage could not be loaded",
					),
				);
			return response.json();
		},
	});
	if (query.isPending)
		return (
			<p role="status">
				{t("mfa.coverage.loading", "Loading organization authentication…")}
			</p>
		);
	if (query.error) return <p role="alert">{query.error.message}</p>;
	return (
		<OrganizationMfaSettings
			organizationId={organizationId}
			initial={query.data}
		/>
	);
}
