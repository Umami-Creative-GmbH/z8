import type { Metadata } from "next";
import "./globals.css";
import dynamic from "next/dynamic";

const FloatingNav = dynamic(() =>
	import("./floating-nav").then((m) => m.FloatingNav),
);

export const metadata: Metadata = {
	title: "Z8",
	description: "Workforce management and time tracking",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body className="antialiased">
				{children}
				<FloatingNav />
			</body>
		</html>
	);
}
