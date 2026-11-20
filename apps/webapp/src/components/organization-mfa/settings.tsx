"use client";

import {
	IconAlertCircle,
	IconAlertTriangle,
	IconInfoCircle,
	IconLoader2,
	IconRefresh,
	IconShieldCheck,
	IconShieldOff,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, type Ref, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ClientForm } from "@/components/ui/client-form";
import { LoadingRegion } from "@/components/ui/loading-region";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { MFA_GRACE_PERIODS } from "@/lib/organization-mfa/policy";
import { cn } from "@/lib/utils";
import { MfaCoverageSummary, MfaMemberCoverage } from "./coverage";
import {
	coverageRows,
	formatCoverageInstant,
	type OrganizationMfaCoverage,
	summarizeCoverage,
} from "./coverage-model";

const POLICY_TAB_PATH = "/settings/enterprise/identity-setup?tab=local-mfa";
const RECENT_VERIFICATION_REQUIRED = "MFA_RECENT_VERIFICATION_REQUIRED";

function verificationHref(organizationId: string) {
	const query = new URLSearchParams({ organizationId, callbackUrl: POLICY_TAB_PATH });
	return `/mfa?${query}`;
}

type SaveError =
	| { kind: "verification" }
	| { kind: "lockout" }
	| { kind: "other"; message: string };

function classifySaveError(message: string | undefined): SaveError | null {
	if (!message) return null;
	if (message === RECENT_VERIFICATION_REQUIRED) return { kind: "verification" };
	if (message.startsWith("Acknowledge that losing every sign-in")) return { kind: "lockout" };
	return { kind: "other", message };
}

function GracePeriodOptions({
	value,
	onChange,
	name,
	labelId,
	descriptionId,
}: {
	value: number;
	onChange: (days: number) => void;
	name: string;
	labelId: string;
	descriptionId: string;
}) {
	const { t } = useTranslate();
	return (
		<RadioGroup
			name={name}
			value={String(value)}
			onValueChange={(next) => onChange(Number(next))}
			aria-labelledby={labelId}
			aria-describedby={descriptionId}
			className="grid grid-cols-2 gap-2 sm:grid-cols-4"
		>
			{MFA_GRACE_PERIODS.map((days) => (
				// The radio button is nested in the label, which names it and widens its target.
				<label
					key={days}
					className={cn(
						"flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
						value === days && "border-primary bg-primary/5 hover:bg-primary/5",
					)}
				>
					<RadioGroupItem value={String(days)} className="mt-0.5" />
					<span className="min-w-0 space-y-0.5">
						<span className="block text-sm font-medium">
							{days === 0
								? t("mfa.policy.graceNone", "Immediately")
								: t("mfa.policy.graceDays", "{days, plural, one {# day} other {# days}}", {
										days,
									})}
						</span>
						<span className="block text-xs text-muted-foreground">
							{days === 0
								? t("mfa.policy.graceNoneHint", "No grace period")
								: t("mfa.policy.graceHint", "{hours} hours to enroll", { hours: days * 24 })}
						</span>
					</span>
				</label>
			))}
		</RadioGroup>
	);
}

function AcknowledgementField({
	name,
	checked,
	onChange,
	label,
	description,
	invalid,
	checkboxRef,
}: {
	name: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	label: string;
	description?: string;
	invalid?: boolean;
	checkboxRef?: Ref<HTMLButtonElement>;
}) {
	const id = useId();
	return (
		<div className="flex items-start gap-3">
			<Checkbox
				ref={checkboxRef}
				id={id}
				name={name}
				checked={checked}
				onCheckedChange={(next) => onChange(next === true)}
				aria-invalid={invalid || undefined}
				aria-describedby={description ? `${id}-description` : undefined}
				className="mt-0.5"
			/>
			<div className="min-w-0 space-y-1">
				<label htmlFor={id} className="cursor-pointer text-sm font-medium leading-snug">
					{label}
				</label>
				{description && (
					<p id={`${id}-description`} className="text-sm text-muted-foreground">
						{description}
					</p>
				)}
			</div>
		</div>
	);
}

