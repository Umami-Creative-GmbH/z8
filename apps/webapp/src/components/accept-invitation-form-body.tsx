import {
	IconLoader2,
	IconMail,
	IconUserPlus,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { withCallbackUrl } from "@/lib/auth/callback-url";
import { Link } from "@/navigation";
import { AuthFormWrapper } from "./auth-form-wrapper";

export interface InvitationDetails {
	email: string;
	inviterName: string | null;
	isExpired: boolean;
	organizationName: string | null;
	role: string | null;
	status: string;
}

interface AcceptInvitationFormBodyProps {
	accepting: boolean;
	callbackUrl: string;
	displayedError: string | null;
	fatalError: string | null;
	invitation: InvitationDetails | null;
	isEmailMismatch: boolean;
	onAccept: () => void;
	onSignOut: () => void;
	session: boolean;
	signUpUrl: string;
}

export function AcceptInvitationFormBody({
	accepting,
	callbackUrl,
	displayedError,
	fatalError,
	invitation,
	isEmailMismatch,
	onAccept,
	onSignOut,
	session,
	signUpUrl,
}: AcceptInvitationFormBodyProps) {
	const { t } = useTranslate();

	return (
		<AuthFormWrapper title={t("auth.accept-invitation", "Accept invitation")}>
			<Card className="border-none shadow-none">
				<CardHeader className="px-0">
					<div className="rounded-2xl border border-border/80 bg-muted/20 p-4 sm:p-5">
						<div className="flex items-start gap-4">
							<div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
								{displayedError ? (
									<IconX className="size-8" aria-hidden="true" />
								) : (
									<IconUserPlus className="size-8" aria-hidden="true" />
								)}
							</div>
							<div className="space-y-2">
								<p className="text-primary text-xs font-medium uppercase tracking-[0.18em]">
									{t("auth.workspace-invitation", "Workspace invitation")}
								</p>
								<CardTitle className="text-left text-2xl sm:text-[1.75rem]">
									{fatalError
										? t("auth.invitation-unavailable", "Invitation unavailable")
										: isEmailMismatch
											? t("auth.wrong-account", "Wrong account")
											: t("auth.you-are-invited", "You're invited")}
								</CardTitle>
								<CardDescription className="text-left text-sm leading-6">
									{fatalError
										? t(
												"auth.invitation-unavailable-description",
												"This invitation can no longer be used. Ask your workspace admin to send a new one.",
											)
										: isEmailMismatch
											? t(
													"auth.wrong-account-description-short",
													"Use the invited email address to switch accounts and continue.",
												)
											: invitation?.organizationName
												? t(
														"auth.invitation-description-with-org",
														"Accept this invitation to join {organization}.",
														{ organization: invitation.organizationName },
													)
												: t(
														"auth.invitation-description-generic",
														"Accept this invitation to join the workspace.",
													)}
								</CardDescription>
							</div>
						</div>
					</div>
				</CardHeader>
				<CardContent className="space-y-4 px-0">
					{invitation ? (
						<section className="rounded-xl border border-border/80 bg-background/80 p-4">
							<div className="mb-4 space-y-1">
								<h3 className="font-medium text-sm">
									{t("auth.invitation-details", "Invitation details")}
								</h3>
								<p className="text-muted-foreground text-sm">
									{t(
										"auth.invitation-details-description",
										"Review the workspace and account details before you continue.",
									)}
								</p>
							</div>
							<dl className="grid gap-3 sm:grid-cols-2">
								<div className="rounded-lg border border-border/70 bg-muted/20 p-3">
									<dt className="text-muted-foreground text-xs uppercase tracking-[0.16em]">
										{t("auth.workspace", "Workspace")}
									</dt>
									<dd className="mt-1 font-medium text-sm">
										{invitation.organizationName ??
											t("common.not-available", "Not available")}
									</dd>
								</div>
								<div className="rounded-lg border border-border/70 bg-muted/20 p-3">
									<dt className="text-muted-foreground text-xs uppercase tracking-[0.16em]">
										{t("auth.invited-email", "Invited email")}
									</dt>
									<dd className="mt-1 flex items-center gap-2 font-medium text-sm">
										<IconMail
											className="size-4 text-muted-foreground"
											aria-hidden="true"
										/>
										<span>{invitation.email}</span>
									</dd>
								</div>
								{invitation.role ? (
									<div className="rounded-lg border border-border/70 bg-muted/20 p-3">
										<dt className="text-muted-foreground text-xs uppercase tracking-[0.16em]">
											{t("auth.role", "Role")}
										</dt>
										<dd className="mt-1 font-medium text-sm">
											{invitation.role}
										</dd>
									</div>
								) : null}
								{invitation.inviterName ? (
									<div className="rounded-lg border border-border/70 bg-muted/20 p-3">
										<dt className="text-muted-foreground text-xs uppercase tracking-[0.16em]">
											{t("auth.invited-by-label", "Invited by")}
										</dt>
										<dd className="mt-1 font-medium text-sm">
											{invitation.inviterName}
										</dd>
									</div>
								) : null}
							</dl>
						</section>
					) : null}
					{fatalError ? (
						<Alert variant="destructive">
							<AlertTitle>{t("common.error", "Error")}</AlertTitle>
							<AlertDescription>{fatalError}</AlertDescription>
						</Alert>
					) : null}
					{!session && !displayedError ? (
						<section className="rounded-xl border border-primary/15 bg-primary/5 p-4">
							<div className="space-y-1">
								<h3 className="font-medium text-sm">
									{t("auth.what-happens-next", "What happens next")}
								</h3>
								<p className="text-muted-foreground text-sm">
									{t(
										"auth.invitation-auth-options-description",
										"Sign in with the invited email address or create an account. You'll return here automatically and join the organization.",
									)}
								</p>
							</div>
							<div className="mt-4 grid gap-3">
								<div className="rounded-lg border border-primary/10 bg-background/80 p-3">
									<p className="font-medium text-sm">
										{t("auth.step-one", "1. Use the invited email")}
									</p>
									<p className="mt-1 text-muted-foreground text-sm">
										{t(
											"auth.invitation-step-one-description",
											"Use the invited email address so the workspace can match this invitation automatically.",
										)}
									</p>
								</div>
								<div className="rounded-lg border border-primary/10 bg-background/80 p-3">
									<p className="font-medium text-sm">
										{t("auth.step-two", "2. Return here and join")}
									</p>
									<p className="mt-1 text-muted-foreground text-sm">
										{t(
											"auth.invitation-step-two-description",
											"After authentication, we'll bring you back to this invitation and finish the workspace setup.",
										)}
									</p>
								</div>
							</div>
						</section>
					) : null}
					{session && isEmailMismatch ? (
						<Alert>
							<AlertTitle>
								{t("auth.wrong-account", "Wrong account")}
							</AlertTitle>
							<AlertDescription>
								{t(
									"auth.wrong-account-description",
									"You're signed in as a different email. Sign out and use the invited email address to accept this invitation.",
								)}
							</AlertDescription>
						</Alert>
					) : null}
				</CardContent>
				<CardFooter className="flex flex-col gap-3 px-0">
					{!fatalError && !isEmailMismatch && session ? (
						<Button className="w-full" onClick={onAccept} disabled={accepting}>
							{accepting ? (
								<>
									<IconLoader2
										className="mr-2 size-4 animate-spin"
										aria-hidden="true"
									/>
									{t("auth.accepting-invitation", "Accepting invitation…")}
								</>
							) : (
								t("auth.accept-invitation", "Accept invitation")
							)}
						</Button>
					) : null}
					{!fatalError && !session ? (
						<>
							<Button asChild className="w-full">
								<Link href={withCallbackUrl("/sign-in", callbackUrl)}>
									{t(
										"auth.sign-in-invited-email",
										"Sign in with invited email",
									)}
								</Link>
							</Button>
							<Button asChild className="w-full" variant="outline">
								<Link href={signUpUrl}>
									{t(
										"auth.create-account-invited-email",
										"Create account with invited email",
									)}
								</Link>
							</Button>
						</>
					) : null}
					{session && isEmailMismatch ? (
						<Button className="w-full" onClick={onSignOut} variant="outline">
							{t("auth.sign-out-and-switch", "Sign out and switch account")}
						</Button>
					) : null}
				</CardFooter>
			</Card>
		</AuthFormWrapper>
	);
}
