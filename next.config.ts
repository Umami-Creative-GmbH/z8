import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
	reactStrictMode: true,
	reactCompiler: true,
	cacheComponents: true,
	experimental: {
		viewTransition: true,
	},
};

export default withNextIntl(nextConfig);
