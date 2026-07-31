import { IconBuilding } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { withCallbackUrl } from "@/lib/auth/callback-url";
import type { SocialProvider, SocialProviderId } from "@/lib/social-providers";
import { Link } from "@/navigation";
import { AuthFormWrapper } from "./auth-form-wrapper";
import {
	type SignupFormProps,
	useSignupFormController,
} from "./signup-form-controller";
import {
	SignupIdentityFields,
	SignupPasswordFields,
	SignupVerificationFields,
} from "./signup-form-fields";

const SOCIAL_SKELETON_KEYS = [
	"social-1",
	"social-2",
	"social-3",
	"social-4",
	"social-5",
	"social-6",
];

function SignupSocialAuth({
	showEmailPassword,
	filteredProviders,
	providersLoading,
	isLoading,
	onSocialSignup,
}: {
	showEmailPassword: boolean;
	filteredProviders: SocialProvider[];
	providersLoading: boolean;
	isLoading: boolean;
	onSocialSignup: (provider: SocialProviderId) => void;
}) {
	const { t } = useTranslate();
	if (filteredProviders.length === 0) return null;
	const skeletonCount = Math.max(filteredProviders.length, 4);
	return (
		<>
			<div className="text-center text-sm">
				<span className="relative z-10 px-2 text-muted-foreground">
					{showEmailPassword
						? t("auth.or-sign-up-with", "Or sign up with")
						: t("auth.sign-up-with.label", "Sign up with")}
				</span>
			</div>
			<div className="flex flex-wrap justify-center gap-2 *:w-1/4">
				{providersLoading
					? SOCIAL_SKELETON_KEYS.slice(0, skeletonCount).map((key) => (
							<div
								key={key}
								className="h-10 animate-pulse rounded-md bg-muted"
							/>
						))
					: filteredProviders.map((provider) => (
							<Tooltip key={provider.id}>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="outline"
										onClick={() => onSocialSignup(provider.id)}
										disabled={isLoading}
									>
										<provider.icon aria-hidden="true" className="size-4" />
										<span className="sr-only">
											{t(
												`auth.sign-up-with.${provider.id}`,
												`Sign up with ${provider.name}`,
											)}
										</span>
									</Button>
								</TooltipTrigger>
								<TooltipContent>
									<span className="text-sm">
										{t(
											`auth.sign-up-with.${provider.id}`,
											`Sign up with ${provider.name}`,
										)}
									</span>
								</TooltipContent>
							</Tooltip>
						))}
			</div>
		</>
	);
}

export function SignupFormBody({
	callbackUrl,
	className,
	initialEmail,
	initialInvitationId,
	initialOrganizationName,
	inviteCode,
	...props
}: SignupFormProps) {
	const controller = useSignupFormController({
		callbackUrl,
		className,
		initialEmail,
		initialInvitationId,
		initialOrganizationName,
		inviteCode,
	});
	const {
		branding,
		displayedOrganizationName,
		error,
		filteredProviders,
		handleSocialSignup,
		handleSubmit,
		inviteCodeValid,
		isInvitationSignup,
		isLoading,
		providersLoading,
		sanitizedCallbackUrl,
		showEmailPassword,
		t,
	} = controller;
	return (
		<AuthFormWrapper
			backHref="/sign-in"
			className={className}
			formProps={{ noValidate: true, onSubmit: handleSubmit }}
			title={t("auth.create-account", "Create your account")}
			branding={branding}
			{...props}
		>
			{error ? (
				<div
					className="rounded-md bg-destructive/15 p-3 text-destructive text-sm"
					role="alert"
				>
					{error}
				</div>
			) : null}
			{displayedOrganizationName &&
			(isInvitationSignup || (inviteCode && inviteCodeValid)) ? (
				<Alert className="border-primary/20 bg-primary/5">
					<IconBuilding className="size-4" />
					<AlertDescription>
						{t(
							"auth.signing-up-to-join",
							"You're signing up to join {organization}",
							{ organization: displayedOrganizationName },
						)}
					</AlertDescription>
				</Alert>
			) : null}
			{inviteCode && inviteCodeValid === false ? (
				<Alert variant="destructive">
					<AlertDescription>
						{t(
							"auth.invalid-invite-code",
							"The invite code is invalid or has expired. You can still sign up and join later.",
						)}
					</AlertDescription>
				</Alert>
			) : null}
			{showEmailPassword ? (
				<>
					<SignupIdentityFields controller={controller} />
					<SignupPasswordFields controller={controller} />
					<SignupVerificationFields controller={controller} />
				</>
			) : null}
			<SignupSocialAuth
				showEmailPassword={showEmailPassword}
				filteredProviders={filteredProviders}
				providersLoading={providersLoading}
				isLoading={isLoading}
				onSocialSignup={handleSocialSignup}
			/>
			{showEmailPassword ? (
				<div className="text-center text-sm">
					{t("auth.already-have-account", "Already have an account?")}{" "}
					<Link
						className="underline underline-offset-4"
						href={withCallbackUrl("/sign-in", sanitizedCallbackUrl)}
					>
						{t("auth.sign-in", "Sign in")}
					</Link>
				</div>
			) : null}
		</AuthFormWrapper>
	);
}
