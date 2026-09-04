import { mkdir, writeFile } from 'node:fs/promises';
import {
  blogPosts,
  comparisonPages,
  futureIndustries,
  ukAiReceptionistComparison,
  globalFaqs,
  industries,
  integrations,
  site,
  trackingTodos,
  trustSignals,
} from './seo-content.mjs';

const TRIAL_SIGNUP_URL = 'https://app.wisecall.io/?signup=1&redirect=/billing';

const out = new URL('../', import.meta.url);
const publicOut = new URL('../public/', import.meta.url);

const route = (path) => `${site.url}${path}`;

// Canonical public path for an industry. Root hand-built pages (dental.html,
// legal.html, property.html) are canonical where they exist — vercel.json 301s
// /industries/<slug>/ to them, so generating those duplicates wastes crawl
// budget and puts redirecting URLs in the sitemap.
const industryPath = (industry) =>
  industry.legacyPath ? industry.legacyPath.replace('.html', '') : `/industries/${industry.slug}/`;

const esc = (value = '') =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function jsonLd(data) {
  return `<script type="application/ld+json">${JSON.stringify(data, null, 2)}</script>`;
}

function organisationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: site.name,
    url: site.url,
    logo: route(site.logo),
    email: site.email,
    areaServed: 'United Kingdom',
    description: site.description,
  };
}

function webPageSchema(page) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    url: route(page.path),
    description: page.description,
    isPartOf: { '@type': 'WebSite', name: site.name, url: site.url },
  };
}

function faqSchema(faqs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };
}

function breadcrumbSchema(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: route(item.path),
    })),
  };
}

