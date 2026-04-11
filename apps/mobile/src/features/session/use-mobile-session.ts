import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  exchangeAppCallbackCode,
  extractAppCallbackResult,
  MOBILE_APP_TYPE_HEADER,
} from "@/src/lib/auth/app-auth";
import {
  clearStoredSessionToken,
  getStoredSessionToken,
  setStoredSessionToken,
} from "@/src/lib/auth/session-store";
import { getWebappUrl } from "@/src/lib/config";

export const MOBILE_SESSION_QUERY_KEY = ["mobile-session"] as const;

export interface MobileSessionOrganization {
  id: string;
  name: string;
  slug: string;
  hasEmployeeRecord: boolean;
}

export interface MobileSessionPayload {
  user: {
    id: string;
    name: string;
    email: string;
  };
  activeOrganizationId: string | null;
  organizations: MobileSessionOrganization[];
}

export interface MobileSession extends MobileSessionPayload {
  token: string;
}

export type MobileSessionCallbackState =
  | { status: "signed-in"; error: null }
  | { status: "error"; error: string }
  | { status: "ignored"; error: null };

async function fetchMobileSession(): Promise<MobileSession | null> {
  const token = await getStoredSessionToken();

  if (!token) {
    return null;
  }

  const response = await fetch(`${getWebappUrl()}/api/mobile/session`, {
    headers: {
      ...MOBILE_APP_TYPE_HEADER,
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) {
    await clearStoredSessionToken();
    return null;
  }

  if (!response.ok) {
    throw new Error("Failed to load mobile session");
  }

  const session = (await response.json()) as MobileSessionPayload;

  return {
    ...session,
    token,
  };
}

export function createMobileSessionController(queryClient: ReturnType<typeof useQueryClient>) {
  return {
    async handleCallbackUrl(url: string) {
      const { error, code, token } = extractAppCallbackResult(url);

		if (error) {
			return { error, status: "error" } satisfies MobileSessionCallbackState;
		}

		let resolvedToken = token;
		if (code) {
			try {
				resolvedToken = await exchangeAppCallbackCode(code, "mobile");
			} catch {
				return { error: "code_exchange_failed", status: "error" } satisfies MobileSessionCallbackState;
			}
		}

		if (!resolvedToken) {
			return { error: null, status: "ignored" } satisfies MobileSessionCallbackState;
      }

      await setStoredSessionToken(resolvedToken);
      await queryClient.invalidateQueries({ queryKey: MOBILE_SESSION_QUERY_KEY });

      return { error: null, status: "signed-in" } satisfies MobileSessionCallbackState;
    },
    async signOut() {
      await clearStoredSessionToken();
      queryClient.clear();
    },
  };
}

export function useMobileSession() {
  return useQuery({
    queryKey: MOBILE_SESSION_QUERY_KEY,
    queryFn: fetchMobileSession,
  });
}

export function useMobileSessionController() {
  const queryClient = useQueryClient();

  return createMobileSessionController(queryClient);
}
