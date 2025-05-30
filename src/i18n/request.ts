import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = await requestLocale;
  return {
    locale: locale || "en",
    // do this to make next-intl not emmit any warnings
    messages: { locale: locale || "en" },
  };
});
