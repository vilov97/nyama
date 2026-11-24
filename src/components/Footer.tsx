export default function Footer() {
  return (
    <footer className="bg-neutral-900 text-white">
      <div className="mx-auto max-w-5xl px-4 py-12">
        <div className="grid gap-8 md:grid-cols-3">
          {/* Brand */}
          <div>
            <p className="mb-3 text-lg font-light tracking-tighter">
              KWAMAIKO<span className="font-black">NYAMA</span>
            </p>
            <p className="text-xs leading-relaxed text-neutral-400">
              Authentic Kenyan nyama choma delivered to your door. Fresh cuts,
              premium quality, reliable delivery.
            </p>
            <div className="mt-4 flex gap-3">
              <span className="flex h-8 w-8 items-center justify-center border border-neutral-700 text-xs text-neutral-400 transition-colors hover:border-[#ffe500] hover:text-[#ffe500]">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" />
                </svg>
              </span>
              <span className="flex h-8 w-8 items-center justify-center border border-neutral-700 text-xs text-neutral-400 transition-colors hover:border-[#ffe500] hover:text-[#ffe500]">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" />
                </svg>
              </span>
              <span className="flex h-8 w-8 items-center justify-center border border-neutral-700 text-xs text-neutral-400 transition-colors hover:border-[#ffe500] hover:text-[#ffe500]">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                </svg>
              </span>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <p className="mb-4 text-[0.6rem] font-bold uppercase tracking-widest text-neutral-300">
              Quick Links
            </p>
            <div className="flex flex-col gap-2">
              {["Order Online", "About Us", "Operating Hours", "Menu"].map(
                (link) => (
                  <a
                    key={link}
                    href={`#${link.toLowerCase().replace(/\s+/g, "-")}`}
                    className="text-xs text-neutral-400 no-underline transition-colors hover:text-[#ffe500]"
                  >
                    {link}
                  </a>
                ),
              )}
            </div>
          </div>

          {/* Contact */}
          <div>
            <p className="mb-4 text-[0.6rem] font-bold uppercase tracking-widest text-neutral-300">
              Contact
            </p>
            <div className="flex flex-col gap-2 text-xs text-neutral-400">
              <div className="flex items-center gap-2">
                <svg className="h-3.5 w-3.5 shrink-0 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span>Nairobi, Kenya</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="h-3.5 w-3.5 shrink-0 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
                </svg>
                <span>+254 700 000 000</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="h-3.5 w-3.5 shrink-0 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                <span>info@kwamaiko.co.ke</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-neutral-800 pt-6 text-center">
          <p className="text-[0.55rem] font-mono text-neutral-500">
            KWAMAIKO NYAMA ONLINE · V2.0 · &copy; {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </footer>
  );
}
