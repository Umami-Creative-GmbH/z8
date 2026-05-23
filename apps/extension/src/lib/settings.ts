const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function normalizeWebappUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function validateWebappUrl(url: string): boolean {
  try {
    const parsed = new URL(normalizeWebappUrl(url));
    if (parsed.username || parsed.password) {
      return false;
    }

    if (parsed.protocol === "https:") {
      return true;
    }

    return parsed.protocol === "http:" && LOCAL_HTTP_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function getWebappOriginPattern(url: string): string | null {
  if (!validateWebappUrl(url)) {
    return null;
  }

  const parsed = new URL(normalizeWebappUrl(url));
  return `${parsed.origin}/*`;
}
