import { getWebappUrl } from "@/src/lib/config";

export const MOBILE_APP_TYPE_HEADER = {
  "X-Z8-App-Type": "mobile",
} as const;

export interface AppCallbackResult {
  code: string | null;
  token: string | null;
  error: string | null;
}

export function buildAppLoginUrl(
  webappUrl = getWebappUrl(),
  redirectUri: string,
) {
  const loginUrl = new URL("/api/auth/app-login", `${webappUrl}/`);

  loginUrl.searchParams.set("app", "mobile");
  loginUrl.searchParams.set("redirect", redirectUri);

  return loginUrl.toString();
}

export function extractSessionTokenFromCallback(callbackUrl: string) {
  return extractAppCallbackResult(callbackUrl).token;
}

export async function exchangeAppCallbackCode(
  code: string,
  app: "mobile" | "desktop",
) {
  const response = await fetch(`${getWebappUrl()}/api/auth/app-exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Z8-App-Type": app,
    },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    throw new Error("Failed to exchange app auth code");
  }

  const payload = (await response.json()) as { token: string };
  return payload.token;
}

export function extractAppCallbackResult(callbackUrl: string): AppCallbackResult {
  const searchParams = new URL(callbackUrl).searchParams;

  return {
    code: searchParams.get("code"),
    error: searchParams.get("error"),
    token: searchParams.get("token"),
  };
}
