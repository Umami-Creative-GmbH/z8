const TRAILING_SLASH_PATTERN = /\/+$/;

export function getWebappUrl() {
  const webappUrl = process.env.EXPO_PUBLIC_WEBAPP_URL?.trim();

  if (!webappUrl) {
    throw new Error("EXPO_PUBLIC_WEBAPP_URL is required");
  }

  return webappUrl.replace(TRAILING_SLASH_PATTERN, "");
}
