import { readFile, writeFile } from 'node:fs/promises';

const TRIAL_SIGNUP_URL = 'https://app.wisecall.io/?signup=1&redirect=/billing';

const MOBILE_CSS = `    .mobile-menu { transform: translateY(-100%); opacity: 0; visibility: hidden; pointer-events: none; transition: transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.2s ease, visibility 0s linear 0.35s; }
    .mobile-menu.open { transform: translateY(0); opacity: 1; visibility: visible; pointer-events: auto; transition-delay: 0s; }`;

const HEADER = `<header class="sticky top-0 z-50 backdrop-blur-md bg-[#172929]/82 border-b border-[#7de8eb]/10 relative">
  <nav class="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
    <a href="/" class="flex items-center gap-3 text-white font-bold text-lg no-underline min-w-0"><img src="/owl-logo.png" alt="WiseCall" class="h-9 w-auto flex-shrink-0"><span class="truncate">WiseCall</span></a>
    <div class="hidden md:flex items-center gap-6 text-sm text-white/70">
      <a href="/how-it-works/" class="hover:text-[#7de8eb]">How It Works</a>
      <a href="/pricing/" class="hover:text-[#7de8eb]">Pricing</a>
      <a href="/industries/" class="hover:text-[#7de8eb]">Industries</a>
      <a href="/integrations/" class="hover:text-[#7de8eb]">Integrations</a>
      <a href="/compare/ai-receptionist-uk-comparison/" class="hover:text-[#7de8eb]">Compare</a>
      <a href="/resources/missed-call-calculator/" class="hover:text-[#7de8eb]">Calculator</a>
      <a href="/blog/missed-calls-cost-uk-businesses/" class="hover:text-[#7de8eb]">Resources</a>
    </div>
    <div class="flex items-center gap-2 flex-shrink-0">
      <a href="${TRIAL_SIGNUP_URL}" class="btn btn-primary hidden sm:inline-flex px-4 py-2.5 text-sm">Start Free Trial <i data-lucide="arrow-right" class="w-4 h-4"></i></a>
      <button id="mobileMenuToggle" type="button" aria-label="Open menu" aria-expanded="false" class="md:hidden w-10 h-10 rounded-lg border border-[#7de8eb]/25 text-white/80 flex items-center justify-center hover:bg-white/5 transition-colors">
        <i data-lucide="menu" class="w-5 h-5"></i>
      </button>
    </div>
  </nav>
  <div id="mobileMenu" class="mobile-menu md:hidden absolute top-full left-0 right-0 bg-[#172929]/98 backdrop-blur-xl border-b border-[#7de8eb]/15 shadow-2xl">
    <div class="px-4 py-5 flex flex-col gap-1 text-white">
      <a href="/how-it-works/" class="py-2.5 text-base hover:text-[#7de8eb] transition-colors">How It Works</a>
      <a href="/pricing/" class="py-2.5 text-base hover:text-[#7de8eb] transition-colors">Pricing</a>
      <a href="/industries/" class="py-2.5 text-base hover:text-[#7de8eb] transition-colors">Industries</a>
      <a href="/integrations/" class="py-2.5 text-base hover:text-[#7de8eb] transition-colors">Integrations</a>
      <a href="/compare/ai-receptionist-uk-comparison/" class="py-2.5 text-base hover:text-[#7de8eb] transition-colors">Compare</a>
      <a href="/resources/missed-call-calculator/" class="py-2.5 text-base hover:text-[#7de8eb] transition-colors">Calculator</a>
      <a href="/blog/missed-calls-cost-uk-businesses/" class="py-2.5 text-base hover:text-[#7de8eb] transition-colors">Resources</a>
      <a href="${TRIAL_SIGNUP_URL}" class="btn btn-primary mt-3 justify-center px-5 py-3 text-sm">Start Free Trial <i data-lucide="arrow-right" class="w-4 h-4"></i></a>
    </div>
  </div>
</header>`;

const MOBILE_SCRIPT = `<script>
(function () {
  const toggle = document.getElementById('mobileMenuToggle');
  const menu = document.getElementById('mobileMenu');
  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    menu.querySelectorAll('a').forEach((link) =>
      link.addEventListener('click', () => menu.classList.remove('open')),
    );
  }
  lucide.createIcons();
})();
</script>`;

const files = [
  'pricing/index.html',
  'how-it-works/index.html',
  'industries/index.html',
  'industries/dental/index.html',
  'industries/estate-agents/index.html',
  'industries/care-homes/index.html',
  'industries/legal/index.html',
  'integrations/index.html',
  'compare/ai-receptionist-uk-comparison/index.html',
  'case-studies/index.html',
  'blog/missed-calls-cost-uk-businesses/index.html',
  'resources/missed-call-calculator/index.html',
  'resources/call-transcript-guide/index.html',
];

for (const rel of files) {
  const path = new URL(`../${rel}`, import.meta.url);
  let html = await readFile(path, 'utf8');
  if (html.includes('mobileMenuToggle')) {
    console.log('skip (already patched):', rel);
    continue;
  }

  if (!html.includes('.mobile-menu')) {
    html = html.replace('  </style>', `${MOBILE_CSS}\n  </style>`);
  }

  html = html.replace(/<header class="sticky top-0[\s\S]*?<\/header>/, HEADER);
  html = html.replace('<script>lucide.createIcons();</script>', MOBILE_SCRIPT);

  await writeFile(path, html);
  console.log('patched:', rel);
}
