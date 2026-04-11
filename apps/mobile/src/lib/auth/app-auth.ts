import { getWebappUrl } from "@/src/lib/config";

export const MOBILE_APP_TYPE_HEADER = {
  "X-Z8-App-Type": "mobile",
} as const;

export interface AppCallbackResult {
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

export function extractAppCallbackResult(callbackUrl: string): AppCallbackResult {
  const searchParams = new URL(callbackUrl).searchParams;

  return {
    error: searchParams.get("error"),
    token: searchParams.get("token"),
  };
}
