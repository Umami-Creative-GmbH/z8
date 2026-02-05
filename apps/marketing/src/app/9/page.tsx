import Image from "next/image";
import Link from "next/link";

export default function Design9() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Optima', 'Candara', 'Segoe UI', sans-serif",
				backgroundColor: "#f7f5f0",
				color: "#2d2d28",
			}}
		>
			{/* Header */}
			<header className="relative z-10 flex items-center justify-between px-10 py-8 lg:px-20">
				<div className="flex items-baseline gap-3">
					<span className="text-2xl font-bold tracking-[-0.02em]">Z8</span>
					<span
						className="text-[14px] italic tracking-wide"
						style={{
							fontFamily: "'Georgia', 'Times New Roman', serif",
							color: "#7c8c6c",
						}}
					>
						Atelier
					</span>
				</div>
				<nav className="hidden items-center gap-10 text-[13px] tracking-wide text-[#9a9590] md:flex">
					<a href="#work" className="transition-colors hover:text-[#2d2d28]">
						Arbeit
					</a>
					<a href="#process" className="transition-colors hover:text-[#2d2d28]">
						Prozess
					</a>
					<a href="#contact" className="transition-colors hover:text-[#2d2d28]">
						Kontakt
					</a>
				</nav>
				<a
					href="#contact"
					className="px-6 py-2.5 text-[12px] font-semibold tracking-wide transition-all hover:bg-[#2d2d28] hover:text-[#f7f5f0]"
					style={{
						border: "1.5px solid #2d2d28",
					}}
				>
					Gespr&auml;ch f&uuml;hren
				</a>
			</header>

			{/* Hero - asymmetric with overlapping image */}
			<section className="relative z-10 px-10 pb-32 pt-16 lg:px-20">
				<div className="grid items-start gap-12 lg:grid-cols-12">
					{/* Left - text */}
					<div className="lg:col-span-5 lg:pt-8">
						<p
							className="animate-fade-up mb-8 text-[11px] font-semibold uppercase tracking-[0.5em]"
							style={{ color: "#7c8c6c", animationDelay: "0.1s" }}
						>
							Zeitwirtschaft
						</p>
						<h1
							className="animate-fade-up text-[clamp(2.8rem,6vw,4.8rem)] leading-[1.08] tracking-[-0.02em]"
							style={{ animationDelay: "0.2s" }}
						>
							Sorgf&auml;ltig
							<br />
							<em
								style={{
									fontFamily: "'Georgia', serif",
									fontStyle: "italic",
									color: "#7c8c6c",
								}}
							>
								gestaltet
							</em>
							, nicht
							<br />
							nur gebaut.
						</h1>

						<div
							className="animate-fade-up mt-12"
							style={{ animationDelay: "0.4s" }}
						>
							<div className="mb-6 h-px w-12" style={{ backgroundColor: "#7c8c6c60" }} />
							<p className="max-w-sm text-[15px] leading-[1.9] text-[#8a8580]">
								Z8 ist Zeiterfassung, die mit der gleichen Sorgfalt entwickelt wurde, die Sie
								in Ihre eigene Arbeit stecken. GoBD-konform und intuitiv.
							</p>
						</div>

						<div
							className="animate-fade-up mt-10 flex gap-4"
							style={{ animationDelay: "0.5s" }}
						>
							<a
								href="#contact"
								className="px-7 py-3.5 text-[12px] font-semibold text-[#f7f5f0] transition-opacity hover:opacity-90"
								style={{ backgroundColor: "#2d2d28" }}
							>
								Demo anfragen
							</a>
							<a
								href="#work"
								className="px-7 py-3.5 text-[12px] font-semibold text-[#9a9590] transition-colors hover:text-[#2d2d28]"
							>
								Entdecken &darr;
							</a>
						</div>
					</div>

					{/* Right - overlapping images */}
					<div
						className="animate-scale-in relative lg:col-span-7"
						style={{ animationDelay: "0.3s" }}
					>
						<div className="relative">
							{/* Main image */}
							<div className="relative h-[55vh] overflow-hidden rounded-sm">
								<Image
									src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80&auto=format&fit=crop"
									alt="Workspace"
									fill
									className="object-cover"
									priority
								/>
							</div>
							{/* Overlapping smaller image */}
							<div
								className="absolute -bottom-10 -left-10 h-48 w-64 overflow-hidden rounded-sm shadow-xl"
								style={{ border: "4px solid #f7f5f0" }}
							>
								<Image
									src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=500&q=80&auto=format&fit=crop"
									alt="Detail"
									fill
									className="object-cover"
								/>
							</div>
							{/* Sage accent block */}
							<div
								className="absolute -right-4 -top-4 flex h-20 w-20 items-center justify-center"
								style={{ backgroundColor: "#7c8c6c" }}
							>
								<span className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/80">
									Z8
								</span>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Horizontal divider with label */}
			<section className="relative z-10 px-10 py-6 lg:px-20">
				<div className="flex items-center gap-6">
					<div className="h-px flex-1" style={{ backgroundColor: "#2d2d2815" }} />
					<span
						className="text-[10px] italic tracking-[0.3em]"
						style={{
							fontFamily: "'Georgia', serif",
							color: "#7c8c6c",
						}}
					>
						Was wir tun
					</span>
					<div className="h-px flex-1" style={{ backgroundColor: "#2d2d2815" }} />
				</div>
			</section>

			{/* Features - staggered editorial layout */}
			<section id="work" className="relative z-10 px-10 py-20 lg:px-20">
				<div className="grid gap-20 lg:grid-cols-12">
					{/* Left column */}
					<div className="flex flex-col gap-16 lg:col-span-5">
						{[
							{
								title: "Stempeluhr",
								desc: "Web, Desktop, Mobile, Browser-Extension. Ein einziger Klick \u2014 sofort synchron auf allen Ger\u00e4ten.",
							},
							{
								title: "Lohn-Schnittstellen",
								desc: "DATEV, Lexware, Personio, SAP. Nahtloser Export ohne Medienbruch oder Handarbeit.",
							},
							{
								title: "Kalender-Sync",
								desc: "Google Calendar, Microsoft 365. Arbeitszeiten und Termine automatisch abgeglichen.",
							},
						].map((f, i) => (
							<div key={i} className="group">
								<div
									className="mb-4 h-px w-8 transition-all duration-500 group-hover:w-16"
									style={{ backgroundColor: "#7c8c6c" }}
								/>
								<h3 className="mb-3 text-xl tracking-tight">{f.title}</h3>
								<p className="text-[14px] leading-[1.85] text-[#8a8580]">{f.desc}</p>
							</div>
						))}
					</div>

					{/* Center image */}
					<div className="hidden lg:col-span-2 lg:flex lg:items-center lg:justify-center">
						<div className="relative h-[45vh] w-full overflow-hidden rounded-sm">
							<Image
								src="https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=400&q=80&auto=format&fit=crop"
								alt=""
								fill
								className="object-cover"
							/>
							<div
								className="absolute inset-0"
								style={{
									background:
										"linear-gradient(180deg, rgba(247,245,240,0.2) 0%, rgba(247,245,240,0.4) 100%)",
								}}
							/>
						</div>
					</div>

					{/* Right column - offset down */}
					<div className="flex flex-col gap-16 lg:col-span-5 lg:pt-24">
						{[
							{
								title: "GoBD-Konformit\u00e4t",
								desc: "Revisionssichere Zeiteintr\u00e4ge. Unver\u00e4nderbar. L\u00fcckenlos nachvollziehbar f\u00fcr jede Pr\u00fcfung.",
							},
							{
								title: "Team-\u00dcbersicht",
								desc: "Anwesenheit, \u00dcberstunden, Urlaubssalden. Alles auf einen Blick, klar strukturiert.",
							},
							{
								title: "Enterprise-SSO",
								desc: "SAML, OpenID Connect, SCIM. Nahtlose Integration in Ihre Identity-Infrastruktur.",
							},
						].map((f, i) => (
							<div key={i} className="group">
								<div
									className="mb-4 h-px w-8 transition-all duration-500 group-hover:w-16"
									style={{ backgroundColor: "#7c8c6c" }}
								/>
								<h3 className="mb-3 text-xl tracking-tight">{f.title}</h3>
								<p className="text-[14px] leading-[1.85] text-[#8a8580]">{f.desc}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Process / philosophy - image with text overlay */}
			<section id="process" className="relative z-10 mx-10 mb-20 lg:mx-20">
				<div className="relative overflow-hidden rounded-sm">
					<div className="relative h-[50vh]">
						<Image
							src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1600&q=80&auto=format&fit=crop"
							alt="Team working together"
							fill
							className="object-cover"
						/>
						<div
							className="absolute inset-0"
							style={{
								background:
									"linear-gradient(135deg, rgba(45,45,40,0.85) 0%, rgba(45,45,40,0.4) 100%)",
							}}
						/>
					</div>
					<div className="absolute inset-0 flex items-center px-12 lg:px-20">
						<div className="max-w-lg">
							<span
								className="mb-4 block text-[10px] uppercase tracking-[0.5em]"
								style={{ color: "#7c8c6c" }}
							>
								Unser Prozess
							</span>
							<h2 className="mb-6 text-[clamp(1.8rem,3vw,2.8rem)] leading-[1.2] tracking-tight text-[#f7f5f0]">
								Wir glauben, dass gute Werkzeuge die Arbeit unsichtbar unterst&uuml;tzen
								&mdash; nie behindern.
							</h2>
							<p className="text-[14px] leading-[1.85] text-[#f7f5f0]/60">
								Jede Entscheidung in Z8 wurde mit Absicht getroffen. Kein Feature ohne
								Grund, kein Pixel ohne Zweck.
							</p>
						</div>
					</div>
				</div>
			</section>

			{/* Image triptych */}
			<section className="relative z-10 px-10 pb-20 lg:px-20">
				<div className="grid gap-3 md:grid-cols-3">
					<div className="relative h-56 overflow-hidden rounded-sm">
						<Image
							src="https://images.unsplash.com/photo-1497215842964-222b430dc094?w=500&q=80&auto=format&fit=crop"
							alt="Detail"
							fill
							className="object-cover transition-transform duration-700 hover:scale-105"
						/>
					</div>
					<div className="relative h-56 overflow-hidden rounded-sm">
						<Image
							src="https://images.unsplash.com/photo-1557804506-669a67965ba0?w=500&q=80&auto=format&fit=crop"
							alt="Meeting"
							fill
							className="object-cover transition-transform duration-700 hover:scale-105"
						/>
					</div>
					<div className="relative h-56 overflow-hidden rounded-sm">
						<Image
							src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=500&q=80&auto=format&fit=crop"
							alt="Analytics"
							fill
							className="object-cover transition-transform duration-700 hover:scale-105"
						/>
					</div>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-10 py-24 lg:px-20">
				<div className="flex items-center gap-6 mb-16">
					<div className="h-px flex-1" style={{ backgroundColor: "#2d2d2815" }} />
					<span
						className="text-[10px] italic tracking-[0.3em]"
						style={{
							fontFamily: "'Georgia', serif",
							color: "#7c8c6c",
						}}
					>
						In Kontakt treten
					</span>
					<div className="h-px flex-1" style={{ backgroundColor: "#2d2d2815" }} />
				</div>

				<div className="grid items-start gap-16 lg:grid-cols-2">
					<div>
						<h2 className="mb-6 text-[clamp(2rem,4vw,3.5rem)] leading-[1.1] tracking-[-0.02em]">
							Lassen Sie uns
							<br />
							<em
								style={{
									fontFamily: "'Georgia', serif",
									fontStyle: "italic",
									color: "#7c8c6c",
								}}
							>
								gemeinsam
							</em>{" "}
							anfangen.
						</h2>
						<p className="max-w-md text-[15px] leading-[1.85] text-[#8a8580]">
							Wir stellen Ihnen Z8 pers&ouml;nlich vor. In Ihrem Tempo, mit Ihren
							Fragen. Ohne Druck, ohne Verpflichtung.
						</p>
					</div>
					<div className="flex flex-col items-start gap-6 lg:items-end lg:pt-4">
						<a
							href="mailto:hello@z8.app"
							className="px-8 py-4 text-[12px] font-semibold text-[#f7f5f0] transition-opacity hover:opacity-90"
							style={{ backgroundColor: "#2d2d28" }}
						>
							Demo vereinbaren
						</a>
						<a
							href="mailto:hello@z8.app"
							className="text-[14px] tracking-wide text-[#9a9590] transition-colors hover:text-[#2d2d28]"
						>
							hello@z8.app &rarr;
						</a>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-10 py-8 lg:px-20" style={{ borderTop: "1px solid #2d2d2810" }}>
				<div className="flex items-center justify-between text-[11px] text-[#b5b0a5]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#7c8c6c]">
						&larr; Alle Designs
					</Link>
				</div>
			</footer>
		</div>
	);
}
