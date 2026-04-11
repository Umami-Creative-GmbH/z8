import { MOBILE_APP_TYPE_HEADER } from "@/src/lib/auth/app-auth";
import { getWebappUrl } from "@/src/lib/config";

export class MobileApiClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MobileApiClientError";
  }
}

interface RequestOptions {
  token: string;
  path: string;
  body?: unknown;
}

async function parseErrorMessage(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { error?: string; message?: string };

    return payload.error ?? payload.message ?? `Request failed with status ${response.status}`;
  }

  const text = await response.text();

  return text || `Request failed with status ${response.status}`;
}

async function request<T>({ token, path, body }: RequestOptions): Promise<T> {
  const response = await fetch(`${getWebappUrl()}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...MOBILE_APP_TYPE_HEADER,
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    throw new MobileApiClientError(response.status, await parseErrorMessage(response));
  }

  return (await response.json()) as T;
}

export function createMobileApiClient(token: string) {
  return {
    get<T>(path: string) {
      return request<T>({ token, path });
    },
    post<T>(path: string, body: unknown) {
      return request<T>({ token, path, body });
    },
  };
}