function layout(page, body, schemas = []) {
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(page.title)}</title>
  <meta name="description" content="${esc(page.description)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${route(page.path)}">
  <meta property="og:type" content="${page.type === 'article' ? 'article' : 'website'}">
  <meta property="og:url" content="${route(page.path)}">
  <meta property="og:title" content="${esc(page.title)}">
  <meta property="og:description" content="${esc(page.description)}">
  <meta property="og:image" content="${route(site.ogImage)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(page.title)}">
  <meta name="twitter:description" content="${esc(page.description)}">
  <link rel="icon" type="image/png" href="/favicon.png">
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    html { scroll-behavior: smooth; }
    body { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#172929; color:white; -webkit-font-smoothing:antialiased; }
    .page-bg { background: radial-gradient(circle at 20% 10%, rgba(125,232,235,.12), transparent 34%), radial-gradient(circle at 85% 20%, rgba(224,122,82,.10), transparent 30%), #172929; }
    .card { background: rgba(255,255,255,.05); border: 1px solid rgba(125,232,235,.12); border-radius: 16px; }
    .card-strong { background: linear-gradient(135deg, rgba(125,232,235,.14), rgba(93,191,194,.04)); border: 1px solid rgba(125,232,235,.35); border-radius: 16px; }
    .btn { display:inline-flex; align-items:center; justify-content:center; gap:.55rem; border-radius:.6rem; font-weight:800; transition:transform .18s ease, box-shadow .2s ease; }
    .btn:hover { transform: translateY(-2px); }
    .btn-primary { background: linear-gradient(90deg,#7de8eb,#5dbfc2); color:#172929; box-shadow:0 0 28px rgba(125,232,235,.24); }
    .btn-secondary { background: rgba(255,255,255,.05); color:white; border:1px solid rgba(125,232,235,.28); }
    .eyebrow { display:inline-flex; align-items:center; gap:.5rem; color:#7de8eb; border:1px solid rgba(125,232,235,.22); background:rgba(125,232,235,.08); border-radius:999px; padding:.45rem .8rem; font-size:.83rem; font-weight:700; }
    details summary { list-style:none; cursor:pointer; }
    details summary::-webkit-details-marker { display:none; }
    [data-lucide] { width: 1em; height: 1em; }
    .mobile-menu { transform: translateY(-100%); opacity: 0; visibility: hidden; pointer-events: none; transition: transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.2s ease, visibility 0s linear 0.35s; }
    .mobile-menu.open { transform: translateY(0); opacity: 1; visibility: visible; pointer-events: auto; transition-delay: 0s; }
  </style>
  ${schemas.map(jsonLd).join('\n  ')}
</head>
<body class="page-bg min-h-screen overflow-x-hidden">
${header()}
<main>
${body}
</main>
${footer()}
<script>
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
</script>
</body>
</html>`;
}

function header() {
  return `<header class="sticky top-0 z-50 backdrop-blur-md bg-[#172929]/82 border-b border-[#7de8eb]/10 relative">
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
      <a href="${TRIAL_SIGNUP_URL}" class="btn btn-primary hidden sm:inline-flex px-4 py-2.5 text-sm">Try it now <i data-lucide="arrow-right" class="w-4 h-4"></i></a>
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
      <a href="${TRIAL_SIGNUP_URL}" class="btn btn-primary mt-3 justify-center px-5 py-3 text-sm">Try it now <i data-lucide="arrow-right" class="w-4 h-4"></i></a>
    </div>
  </div>
</header>`;
}

function footer() {
  return `<footer class="border-t border-[#7de8eb]/10 px-6 py-14">
  <div class="max-w-7xl mx-auto grid md:grid-cols-4 gap-8 text-sm">
    <div>
      <div class="flex items-center gap-2 font-bold text-white mb-3"><img src="/owl-logo.png" alt="" class="h-8">WiseCall</div>
      <p class="text-white/60 leading-relaxed">${esc(site.description)}</p>
    </div>
    <div>
      <h2 class="text-white font-bold mb-3 text-base">Explore</h2>
      <ul class="space-y-2 text-white/60">
        <li><a href="/how-it-works/" class="hover:text-[#7de8eb]">How WiseCall handles calls</a></li>
        <li><a href="/pricing/" class="hover:text-[#7de8eb]">WiseCall pricing</a></li>
        <li><a href="/integrations/" class="hover:text-[#7de8eb]">WiseCall integrations</a></li>
        <li><a href="/compare/ai-receptionist-uk-comparison/" class="hover:text-[#7de8eb]">AI receptionist UK comparison</a></li>
        <li><a href="/resources/missed-call-calculator/" class="hover:text-[#7de8eb]">Missed call calculator</a></li>
      </ul>
    </div>
    <div>
      <h2 class="text-white font-bold mb-3 text-base">Industries</h2>
      <ul class="space-y-2 text-white/60">
        ${industries.map((industry) => `<li><a href="${industryPath(industry)}" class="hover:text-[#7de8eb]">${esc(industry.keyword)}</a></li>`).join('')}
      </ul>
    </div>
    <div>
      <h2 class="text-white font-bold mb-3 text-base">Company</h2>
      <ul class="space-y-2 text-white/60">
        <li><a href="/" class="hover:text-[#7de8eb]">Home</a></li>
        <li><a href="/privacy-policy" class="hover:text-[#7de8eb]">Privacy policy</a></li>
        <li><a href="/terms" class="hover:text-[#7de8eb]">Terms</a></li>
      </ul>
    </div>
  </div>
</footer>`;
}

const comparisonHeroPanel = {
  title: 'Why businesses switch',
  items: ['Answers instantly, 24/7', 'Captures structured details, not messages', 'Summary and next step after every call', 'Routes and escalates urgent calls', 'Test it on real calls in a 7-day pilot'],
};

const DEFAULT_HERO_PANEL = {
  title: 'What WiseCall does on every call',
  items: ['Answers in your business name', 'Qualifies the caller’s intent', 'Captures structured details', 'Books, routes or escalates', 'Sends summaries and transcripts'],
};

function hero({ eyebrow, h1, lead, cta = 'Try it now', secondary = 'Calculate Missed Calls', panel = DEFAULT_HERO_PANEL }) {
  return `<section class="px-6 py-20 md:py-28">
  <div class="max-w-7xl mx-auto grid lg:grid-cols-[1.05fr_.95fr] gap-10 items-center">
    <div>
      <div class="eyebrow mb-7"><i data-lucide="sparkles" class="w-4 h-4"></i>${esc(eyebrow)}</div>
      <h1 class="text-5xl md:text-7xl font-black leading-tight tracking-tight mb-7">${h1}</h1>
      <p class="text-xl md:text-2xl text-white/72 leading-relaxed max-w-3xl mb-9">${esc(lead)}</p>
      <div class="flex flex-col sm:flex-row gap-4">
        <a href="${TRIAL_SIGNUP_URL}" class="btn btn-primary px-8 py-4">${esc(cta)} <i data-lucide="arrow-right" class="w-5 h-5"></i></a>
        <a href="/resources/missed-call-calculator/" class="btn btn-secondary px-8 py-4">${esc(secondary)}</a>
      </div>
    </div>
    <div class="card-strong p-7">
      <h2 class="text-2xl font-bold mb-5">${esc(panel.title)}</h2>
      <div class="grid gap-4">
        ${panel.items.map((item) => `<div class="flex gap-3 text-white/78"><i data-lucide="check-circle-2" class="w-5 h-5 text-[#7de8eb] flex-shrink-0 mt-1"></i><span>${esc(item)}</span></div>`).join('')}
      </div>
    </div>
  </div>
</section>`;
}

function trustStrip() {
  return `<section class="px-6 py-10 border-y border-[#7de8eb]/10 bg-white/[.025]">
  <div class="max-w-7xl mx-auto grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
    ${trustSignals.map((signal) => `<div class="flex items-center gap-2 text-white/70"><i data-lucide="shield-check" class="w-5 h-5 text-[#7de8eb]"></i><span>${esc(signal)}</span></div>`).join('')}
  </div>
</section>`;
}

function faqSection(faqs, title = 'Common Questions') {
  return `<section class="px-6 py-20">
  <div class="max-w-4xl mx-auto">
    <div class="eyebrow mb-6"><i data-lucide="help-circle" class="w-4 h-4"></i>FAQ</div>
    <h2 class="text-4xl md:text-5xl font-black mb-5">${esc(title)}</h2>
    <div class="space-y-3 mt-10">
      ${faqs.map((faq) => `<details class="card p-6">
        <summary class="flex items-start justify-between gap-4"><h3 class="font-bold text-lg">${esc(faq.question)}</h3><i data-lucide="chevron-down" class="text-[#7de8eb] flex-shrink-0"></i></summary>
        <p class="text-white/68 leading-relaxed mt-4">${esc(faq.answer)}</p>
      </details>`).join('')}
    </div>
  </div>
</section>`;
}

function ctaBlock(title = 'Ready to stop missing calls?', text = 'Book a free demo and we will show how WiseCall can fit your call flow, team and current phone setup.') {
  return `<section id="demo" class="px-6 py-20">
  <div class="max-w-5xl mx-auto text-center card-strong p-10 md:p-14">
    <h2 class="text-4xl md:text-5xl font-black mb-5">${esc(title)}</h2>
    <p class="text-white/72 text-xl leading-relaxed max-w-3xl mx-auto mb-8">${esc(text)}</p>
    <div class="flex flex-col sm:flex-row gap-4 justify-center">
      <a href="${TRIAL_SIGNUP_URL}" class="btn btn-primary px-8 py-4">Try it now</a>
      <a href="/how-it-works/" class="btn btn-secondary px-8 py-4">See how WiseCall works</a>
    </div>
  </div>
</section>`;
}

function relatedLinks(links) {
  return `<section class="px-6 py-16 bg-white/[.025]">
  <div class="max-w-7xl mx-auto">
    <h2 class="text-3xl font-black mb-8">Related WiseCall pages</h2>
    <div class="grid md:grid-cols-3 gap-4">
      ${links.map((link) => `<a href="${link.path}" class="card p-6 block hover:border-[#7de8eb]/40">
        <h3 class="font-bold text-white mb-2">${esc(link.title)}</h3>
        <p class="text-white/60 text-sm leading-relaxed">${esc(link.text)}</p>
      </a>`).join('')}
    </div>
  </div>
</section>`;
}

const calculatorPresets = {
  general: { label: 'General', calls: 40, missedPct: 20, enquiryPct: 30, value: 150, convPct: 30, days: 22 },
  dental: { label: 'Dental', calls: 60, missedPct: 25, enquiryPct: 25, value: 350, convPct: 40, days: 21 },
  legal: { label: 'Legal', calls: 25, missedPct: 20, enquiryPct: 35, value: 1200, convPct: 20, days: 21 },
  property: { label: 'Property', calls: 45, missedPct: 22, enquiryPct: 30, value: 900, convPct: 20, days: 24 },
  trades: { label: 'Trades', calls: 15, missedPct: 35, enquiryPct: 50, value: 250, convPct: 40, days: 24 },
  care: { label: 'Care', calls: 20, missedPct: 20, enquiryPct: 20, value: 1500, convPct: 15, days: 30 },
};

function missedCallCalculatorBlock(presetKey = 'general') {
  const active = calculatorPresets[presetKey] ? presetKey : 'general';
  return `<section class="px-6 py-20" id="calculator">
  <div class="max-w-7xl mx-auto grid lg:grid-cols-[.9fr_1.1fr] gap-8 items-start">
    <div>
      <div class="eyebrow mb-6"><i data-lucide="calculator" class="w-4 h-4"></i>Missed Call Calculator</div>
      <h2 class="text-4xl md:text-5xl font-black mb-5">Estimate what unanswered calls may be costing</h2>
      <p class="text-white/70 text-lg leading-relaxed mb-6">Start from an industry preset, then adjust every figure to match your business. This is a planning estimate, not a claim about your actual performance.</p>
      <div class="flex flex-wrap gap-2" id="calcPresets">
        ${Object.entries(calculatorPresets).map(([key, preset]) => `<button type="button" data-preset="${key}" class="calc-preset px-4 py-2 rounded-full border text-sm font-semibold transition-colors ${key === active ? 'bg-[#7de8eb] text-[#172929] border-[#7de8eb]' : 'bg-white/5 text-white/70 border-[#7de8eb]/20 hover:border-[#7de8eb]/50'}">${esc(preset.label)}</button>`).join('')}
      </div>
    </div>
    <div class="card-strong p-6">
      <div class="grid sm:grid-cols-3 gap-4">
        <label class="block text-sm text-white/70">Calls per day<input id="calcCalls" type="number" min="0" class="mt-2 w-full rounded-lg bg-white/10 border border-[#7de8eb]/20 px-4 py-3 text-white"></label>
        <label class="block text-sm text-white/70">Missed calls (%)<input id="calcMissedPct" type="number" min="0" max="100" class="mt-2 w-full rounded-lg bg-white/10 border border-[#7de8eb]/20 px-4 py-3 text-white"></label>
        <label class="block text-sm text-white/70">New enquiries (%)<input id="calcEnquiryPct" type="number" min="0" max="100" class="mt-2 w-full rounded-lg bg-white/10 border border-[#7de8eb]/20 px-4 py-3 text-white"></label>
        <label class="block text-sm text-white/70">Enquiry value (£)<input id="calcValue" type="number" min="0" class="mt-2 w-full rounded-lg bg-white/10 border border-[#7de8eb]/20 px-4 py-3 text-white"></label>
        <label class="block text-sm text-white/70">Conversion rate (%)<input id="calcConvPct" type="number" min="0" max="100" class="mt-2 w-full rounded-lg bg-white/10 border border-[#7de8eb]/20 px-4 py-3 text-white"></label>
        <label class="block text-sm text-white/70">Working days / month<input id="calcDays" type="number" min="0" max="31" class="mt-2 w-full rounded-lg bg-white/10 border border-[#7de8eb]/20 px-4 py-3 text-white"></label>
      </div>
      <div class="mt-6 grid sm:grid-cols-2 gap-4">
        <div class="p-5 rounded-xl bg-[#172929]/70 border border-[#7de8eb]/15">
          <div class="text-white/60 text-sm mb-1.5">Missed calls / month</div>
          <div id="calcOutCalls" class="text-3xl font-black text-white">0</div>
        </div>
        <div class="p-5 rounded-xl bg-[#172929]/70 border border-[#7de8eb]/15">
          <div class="text-white/60 text-sm mb-1.5">Missed new enquiries</div>
          <div id="calcOutEnquiries" class="text-3xl font-black text-white">0</div>
        </div>
        <div class="p-5 rounded-xl bg-[#172929]/70 border border-[#7de8eb]/25">
          <div class="text-white/60 text-sm mb-1.5">Monthly value at risk</div>
          <div id="calcOutMonthly" class="text-3xl font-black text-[#7de8eb]">£0</div>
        </div>
        <div class="p-5 rounded-xl bg-[#172929]/70 border border-[#7de8eb]/25">
          <div class="text-white/60 text-sm mb-1.5">Annual value at risk</div>
          <div id="calcOutAnnual" class="text-3xl font-black text-[#7de8eb]">£0</div>
        </div>
      </div>
      <p class="text-white/40 text-xs mt-4 leading-relaxed">Estimates only, based on the figures you enter. Actual results depend on your call patterns, enquiry mix and follow-up.</p>
      <a href="${TRIAL_SIGNUP_URL}" class="btn btn-primary w-full text-center py-3.5 mt-5">Stop the leak — try WiseCall now</a>
      <script>
      (function () {
        const presets = ${JSON.stringify(calculatorPresets)};
        const fields = { calls: 'calcCalls', missedPct: 'calcMissedPct', enquiryPct: 'calcEnquiryPct', value: 'calcValue', convPct: 'calcConvPct', days: 'calcDays' };
        const el = (id) => document.getElementById(id);
        const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
        const num = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
        const current = {};
        function animate(id, target, format) {
          const node = el(id);
          const from = current[id] || 0;
          current[id] = target;
          const start = performance.now();
          function tick(now) {
            const t = Math.min((now - start) / 400, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            node.textContent = format(Math.round(from + (target - from) * eased));
            if (t < 1) requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        }
        function recalc() {
          const calls = Number(el(fields.calls).value || 0);
          const missed = calls * (Number(el(fields.missedPct).value || 0) / 100) * Number(el(fields.days).value || 0);
          const enquiries = missed * (Number(el(fields.enquiryPct).value || 0) / 100);
          const monthly = enquiries * Number(el(fields.value).value || 0) * (Number(el(fields.convPct).value || 0) / 100);
          animate('calcOutCalls', missed, num.format);
          animate('calcOutEnquiries', enquiries, num.format);
          animate('calcOutMonthly', monthly, gbp.format);
          animate('calcOutAnnual', monthly * 12, gbp.format);
        }
        function applyPreset(key) {
          Object.entries(fields).forEach(([prop, id]) => { el(id).value = presets[key][prop]; });
          document.querySelectorAll('.calc-preset').forEach((btn) => {
            const on = btn.dataset.preset === key;
            btn.classList.toggle('bg-[#7de8eb]', on);
            btn.classList.toggle('text-[#172929]', on);
            btn.classList.toggle('border-[#7de8eb]', on);
            btn.classList.toggle('bg-white/5', !on);
            btn.classList.toggle('text-white/70', !on);
            btn.classList.toggle('border-[#7de8eb]/20', !on);
          });
          recalc();
        }
        document.querySelectorAll('.calc-preset').forEach((btn) => btn.addEventListener('click', () => applyPreset(btn.dataset.preset)));
        Object.values(fields).forEach((id) => el(id).addEventListener('input', recalc));
        applyPreset('${active}');
      })();
      </script>
    </div>
  </div>
</section>`;
}

function audioAndCasePlaceholders(industry) {
  return `<section class="px-6 py-20 bg-white/[.025]">
  <div class="max-w-7xl mx-auto grid lg:grid-cols-2 gap-6">
    <div class="card p-7">
      <div class="eyebrow mb-5"><i data-lucide="audio-lines" class="w-4 h-4"></i>Example call</div>
      <h2 class="text-3xl font-black mb-4">How WiseCall handles a ${esc(industry.singular)} call</h2>
      <p class="text-white/68 leading-relaxed">WiseCall answers in your business name, confirms the reason for the call and asks the right questions for a ${esc(industry.leadType)}. It books, routes or escalates the next step, then sends your team a clear summary. The example below is anonymised and does not identify any caller.</p>
    </div>
    <div class="card p-7">
      <div class="eyebrow mb-5"><i data-lucide="file-text" class="w-4 h-4"></i>What your team receives</div>
      <h2 class="text-3xl font-black mb-4">A clear summary after every call</h2>
      <p class="text-white/68 leading-relaxed">Each call is logged with the caller's name and number, the reason for the call, the structured details captured, the outcome (booked, routed, callback or escalated) and a full transcript, delivered where your team already works.</p>
    </div>
  </div>
</section>`;
}

function renderIndustryPage(industry) {
  const page = { title: industry.title, description: industry.description, path: industryPath(industry) };
  const faqs = [...industry.faqs, ...globalFaqs.slice(0, 2)];
  const body = `${hero({
    eyebrow: industry.keyword,
    h1: `${esc(industry.h1)} <span class="text-[#7de8eb]">for UK businesses</span>`,
    lead: industry.heroLead,
    cta: 'Start a 7-day pilot',
    secondary: 'Calculate missed calls',
    panel: { title: `What WiseCall handles for ${industry.name.toLowerCase()}`, items: industry.features.slice(0, 5) },
  })}
${trustStrip()}
<section class="px-6 py-20">
  <div class="max-w-7xl mx-auto grid lg:grid-cols-[.92fr_1.08fr] gap-10">
    <div><div class="eyebrow mb-6"><i data-lucide="alert-triangle" class="w-4 h-4"></i>Problem</div><h2 class="text-4xl md:text-5xl font-black mb-5">${esc(industry.painTitle)}</h2><p class="text-white/70 text-lg leading-relaxed">${esc(industry.pain)}</p></div>
    <div class="card-strong p-7"><h3 class="text-2xl font-bold mb-4">${esc(industry.primaryOutcome)}</h3><p class="text-white/70 leading-relaxed">${esc(industry.missedCallExample)}</p></div>
  </div>
</section>
<section class="px-6 py-20 bg-white/[.025]">
  <div class="max-w-7xl mx-auto">
    <h2 class="text-4xl md:text-5xl font-black mb-10">What happens when a ${esc(industry.leadType)} calls</h2>
    <div class="grid md:grid-cols-5 gap-4">
      ${['Call answered', 'Intent understood', 'Details captured', 'Booking or escalation', 'Summary delivered'].map((step, index) => `<div class="card p-6"><div class="text-[#7de8eb] font-black text-2xl mb-4">0${index + 1}</div><h3 class="font-bold mb-3">${esc(step)}</h3><p class="text-white/62 text-sm leading-relaxed">WiseCall follows your rules and captures structured information for your team.</p></div>`).join('')}
    </div>
  </div>
</section>
<section class="px-6 py-20">
  <div class="max-w-7xl mx-auto">
    <div class="eyebrow mb-6"><i data-lucide="settings" class="w-4 h-4"></i>Features</div>
    <h2 class="text-4xl md:text-5xl font-black mb-8">Built for ${esc(industry.name)}</h2>
    <div class="grid md:grid-cols-3 gap-4 mb-8">${industry.features.map((feature) => `<div class="card p-5 flex gap-3"><i data-lucide="check" class="w-5 h-5 text-[#7de8eb] flex-shrink-0 mt-1"></i><span>${esc(feature)}</span></div>`).join('')}</div>
    <div class="card p-6"><h3 class="font-bold text-xl mb-3">Compliance note</h3><p class="text-white/68 leading-relaxed">${esc(industry.compliance)}</p></div>
  </div>
</section>
<section class="px-6 py-20 bg-white/[.025]">
  <div class="max-w-7xl mx-auto">
    <h2 class="text-4xl md:text-5xl font-black mb-8">Integrations and handover points</h2>
    <div class="grid md:grid-cols-5 gap-4">${industry.integrations.map((integration) => `<div class="card p-5 text-center text-white/75">${esc(integration)}</div>`).join('')}</div>
  </div>
</section>
${audioAndCasePlaceholders(industry)}
${missedCallCalculatorBlock({ dental: 'dental', legal: 'legal', 'estate-agents': 'property', 'care-homes': 'care' }[industry.slug] || 'general')}
${faqSection(faqs, `Common Questions from ${industry.name}`)}
${relatedLinks([
  { path: '/pricing/', title: `Pricing for ${industry.name}`, text: 'See how WiseCall plans work for UK businesses.' },
  { path: '/how-it-works/', title: 'How WiseCall handles a call', text: 'Understand the call flow, routing and summaries.' },
  { path: '/compare/ai-receptionist-uk-comparison/', title: 'AI receptionist UK comparison', text: 'Compare WiseCall with common alternatives.' },
])}
${ctaBlock(`Ready to capture more ${industry.leadType.replace(/y$/, 'ies')}?`, `Book a free demo and see how WiseCall can support your ${industry.singular}.`)}`;
  return layout(page, body, [organisationSchema(), webPageSchema(page), breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Industries', path: '/industries/' }, { name: industry.name, path: page.path }]), faqSchema(faqs)]);
}

function renderIndustriesHub() {
  const page = {
    title: 'AI Receptionist by Industry UK | WiseCall',
    description: 'Explore WiseCall AI receptionist use cases for UK dental practices, law firms, estate agents and future sector pages.',
    path: '/industries/',
  };
  const body = `${hero({ eyebrow: 'Industry hub', h1: 'AI Receptionist <span class="text-[#7de8eb]">by Industry</span>', lead: 'WiseCall adapts call handling, intake questions, integrations and escalation rules to the way each UK sector works.' })}
${trustStrip()}
<section class="px-6 py-20"><div class="max-w-7xl mx-auto grid md:grid-cols-3 gap-5">
${industries.map((industry) => `<a href="${industryPath(industry)}" class="card p-7 block hover:border-[#7de8eb]/40"><h2 class="text-2xl font-bold mb-3">${esc(industry.name)}</h2><p class="text-white/65 leading-relaxed">${esc(industry.description)}</p><span class="inline-flex mt-5 text-[#7de8eb] font-bold">View ${esc(industry.keyword)}</span></a>`).join('')}
</div></section>
<section class="px-6 py-20 bg-white/[.025]"><div class="max-w-7xl mx-auto"><h2 class="text-4xl font-black mb-6">More industries coming soon</h2><p class="text-white/68 mb-6">WiseCall also supports sectors including these — get in touch and we will tailor call handling to your business.</p><div class="flex flex-wrap gap-3">${futureIndustries.map((slug) => `<span class="px-4 py-2 rounded-full border border-[#7de8eb]/20 text-white/70">${esc(slug.replaceAll('-', ' '))}</span>`).join('')}</div></div></section>
${ctaBlock('Don’t see your industry?', 'Book a demo and we will show you how WiseCall adapts to your call flow, intake questions and escalation rules.')}`;
  return layout(page, body, [organisationSchema(), webPageSchema(page), breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Industries', path: page.path }])]);
}

function renderHowItWorks() {
  const page = {
    title: 'How WiseCall AI Receptionist Works | UK Call Answering',
    description: 'See how WiseCall answers calls, understands caller intent, captures details, books or routes the next step and sends summaries to your team.',
    path: '/how-it-works/',
  };
  const steps = [
    ['Call arrives', 'A patient, client or customer calls your WiseCall-enabled business number.'],
    ['AI answers professionally', 'WiseCall answers in your business name using your approved greeting and call rules.'],
    ['Details are captured', 'The AI asks relevant questions and captures name, reason, urgency, contact details and next step.'],
    ['Action is taken', 'WiseCall books, routes, escalates or offers a callback depending on your configuration.'],
    ['Summary is delivered', 'Your team receives a structured summary and transcript so they can act quickly.'],
  ];
  const body = `${hero({ eyebrow: 'How it works', h1: 'How WiseCall Handles <span class="text-[#7de8eb]">Inbound Calls</span>', lead: 'WiseCall is designed to make call handling clear, auditable and useful for UK businesses rather than a black-box voice bot.' })}
<section class="px-6 py-20"><div class="max-w-7xl mx-auto grid md:grid-cols-5 gap-4">${steps.map(([name, text], index) => `<div class="card p-6"><div class="text-[#7de8eb] font-black text-2xl mb-4">0${index + 1}</div><h2 class="font-bold text-xl mb-3">${esc(name)}</h2><p class="text-white/64 text-sm leading-relaxed">${esc(text)}</p></div>`).join('')}</div></section>
${faqSection(globalFaqs, 'Questions about AI call handling')}
${relatedLinks([
  { path: '/dental', title: 'Dental call handling example', text: 'See how WiseCall handles dental patient calls.' },
  { path: '/legal', title: 'Legal intake example', text: 'See how WiseCall supports law firm intake.' },
  { path: '/pricing/', title: 'WiseCall pricing', text: 'Understand the plan structure and what is included.' },
])}
${ctaBlock('Want to hear how WiseCall would answer your calls?', 'Book a demo and we will walk through your current call flow.')}`;
  return layout(page, body, [organisationSchema(), webPageSchema(page), breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'How It Works', path: page.path }]), {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: 'How WiseCall handles an inbound call',
    step: steps.map(([name, text]) => ({ '@type': 'HowToStep', name, text })),
  }, faqSchema(globalFaqs)]);
}

const pricingPlans = [
  {
    name: 'Starter',
    monthly: '99',
    annual: '84.15',
    year: '1,009.80',
    tagline: 'Small businesses, sole traders and teams who want to stop missing calls',
    calls: '100 AI Calls',
    included: ['100 AI Email Replies', '250 WhatsApp Messages', '100 Live Chat Conversations', '100 SMS Messages and Notifications'],
  },
  {
    name: 'Professional',
    monthly: '199',
    annual: '169.15',
    year: '2,029.80',
    tagline: 'Growing businesses with regular inbound enquiries',
    calls: '300 AI Calls',
    included: ['500 AI Email Replies', '800 WhatsApp Messages', '300 Live Chat Conversations', '300 SMS Messages and Notifications'],
    popular: true,
  },
  {
    name: 'Business',
    monthly: '399',
    annual: '339.15',
    year: '4,069.80',
    tagline: 'Busy teams, multi-site businesses and companies with high call volume',
    calls: '750 AI Calls',
    included: ['2,000 AI Email Replies', '2,500 WhatsApp Messages', '1,000 Live Chat Conversations', '750 SMS Messages and Notifications'],
  },
];

function renderPricing() {
  const page = {
    title: 'WiseCall Pricing UK | AI Receptionist Plans',
    description: 'WiseCall AI receptionist pricing for UK businesses: Starter £99, Professional £199 and Business £399 per month on 30-day rolling, or save 15% annually.',
    path: '/pricing/',
  };
  const body = `${hero({ eyebrow: 'Pricing', h1: 'One AI front desk.', lead: '30-day rolling as standard. Cancel before the next month. Or pay annually and save 15%.', cta: 'Try 20 free calls', panel: { title: 'Included in every plan', items: ['AI receptionist, 24/7', 'Voice, email, WhatsApp, live chat and SMS', 'Call summaries and transcripts', 'Appointment booking and routing', 'Dashboard and analytics'] } })}
<style>
  .billing-toggle { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px; background: rgba(255,255,255,.08); }
  .billing-toggle button { border: 0; border-radius: 999px; padding: .45rem 1.15rem; font-size: .875rem; font-weight: 600; background: transparent; color: rgba(255,255,255,.62); cursor: pointer; }
  .billing-toggle button.is-active { background: #fff; color: #0c1f1f; }
  .billing-save-chip { display: inline-flex; align-items: center; border-radius: 999px; padding: .2rem .65rem; font-size: .72rem; font-weight: 700; color: #7de8eb; background: rgba(125,232,235,.12); }
</style>
<section class="px-6 pb-20">
  <div class="flex flex-wrap items-center justify-center gap-3 mb-10">
    <div class="billing-toggle" role="group" aria-label="Billing cycle">
      <button type="button" data-billing="monthly">Monthly</button>
      <button type="button" class="is-active" data-billing="annual">Annual</button>
    </div>
    <span class="billing-save-chip">Save 15%</span>
  </div>
  <div class="max-w-7xl mx-auto grid md:grid-cols-3 gap-5">${pricingPlans.map((plan) => `<div class="card-strong p-7 relative">${plan.popular ? '<span class="absolute -top-3 left-7 px-3 py-1 rounded-full bg-[#7de8eb] text-[#0f1f1f] text-xs font-bold">Most Popular</span>' : ''}<h2 class="text-2xl font-bold mb-3">${esc(plan.name)}</h2><p class="text-white/68 leading-relaxed mb-5">${esc(plan.tagline)}</p><div class="mb-5" data-plan-price data-monthly="${esc(plan.monthly)}" data-annual="${esc(plan.annual)}" data-year="${esc(plan.year)}"><span class="text-4xl font-black" data-price-amount>£${esc(plan.annual)}</span><span class="text-white/60">/month</span> <span data-price-save class="billing-save-chip">Save 15%</span><div class="text-white/50 text-sm mt-1" data-price-note>£${esc(plan.year)}/year · billed annually · excl. VAT</div></div><ul class="space-y-2 text-white/70 mb-6">${[plan.calls, ...plan.included, 'AI receptionist, 24/7', 'Call summaries and transcripts', 'Appointment booking', 'Call transfers and routing'].map((item) => `<li class="flex gap-2"><i data-lucide="check" class="text-[#7de8eb] mt-1"></i><span>${esc(item)}</span></li>`).join('')}</ul><a href="${TRIAL_SIGNUP_URL}" class="btn btn-primary w-full text-center py-3">Try 20 free calls</a></div>`).join('')}</div>
  <p class="text-center text-white/60 text-sm mt-10">750+ calls · custom · <a href="/#contact" class="text-[#7de8eb] underline underline-offset-2">Talk to us</a></p>
</section>
${faqSection([
  { question: 'How does WiseCall pricing work?', answer: 'WiseCall pricing is based on the plan you choose (Starter, Professional or Business) and the number of AI-handled calls, emails, WhatsApp messages, live chat conversations and SMS notifications included each month. Pay monthly on 30-day rolling, or save 15% when you pay annually. All prices exclude VAT.' },
  { question: 'What is included in every plan?', answer: 'Every plan includes a 24/7 AI receptionist, call summaries and transcripts, appointment booking, call transfers and routing, and a dashboard. You can try 20 free calls to test your setup, with no card.' },
  { question: 'What is the contract term?', answer: 'Plans are 30-day rolling as standard. Cancel before the next month. Or pay annually and save 15%.' },
  { question: 'What happens if we receive more AI calls than our plan includes?', answer: 'If your business regularly exceeds its monthly allowance, we will recommend moving to a more suitable plan. Book a demo and we can advise based on your call volume.' },
], 'Pricing Questions')}
${relatedLinks([
  { path: '/compare/wisecall-vs-answering-service/', title: 'WiseCall vs answering service', text: 'See the cost and coverage difference against a traditional answering service.' },
  { path: '/compare/wisecall-vs-voicemail/', title: 'WiseCall vs voicemail', text: 'See what changes when WiseCall answers instead of a recorded message.' },
  { path: '/resources/missed-call-calculator/', title: 'Calculate missed call value', text: 'Estimate the opportunity cost of unanswered calls before choosing a plan.' },
])}
${ctaBlock('Need help choosing a plan?', 'Book a free 15-minute demo and we will recommend a plan based on your current call volume.')}
<script>
(function () {
  const buttons = document.querySelectorAll('[data-billing]');
  const cards = document.querySelectorAll('[data-plan-price]');
  if (!buttons.length || !cards.length) return;
  function apply(cycle) {
    buttons.forEach((b) => b.classList.toggle('is-active', b.dataset.billing === cycle));
    cards.forEach((card) => {
      const priceEl = card.querySelector('[data-price-amount]');
      const noteEl = card.querySelector('[data-price-note]');
      const saveEl = card.querySelector('[data-price-save]');
      if (cycle === 'annual') {
        if (priceEl) priceEl.textContent = '£' + card.dataset.annual;
        if (noteEl) noteEl.textContent = '£' + card.dataset.year + '/year · billed annually · excl. VAT';
        if (saveEl) saveEl.hidden = false;
      } else {
        if (priceEl) priceEl.textContent = '£' + card.dataset.monthly;
        if (noteEl) noteEl.textContent = '30-day rolling · excl. VAT';
        if (saveEl) saveEl.hidden = true;
      }
    });
  }
  buttons.forEach((b) => b.addEventListener('click', () => apply(b.dataset.billing)));
})();
</script>`;
  return layout(page, body, [organisationSchema(), webPageSchema(page), breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Pricing', path: page.path }])]);
}

function sourceAnchor(name, href) {
  if (!href) return esc(name);
  const external = /^https?:\/\//.test(href) && !href.startsWith(site.url);
  const rel = external ? ' rel="noopener noreferrer"' : '';
  return `<a href="${esc(href)}" class="text-[#7de8eb] underline underline-offset-2 hover:text-white"${rel}>${esc(name)}</a>`;
}

function comparisonTable(columns, rows, { firstHeader = '', minClass = 'compare-table' } = {}) {
  return `<div class="overflow-x-auto card p-3 -mx-2 sm:mx-0"><table class="w-full text-left text-sm ${minClass}"><thead><tr class="text-[#7de8eb]"><th class="p-4 whitespace-nowrap">${esc(firstHeader)}</th>${columns.map((col) => `<th class="p-4 whitespace-nowrap">${typeof col === 'string' ? esc(col) : sourceAnchor(col.name, col.href)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr class="border-t border-[#7de8eb]/10">${row.map((cell, index) => `<td class="p-4 text-white/72 align-top${index === 0 ? ' font-semibold text-white/85 whitespace-nowrap' : ''}">${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function linkedFaqSection(faqs, title) {
  return `<section class="px-6 py-20" id="faq">
  <div class="max-w-4xl mx-auto">
    <div class="eyebrow mb-6"><i data-lucide="help-circle" class="w-4 h-4"></i>FAQ</div>
    <h2 class="text-4xl md:text-5xl font-black mb-5">${esc(title)}</h2>
    <div class="space-y-3 mt-10">
      ${faqs.map((faq) => `<details class="card p-6">
        <summary class="flex items-start justify-between gap-4"><h3 class="font-bold text-lg">${esc(faq.question)}</h3><i data-lucide="chevron-down" class="text-[#7de8eb] flex-shrink-0"></i></summary>
        <p class="text-white/68 leading-relaxed mt-4">${esc(faq.answer)}${faq.link ? ` ${sourceAnchor(faq.link.label, faq.link.href)}` : ''}</p>
      </details>`).join('')}
    </div>
  </div>
</section>`;
}

function renderComparison() {
  const data = ukAiReceptionistComparison;
  const page = {
    title: data.title,
    description: data.description,
    path: '/compare/ai-receptionist-uk-comparison/',
  };
  const writeUps = [
    {
      title: 'WiseCall',
      paragraphs: [
        'Answers in your business name, asks the right questions, books or routes the next step, then sends your team a proper summary. Same knowledge on email, WhatsApp, live chat and SMS.',
        'You do not need a phone system. We give you a number, or we connect the one you have. Calls and data stay in the UK. Dental can book eligible appointments into Dentally. It never gives clinical advice.',
        '20 inbound AI calls to try it, no card. 30-day rolling, or 15% off yearly.',
        'Skip us if you only want the cheapest unlimited minutes and you do not care about the phone stack.',
      ],
    },
    {
      title: 'Hey Jodie',
      paragraphs: [
        '£49, £99 or £199. Unlimited minutes. 7 days free. Keep your number. Clean offer. Basic does not book or transfer.',
        'Skip Jodie if you need WhatsApp and email on the same agent, or a UK number of your own rather than call forwarding.',
      ],
    },
    {
      title: 'Fonio',
      paragraphs: [
        'Austrian company, big in Germany and Austria, now hiring in London. Solo is €99 a month for 1,000 minutes. Team adds SIP and outbound campaigns. 30-day money-back. Hosted in Germany.',
        'Fine if you are happy paying in euros and keeping data in the EU. Less fine if you wanted a UK receptionist product with a pound invoice.',
      ],
    },
    {
      title: 'whoza',
      paragraphs: [
        'For plumbers, heating engineers and builders. £59 a month for 10 jobs. You pay for work captured, not spam calls. Honest for someone on the tools.',
        'Not for a dental practice or a law firm. They are not trying to be.',
      ],
    },
    {
      title: 'IONOS',
      paragraphs: [
        '£39, £69 or £99 excl. VAT on their UK page today, billed by call count, 30-day money-back. Fine as a cheap add-on if you already use IONOS. It is not a front desk with booking rules and a dedicated number.',
      ],
    },
    {
      title: 'Moneypenny',
      paragraphs: [
        'Everyone in the UK has heard of them. They have an AI receptionist now. The site still sends you to a quote. If the caller has to reach a person, start there.',
      ],
    },
  ];
  const checks = [
    'Where is the call data. UK, EU, or they do not say. For dental, care and legal this is a real question, not a slogan.',
    'Do you also need a phone system. Forwarding a mobile is fine until you want overflow, a ported number, or routing to mobiles without a second supplier.',
    'What happens on email and WhatsApp. Most of these products only answer the phone. Your customers do not only ring.',
    'Is the price a cap or a meter. Unlimited minutes, per-minute extras, per-call extras and per-job billing feel very different at 80 calls a week.',
  ];
  const faqsForSchema = data.faqs.map((faq) => ({
    question: faq.question,
    answer: faq.link ? `${faq.answer} ${faq.link.label}: ${faq.link.href}` : faq.answer,
  }));
  const body = `<style>
    .compare-table { min-width: 68rem; }
    .compare-table-sm { min-width: 36rem; }
    .compare-table th:first-child, .compare-table td:first-child,
    .compare-table-sm th:first-child, .compare-table-sm td:first-child {
      position: sticky; left: 0; z-index: 1;
      background: #1a3232;
    }
    .demo-phone-input {
      appearance: none; -webkit-appearance: none;
      background: transparent !important; border: 0; box-shadow: none !important;
      color: #ffffff; caret-color: #7de8eb; min-height: 2.5rem;
    }
    .demo-phone-input::placeholder { color: rgba(255,255,255,0.48); }
  </style>
<section class="px-6 py-20 md:py-28">
  <div class="max-w-7xl mx-auto grid lg:grid-cols-[1.05fr_.95fr] gap-10 items-center">
    <div>
      <div class="eyebrow mb-7"><i data-lucide="sparkles" class="w-4 h-4"></i>Comparison</div>
      <h1 class="text-5xl md:text-7xl font-black leading-tight tracking-tight mb-7">Best AI receptionist UK <span class="text-[#7de8eb]">2026</span></h1>
      <p class="text-xl md:text-2xl text-white/72 leading-relaxed max-w-3xl mb-6">${esc("Prices taken from each company's public pricing page on 3 September 2026. WiseCall prices exclude VAT. Fonio bills in euros, so we left it in euros.")}</p>
      <p class="text-lg text-white/68 leading-relaxed max-w-3xl mb-9">${esc('Search "AI receptionist UK" and you get a pile of roundups written by the people in them. This is just the published prices, and what you actually get.')}</p>
      <div class="flex flex-col sm:flex-row gap-4">
        <a href="${TRIAL_SIGNUP_URL}" class="btn btn-primary px-8 py-4">Try 20 free calls <i data-lucide="arrow-right" class="w-5 h-5"></i></a>
        <a href="/try" class="btn btn-secondary px-8 py-4">Call the live demo</a>
      </div>
    </div>
    <div class="card-strong p-7">
      <p class="text-white/78 text-xl leading-relaxed">WiseCall is in the table. We are not pretending otherwise.</p>
    </div>
  </div>
</section>
<section class="px-6 py-20">
  <div class="max-w-4xl mx-auto">
    <div class="eyebrow mb-6"><i data-lucide="list-checks" class="w-4 h-4"></i>Quick take</div>
    <h2 class="text-4xl md:text-5xl font-black mb-8">Quick take</h2>
    <div class="space-y-5 text-lg text-white/72 leading-relaxed">
      <p>Hey Jodie is the cheapest unlimited-minutes plan, from £49 a month. Bookings and transfers are not on Basic.</p>
      <p>IONOS is the cheapest metered starter: £39 a month excl. VAT for 30 calls, then 49p a call.</p>
      <p>whoza is for UK trades, from £59 a month, billed around captured jobs.</p>
      <p>Moneypenny is the one with a human behind the AI. They do not publish a price.</p>
      <p>Fonio is a European product. Solo is €99 a month (€84 if you pay annually) for 1,000 minutes. Servers are in Nuremberg.</p>
      <p>WiseCall starts at £99 a month on 30-day rolling, or £84.15 if you pay annually. UK hosting, a number included, and the same agent on phone, email, WhatsApp, live chat and SMS. 20 inbound AI calls to try it, no card.</p>
      <p>If the only thing you care about is the lowest headline price, we are not the cheapest. If you care where the calls live and whether you need a separate phone system, we are the one built for that.</p>
    </div>
  </div>
</section>
<section class="px-6 py-20" id="prices">
  <div class="max-w-7xl mx-auto">
    <div class="eyebrow mb-6"><i data-lucide="table" class="w-4 h-4"></i>Prices</div>
    <h2 class="text-4xl md:text-5xl font-black mb-8">Prices</h2>
    ${comparisonTable(data.columns, data.rows, { firstHeader: '' })}
    <p class="text-white/55 text-sm leading-relaxed mt-5">Sources:
      ${data.sources.map((source, index) => `${index ? ', ' : ''}${sourceAnchor(source.name, source.href)}`).join('')}
    </p>
  </div>
</section>
<section class="px-6 py-20">
  <div class="max-w-4xl mx-auto space-y-5">
    ${writeUps.map((item) => `<article class="card p-7">
      <h2 class="text-2xl font-bold mb-4">${esc(item.title)}</h2>
      <div class="space-y-4">${item.paragraphs.map((text) => `<p class="text-white/68 leading-relaxed">${esc(text)}</p>`).join('')}</div>
    </article>`).join('')}
  </div>
</section>
<section class="px-6 py-20">
  <div class="max-w-4xl mx-auto">
    <div class="eyebrow mb-6"><i data-lucide="search" class="w-4 h-4"></i>Before you buy</div>
    <h2 class="text-4xl md:text-5xl font-black mb-8">Four things to check before you buy</h2>
    <ol class="space-y-5">
      ${checks.map((text, index) => `<li class="card p-6 flex gap-4"><span class="text-[#7de8eb] font-black text-2xl leading-none">${index + 1}</span><p class="text-white/72 leading-relaxed">${esc(text)}</p></li>`).join('')}
    </ol>
    <div class="card-strong p-7 mt-8">
      <p class="text-white/80 leading-relaxed">Ours: UK, phone system included, same agent across channels, 30-day rolling, published GBP price.</p>
    </div>
  </div>
</section>
<section class="px-6 py-20">
  <div class="max-w-7xl mx-auto">
    <div class="eyebrow mb-6"><i data-lucide="git-compare" class="w-4 h-4"></i>WiseCall and Fonio</div>
    <h2 class="text-4xl md:text-5xl font-black mb-5">WiseCall and Fonio</h2>
    <p class="text-lg text-white/72 leading-relaxed max-w-3xl mb-8">Fonio is the well-funded European AI phone assistant. WiseCall is the UK one.</p>
    ${comparisonTable(data.fonioColumns.slice(1), data.fonioRows, { firstHeader: data.fonioColumns[0], minClass: 'compare-table-sm' })}
    <p class="text-lg text-white/72 leading-relaxed max-w-3xl mt-8">If you are a UK practice choosing between the two, it is whose number, whose data, and whose invoice.</p>
  </div>
</section>
<section id="demo" class="px-6 py-20">
  <div class="max-w-5xl mx-auto card-strong p-10 md:p-14">
    <h2 class="text-4xl md:text-5xl font-black mb-5 text-center">Try it</h2>
    <p class="text-white/72 text-xl leading-relaxed max-w-3xl mx-auto mb-8 text-center">Call the live demo, or start 20 inbound AI calls with no card. Most businesses are live within a week. 30-day rolling. Cancel before the next month.</p>
    <div class="flex flex-col sm:flex-row gap-4 justify-center mb-8">
      <a href="/try" class="btn btn-secondary px-8 py-4">Call the live demo</a>
      <a href="${TRIAL_SIGNUP_URL}" class="btn btn-primary px-8 py-4">Try 20 free calls</a>
    </div>
    <form id="demoCallbackForm" class="max-w-md mx-auto" novalidate>
      <div class="flex items-center gap-3 rounded-full bg-white/5 border border-[#7de8eb]/30 px-5 py-3.5 focus-within:border-[#7de8eb]/70">
        <i data-lucide="phone" class="w-5 h-5 text-[#7de8eb] flex-shrink-0"></i>
        <input id="demoCallbackPhone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="07…" aria-label="Mobile number for demo callback" class="demo-phone-input min-w-0 flex-1 outline-none font-semibold text-base tracking-wide">
        <button id="demoCallbackButton" type="submit" class="shrink-0 rounded-full bg-[#7de8eb] px-4 py-2 text-[#172929] text-sm font-bold hover:bg-[#9cf1f3] transition-colors">Call me</button>
      </div>
      <p id="demoCallbackStatus" class="hidden text-white/55 text-sm mt-3 text-center" aria-live="polite"></p>
    </form>
    <p class="text-white/55 text-sm text-center mt-8">
      ${[
        { href: '/try', label: 'Try' },
        { href: '/pricing/', label: 'Pricing' },
        { href: '/dental', label: 'Dental' },
        { href: '/trades', label: 'Trades' },
        { href: '/legal', label: 'Legal' },
      ].map((item) => sourceAnchor(item.label, item.href)).join(' · ')}
    </p>
  </div>
</section>
${linkedFaqSection(data.faqs, 'Questions')}
${relatedLinks([
  { path: '/pricing/', title: 'WiseCall pricing', text: 'Understand the WiseCall plan structure.' },
  { path: '/how-it-works/', title: 'How WiseCall works', text: 'See the call flow behind the comparison.' },
  ...comparisonPages.map((c) => ({ path: `/compare/${c.slug}/`, title: `WiseCall vs ${c.subject}`, text: `A focused comparison against ${c.subject.toLowerCase()}.` })),
])}
<p class="max-w-7xl mx-auto px-6 pb-10 text-white/45 text-sm leading-relaxed">Prices last checked ${esc(data.checked)}. If someone changes a plan, update this table the same day.</p>
<script>
(function () {
  const endpoint = window.WISECALL_DEMO_CALLBACK_ENDPOINT || 'https://zgzzpwaqqftmugzpccpm.supabase.co/functions/v1/wisecall-demo-callback';
  const form = document.getElementById('demoCallbackForm');
  const phoneInput = document.getElementById('demoCallbackPhone');
  const button = document.getElementById('demoCallbackButton');
  const status = document.getElementById('demoCallbackStatus');
  if (!form || !phoneInput || !button || !status) return;
  function setStatus(message, state) {
    status.textContent = message;
    status.classList.toggle('hidden', !message);
    status.classList.toggle('text-[#7de8eb]', state === 'success');
    status.classList.toggle('text-red-200', state === 'error');
    status.classList.toggle('text-white/55', state !== 'success' && state !== 'error');
  }
  function toUkMobile(value) {
    let digits = String(value || '').replace(/\\D+/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0') && digits.length === 11) digits = '44' + digits.slice(1);
    if (digits.length === 10 && digits.startsWith('7')) digits = '44' + digits;
    return /^447\\d{9}$/.test(digits) ? '+' + digits : '';
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const phone = toUkMobile(phoneInput.value);
    if (!phone) {
      phoneInput.focus();
      setStatus('Enter a UK mobile number so the agent can call you.', 'error');
      return;
    }
    button.disabled = true;
    button.textContent = 'Calling...';
    setStatus('Starting the WiseCall demo...', 'idle');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone,
          profile_slug: 'wisecall',
          agent_name: 'WiseCall Website Assistant',
          source: 'wisecall_compare_uk'
        })
      });
      const result = await response.json().catch(function () { return {}; });
      if (!response.ok || result.ok === false) throw new Error(result.error || 'Could not start the demo call.');
      setStatus(result.message || 'The WiseCall demo agent is calling now.', 'success');
    } catch (error) {
      setStatus(error.message || 'Could not start the demo call. Please try again.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Call me';
    }
  });
})();
</script>`;
  return layout(page, body, [
    organisationSchema(),
    webPageSchema(page),
    breadcrumbSchema([
      { name: 'Home', path: '/' },
      { name: 'Compare', path: '/compare/' },
      { name: 'Best AI receptionist UK 2026', path: page.path },
    ]),
    faqSchema(faqsForSchema),
  ]);
}

function renderComparisonPage(comparison) {
  const page = {
    title: comparison.title,
    description: comparison.description,
    path: `/compare/${comparison.slug}/`,
  };
  const body = `${hero({ eyebrow: comparison.eyebrow, h1: comparison.h1, lead: comparison.lead, cta: 'Start a 7-day pilot', panel: comparisonHeroPanel })}
<section class="px-6 py-20"><div class="max-w-7xl mx-auto overflow-x-auto card p-3"><table class="w-full text-left text-sm"><thead><tr class="text-[#7de8eb]">${comparison.columns.map((col) => `<th class="p-4">${esc(col)}</th>`).join('')}</tr></thead><tbody>${comparison.rows.map((row) => `<tr class="border-t border-[#7de8eb]/10">${row.map((cell) => `<td class="p-4 text-white/72">${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>
${faqSection(comparison.faqs, `${page.title.split('|')[0].trim()} Questions`)}
${relatedLinks([
  { path: '/pricing/', title: 'WiseCall pricing', text: 'Understand the WiseCall plan structure.' },
  { path: '/how-it-works/', title: 'How WiseCall works', text: 'See the call flow behind the comparison.' },
  { path: '/compare/ai-receptionist-uk-comparison/', title: 'AI receptionist UK comparison', text: 'See the broader comparison against human reception and voicemail.' },
])}
${ctaBlock(comparison.ctaTitle, comparison.ctaText)}`;
  return layout(page, body, [organisationSchema(), webPageSchema(page), breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Compare', path: '/compare/' }, { name: page.title.split('|')[0].trim(), path: page.path }]), faqSchema(comparison.faqs)]);
}

function renderCalculator() {
  const page = {
    title: 'Missed Call Calculator UK | WiseCall',
    description: 'Estimate the potential value of missed calls for a UK business using your own call volume, lead value and conversion-rate assumptions.',
    path: '/resources/missed-call-calculator/',
  };
  const body = `${hero({ eyebrow: 'Resource', h1: 'Missed Call <span class="text-[#7de8eb]">Calculator</span>', lead: 'Estimate the potential monthly opportunity from calls your business does not answer. Use your own inputs and treat the result as a planning estimate.', panel: { title: 'What the calculator estimates', items: ['Missed calls per month', 'Missed new enquiries', 'Monthly value at risk', 'Annual value at risk', 'Industry presets you can adjust'] } })}
${missedCallCalculatorBlock()}
${relatedLinks(industries.map((industry) => ({ path: industryPath(industry), title: industry.keyword, text: `See how missed call recovery applies to ${industry.name.toLowerCase()}.` })))}
${ctaBlock('Want help reducing missed calls?', 'Book a demo and see how WiseCall can answer, summarise and route calls for your team.')}`;
  return layout(page, body, [organisationSchema(), webPageSchema(page), breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Resources', path: '/resources/' }, { name: 'Missed Call Calculator', path: page.path }])]);
}

function renderIntegrations() {
  const page = {
    title: 'WiseCall Integrations UK | CRM, Calendar and Phone Workflows',
    description:
      'See how WiseCall can connect AI call answering with calendars, CRMs, phone systems, team alerts and workflow handover points for UK businesses.',
    path: '/integrations/',
  };
  const body = `${hero({ eyebrow: 'Integrations', h1: 'WiseCall Integrations <span class="text-[#7de8eb]">and Handover Points</span>', lead: 'WiseCall is designed to fit around the systems your team already uses: calendars, CRMs, email, team alerts and phone routing rules.' })}
${trustStrip()}
<section class="px-6 py-20"><div class="max-w-7xl mx-auto grid md:grid-cols-2 lg:grid-cols-4 gap-5">${integrations.map((integration) => `<div class="card p-7"><h2 class="text-2xl font-bold mb-3">${esc(integration.name)}</h2><p class="text-white/66 leading-relaxed">${esc(integration.description)}</p></div>`).join('')}</div></section>
<section class="px-6 py-20 bg-white/[.025]"><div class="max-w-7xl mx-auto"><h2 class="text-4xl md:text-5xl font-black mb-8">Industry system examples</h2><div class="grid md:grid-cols-3 gap-5">${industries.map((industry) => `<a href="${industryPath(industry)}" class="card p-7 block hover:border-[#7de8eb]/40"><h3 class="text-xl font-bold mb-3">${esc(industry.name)}</h3><p class="text-white/62 text-sm leading-relaxed mb-5">${esc(industry.integrations.join(', '))}</p><span class="text-[#7de8eb] font-bold">${esc(industry.keyword)}</span></a>`).join('')}</div></div></section>
${faqSection([
  { question: 'Can WiseCall integrate with our existing CRM?', answer: 'WiseCall can send structured call summaries and caller details into CRM and workflow systems where suitable integration routes are available. The exact setup depends on the CRM, available APIs and the level of automation required.' },
  { question: 'Can WiseCall update calendars?', answer: 'WiseCall can support calendar-led workflows such as callback windows and booking requests where the business has a clear availability process. Live booking depends on the calendar or diary system and the permissions available.' },
  { question: 'Can WiseCall work with our existing phone numbers?', answer: 'WiseCall can usually be configured around existing business call flows, including number routing, overflow rules and escalation paths. The best setup is confirmed during onboarding.' },
], 'Integration Questions')}
${relatedLinks([
  { path: '/how-it-works/', title: 'How call handling works', text: 'See how WiseCall captures details and sends summaries.' },
  { path: '/dental', title: 'Dental integrations', text: 'See dental practice workflow examples.' },
  { path: '/legal', title: 'Legal intake systems', text: 'See law firm intake workflow examples.' },
])}
${ctaBlock('Want WiseCall connected to your workflow?', 'Book a demo and we will map your current systems, handover points and routing needs.')}`;
  return layout(page, body, [organisationSchema(), webPageSchema(page), breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Integrations', path: page.path }]), faqSchema([
    { question: 'Can WiseCall integrate with our existing CRM?', answer: 'WiseCall can send structured call summaries and caller details into CRM and workflow systems where suitable integration routes are available. The exact setup depends on the CRM, available APIs and the level of automation required.' },
    { question: 'Can WiseCall update calendars?', answer: 'WiseCall can support calendar-led workflows such as callback windows and booking requests where the business has a clear availability process. Live booking depends on the calendar or diary system and the permissions available.' },
    { question: 'Can WiseCall work with our existing phone numbers?', answer: 'WiseCall can usually be configured around existing business call flows, including number routing, overflow rules and escalation paths. The best setup is confirmed during onboarding.' },
  ])]);
}

function renderCaseStudies() {
  const page = {
    title: 'WiseCall in Action | Example AI Call Handling for UK Businesses',
    description:
      'See how WiseCall handles calls for UK service businesses: anonymised example calls, the summaries your team receives, and the safeguards behind every call.',
    path: '/case-studies/',
  };
  const examples = [
    ['Dental practice', 'New patient, out of hours', 'Caller wanted to register and book a check-up at 7:40pm. WiseCall answered in the practice name, captured name, number and reason, offered the next two available slots and emailed reception a summary for the morning.'],
    ['Law firm', 'New enquiry, overflow', 'Reception was on another line. WiseCall qualified the matter type, confirmed it was not an existing case, captured contact details and flagged it as a same-day callback for the intake team.'],
    ['Estate agent', 'Valuation request', 'Caller asked about selling. WiseCall captured the address, property type and preferred times, then created a structured valuation lead and notified the branch by SMS.'],
    ['Trades business', 'On a job, could not answer', 'Boiler fault marked urgent. WiseCall took the address and fault description, recognised the urgency and routed the caller straight to the on-call mobile.'],
    ['Care provider', 'Family enquiry', 'WiseCall confirmed whether the caller was enquiring for themselves or a relative, captured the details sensitively and passed them to the care coordinator with a clear summary.'],
    ['General office', 'After-hours overflow', 'Instead of voicemail, the caller spoke to WiseCall, got an answer to a common question from the knowledge base and left a captured enquiry ready for the team.'],
  ];
  const body = `${hero({ eyebrow: 'WiseCall in action', h1: 'See How WiseCall <span class="text-[#7de8eb]">Handles a Call</span>', lead: 'These are anonymised examples of the kinds of calls WiseCall handles every day, and the summaries your team receives afterwards. No customer is identifiable.' })}
${trustStrip()}
<section class="px-6 py-20"><div class="max-w-7xl mx-auto">
  <div class="eyebrow mb-6"><i data-lucide="file-text" class="w-4 h-4"></i>Example calls</div>
  <h2 class="text-4xl md:text-5xl font-black mb-10">Anonymised examples by sector</h2>
  <div class="grid md:grid-cols-3 gap-5">${examples.map(([sector, scenario, summary]) => `<div class="card p-7"><div class="text-[#7de8eb] text-sm font-bold mb-1">${esc(sector)}</div><h3 class="text-xl font-bold mb-3">${esc(scenario)}</h3><p class="text-white/66 leading-relaxed text-sm">${esc(summary)}</p></div>`).join('')}</div>
  <p class="text-white/45 text-sm mt-6">Examples are illustrative and anonymised to show typical call handling. They do not identify any individual caller or customer.</p>
</div></section>
<section class="px-6 py-20"><div class="max-w-7xl mx-auto">
  <div class="eyebrow mb-6"><i data-lucide="shield-check" class="w-4 h-4"></i>What stands behind every call</div>
  <h2 class="text-4xl md:text-5xl font-black mb-10">Proof is more than testimonials</h2>
  <div class="grid md:grid-cols-4 gap-4">${[
    ['UK-based setup and support', 'Onboarding and support from a UK team that knows the product, not an offshore script.'],
    ['GDPR-aware data handling', 'Structured, purposeful data capture on UK-based infrastructure, with access controls per team member.'],
    ['Human fallback', 'Every call has a clear next step. When a person is needed, WiseCall routes, books a callback or escalates.'],
    ['Full audit trail', 'Every AI-handled call is logged with a summary, timestamp, duration and outcome you can review.'],
  ].map(([title, text]) => `<div class="card p-6"><h3 class="font-bold text-lg mb-3">${esc(title)}</h3><p class="text-white/62 text-sm leading-relaxed">${esc(text)}</p></div>`).join('')}</div>
</div></section>
${relatedLinks([
  { path: '/how-it-works/', title: 'How WiseCall works', text: 'See the five steps WiseCall follows on every call.' },
  { path: '/resources/missed-call-calculator/', title: 'Missed call calculator', text: 'Estimate what unanswered calls could be costing you.' },
  { path: '/compare/ai-receptionist-uk-comparison/', title: 'Comparison page', text: 'See how AI call answering compares to the alternatives.' },
])}
${ctaBlock('Want to hear it handle your calls?', 'Start a 7-day pilot or book a demo, and see the summaries WiseCall would send your team.')}`;
  return layout(page, body, [organisationSchema(), webPageSchema(page), breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'WiseCall in Action', path: page.path }])]);
}

function renderTranscriptGuide() {
  const page = {
    title: 'Call Transcript Content Guide | WiseCall',
    description:
      'A practical guide for turning WiseCall call transcripts into anonymised FAQs, examples and benchmark content without inventing customer data.',
    path: '/resources/call-transcript-guide/',
  };
  const faqs = [
    {
      question: 'Can call transcripts be used for SEO content?',
      answer:
        'Call transcripts can inform SEO content if personal data is removed, customer permission is respected and the published content uses anonymised patterns rather than exposing individual callers.',
    },
    {
      question: 'What should be removed before using a transcript?',
      answer:
        'Names, phone numbers, addresses, dates of birth, matter details, health information and any other personal or commercially sensitive details should be removed before a transcript pattern is used for content planning.',
    },
  ];
  const body = `${hero({ eyebrow: 'Resource', h1: 'Using Call Transcripts <span class="text-[#7de8eb]">Responsibly</span>', lead: 'WiseCall records and summarises every call. This guide explains how those transcripts can be used to improve your answers and reporting while protecting caller privacy.' })}
<section class="px-6 py-20"><div class="max-w-7xl mx-auto grid md:grid-cols-4 gap-4">${[
  ['Collect', 'Group transcripts by industry, call reason and outcome.'],
  ['Anonymise', 'Remove personal data and commercially sensitive details.'],
  ['Extract', 'Identify repeated questions, objections and caller language.'],
  ['Publish carefully', 'Create FAQs, examples and reports without exposing callers.'],
].map(([title, text]) => `<div class="card p-6"><h2 class="font-bold text-xl mb-3">${esc(title)}</h2><p class="text-white/64 text-sm leading-relaxed">${esc(text)}</p></div>`).join('')}</div></section>
${faqSection(faqs, 'Transcript Content Questions')}
${relatedLinks([
  { path: '/case-studies/', title: 'WiseCall in action', text: 'See anonymised example calls and the summaries your team receives.' },
  { path: '/dental', title: 'Dental FAQs', text: 'See an example of self-contained vertical FAQs.' },
  { path: '/blog/missed-calls-cost-uk-businesses/', title: 'Missed call article', text: 'Use research-led content while transcript data matures.' },
])}
${ctaBlock('Need help turning calls into useful content?', 'Book a demo and we can explain what WiseCall captures and how it can support future reporting.')}`;
  return layout(page, body, [organisationSchema(), webPageSchema(page), breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Resources', path: '/resources/' }, { name: 'Call Transcript Guide', path: page.path }]), faqSchema(faqs)]);
}

function renderBlogPost() {
  const post = blogPosts[0];
  const page = {
    title: `${post.title} | WiseCall`,
    description: post.description,
    path: `/blog/${post.slug}/`,
    type: 'article',
  };
  const faqs = [
    { question: 'Why do missed calls matter for UK businesses?', answer: 'Missed calls matter because many callers contact the next available provider if they cannot speak to someone or leave a useful enquiry. For appointment-led and service businesses, missed calls can mean lost bookings, slower response times and poorer customer experience.' },
    { question: 'How can a business reduce missed calls?', answer: 'A business can reduce missed calls by answering overflow and out-of-hours calls, capturing structured caller information, routing urgent calls and giving staff clear summaries so follow-up happens quickly.' },
  ];
  const body = `${hero({ eyebrow: 'Guide', h1: 'What Missed Calls Cost <span class="text-[#7de8eb]">UK Businesses</span>', lead: post.description })}
<article class="px-6 py-20"><div class="max-w-3xl mx-auto text-white/76 text-lg leading-relaxed space-y-6">
<p>For UK service businesses, the cost of a missed call is rarely just the call itself. It can be a missed appointment, a delayed client intake, a lost valuation request or a customer who contacts a competitor instead.</p>
<h2 class="text-3xl font-black text-white">How to estimate missed-call value</h2>
<p>Start with three inputs: how many calls go unanswered each month, the average value of a successful enquiry, and the percentage of enquiries that normally become customers or bookings. The missed call calculator uses those assumptions to estimate possible monthly opportunity.</p>
<h2 class="text-3xl font-black text-white">Why AI call answering helps</h2>
<p>An AI receptionist can answer immediately, ask consistent questions and send a structured summary to the team. That means callers are not pushed straight to voicemail and staff receive cleaner information for follow-up.</p>
<h2 class="text-3xl font-black text-white">Use cases by sector</h2>
<p>Dental practices can capture new patient and cancellation calls. Law firms can qualify new client enquiries. Estate agents can capture valuation and viewing requests after branch hours.</p>
</div></article>
${missedCallCalculatorBlock()}
${faqSection(faqs, 'Missed Call Questions')}
${relatedLinks([
  { path: '/dental', title: 'Missed calls in dental practices', text: 'See how WiseCall supports dental reception teams.' },
  { path: '/legal', title: 'Missed legal enquiries', text: 'See how WiseCall supports law firm intake.' },
  { path: '/property', title: 'Missed property enquiries', text: 'See how WiseCall supports estate agency branches.' },
])}
${ctaBlock('Turn missed calls into structured enquiries', 'Book a demo to see how WiseCall can capture and route caller details for your business.')}`;
  return layout(page, body, [organisationSchema(), webPageSchema(page), breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Blog', path: '/blog/' }, { name: post.title, path: page.path }]), faqSchema(faqs), {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    author: { '@type': 'Organization', name: site.name },
    publisher: { '@type': 'Organization', name: site.name, logo: { '@type': 'ImageObject', url: route(site.logo) } },
    mainEntityOfPage: route(page.path),
  }]);
}

function renderTrackingDoc() {
  return `# WiseCall SEO Tracking Setup

These placeholders are intentionally not hardcoded into the website because the production IDs are not available yet.

## Manual setup required

${trackingTodos.map((item) => `- ${item}`).join('\n')}

## Recommended event names

- demo_booking_click
- contact_form_submit
- missed_call_calculator_used
- pricing_cta_click
- industry_demo_click
- call_source_landing_page

## Verification

- Google Search Console: verify the domain property, then submit https://wisecall.io/sitemap.xml
- Bing Webmaster Tools: verify the domain property, then submit https://wisecall.io/sitemap.xml
- GA4: add the Measurement ID through the deployment environment or a safe config injection step.
`;
}

function renderRobots() {
  return `User-agent: *
Allow: /

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: GPTBot
Allow: /

User-agent: PerplexityBot
Allow: /

Sitemap: ${site.url}/sitemap.xml
`;
}

function allRoutes() {
  return [
    '/',
    '/pricing/',
    '/how-it-works/',
    '/integrations/',
    '/case-studies/',
    '/industries/',
    ...industries.map((industry) => industryPath(industry)),
    '/trades',
    '/compare/ai-receptionist-uk-comparison/',
    ...comparisonPages.map((comparison) => `/compare/${comparison.slug}/`),
    '/resources/missed-call-calculator/',
    '/resources/call-transcript-guide/',
    '/blog/missed-calls-cost-uk-businesses/',
    '/ai-consultancy',
    '/ai-workshop',
    '/partners',
  ];
}

function renderSitemap() {
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allRoutes().map((path) => `  <url>
    <loc>${route(path)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${path === '/' ? 'weekly' : 'monthly'}</changefreq>
    <priority>${path === '/' ? '1.0' : '0.8'}</priority>
  </url>`).join('\n')}
</urlset>
`;
}

function renderLlms() {
  return `# WiseCall

WiseCall is an AI receptionist and AI voice agent platform for UK businesses. It answers phone calls, qualifies enquiries, captures structured details, supports booking and escalation workflows, and provides call summaries and transcripts.

## Key pages

- Homepage: ${site.url}/
- How WiseCall works: ${site.url}/how-it-works/
- Pricing: ${site.url}/pricing/
- Integrations: ${site.url}/integrations/
- Case studies: ${site.url}/case-studies/
- Industries hub: ${site.url}/industries/
- Dental practices: ${site.url}/dental
- Legal and professional services: ${site.url}/legal
- Estate agents: ${site.url}/property
- AI receptionist UK comparison: ${site.url}/compare/ai-receptionist-uk-comparison/
${comparisonPages.map((c) => `- WiseCall vs ${c.subject}: ${site.url}/compare/${c.slug}/`).join('\n')}
- Missed call calculator: ${site.url}/resources/missed-call-calculator/
- Call transcript guide: ${site.url}/resources/call-transcript-guide/
- Missed calls guide: ${site.url}/blog/missed-calls-cost-uk-businesses/
- Partners: ${site.url}/partners

## Important positioning

- WiseCall is for UK businesses.
- WiseCall combines AI call answering with a business phone system foundation.
- WiseCall is useful for missed call recovery, out-of-hours call handling, overflow cover, structured caller summaries and team routing.
- WiseCall can be used for out-of-hours cover, overflow cover, or full-time AI call handling.
- WiseCall serves UK service businesses including dental practices, law firms, estate agents, trades and care providers.
- WiseCall handles data in a GDPR-aware way on UK-based infrastructure, with call examples published only in anonymised form.
`;
}

async function write(path, content) {
  const file = new URL(path, out);
  await mkdir(new URL('.', file), { recursive: true });
  await writeFile(file, content);
}

async function writePublic(path, content) {
  const file = new URL(path, publicOut);
  await mkdir(new URL('.', file), { recursive: true });
  await writeFile(file, content);
}

async function generate() {
  await write('industries/index.html', renderIndustriesHub());
  await Promise.all(industries.filter((industry) => !industry.legacyPath).map((industry) => write(`industries/${industry.slug}/index.html`, renderIndustryPage(industry))));
  await write('how-it-works/index.html', renderHowItWorks());
  await write('pricing/index.html', renderPricing());
  await write('integrations/index.html', renderIntegrations());
  await write('case-studies/index.html', renderCaseStudies());
  await write('compare/ai-receptionist-uk-comparison/index.html', renderComparison());
  await Promise.all(comparisonPages.map((comparison) => write(`compare/${comparison.slug}/index.html`, renderComparisonPage(comparison))));
  await write('resources/missed-call-calculator/index.html', renderCalculator());
  await write('resources/call-transcript-guide/index.html', renderTranscriptGuide());
  await write('blog/missed-calls-cost-uk-businesses/index.html', renderBlogPost());
  await write('docs/seo-tracking-setup.md', renderTrackingDoc());
  await writePublic('robots.txt', renderRobots());
  await writePublic('sitemap.xml', renderSitemap());
  await writePublic('llms.txt', renderLlms());
}

await generate();
