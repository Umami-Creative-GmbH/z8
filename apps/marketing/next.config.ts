import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	reactStrictMode: true,
	cacheComponents: true,
	partialPrefetching: true,
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "images.unsplash.com",
			},
		],
	},
};

export default nextConfig;
