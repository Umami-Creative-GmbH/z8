"use client";

import { useThemeTokens } from "@/components/theme/theme-context";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { navItems } from "./data";

export function Header() {
	const { t, mounted } = useThemeTokens();

	return (
		<header
			className="relative z-20 flex items-center justify-between px-8 py-5 lg:px-16"
			style={{ transition: "background-color 0.4s ease" }}
		>
			<div className="flex items-center gap-8">
				<span className="text-[22px] font-black tracking-[-0.02em]">{mounted ? "Z8" : "Z8"}</span>
				<nav className="hidden items-center gap-6 text-[14px] md:flex" style={{ color: t.textSecondary }}>
					{navItems.map((item) => (
						<a
							key={item.href}
							href={item.href}
							className="transition-colors"
							style={{ color: t.textSecondary }}
							onMouseOver={(e) => e.currentTarget.style.color = t.navHover}
							onMouseOut={(e) => e.currentTarget.style.color = t.textSecondary}
						>
							{item.label}
						</a>
					))}
				</nav>
			</div>
			<div className="flex items-center gap-3">
				<a href="#contact" className="text-[14px] transition-colors" style={{ color: t.textSecondary }}>
					Anmelden
				</a>
				<a
					href="#contact"
					className="rounded-lg px-5 py-2.5 text-[14px] font-semibold transition-all hover:opacity-90"
					style={{ backgroundColor: t.surface, color: t.surfaceText, transition: "background-color 0.4s ease" }}
				>
					Kostenlos starten
				</a>
				<ThemeToggle />
			</div>
		</header>
	);
}
