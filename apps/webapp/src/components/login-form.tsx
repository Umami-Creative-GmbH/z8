"use client";

import { useTranslate } from "@tolgee/react";
import { Key } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";
import { Link, useRouter } from "@/navigation";
import { AuthFormWrapper } from "./auth-form-wrapper";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { t } = useTranslate();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error for this field when user starts typing
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
    // Clear general error when user starts typing
    if (error) {
      setError(null);
    }
  };

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[field];
      return newErrors;
    });
  };

  const setFieldError = (field: string, message: string) => {
    setFieldErrors((prev) => ({
      ...prev,
      [field]: message,
    }));
  };

  const validateEmail = (value: string) => {
    const result = z.string().email().safeParse(value);
    if (result.success) {
      clearFieldError("email");
    } else {
      setFieldError("email", "Invalid email address");
    }
  };

  const validatePassword = (value: string) => {
    if (value.length === 0) {
      setFieldError("password", "Password is required");
    } else {
      clearFieldError("password");
    }
  };

  const validateField = (field: string, value: string) => {
    switch (field) {
      case "email":
        validateEmail(value);
        break;
      case "password":
        validatePassword(value);
        break;
      default:
        break;
    }
  };

  const handleValidationErrors = (errors: z.ZodError) => {
    const errorMap: Record<string, string> = {};
    for (const err of errors.errors) {
      if (err.path[0]) {
        errorMap[err.path[0] as string] = err.message;
      }
    }
    setFieldErrors(errorMap);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const result = loginSchema.safeParse(formData);

    if (!result.success) {
      handleValidationErrors(result.error);
      setIsLoading(false);
      return;
    }

    try {
      const signInResult = await authClient.signIn.email({
        email: formData.email,
        password: formData.password,
      });

      if (signInResult.error) {
        setError(
          signInResult.error.message ||
            t("auth.login-failed", "Failed to sign in")
        );
      } else {
        router.push("/");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("auth.login-error", "An error occurred during sign in")
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthFormWrapper
      className={className}
      formProps={{ onSubmit: handleSubmit }}
      title={t("auth.login-to-account", "Login to your account")}
      {...props}
    >
      {error ? (
        <div className="rounded-md bg-destructive/15 p-3 text-destructive text-sm">
          {error}
        </div>
      ) : null}
      <div className="grid gap-3">
        <Label htmlFor="email">{t("auth.email", "Email")}</Label>
        <Input
          id="email"
          name="email"
          onBlur={(e) => validateField("email", e.target.value)}
          onChange={(e) => {
            handleChange("email", e.target.value);
            validateField("email", e.target.value);
          }}
          placeholder={t("auth.email-placeholder", "m@example.com")}
          required
          type="email"
          value={formData.email}
        />
        {fieldErrors.email ? (
          <p className="text-destructive text-sm">{fieldErrors.email}</p>
        ) : null}
      </div>
      <div className="grid gap-3">
        <Label htmlFor="password">{t("auth.password", "Password")}</Label>
        <Input
          id="password"
          name="password"
          onBlur={(e) => validateField("password", e.target.value)}
          onChange={(e) => {
            handleChange("password", e.target.value);
            validateField("password", e.target.value);
          }}
          required
          type="password"
          value={formData.password}
        />
        {fieldErrors.password ? (
          <p className="text-destructive text-sm">{fieldErrors.password}</p>
        ) : null}
      </div>
      <Button className="w-full" disabled={isLoading} type="submit">
        {isLoading
          ? t("common.loading", "Loading...")
          : t("auth.login", "Login")}
      </Button>
      <div className="-mt-6 text-center">
        <Link
          className="text-xs underline-offset-2 hover:underline"
          href="/forgot-password"
        >
          {t("auth.forgot-password", "Forgot your password?")}
        </Link>
      </div>
      <div className="text-center text-sm">
        <span className="relative z-10 px-2 text-muted-foreground">
          {t("auth.or-continue-with", "Or continue with")}
        </span>
      </div>
      <div className="flex flex-wrap justify-center gap-2 *:w-1/4">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="outline">
              <Key className="h-4 w-4" />
              <span className="sr-only">
                {t("auth.login-with.passkey", "Login with Passkey")}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <span className="text-sm">
              {t("auth.login-with.passkey", "Login with Passkey")}
            </span>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="outline">
              <svg
                aria-label={t("auth.login-with.apple", "Login with Apple")}
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <title>{t("auth.login-with.apple", "Login with Apple")}</title>
                <path
                  d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
                  fill="currentColor"
                />
              </svg>
              <span className="sr-only">
                {t("auth.login-with.apple", "Login with Apple")}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <span className="text-sm">
              {t("auth.login-with.apple", "Login with Apple")}
            </span>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="outline">
              <svg
                aria-label={t("auth.login-with.google", "Login with Google")}
                height="1em"
                viewBox="0 0 256 262"
                width="0.98em"
                xmlns="http://www.w3.org/2000/svg"
              >
                <title>
                  {t("auth.login-with.google", "Login with Google")}
                </title>
                <path
                  d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622l38.755 30.023l2.685.268c24.659-22.774 38.875-56.282 38.875-96.027"
                  fill="#4285F4"
                />
                <path
                  d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055c-34.523 0-63.824-22.773-74.269-54.25l-1.531.13l-40.298 31.187l-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1"
                  fill="#34A853"
                />
                <path
                  d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82c0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602z"
                  fill="#FBBC05"
                />
                <path
                  d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0C79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251"
                  fill="#EB4335"
                />
              </svg>
              <span className="sr-only">
                {t("auth.login-with.google", "Login with Google")}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <span className="text-sm">
              {t("auth.login-with.google", "Login with Google")}
            </span>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="outline">
              <svg
                aria-label={t(
                  "auth.login-with.microsoft",
                  "Login with Microsoft"
                )}
                height="1em"
                viewBox="0 0 24 24"
                width="1em"
                xmlns="http://www.w3.org/2000/svg"
              >
                <title>
                  {t("auth.login-with.microsoft", "Login with Microsoft")}
                </title>
                <path
                  d="M2 3h9v9H2zm9 19H2v-9h9zM21 3v9h-9V3zm0 19h-9v-9h9z"
                  fill="currentColor"
                />
              </svg>
              <span className="sr-only">
                {t("auth.login-with.microsoft", "Login with Microsoft")}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <span className="text-sm">
              {t("auth.login-with.microsoft", "Login with Microsoft")}
            </span>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="outline">
              <svg
                aria-label={t(
                  "auth.login-with.linkedin",
                  "Login with LinkedIn"
                )}
                height="1em"
                viewBox="0 0 24 24"
                width="1em"
                xmlns="http://www.w3.org/2000/svg"
              >
                <title>
                  {t("auth.login-with.linkedin", "Login with LinkedIn")}
                </title>
                <path
                  d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93zM6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37z"
                  fill="currentColor"
                />
              </svg>
              <span className="sr-only">
                {t("auth.login-with.linkedin", "Login with LinkedIn")}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <span className="text-sm">
              {t("auth.login-with.linkedin", "Login with LinkedIn")}
            </span>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="outline">
              <svg
                aria-label={t("auth.login-with.github", "Login with Github")}
                height="1em"
                viewBox="0 0 24 24"
                width="1em"
                xmlns="http://www.w3.org/2000/svg"
              >
                <title>
                  {t("auth.login-with.github", "Login with Github")}
                </title>
                <path
                  d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5c.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34c-.46-1.16-1.11-1.47-1.11-1.47c-.91-.62.07-.6.07-.6c1 .07 1.53 1.03 1.53 1.03c.87 1.52 2.34 1.07 2.91.83c.09-.65.35-1.09.63-1.34c-2.22-.25-4.55-1.11-4.55-4.92c0-1.11.38-2 1.03-2.71c-.1-.25-.45-1.29.1-2.64c0 0 .84-.27 2.75 1.02c.79-.22 1.65-.33 2.5-.33s1.71.11 2.5.33c1.91-1.29 2.75-1.02 2.75-1.02c.55 1.35.2 2.39.1 2.64c.65.71 1.03 1.6 1.03 2.71c0 3.82-2.34 4.66-4.57 4.91c.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2"
                  fill="currentColor"
                />
              </svg>
              <span className="sr-only">
                {t("auth.login-with.github", "Login with Github")}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <span className="text-sm">
              {t("auth.login-with.github", "Login with Github")}
            </span>
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="text-center text-sm">
        {t("auth.dont-have-account", "Don't have an account?")}{" "}
        <Link className="underline underline-offset-4" href="/sign-up">
          {t("auth.sign-up", "Sign up")}
        </Link>
      </div>
    </AuthFormWrapper>
  );
}
