import type { Metadata } from "next";
import { themes } from "@/components/theme/tokens";
import "./globals.css";

export const metadata: Metadata = {
	title: "Z8",
	description: "Workforce management and time tracking",
};

/**
 * Inline script that runs before React hydrates to prevent theme flash.
 * Reads localStorage synchronously and sets CSS custom properties on <html>.
 */
const themeScript = `(function(){try{var d=localStorage.getItem("z8-theme");if(d==="dark"){document.documentElement.dataset.theme="dark";var t=${JSON.stringify(themes.dark)};for(var k in t)document.documentElement.style.setProperty("--z8-"+k,t[k])}}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<script dangerouslySetInnerHTML={{ __html: themeScript }} />
			</head>
			<body className="antialiased">
				{children}
			</body>
		</html>
	);
}
