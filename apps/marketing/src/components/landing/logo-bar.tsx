import { v } from "@/components/theme/tokens";
import { logos } from "./data";

export function LogoBar() {
	return (
		<section className="relative z-10 px-8 py-16 lg:px-16" style={{ borderTop: `1px solid ${v("border")}`, transition: "border-color 0.4s ease" }}>
			<div className="flex flex-wrap items-center justify-center gap-12">
				<span className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: v("trustedLabel") }}>Vertraut von</span>
				{logos.map((logo, i) => (
					<span key={i} className="text-[18px] font-bold" style={{ letterSpacing: "-0.01em", color: v("logoColor") }}>
						{logo}
					</span>
				))}
			</div>
		</section>
	);
}
