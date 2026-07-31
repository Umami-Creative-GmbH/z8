import { IconLoader2 } from "@tabler/icons-react";
import {
	PasswordStrengthIndicator,
	PasswordVisibilityInput,
} from "@/components/auth/password-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SignupController } from "./signup-form-controller";
import { TurnstileWidget } from "./turnstile-widget";

const getFieldErrorId = (field: string) => `${field}-error`;

function getDescribedBy(...ids: Array<string | false | null | undefined>) {
	const describedBy = ids.filter(Boolean).join(" ");
	return describedBy.length > 0 ? describedBy : undefined;
}

function getFieldError(errors: unknown[]) {
	const error = errors.find((value) => typeof value === "string");
	return typeof error === "string" ? error : undefined;
}

export function SignupIdentityFields({
	controller,
}: {
	controller: SignupController;
}) {
	const {
		form,
		isInvitationSignup,
		t,
		validateEmail,
		validateFirstName,
		validateLastName,
	} = controller;
	return (
		<>
			<div className="grid gap-4 md:grid-cols-2">
				{(
					[
						[
							"firstName",
							"First Name",
							"given-name",
							"John…",
							validateFirstName,
						],
						["lastName", "Last Name", "family-name", "Doe…", validateLastName],
					] as const
				).map(([name, label, autoComplete, placeholder, validate]) => (
					<form.Field
						key={name}
						name={name}
						validators={{
							onBlur: ({ value }) => validate(value),
							onChange: ({ value }) => validate(value),
							onSubmit: ({ value }) => validate(value),
						}}
					>
						{(field) => {
							const errorMessage = getFieldError(field.state.meta.errors);
							const translationName =
								name === "firstName" ? "first-name" : "last-name";
							return (
								<div className="grid gap-3">
									<Label htmlFor={name}>
										{t(`auth.${translationName}`, label)}
									</Label>
									<Input
										aria-describedby={getDescribedBy(
											errorMessage && getFieldErrorId(name),
										)}
										aria-invalid={errorMessage ? "true" : "false"}
										id={name}
										name={field.name}
										autoComplete={autoComplete}
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.target.value)}
										placeholder={t(
											`auth.${translationName}-placeholder`,
											placeholder,
										)}
										required
										type="text"
										value={field.state.value}
									/>
									{errorMessage ? (
										<p
											className="text-destructive text-sm"
											id={getFieldErrorId(name)}
										>
											{errorMessage}
										</p>
									) : null}
								</div>
							);
						}}
					</form.Field>
				))}
			</div>
			<form.Field
				name="email"
				validators={{
					onBlur: ({ value }) => validateEmail(value),
					onChange: ({ value }) => validateEmail(value),
					onSubmit: ({ value }) => validateEmail(value),
				}}
			>
				{(field) => {
					const errorMessage = getFieldError(field.state.meta.errors);
					return (
						<div className="grid gap-3">
							<Label htmlFor="email">{t("auth.email", "Email")}</Label>
							<Input
								aria-describedby={getDescribedBy(
									isInvitationSignup && "email-invite-note",
									errorMessage && getFieldErrorId("email"),
								)}
								aria-invalid={errorMessage ? "true" : "false"}
								className={
									isInvitationSignup ? "bg-muted/40 font-medium" : undefined
								}
								id="email"
								name={field.name}
								autoComplete="email"
								spellCheck={false}
								readOnly={isInvitationSignup}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
								placeholder={t("auth.email-placeholder", "jane@example.com…")}
								required
								type="email"
								value={field.state.value}
							/>
							{isInvitationSignup ? (
								<p
									className="text-muted-foreground text-sm"
									id="email-invite-note"
								>
									{t(
										"auth.invited-email-locked",
										"Use the invited email address for this account so you can join the organization automatically.",
									)}
								</p>
							) : null}
							{errorMessage ? (
								<p
									className="text-destructive text-sm"
									id={getFieldErrorId("email")}
								>
									{errorMessage}
								</p>
							) : null}
						</div>
					);
				}}
			</form.Field>
		</>
	);
}