export function OrganizationMfaSettings({
	organizationId,
	initial,
}: {
	organizationId: string;
	initial: OrganizationMfaCoverage;
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const router = useRouter();
	const queryClient = useQueryClient();
	const [saveError, setSaveError] = useState<SaveError | null>(null);
	const [recoveryMissing, setRecoveryMissing] = useState(false);
	const recoveryRef = useRef<HTMLButtonElement>(null);
	const lockoutRef = useRef<HTMLButtonElement>(null);
	const rows = coverageRows(initial);
	const summary = summarizeCoverage(rows);
	const form = useForm({
		defaultValues: {
			enabled: initial.enabled,
			gracePeriodDays: initial.gracePeriodDays,
			recoveryAcknowledged: false,
			soleAdminLockoutAcknowledged: false,
		},
		onSubmit: async ({ value }) => {
			setSaveError(null);
			const activating = value.enabled && !initial.enabled;
			if (activating && !value.recoveryAcknowledged) {
				setRecoveryMissing(true);
				recoveryRef.current?.focus();
				return;
			}
			const response = await fetch("/api/organization-mfa/policy", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ organizationId, ...value }),
			});
			const result = await response.json().catch(() => ({}));
			if (!response.ok) {
				const classified = classifySaveError(result.error) ?? {
					kind: "other",
					message: t("mfa.policy.failed", "Policy update refused"),
				};
				setSaveError(classified);
				if (classified.kind === "lockout") lockoutRef.current?.focus();
				return;
			}
			toast.success(
				value.enabled
					? t("mfa.policy.savedOn", "Local MFA requirement saved")
					: t("mfa.policy.savedOff", "Local MFA requirement turned off"),
			);
			await queryClient.invalidateQueries({
				queryKey: ["organization-mfa-policy", organizationId],
			});
			router.refresh();
		},
	});

	return (
		<div className="space-y-6">
			<MfaCoverageSummary summary={summary} policyEnabled={initial.enabled} />
			<ClientForm
				noValidate
				className="page-measure"
				aria-labelledby="mfa-policy-title"
				onSubmit={() => {
					void form.handleSubmit();
				}}
			>
				<Card className="gap-0 py-0">
					<CardHeader className="border-b py-5">
						<CardTitle as="h2" id="mfa-policy-title" className="text-base">
							{t("mfa.policy.title", "Organization authentication")}
						</CardTitle>
						<CardDescription>
							{initial.updatedAt
								? t("mfa.policy.updatedAt", "Last changed {date} ({timezone})", {
										date: formatCoverageInstant(initial.updatedAt, initial.timezone, locale),
										timezone: initial.timezone,
									})
								: t("mfa.policy.neverChanged", "Not configured yet")}
						</CardDescription>
						<CardAction>
							{initial.enabled ? (
								<Badge variant="success">
									<IconShieldCheck aria-hidden="true" />
									{t("mfa.policy.stateOn", "Required")}
								</Badge>
							) : (
								<Badge variant="outline" className="text-muted-foreground">
									<IconShieldOff aria-hidden="true" />
									{t("mfa.policy.stateOff", "Not required")}
								</Badge>
							)}
						</CardAction>
					</CardHeader>
					<CardContent className="divide-y">
						<form.Field name="enabled">
							{(field) => (
								<div className="flex items-start justify-between gap-6 py-5">
									<div className="min-w-0 space-y-1">
										<label
											htmlFor="mfa-policy-enabled"
											className="cursor-pointer text-sm font-medium"
										>
											{t("mfa.policy.enable", "Require an authenticator for local sign-ins")}
										</label>
										<p
											id="mfa-policy-enabled-description"
											className="text-sm text-muted-foreground"
										>
											{t(
												"mfa.policy.description",
												"Require password plus TOTP, or a passkey verified with PIN/biometrics, for every human member's local organization access. Synced passkeys qualify. This policy is available on every plan.",
											)}
										</p>
									</div>
									<Switch
										id="mfa-policy-enabled"
										name={field.name}
										checked={field.state.value}
										onCheckedChange={(checked) => {
											field.handleChange(checked);
											setSaveError(null);
										}}
										aria-describedby="mfa-policy-enabled-description"
										className="mt-0.5"
									/>
								</div>
							)}
						</form.Field>
						<form.Field name="gracePeriodDays">
							{(field) => (
								<div className="min-w-0 space-y-3 py-5">
									<p id="mfa-policy-grace-label" className="text-sm font-medium">
										{t("mfa.policy.grace", "Enrollment window for future assignments")}
									</p>
									<p id="mfa-policy-grace-description" className="text-sm text-muted-foreground">
										{t(
											"mfa.policy.graceDescription",
											"Applies when a member is assigned a deadline after you save. Existing deadlines never move.",
										)}
									</p>
									<GracePeriodOptions
										name={field.name}
										value={field.state.value}
										onChange={field.handleChange}
										labelId="mfa-policy-grace-label"
										descriptionId="mfa-policy-grace-description"
									/>
								</div>
							)}
						</form.Field>
						<form.Subscribe selector={(state) => state.values}>
							{(values) => {
								const activating = values.enabled && !initial.enabled;
								const deactivating = !values.enabled && initial.enabled;
								if (deactivating)
									return (
										<div className="py-5">
											<Alert>
												<IconInfoCircle aria-hidden="true" />
												<AlertTitle>
													{t("mfa.policy.offTitle", "Turning the requirement off")}
												</AlertTitle>
												<AlertDescription>
													{t(
														"mfa.policy.windows",
														"Existing deadlines never move. Disabling suspends enforcement; re-enabling restores assigned deadlines, including expired ones. There are no individual exemptions.",
													)}
												</AlertDescription>
											</Alert>
										</div>
									);
								if (!activating) return null;
								return (
									<ActivationSafeguards
										withoutMethod={summary.inScope - summary.enrolled}
										gracePeriodDays={values.gracePeriodDays}
									>
										<form.Field name="recoveryAcknowledged">
											{(field) => (
												<div className="space-y-1.5">
													<AcknowledgementField
														name={field.name}
														checked={field.state.value}
														onChange={(checked) => {
															field.handleChange(checked);
															setRecoveryMissing(false);
														}}
														checkboxRef={recoveryRef}
														invalid={recoveryMissing}
														label={t(
															"mfa.policy.recoveryAck",
															"I have verified my sign-in route and arranged recovery.",
														)}
														description={t(
															"mfa.policy.recoveryAckHint",
															"Required to turn the requirement on.",
														)}
													/>
													{recoveryMissing && (
														<p
															role="alert"
															className="flex items-center gap-1.5 pl-7 text-sm text-destructive"
														>
															<IconAlertCircle aria-hidden="true" className="size-4" />
															{t(
																"mfa.policy.recoveryRequired",
																"Confirm your sign-in route and recovery before turning this on.",
															)}
														</p>
													)}
												</div>
											)}
										</form.Field>
										<form.Field name="soleAdminLockoutAcknowledged">
											{(field) => (
												<AcknowledgementField
													name={field.name}
													checked={field.state.value}
													onChange={field.handleChange}
													checkboxRef={lockoutRef}
													invalid={saveError?.kind === "lockout" && !field.state.value}
													label={t(
														"mfa.policy.lockoutLabel",
														"Accept the risk of losing every administrator authentication route",
													)}
													description={t(
														"mfa.policy.lockoutAck",
														"If no other administrator has a confirmed route, I accept that losing every authentication and recovery route leaves this organization locked, without an administrator or support bypass.",
													)}
												/>
											)}
										</form.Field>
									</ActivationSafeguards>
								);
							}}
						</form.Subscribe>
					</CardContent>
					<CardFooter className="flex-col items-stretch gap-4 border-t bg-muted/30 py-4 sm:flex-row sm:items-center sm:justify-between">
						<p className="flex min-w-0 items-start gap-2 text-sm text-muted-foreground">
							<IconShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
							<span>
								{t(
									"mfa.policy.verifyHint",
									"Saving needs owner or admin access and a verification from the last five minutes.",
								)}{" "}
								<Link
									href={verificationHref(organizationId)}
									className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
								>
									{t("mfa.policy.verifyNow", "Verify now")}
								</Link>
							</span>
						</p>
						<form.Subscribe
							selector={(state) => ({
								submitting: state.isSubmitting,
								dirty:
									state.values.enabled !== initial.enabled ||
									state.values.gracePeriodDays !== initial.gracePeriodDays,
							})}
						>
							{({ submitting, dirty }) => (
								<div className="flex shrink-0 items-center justify-end gap-3">
									{dirty && !submitting && (
										<span className="text-sm text-muted-foreground" aria-live="polite">
											{t("mfa.policy.unsaved", "Unsaved changes")}
										</span>
									)}
									{dirty && (
										<Button
											type="button"
											variant="ghost"
											disabled={submitting}
											onClick={() => {
												form.reset();
												setSaveError(null);
												setRecoveryMissing(false);
											}}
										>
											{t("common.cancel", "Cancel")}
										</Button>
									)}
									<Button type="submit" disabled={submitting || !dirty} aria-busy={submitting}>
										{submitting && (
											<IconLoader2
												aria-hidden="true"
												className="size-4 animate-spin motion-reduce:animate-none"
											/>
										)}
										{submitting
											? t("mfa.policy.saving", "Saving…")
											: t("mfa.policy.save", "Save policy")}
									</Button>
								</div>
							)}
						</form.Subscribe>
					</CardFooter>
				</Card>
				{saveError && (
					<SaveErrorAlert error={saveError} organizationId={organizationId} className="mt-4" />
				)}
			</ClientForm>
			<MfaMemberCoverage
				rows={rows}
				summary={summary}
				timezone={initial.timezone}
				policyEnabled={initial.enabled}
			/>
			<aside className="page-measure flex items-start gap-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
				<IconInfoCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
				<div className="space-y-2">
					<p className="font-medium text-foreground">
						{t("mfa.policy.ssoTitle", "Members who sign in with SSO")}
					</p>
					<p>
						{t(
							"mfa.policy.sso",
							"Verified sign-in through this organization's current SSO provider is outside the local MFA baseline. The organization enforces MFA at its identity provider; Z8 does not verify IdP MFA assurance. Require SSO remains separate and has no local fallback.",
						)}
					</p>
					<Link
						href="?tab=sso"
						className="inline-block font-medium text-foreground underline underline-offset-4 hover:text-primary"
					>
						{t("mfa.policy.ssoLink", "Manage SSO providers")}
					</Link>
				</div>
			</aside>
		</div>
	);
}

