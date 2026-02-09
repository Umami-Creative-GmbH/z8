import { v } from "@/components/theme/tokens";
import { testimonials } from "./data";

export function Testimonials() {
	return (
		<section className="relative z-10 px-8 py-28 lg:px-16">
			<div className="mx-auto max-w-6xl">
				<div className="mb-16 text-center">
					<span className="mb-3 block text-[12px] font-bold uppercase tracking-[0.15em]" style={{ color: v("textTertiary") }}>
						Kundenstimmen
					</span>
					<h2 className="text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.02em]">
						Was unsere Kunden sagen.
					</h2>
				</div>
				<div className="grid gap-6 md:grid-cols-3">
					{testimonials.map((testimonial, i) => (
						<div
							key={i}
							className="group rounded-2xl p-8 transition-all hover:-translate-y-1 hover:shadow-lg"
							style={{ border: `1px solid ${v("border")}`, backgroundColor: v("cardBg"), transition: "background-color 0.4s ease, border-color 0.4s ease" }}
						>
							<div className="mb-5 font-serif text-[48px] leading-none" style={{ color: v("quoteColor") }}>&ldquo;</div>
							<p className="mb-8 text-[15px] leading-[1.8]" style={{ color: v("textFaint") }}>
								{testimonial.quote}
							</p>
							<div className="flex items-center gap-3">
								<div
									className="flex h-10 w-10 items-center justify-center rounded-full text-[12px] font-bold"
									style={{ backgroundColor: v("surface"), color: v("surfaceText") }}
								>
									{testimonial.avatar}
								</div>
								<div>
									<div className="text-[14px] font-semibold">{testimonial.name}</div>
									<div className="text-[12px]" style={{ color: v("textTertiary") }}>{testimonial.role}</div>
								</div>
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
