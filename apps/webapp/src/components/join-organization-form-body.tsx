import { IconBuilding, IconCheck, IconClock, IconLoader2, IconUserPlus } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { FormEventHandler, ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useBranding } from "@/lib/auth/domain-auth-context";
import { Link } from "@/navigation";
import { AuthFormWrapper } from "./auth-form-wrapper";

export type JoinState =
	| "loading"
	| "invalid"
	| "valid"
	| "joining"
	| "success"
	| "error"
	| "already-member";

interface JoinOrganizationFormBodyProps {
	code: string;
	codeField: ReactNode;
	error: string | null;
	joinStatus: "pending" | "approved" | null;
	onSubmit: FormEventHandler<HTMLFormElement>;
	onValidate: () => void;
	organizationId: string | null;
	organizationName: string | null;
	accountEmail: string | null;
	sessionLoading: boolean;
	signInHref: string;
	signUpHref: string;
	state: JoinState;
}

export function JoinOrganizationFormBody({
	code,
	codeField,
	error,
	joinStatus,
	onSubmit,
	onValidate,
	organizationId,
	organizationName,
	accountEmail,
	sessionLoading,
	signInHref,
	signUpHref,
	state,
}: JoinOrganizationFormBodyProps) {
	const { t } = useTranslate();
	const branding = useBranding();
	const completed = state === "success" || state === "already-member";
	const pending = state === "success" && joinStatus === "pending";
	const completionHref =
		!pending && organizationId
			? `/init?organizationId=${encodeURIComponent(organizationId)}`
			: "/init";
	const title =
		state === "already-member"
			? t("settings.inviteCodes.alreadyMember", "Already a Member")
			: state === "success"
				? pending
					? t("settings.inviteCodes.joinRequestSent", "Join Request Sent")
					: t("settings.inviteCodes.joinedSuccessfully", "Joined Successfully")
				: t("settings.inviteCodes.joinOrganization", "Join Organization");

	return (
		<AuthFormWrapper title={title} branding={branding} formProps={{ onSubmit }}>
			<div className="space-y-6">
				{completed ? (
					<>
						<div role="status" className="space-y-4">
							<p className="break-words text-sm text-muted-foreground">
								{accountEmail
									? t("auth.join.accountContext", "Joining with {email}", {
											email: accountEmail,
										})
									: null}
							</p>
							<Alert role="status">
								{pending ? (
									<IconClock aria-hidden="true" className="size-4" />
								) : (
									<IconCheck aria-hidden="true" className="size-4" />
								)}
								<AlertTitle className="break-words">{organizationName}</AlertTitle>
								<AlertDescription>
									{state === "already-member"
										? t(
												"settings.inviteCodes.alreadyMemberMessage",
												"You are already a member of this organization.",
											)
										: pending
											? t(
													"settings.inviteCodes.pendingApprovalMessage",
													"Your request to join {organization} has been submitted. An administrator will review your request.",
													{ organization: organizationName },
												)
											: t(
													"settings.inviteCodes.joinedMessage",
													"You have successfully joined {organization}.",
													{ organization: organizationName },
												)}
								</AlertDescription>
							</Alert>
							{pending ? (
								<div className="space-y-2 text-sm text-muted-foreground">
									<p className="font-medium text-foreground">
										{t("settings.inviteCodes.pendingApproval", "Pending Approval")}
									</p>
									<p>
										{t(
											"settings.inviteCodes.pendingApprovalDescription",
											"You will be notified once your membership is approved.",
										)}
									</p>
									<p>
										{t(
											"auth.join.approvalBoundary",
											"Continuing does not approve this request or grant access to this organization.",
										)}
									</p>
								</div>
							) : (
								<p className="text-sm text-muted-foreground">
									{t(
										"auth.join.employmentBoundary",
										"Your organization's access and employment checks still apply.",
									)}
								</p>
							)}
						</div>
						<Button asChild className="w-full">
							<Link href={completionHref}>
								{pending
									? t("auth.join.continueToAccount", "Continue to your account")
									: t("common.goToDashboard", "Go to Dashboard")}
							</Link>
						</Button>
					</>
				) : (
					<>
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.inviteCodes.enterCodeDescription",
								"Enter an invite code to join an organization",
							)}
						</p>
						<div className="space-y-3">
							{codeField}
							<Button
								type="button"
								variant="outline"
								className="w-full"
								onClick={onValidate}
								disabled={!code.trim() || state === "loading" || state === "joining"}
							>
								{state === "loading" ? (
									<IconLoader2
										aria-hidden="true"
										className="size-4 animate-spin motion-reduce:animate-none"
									/>
								) : null}
								{t("common.validate", "Validate")}
							</Button>
						</div>
						<div role="status" aria-live="polite" className="space-y-3">
							{state === "loading" ? (
								<p className="text-sm text-muted-foreground">
									{t("settings.inviteCodes.validatingCode", "Validating code...")}
								</p>
							) : null}
							{organizationName ? (
								<Alert role="status">
									<IconBuilding aria-hidden="true" className="size-4" />
									<AlertTitle className="break-words">{organizationName}</AlertTitle>
									<AlertDescription>
										{t(
											"auth.join.resolvedOrganization",
											"This is the organization associated with your code.",
										)}
									</AlertDescription>
								</Alert>
							) : null}
							<p className="break-words text-sm text-muted-foreground">
								{sessionLoading
									? t("common.loading", "Loading...")
									: accountEmail
										? t("auth.join.accountContext", "Joining with {email}", {
												email: accountEmail,
											})
										: t(
												"auth.join.signInContext",
												"Sign in to request membership with your account.",
											)}
							</p>
						</div>
						{state === "error" && error ? (
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
						) : null}
						<Button
							type="submit"
							className="w-full"
							disabled={
								sessionLoading ||
								!code.trim() ||
								state === "loading" ||
								state === "joining" ||
								state === "invalid" ||
								!organizationName
							}
						>
							{state === "joining" ? (
								<IconLoader2
									aria-hidden="true"
									className="size-4 animate-spin motion-reduce:animate-none"
								/>
							) : (
								<IconUserPlus aria-hidden="true" className="size-4" />
							)}
							{state === "joining"
								? t("settings.inviteCodes.joining", "Joining...")
								: !accountEmail
									? t("settings.inviteCodes.signInToJoin", "Sign in to Join")
									: t("settings.inviteCodes.joinOrganization", "Join Organization")}
						</Button>
						{!accountEmail && !sessionLoading ? (
							<div className="space-y-2 border-t pt-4 text-sm text-muted-foreground">
								<p>
									{t("settings.inviteCodes.alreadyHaveAccount", "Already have an account?")}{" "}
									<Link href={signInHref} className="text-primary underline underline-offset-4">
										{t("auth.sign-in", "Sign in")}
									</Link>
								</p>
								<p>
									{t("settings.inviteCodes.needAccount", "Don't have an account?")}{" "}
									<Link href={signUpHref} className="text-primary underline underline-offset-4">
										{t("auth.sign-up", "Sign up")}
									</Link>
								</p>
							</div>
						) : null}
					</>
				)}
			</div>
		</AuthFormWrapper>
	);
}