function ActivationSafeguards({
	withoutMethod,
	gracePeriodDays,
	children,
}: {
	withoutMethod: number;
	gracePeriodDays: number;
	children: ReactNode;
}) {
	const { t } = useTranslate();
	return (
		<section aria-labelledby="mfa-activation-title" className="space-y-4 py-5">
			<div className="space-y-1">
				<h3 id="mfa-activation-title" className="text-sm font-medium">
					{t("mfa.policy.activationTitle", "Before you turn this on")}
				</h3>
				<p className="text-sm text-muted-foreground">
					{t(
						"mfa.policy.activation",
						"Changes need owner/admin authority and accepted authentication within five minutes. Arrange recovery and preferably another administrator who has demonstrated a working sign-in route; enrollment alone does not prove one.",
					)}
				</p>
			</div>
			{withoutMethod > 0 && (
				<div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
					<IconAlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
					<p>
						{gracePeriodDays === 0
							? t(
									"mfa.policy.impactNow",
									"{count, plural, one {# member has} other {# members have}} no enrolled method. Without an earlier deadline, they lose local organization access until they enroll.",
									{ count: withoutMethod },
								)
							: t(
									"mfa.policy.impactWindow",
									"{count, plural, one {# member has} other {# members have}} no enrolled method. Members without an earlier deadline get {days, plural, one {# day} other {# days}} to enroll; deadlines assigned before are restored as they were.",
									{ count: withoutMethod, days: gracePeriodDays },
								)}
					</p>
				</div>
			)}
			<div className="space-y-4 rounded-lg border p-4">{children}</div>
		</section>
	);
}

