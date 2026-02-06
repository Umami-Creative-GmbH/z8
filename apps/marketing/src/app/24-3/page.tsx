import Image from "next/image";
import Link from "next/link";

export default function Design24_3() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Freight Display', 'Canela', 'Noto Serif Display', Georgia, serif",
				backgroundColor: "#f7f5f2",
				color: "#1c1a18",
			}}
		>
			{/* Warm platinum ambient */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{
					background:
						"radial-gradient(ellipse 70% 50% at 70% 20%, rgba(200,195,185,0.12) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 30% 80%, rgba(190,185,175,0.08) 0%, transparent 50%)",
				}}
			/>

			{/* Header */}
			<header className="relative z-10 flex items-center justify-between px-10 py-8 lg:px-20">
				<div className="flex items-baseline gap-5">
					<span className="text-[26px] font-light tracking-[0.08em]" style={{ color: "#8a8580" }}>
						Z8
					</span>
					<span className="text-[9px] uppercase tracking-[0.5em] text-[#b8b0a8]">
						Platin
					</span>
				</div>
				<nav className="hidden items-center gap-12 text-[10px] uppercase tracking-[0.3em] text-[#b8b0a8] md:flex">
					<a href="#features" className="transition-colors hover:text-[#1c1a18]">Funktionen</a>
					<a href="#philosophy" className="transition-colors hover:text-[#1c1a18]">Philosophie</a>
					<a href="#contact" className="transition-colors hover:text-[#1c1a18]">Kontakt</a>
				</nav>
				<a
					href="#contact"
					className="text-[9px] uppercase tracking-[0.3em] text-[#8a8580] transition-colors hover:text-[#1c1a18]"
					style={{ borderBottom: "1px solid #8a858040", paddingBottom: "3px" }}
				>
					Anfragen
				</a>
			</header>

			<div className="relative z-10 mx-10 h-px lg:mx-20" style={{ backgroundColor: "#1c1a1808" }} />

			{/* Hero — editorial two-column */}
			<section className="relative z-10 px-10 pb-24 pt-24 lg:px-20">
				<div className="mx-auto max-w-6xl">
					<div className="grid gap-16 lg:grid-cols-12">
						{/* Left: large image */}
						<div className="animate-scale-in lg:col-span-5" style={{ animationDelay: "0.2s" }}>
							<div className="relative h-[65vh] overflow-hidden">
								<Image
									src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=900&q=80&auto=format&fit=crop"
									alt=""
									fill
									className="object-cover"
									style={{ filter: "saturate(0.2) brightness(1.0) contrast(0.95) sepia(0.08)" }}
									priority
								/>
							</div>
							<p className="mt-4 text-[9px] uppercase tracking-[0.4em] text-[#c0b8b0]">
								Fotografie &mdash; Editorial
							</p>
						</div>

						{/* Right: text */}
						<div className="flex flex-col justify-center lg:col-span-7 lg:pl-8">
							<p
								className="animate-fade-up mb-8 text-[10px] uppercase tracking-[0.6em] text-[#b8b0a8]"
								style={{ animationDelay: "0.1s" }}
							>
								Haute Pr&auml;zision
							</p>
							<h1
								className="animate-fade-up"
								style={{
									fontSize: "clamp(3rem, 7vw, 5.5rem)",
									fontWeight: 300,
									lineHeight: 1.05,
									letterSpacing: "-0.02em",
									animationDelay: "0.2s",
								}}
							>
								Zeiterfassung,
								<br />
								veredelt in{" "}
								<em style={{ color: "#8a8580" }}>Platin</em>.
							</h1>
							<p
								className="animate-fade-up mt-10 max-w-md text-[15px] leading-[2.2] text-[#8a8580]"
								style={{
									fontFamily: "'Gill Sans', 'Optima', 'Century Gothic', sans-serif",
									animationDelay: "0.4s",
								}}
							>
								Nicht einfach verchromt &mdash; durchgehend edel. Z8 behandelt Ihre
								Arbeitszeiten mit der Sorgfalt, die wertvolle Dinge verdienen.
								GoBD-konform, ma&szlig;geschneidert, exquisit.
							</p>
							<div
								className="animate-fade-up mt-12 flex items-center gap-8"
								style={{ animationDelay: "0.5s" }}
							>
								<a
									href="#contact"
									className="px-8 py-3.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white transition-all hover:bg-[#3a3530]"
									style={{ backgroundColor: "#1c1a18" }}
								>
									Demo vereinbaren
								</a>
								<a href="#features" className="text-[10px] tracking-[0.2em] text-[#b8b0a8] transition-colors hover:text-[#1c1a18]">
									Entdecken &darr;
								</a>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Platinum rule */}
			<div className="relative z-10 mx-10 flex items-center gap-6 lg:mx-20">
				<div className="h-px flex-1" style={{ background: "linear-gradient(90deg, #1c1a1808, #1c1a1804)" }} />
				<span className="text-[8px] uppercase tracking-[0.6em] text-[#c8c0b8]">Pt</span>
				<div className="h-px flex-1" style={{ background: "linear-gradient(90deg, #1c1a1804, #1c1a1808)" }} />
			</div>

			{/* Features — editorial list */}
			<section id="features" className="relative z-10 px-10 py-28 lg:px-20">
				<div className="mx-auto max-w-6xl">
					<div className="mb-20 grid lg:grid-cols-12">
						<div className="lg:col-span-4">
							<span className="mb-3 block text-[9px] uppercase tracking-[0.5em] text-[#b8b0a8]">
								Funktionen
							</span>
							<h2 className="text-[clamp(2rem,3.5vw,3rem)] font-light tracking-tight">
								Sechs Karat.
							</h2>
						</div>
					</div>

					<div className="grid gap-12 md:grid-cols-2 lg:grid-cols-3">
						{[
							{ title: "Stempeluhr", desc: "Web, Desktop, Mobile. Echtzeit-Synchronisation \u00fcber alle Ger\u00e4te hinweg." },
							{ title: "GoBD-konform", desc: "Revisionssichere Eintr\u00e4ge. Unver\u00e4nderbar, l\u00fcckenlos dokumentiert." },
							{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Nahtloser, automatisierter Transfer." },
							{ title: "Multi-Tenant", desc: "Mandantenf\u00e4hig. Organisationen isoliert und sicher verwaltet." },
							{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Nahtlos in Ihre Infrastruktur integriert." },
							{ title: "Echtzeit-Analyse", desc: "\u00dcberstunden, Trends, Dashboards. Sofort verf\u00fcgbar, stets aktuell." },
						].map((f, i) => (
							<div key={i} className="group">
								<div className="mb-4 flex items-center gap-4">
									<span className="text-[22px] font-light text-[#c8c0b8]" style={{ fontFamily: "'Freight Display', Georgia, serif" }}>
										{String(i + 1).padStart(2, "0")}
									</span>
									<div className="h-px flex-1 transition-all duration-500 group-hover:bg-[#1c1a1810]" style={{ backgroundColor: "#1c1a1806" }} />
								</div>
								<h3 className="mb-2 text-[18px] font-light tracking-tight transition-colors group-hover:text-[#1c1a18]" style={{ color: "#5a5550" }}>
									{f.title}
								</h3>
								<p className="text-[12px] leading-[1.9] text-[#a8a098]" style={{ fontFamily: "'Gill Sans', 'Optima', 'Century Gothic', sans-serif" }}>
									{f.desc}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Image spread */}
			<section className="relative z-10 mx-10 mb-24 lg:mx-20">
				<div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-3">
					<div className="relative h-64 overflow-hidden md:col-span-2">
						<Image src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=900&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.15) brightness(1.0) contrast(0.95) sepia(0.05)" }} />
					</div>
					<div className="relative h-64 overflow-hidden">
						<Image src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=500&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.15) brightness(1.0) contrast(0.95) sepia(0.05)" }} />
					</div>
				</div>
			</section>

			{/* Philosophy */}
			<section id="philosophy" className="relative z-10 px-10 py-32 lg:px-20" style={{ backgroundColor: "#1c1a18", color: "#e8e0d8" }}>
				<div className="mx-auto max-w-3xl text-center">
					<div className="mb-8 flex items-center justify-center gap-4">
						<div className="h-px w-16" style={{ background: "linear-gradient(90deg, transparent, #e8e0d820)" }} />
						<span className="text-[8px] uppercase tracking-[0.5em] text-[#e8e0d830]">Pt 78</span>
						<div className="h-px w-16" style={{ background: "linear-gradient(90deg, #e8e0d820, transparent)" }} />
					</div>
					<blockquote
						className="text-[clamp(1.5rem,3.5vw,2.8rem)] font-light italic leading-[1.5] tracking-[-0.01em]"
						style={{ color: "#a8a098" }}
					>
						Wahre Eleganz braucht keine Erkl&auml;rung &mdash;
						sie spricht durch Pr&auml;zision.
					</blockquote>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-10 py-28 lg:px-20">
				<div className="mx-auto max-w-6xl grid gap-16 lg:grid-cols-2">
					<div>
						<h2 className="text-[clamp(2rem,5vw,4rem)] font-light leading-[1.1] tracking-tight">
							Bereit f&uuml;r
							<br />
							<em style={{ color: "#8a8580" }}>Veredelung</em>?
						</h2>
					</div>
					<div className="flex flex-col justify-end">
						<p className="mb-8 text-[14px] leading-[2] text-[#a8a098]" style={{ fontFamily: "'Gill Sans', 'Optima', 'Century Gothic', sans-serif" }}>
							Erleben Sie Z8 in seiner edelsten Ausf&uuml;hrung. Pers&ouml;nlich, exklusiv.
						</p>
						<div className="flex items-center gap-6">
							<a
								href="mailto:hello@z8.app"
								className="px-8 py-3.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white transition-all hover:bg-[#3a3530]"
								style={{ backgroundColor: "#1c1a18" }}
							>
								Demo vereinbaren
							</a>
							<a href="mailto:hello@z8.app" className="text-[10px] tracking-[0.15em] text-[#b8b0a8] transition-colors hover:text-[#1c1a18]">
								hello@z8.app
							</a>
						</div>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-10 py-8 lg:px-20" style={{ borderTop: "1px solid #1c1a1806" }}>
				<div className="flex items-center justify-between text-[9px] uppercase tracking-[0.3em] text-[#c8c0b8]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#1c1a18]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
