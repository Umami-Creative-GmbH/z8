import Image from "next/image";

export function LargeBanner() {
	return (
		<section className="relative z-10 mx-8 overflow-hidden rounded-3xl lg:mx-16" style={{ height: "420px" }}>
			<Image
				src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1400&q=80&auto=format&fit=crop"
				alt="Team collaboration"
				fill
				className="object-cover"
			/>
			<div
				className="absolute inset-0 flex flex-col items-center justify-center text-center"
				style={{ background: "linear-gradient(to top, rgba(26,26,26,0.85) 0%, rgba(26,26,26,0.4) 100%)" }}
			>
				<h2
					className="mb-4 text-white"
					style={{
						fontSize: "clamp(1.8rem, 3.5vw, 2.8rem)",
						fontWeight: 700,
						letterSpacing: "-0.02em",
					}}
				>
					Gebaut f&uuml;r Teams, die es ernst meinen.
				</h2>
				<p className="max-w-md text-[15px] text-[#bbb]">
					Von 3-Personen-Startups bis zu DAX-Konzernen &mdash; Z8 skaliert mit Ihren Anforderungen.
				</p>
			</div>
		</section>
	);
}