function SaveErrorAlert({
	error,
	organizationId,
	className,
}: {
	error: SaveError;
	organizationId: string;
	className?: string;
}) {
	const { t } = useTranslate();
	return (
		<Alert variant="destructive" className={className}>
			<IconAlertCircle aria-hidden="true" />
			<AlertTitle>{t("mfa.policy.failed", "Policy update refused")}</AlertTitle>
			<AlertDescription className="space-y-3">
				{error.kind === "verification" ? (
					<>
						<p>
							{t(
								"mfa.policy.verificationExpired",
								"Your verification is missing or older than five minutes. Verify again, then save. You will return to this page.",
							)}
						</p>
						<Link
							href={verificationHref(organizationId)}
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							<IconShieldCheck aria-hidden="true" className="size-4" />
							{t("mfa.policy.verifyNow", "Verify now")}
						</Link>
					</>
				) : error.kind === "lockout" ? (
					<p>
						{t(
							"mfa.policy.lockoutRequired",
							"No other administrator has a confirmed sign-in route. Accept the lockout risk below, or have another administrator verify first.",
						)}
					</p>
				) : (
					<p>{error.message}</p>
				)}
			</AlertDescription>
		</Alert>
	);
}

function CoverageSkeleton() {
	return (
		<LoadingRegion
			label={{
				labelKey: "mfa.coverage.loading",
				labelDefault: "Loading organization authentication…",
			}}
			className="space-y-6"
		>
			<Skeleton className="h-32 w-full rounded-xl" />
			<Skeleton className="h-96 w-full rounded-xl" />
			<Skeleton className="h-64 w-full rounded-xl" />
		</LoadingRegion>
	);
}

