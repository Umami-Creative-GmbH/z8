"use client";

import { useThemeTokens } from "@/components/theme/theme-context";

export function ThemeToggle() {
	const { dark, toggle } = useThemeTokens();

	return (
		<button
			type="button"
			onClick={toggle}
			aria-label={dark ? "Zum hellen Modus wechseln" : "Zum dunklen Modus wechseln"}
			className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition-all"
			style={{
				backgroundColor: dark ? "#1e1e1e" : "#f0f0f0",
				border: `1px solid ${dark ? "#252525" : "#e8e8e8"}`,
			}}
		>
			{/* Sun */}
			<svg
				width="16"
				height="16"
				viewBox="0 0 16 16"
				fill="none"
				style={{
					position: "absolute",
					opacity: dark ? 1 : 0,
					transform: dark ? "rotate(0deg) scale(1)" : "rotate(-90deg) scale(0.5)",
					transition: "all 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
				}}
			>
				<circle cx="8" cy="8" r="3" fill={dark ? "#e8e8e8" : "#1a1a1a"} />
				{[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
					<line
						key={angle}
						x1="8"
						y1="1.5"
						x2="8"
						y2="3"
						stroke={dark ? "#e8e8e8" : "#1a1a1a"}
						strokeWidth="1.5"
						strokeLinecap="round"
						transform={`rotate(${angle} 8 8)`}
					/>
				))}
			</svg>
			{/* Moon */}
			<svg
				width="15"
				height="15"
				viewBox="0 0 15 15"
				fill="none"
				style={{
					position: "absolute",
					opacity: dark ? 0 : 1,
					transform: dark ? "rotate(90deg) scale(0.5)" : "rotate(0deg) scale(1)",
					transition: "all 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
				}}
			>
				<path
					d="M13.5 8.5a6 6 0 0 1-8-8A6.5 6.5 0 1 0 13.5 8.5Z"
					fill={dark ? "#e8e8e8" : "#555"}
				/>
			</svg>
		</button>
	);
}
