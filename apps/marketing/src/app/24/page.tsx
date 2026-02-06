import Image from "next/image";
import Link from "next/link";

export default function Design24() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'SF Pro Display', 'Helvetica Neue', 'Arial', sans-serif",
				backgroundColor: "#111114",
				color: "#e0e0e8",
			}}
		>
			{/* Chrome reflection background */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{
					background:
						"conic-gradient(from 180deg at 50% 60%, rgba(180,180,200,0.03) 0deg, rgba(220,220,240,0.06) 60deg, rgba(160,160,180,0.02) 120deg, rgba(200,200,220,0.04) 180deg, rgba(170,170,190,0.03) 240deg, rgba(210,210,230,0.05) 300deg, rgba(180,180,200,0.03) 360deg)",
				}}
			/>

			{/* Header */}
			<header className="relative z-10 flex items-center justify-between px-8 py-7 lg:px-16">
				<div className="flex items-center gap-4">
					<span
						className="text-[24px] font-bold tracking-[-0.02em]"
						style={{
							background: "linear-gradient(135deg, #c0c0d0, #ffffff, #a0a0b0, #e0e0f0)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						Z8
					</span>
					<div className="h-4 w-px" style={{ background: "linear-gradient(180deg, transparent, #50506020, transparent)" }} />
					<span className="text-[10px] uppercase tracking-[0.4em] text-[#505060]">
						Zeiterfassung
					</span>
				</div>
				<nav className="hidden items-center gap-10 text-[11px] tracking-[0.1em] text-[#505060] md:flex">
					<a href="#features" className="transition-colors hover:text-[#c0c0d0]">Funktionen</a>
					<a href="#reflect" className="transition-colors hover:text-[#c0c0d0]">Reflexion</a>
					<a href="#contact" className="transition-colors hover:text-[#c0c0d0]">Kontakt</a>
				</nav>
				<a
					href="#contact"
					className="px-6 py-2.5 text-[10px] font-semibold uppercase tracking-[0.15em] transition-all hover:shadow-[0_0_20px_rgba(200,200,230,0.15)]"
					style={{
						background: "linear-gradient(135deg, #3a3a48, #2a2a34)",
						border: "1px solid rgba(200,200,230,0.1)",
						color: "#c0c0d0",
					}}
				>
					Anfragen
				</a>
			</header>

			{/* Chrome line */}
			<div className="relative z-10 mx-8 lg:mx-16">
				<div
					className="h-px"
					style={{
						background: "linear-gradient(90deg, transparent, rgba(200,200,230,0.15), rgba(255,255,255,0.3), rgba(200,200,230,0.15), transparent)",
					}}
				/>
			</div>

			{/* Hero */}
			<section className="relative z-10 px-8 pb-24 pt-32 lg:px-16">
				<div className="mx-auto max-w-5xl text-center">
					<p
						className="animate-fade-up mb-10 text-[10px] font-medium uppercase tracking-[0.6em]"
						style={{ color: "#505060", animationDelay: "0.1s" }}
					>
						Poliert bis zur Perfektion
					</p>

					<h1
						className="animate-fade-up"
						style={{
							fontSize: "clamp(3.5rem, 10vw, 8rem)",
							fontWeight: 700,
							lineHeight: 0.95,
							letterSpacing: "-0.04em",
							animationDelay: "0.2s",
							background: "linear-gradient(180deg, #ffffff 0%, #a0a0b8 40%, #606070 70%, #404050 100%)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						Fl&uuml;ssiges
						<br />
						Chrom.
					</h1>

					<p
						className="animate-fade-up mx-auto mt-10 max-w-md text-[15px] leading-[1.9] text-[#606070]"
						style={{ animationDelay: "0.4s" }}
					>
						Zeiterfassung, geformt wie fl&uuml;ssiges Metall: passt sich an,
						spiegelt Ihre Prozesse und h&auml;rtet zu unzerst&ouml;rbarer Pr&auml;zision.
					</p>

					<div className="animate-fade-up mt-12 flex items-center justify-center gap-6" style={{ animationDelay: "0.5s" }}>
						<a
							href="#contact"
							className="group relative overflow-hidden px-10 py-4 text-[11px] font-semibold uppercase tracking-[0.15em] transition-all"
							style={{
								background: "linear-gradient(135deg, #c0c0d0, #e0e0f0, #a0a0b8)",
								color: "#111114",
							}}
						>
							<span className="relative z-10">Demo anfragen</span>
							<div
								className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
								style={{ background: "linear-gradient(135deg, #e0e0f0, #ffffff, #c0c0d0)" }}
							/>
						</a>
						<a href="#features" className="text-[11px] tracking-[0.15em] text-[#505060] transition-colors hover:text-[#c0c0d0]">
							Erkunden &darr;
						</a>
					</div>
				</div>
			</section>

			{/* Hero image - mercury pool */}
			<section className="relative z-10 mx-8 mb-32 lg:mx-16">
				<div className="animate-scale-in mx-auto max-w-4xl" style={{ animationDelay: "0.6s" }}>
					<div
						className="relative overflow-hidden"
						style={{
							padding: "1px",
							background: "linear-gradient(135deg, rgba(200,200,230,0.2), rgba(200,200,230,0.05), rgba(200,200,230,0.15))",
						}}
					>
						<div className="relative h-[40vh] overflow-hidden" style={{ backgroundColor: "#111114" }}>
							<Image
								src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80&auto=format&fit=crop"
								alt=""
								fill
								className="object-cover"
								style={{ filter: "saturate(0) brightness(0.5) contrast(1.3)" }}
								priority
							/>
							{/* Chrome sheen overlay */}
							<div
								className="absolute inset-0"
								style={{
									background: "linear-gradient(135deg, rgba(200,200,230,0.05), transparent 40%, rgba(255,255,255,0.03) 60%, transparent)",
								}}
							/>
						</div>
					</div>
					{/* Reflection line */}
					<div
						className="mx-auto mt-1 h-px max-w-xs"
						style={{
							background: "linear-gradient(90deg, transparent, rgba(200,200,230,0.2), transparent)",
						}}
					/>
				</div>
			</section>

			{/* Features */}
			<section id="features" className="relative z-10 px-8 py-24 lg:px-16">
				<div className="mx-auto max-w-5xl">
					<div className="mb-16 text-center">
						<span className="mb-4 block text-[10px] uppercase tracking-[0.5em] text-[#505060]">
							Funktionen
						</span>
						<h2
							className="text-4xl font-bold tracking-[-0.02em]"
							style={{
								background: "linear-gradient(180deg, #e0e0e8, #808090)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							Sechs Legierungen.
						</h2>
					</div>

					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						{[
							{ title: "Stempeluhr", desc: "Web, Desktop, Mobile. Echtzeit-Synchronisation \u00fcber alle Ger\u00e4te." },
							{ title: "GoBD-konform", desc: "Revisionssichere Eintr\u00e4ge. Unver\u00e4nderbar dokumentiert." },
							{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Nahtloser Transfer." },
							{ title: "Multi-Tenant", desc: "Mandantenf\u00e4hig. Organisationen isoliert und gehärtet." },
							{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Verschmolzen mit Ihrer Infrastruktur." },
							{ title: "Echtzeit-Analyse", desc: "\u00dcberstunden, Trends, Dashboards. Sofort reflektiert." },
						].map((f, i) => (
							<div
								key={i}
								className="group relative overflow-hidden p-7 transition-all duration-500 hover:translate-y-[-2px]"
								style={{
									background: "linear-gradient(135deg, rgba(200,200,230,0.04), rgba(200,200,230,0.01))",
									border: "1px solid rgba(200,200,230,0.06)",
								}}
							>
								{/* Chrome shine on hover */}
								<div
									className="absolute inset-0 translate-x-[-100%] transition-transform duration-700 group-hover:translate-x-[100%]"
									style={{
										background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent)",
									}}
								/>
								<span className="mb-1 block text-[9px] tracking-[0.3em] text-[#404050]">
									0{i + 1}
								</span>
								<h3
									className="mb-3 text-[16px] font-semibold tracking-tight transition-colors group-hover:text-white"
									style={{ color: "#a0a0b0" }}
								>
									{f.title}
								</h3>
								<p className="text-[12px] leading-[1.85] text-[#505060]">{f.desc}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Image row */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-16">
				<div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
					<div
						className="relative h-56 overflow-hidden"
						style={{
							padding: "1px",
							background: "linear-gradient(135deg, rgba(200,200,230,0.1), rgba(200,200,230,0.02))",
						}}
					>
						<div className="relative h-full overflow-hidden">
							<Image src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=700&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0) brightness(0.45) contrast(1.2)" }} />
						</div>
					</div>
					<div
						className="relative h-56 overflow-hidden"
						style={{
							padding: "1px",
							background: "linear-gradient(135deg, rgba(200,200,230,0.02), rgba(200,200,230,0.1))",
						}}
					>
						<div className="relative h-full overflow-hidden">
							<Image src="https://images.unsplash.com/photo-1557804506-669a67965ba0?w=700&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0) brightness(0.45) contrast(1.2)" }} />
						</div>
					</div>
				</div>
			</section>

			{/* Reflection section */}
			<section id="reflect" className="relative z-10 px-8 py-32 lg:px-16">
				<div className="mx-auto max-w-2xl text-center">
					<div className="mb-8 flex items-center justify-center">
						<div
							className="h-px w-24"
							style={{ background: "linear-gradient(90deg, transparent, rgba(200,200,230,0.2))" }}
						/>
						<div
							className="mx-4 h-2 w-2 rounded-full"
							style={{ background: "linear-gradient(135deg, #c0c0d0, #808090)" }}
						/>
						<div
							className="h-px w-24"
							style={{ background: "linear-gradient(90deg, rgba(200,200,230,0.2), transparent)" }}
						/>
					</div>
					<blockquote
						className="text-[clamp(1.4rem,3vw,2.2rem)] font-light leading-[1.5] tracking-[-0.01em]"
						style={{ color: "#808090" }}
					>
						Die beste Technologie ist die, die sich Ihnen anpasst &mdash; nicht umgekehrt.
					</blockquote>
					{/* Reflected text */}
					<div
						className="mt-4 text-[clamp(1.4rem,3vw,2.2rem)] font-light leading-[1.5] tracking-[-0.01em]"
						style={{
							color: "#808090",
							opacity: 0.06,
							transform: "scaleY(-1)",
							maskImage: "linear-gradient(180deg, rgba(0,0,0,0.3), transparent)",
							WebkitMaskImage: "linear-gradient(180deg, rgba(0,0,0,0.3), transparent)",
						}}
					>
						Die beste Technologie ist die, die sich Ihnen anpasst.
					</div>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-16">
				<div
					className="mx-auto max-w-3xl overflow-hidden p-12 lg:p-16"
					style={{
						background: "linear-gradient(135deg, rgba(200,200,230,0.04), rgba(200,200,230,0.01))",
						border: "1px solid rgba(200,200,230,0.08)",
					}}
				>
					<div className="text-center">
						<h2
							className="mb-4 text-4xl font-bold tracking-[-0.02em]"
							style={{
								background: "linear-gradient(180deg, #e0e0e8, #808090)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							Bereit zum Gl&auml;nzen?
						</h2>
						<p className="mb-8 text-[14px] leading-relaxed text-[#505060]">
							Erleben Sie Z8 in seiner poliertesten Form.
						</p>
						<div className="flex items-center justify-center gap-4">
							<a
								href="mailto:hello@z8.app"
								className="px-10 py-4 text-[11px] font-semibold uppercase tracking-[0.15em] transition-all hover:shadow-[0_0_30px_rgba(200,200,230,0.15)]"
								style={{
									background: "linear-gradient(135deg, #c0c0d0, #e0e0f0, #a0a0b8)",
									color: "#111114",
								}}
							>
								Demo vereinbaren
							</a>
							<a
								href="mailto:hello@z8.app"
								className="px-6 py-4 text-[11px] tracking-[0.1em] text-[#505060] transition-colors hover:text-[#c0c0d0]"
							>
								hello@z8.app
							</a>
						</div>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16">
				<div
					className="h-px"
					style={{ background: "linear-gradient(90deg, transparent, rgba(200,200,230,0.08), transparent)" }}
				/>
				<div className="flex items-center justify-between pt-6 text-[10px] tracking-[0.2em] text-[#303040]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#c0c0d0]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