export function OrganizationMfaPolicyPanel({ organizationId }: { organizationId: string }) {
	const { t } = useTranslate();
	const query = useQuery({
		queryKey: ["organization-mfa-policy", organizationId],
		queryFn: async (): Promise<OrganizationMfaCoverage> => {
			const response = await fetch(
				`/api/organization-mfa/policy?organizationId=${encodeURIComponent(organizationId)}`,
			);
			if (!response.ok)
				throw new Error(
					t("mfa.coverage.failed", "Organization authentication coverage could not be loaded"),
				);
			return response.json();
		},
	});
	if (query.isPending) return <CoverageSkeleton />;
	if (query.error)
		return (
			<Alert variant="destructive">
				<IconAlertCircle aria-hidden="true" />
				<AlertTitle>{query.error.message}</AlertTitle>
				<AlertDescription>
					<p>
						{t(
							"mfa.coverage.failedHint",
							"Only owners and admins who have verified their sign-in for this organization can view this page.",
						)}
					</p>
					<div className="mt-3 flex flex-wrap gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => void query.refetch()}
							disabled={query.isFetching}
						>
							<IconRefresh aria-hidden="true" className="size-4" />
							{t("common.retry", "Retry")}
						</Button>
						<Link
							href={verificationHref(organizationId)}
							className={buttonVariants({ variant: "ghost", size: "sm" })}
						>
							{t("mfa.policy.verifyNow", "Verify now")}
						</Link>
					</div>
				</AlertDescription>
			</Alert>
		);
	return (
		<OrganizationMfaSettings
			key={`${query.data.enabled}:${query.data.gracePeriodDays}:${query.data.updatedAt}`}
			organizationId={organizationId}
			initial={query.data}
		/>
	);
}