export function SignupPasswordFields({
	controller,
}: {
	controller: SignupController;
}) {
	const { form, formData, t, validateConfirmPassword, validatePassword } =
		controller;
	return (
		<div className="grid gap-3 rounded-xl border border-border/80 bg-background/80 p-4">
			<div className="space-y-1">
				<p className="font-medium text-sm">
					{t("auth.secure-password-heading", "Set a secure password")}
				</p>
				<p className="text-muted-foreground text-sm">
					{t(
						"auth.secure-password-description",
						"Use a password you can recognize quickly during busy workdays without compromising security.",
					)}
				</p>
			</div>
			<form.Field
				name="password"
				validators={{
					onBlur: ({ value }) => validatePassword(value),
					onChange: ({ value }) => validatePassword(value),
					onSubmit: ({ value }) => validatePassword(value),
				}}
			>
				{(field) => {
					const errorMessage = getFieldError(field.state.meta.errors);
					return (
						<>
							<Label htmlFor="password">{t("auth.password", "Password")}</Label>
							<PasswordVisibilityInput
								aria-describedby={getDescribedBy(
									"password-guidance",
									errorMessage && getFieldErrorId("password"),
								)}
								aria-invalid={errorMessage ? "true" : "false"}
								id="password"
								name={field.name}
								autoComplete="new-password"
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
								placeholder={t(
									"setup:setup.field.password_placeholder",
									"Create a strong password",
								)}
								required
								value={field.state.value}
							/>
							<PasswordStrengthIndicator
								id="password-guidance"
								password={formData.password}
							/>
							{errorMessage ? (
								<p
									className="text-destructive text-sm"
									id={getFieldErrorId("password")}
								>
									{errorMessage}
								</p>
							) : null}
						</>
					);
				}}
			</form.Field>
			<form.Field
				name="confirmPassword"
				validators={{
					onBlur: ({ value }) => validateConfirmPassword(value),
					onChangeListenTo: ["password"],
					onChange: ({ value }) => validateConfirmPassword(value),
					onSubmit: ({ value }) => validateConfirmPassword(value),
				}}
			>
				{(field) => {
					const errorMessage = getFieldError(field.state.meta.errors);
					return (
						<>
							<Label htmlFor="confirmPassword">
								{t("auth.confirm-password", "Confirm Password")}
							</Label>
							<PasswordVisibilityInput
								aria-describedby={getDescribedBy(
									errorMessage && getFieldErrorId("confirmPassword"),
								)}
								aria-invalid={errorMessage ? "true" : "false"}
								id="confirmPassword"
								name={field.name}
								autoComplete="new-password"
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
								placeholder={t(
									"setup:setup.field.confirm_password_placeholder",
									"Confirm your password",
								)}
								required
								value={field.state.value}
							/>
							{errorMessage ? (
								<p
									className="text-destructive text-sm"
									id={getFieldErrorId("confirmPassword")}
								>
									{errorMessage}
								</p>
							) : null}
						</>
					);
				}}
			</form.Field>
		</div>
	);
}

export function SignupVerificationFields({
	controller,
}: {
	controller: SignupController;
}) {
	const {
		handleTurnstileError,
		handleTurnstileExpire,
		handleTurnstileTimeout,
		handleTurnstileVerify,
		isLoading,
		t,
		turnstileConfig,
		turnstileRef,
	} = controller;
	return (
		<>
			{turnstileConfig?.enabled && turnstileConfig.siteKey ? (
				<div className="flex justify-center">
					<TurnstileWidget
						ref={turnstileRef}
						siteKey={turnstileConfig.siteKey}
						onVerify={handleTurnstileVerify}
						onError={handleTurnstileError}
						onExpire={handleTurnstileExpire}
						onTimeout={handleTurnstileTimeout}
					/>
				</div>
			) : null}
			<Button className="w-full" disabled={isLoading} type="submit">
				{isLoading ? (
					<>
						<IconLoader2 className="mr-2 size-4 animate-spin" />
						{t("common.loading", "Loading…")}
					</>
				) : (
					t("auth.sign-up", "Sign up")
				)}
			</Button>
		</>
	);
}
