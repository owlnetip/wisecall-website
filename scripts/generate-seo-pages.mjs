import { mkdir, writeFile } from 'node:fs/promises';
import {
  blogPosts,
  comparisonRows,
  futureIndustries,
  globalFaqs,
  industries,
  integrations,
  site,
  trackingTodos,
  trustSignals,
} from './seo-content.mjs';

const out = new URL('../', import.meta.url);
const publicOut = new URL('../public/', import.meta.url);

const route = (path) => `${site.url}${path}`;
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
  </style>
  ${schemas.map(jsonLd).join('\n  ')}
</head>
<body class="page-bg min-h-screen overflow-x-hidden">
${header()}
<main>
${body}
</main>
${footer()}
<script>lucide.createIcons();</script>
</body>
</html>`;
}

function header() {
  return `<header class="sticky top-0 z-50 backdrop-blur-md bg-[#172929]/82 border-b border-[#7de8eb]/10">
  <nav class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-6">
    <a href="/" class="flex items-center gap-3 text-white font-bold text-lg no-underline"><img src="/owl-logo.png" alt="WiseCall" class="h-9 w-auto">WiseCall</a>
    <div class="hidden md:flex items-center gap-6 text-sm text-white/70">
      <a href="/how-it-works/" class="hover:text-[#7de8eb]">How It Works</a>
      <a href="/pricing/" class="hover:text-[#7de8eb]">Pricing</a>
      <a href="/industries/" class="hover:text-[#7de8eb]">Industries</a>
      <a href="/integrations/" class="hover:text-[#7de8eb]">Integrations</a>
      <a href="/compare/ai-receptionist-uk-comparison/" class="hover:text-[#7de8eb]">Compare</a>
      <a href="/resources/missed-call-calculator/" class="hover:text-[#7de8eb]">Calculator</a>
      <a href="/blog/missed-calls-cost-uk-businesses/" class="hover:text-[#7de8eb]">Resources</a>
    </div>
    <a href="https://app.wisecall.io" class="btn btn-primary px-5 py-2.5 text-sm">Start Free Trial <i data-lucide="arrow-right" class="w-4 h-4"></i></a>
  </nav>
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
      <h2 class="text-white font-bold mb-3 text-base">Priority Pages</h2>
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
        ${industries.map((industry) => `<li><a href="/industries/${industry.slug}/" class="hover:text-[#7de8eb]">${esc(industry.keyword)}</a></li>`).join('')}
      </ul>
    </div>
    <div>
      <h2 class="text-white font-bold mb-3 text-base">AI Search Notes</h2>
      <p class="text-white/60 leading-relaxed">FAQ answers are written as standalone answers for Google snippets, ChatGPT, Perplexity, Gemini and Copilot extraction.</p>
    </div>
  </div>
</footer>`;
}

function hero({ eyebrow, h1, lead, cta = 'Book a Free Demo', secondary = 'Calculate Missed Calls' }) {
  return `<section class="px-6 py-20 md:py-28">
  <div class="max-w-7xl mx-auto grid lg:grid-cols-[1.05fr_.95fr] gap-10 items-center">
    <div>
      <div class="eyebrow mb-7"><i data-lucide="sparkles" class="w-4 h-4"></i>${esc(eyebrow)}</div>
      <h1 class="text-5xl md:text-7xl font-black leading-tight tracking-tight mb-7">${h1}</h1>
      <p class="text-xl md:text-2xl text-white/72 leading-relaxed max-w-3xl mb-9">${esc(lead)}</p>
      <div class="flex flex-col sm:flex-row gap-4">
        <a href="https://app.wisecall.io" class="btn btn-primary px-8 py-4">${esc(cta)} <i data-lucide="arrow-right" class="w-5 h-5"></i></a>
        <a href="/resources/missed-call-calculator/" class="btn btn-secondary px-8 py-4">${esc(secondary)}</a>
      </div>
    </div>
    <div class="card-strong p-7">
      <h2 class="text-2xl font-bold mb-5">What WiseCall does on every call</h2>
      <div class="grid gap-4">
        ${['Answers in your business name', 'Qualifies the caller’s intent', 'Captures structured details', 'Books, routes or escalates', 'Sends summaries and transcripts'].map((item) => `<div class="flex gap-3 text-white/78"><i data-lucide="check-circle-2" class="w-5 h-5 text-[#7de8eb] flex-shrink-0 mt-1"></i><span>${esc(item)}</span></div>`).join('')}
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
      <a href="https://app.wisecall.io" class="btn btn-primary px-8 py-4">Start Free Trial</a>
      <a href="/how-it-works/" class="btn btn-secondary px-8 py-4">See how WiseCall works</a>
    </div>
    <p class="text-white/45 text-sm mt-6">Tracking TODO: demo_booking_click and form_submission conversion events should be connected in GA4 once IDs are available.</p>
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

function missedCallCalculatorBlock() {
  return `<section class="px-6 py-20" id="calculator">
  <div class="max-w-7xl mx-auto grid lg:grid-cols-[.9fr_1.1fr] gap-8 items-start">
    <div>
      <div class="eyebrow mb-6"><i data-lucide="calculator" class="w-4 h-4"></i>Missed Call Calculator</div>
      <h2 class="text-4xl md:text-5xl font-black mb-5">Estimate what unanswered calls may be costing</h2>
      <p class="text-white/70 text-lg leading-relaxed">Use your own figures. This calculator is a planning tool, not a claim about your actual performance.</p>
    </div>
    <div class="card-strong p-6">
      <div class="grid sm:grid-cols-3 gap-4">
        <label class="block text-sm text-white/70">Missed calls per month<input id="missedCalls" type="number" value="20" min="0" class="mt-2 w-full rounded-lg bg-white/8 border border-[#7de8eb]/20 px-4 py-3 text-white"></label>
        <label class="block text-sm text-white/70">Lead value (£)<input id="leadValue" type="number" value="100" min="0" class="mt-2 w-full rounded-lg bg-white/8 border border-[#7de8eb]/20 px-4 py-3 text-white"></label>
        <label class="block text-sm text-white/70">Conversion rate (%)<input id="conversionRate" type="number" value="25" min="0" max="100" class="mt-2 w-full rounded-lg bg-white/8 border border-[#7de8eb]/20 px-4 py-3 text-white"></label>
      </div>
      <div class="mt-6 p-6 rounded-xl bg-[#172929]/70 border border-[#7de8eb]/20">
        <div class="text-white/60 text-sm mb-2">Estimated monthly opportunity</div>
        <div id="calcResult" class="text-4xl font-black text-[#7de8eb]">£500</div>
      </div>
      <script>
        function updateMissedCallCalc() {
          const calls = Number(document.getElementById('missedCalls').value || 0);
          const value = Number(document.getElementById('leadValue').value || 0);
          const rate = Number(document.getElementById('conversionRate').value || 0) / 100;
          document.getElementById('calcResult').textContent = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(calls * value * rate);
        }
        ['missedCalls','leadValue','conversionRate'].forEach((id) => document.getElementById(id).addEventListener('input', updateMissedCallCalc));
        updateMissedCallCalc();
      </script>
    </div>
  </div>
</section>`;
}

function audioAndCasePlaceholders(industry) {
  return `<section class="px-6 py-20 bg-white/[.025]">
  <div class="max-w-7xl mx-auto grid lg:grid-cols-2 gap-6">
    <div class="card p-7">
      <div class="eyebrow mb-5"><i data-lucide="audio-lines" class="w-4 h-4"></i>Sample Call Placeholder</div>
      <h2 class="text-3xl font-black mb-4">60-second ${esc(industry.singular)} call sample</h2>
      <p class="text-white/68 leading-relaxed">Placeholder: add an anonymised or synthetic approved audio sample showing how WiseCall handles a ${esc(industry.leadType)}. Do not publish real customer audio without consent.</p>
    </div>
    <div class="card p-7">
      <div class="eyebrow mb-5"><i data-lucide="file-text" class="w-4 h-4"></i>Case Study Placeholder</div>
      <h2 class="text-3xl font-black mb-4">Proof to add when real data is available</h2>
      <p class="text-white/68 leading-relaxed">Placeholder: add named customer permission, before/after call statistics, anonymised transcript themes and a quote only after they are verified.</p>
    </div>
  </div>
</section>`;
}

function transcriptReadiness() {
  return `<section class="px-6 py-20">
  <div class="max-w-7xl mx-auto">
    <div class="eyebrow mb-6"><i data-lucide="database" class="w-4 h-4"></i>Transcript-to-content readiness</div>
    <h2 class="text-4xl md:text-5xl font-black mb-8">Future content that should come from real call data</h2>
    <div class="grid md:grid-cols-4 gap-4">
      ${[
        ['Anonymised call examples', 'Use approved, anonymised patterns from real calls to explain common caller needs.'],
        ['Transcript-derived FAQs', 'Turn repeated caller questions into self-contained FAQ answers for AI search.'],
        ['Call statistics', 'Publish only aggregated, verified call-handling metrics once enough data exists.'],
        ['Quarterly benchmark reports', 'Create industry benchmark reports from anonymised WiseCall data when statistically meaningful.'],
      ].map(([title, text]) => `<div class="card p-6"><h3 class="font-bold text-lg mb-3">${esc(title)}</h3><p class="text-white/62 text-sm leading-relaxed">${esc(text)}</p></div>`).join('')}
    </div>
  </div>
</section>`;
}

function renderIndustryPage(industry) {
  const page = { title: industry.title, description: industry.description, path: `/industries/${industry.slug}/` };
  const faqs = [...industry.faqs, ...globalFaqs.slice(0, 2)];
  const body = `${hero({
    eyebrow: industry.keyword,
    h1: `${esc(industry.h1)} <span class="text-[#7de8eb]">for UK businesses</span>`,
    lead: industry.heroLead,
    cta: 'Start Your Free Trial',
    secondary: 'Calculate missed calls',
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
${missedCallCalculatorBlock()}
${faqSection(faqs, `Common Questions from ${industry.name}`)}
${transcriptReadiness()}
${relatedLinks([
  { path: '/pricing/', title: `Pricing for ${industry.name}`, text: 'See how WiseCall plans work for UK businesses.' },
  { path: '/how-it-works/', title: 'How WiseCall handles a call', text: 'Understand the call flow, routing and summaries.' },
  { path: '/compare/ai-receptionist-uk-comparison/', title: 'AI receptionist UK comparison', text: 'Compare WiseCall with common alternatives.' },
])}
${ctaBlock(`Ready to capture more ${industry.leadType}s?`, `Book a free demo and see how WiseCall can support your ${industry.singular}.`)}`;
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
${industries.map((industry) => `<a href="/industries/${industry.slug}/" class="card p-7 block hover:border-[#7de8eb]/40"><h2 class="text-2xl font-bold mb-3">${esc(industry.name)}</h2><p class="text-white/65 leading-relaxed">${esc(industry.description)}</p><span class="inline-flex mt-5 text-[#7de8eb] font-bold">View ${esc(industry.keyword)}</span></a>`).join('')}
</div></section>
<section class="px-6 py-20 bg-white/[.025]"><div class="max-w-7xl mx-auto"><h2 class="text-4xl font-black mb-6">Future industry pages</h2><p class="text-white/68 mb-6">The content architecture is ready for these pages once real copy, integrations and FAQs are approved.</p><div class="flex flex-wrap gap-3">${futureIndustries.map((slug) => `<span class="px-4 py-2 rounded-full border border-[#7de8eb]/20 text-white/70">${esc(slug.replaceAll('-', ' '))}</span>`).join('')}</div></div></section>
${ctaBlock('Need an industry page built next?', 'WiseCall can extend this structure for care homes, restaurants, schools and telecoms resellers without duplicating page code.')}`;
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
  { path: '/industries/dental/', title: 'Dental call handling example', text: 'See how WiseCall handles dental patient calls.' },
  { path: '/industries/legal/', title: 'Legal intake example', text: 'See how WiseCall supports law firm intake.' },
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

function renderPricing() {
  const page = {
    title: 'WiseCall Pricing UK | AI Receptionist Plans',
    description: 'Understand WiseCall AI receptionist pricing for UK businesses, including plan structure, AI-handled calls, phone system inclusions and demo options.',
    path: '/pricing/',
  };
  const body = `${hero({ eyebrow: 'Pricing', h1: 'AI Receptionist Pricing <span class="text-[#7de8eb]">for UK Businesses</span>', lead: 'WiseCall pricing is designed around AI-handled inbound calls, team phone system needs and UK support. Book a demo if you need help choosing a plan.' })}
<section class="px-6 py-20"><div class="max-w-7xl mx-auto grid md:grid-cols-3 gap-5">${[
  ['Core', 'For smaller teams that want reliable AI call cover and a complete phone system foundation.'],
  ['Growth', 'For businesses with higher call volume, more routing requirements and regular overflow.'],
  ['Pro', 'For larger teams or businesses with significant call volume and room to scale.'],
].map(([name, text]) => `<div class="card-strong p-7"><h2 class="text-2xl font-bold mb-3">${esc(name)}</h2><p class="text-white/68 leading-relaxed mb-5">${esc(text)}</p><ul class="space-y-2 text-white/70">${['AI receptionist', 'Phone system included', 'UK outbound calling allowance', 'Call summaries and transcripts'].map((item) => `<li class="flex gap-2"><i data-lucide="check" class="text-[#7de8eb] mt-1"></i><span>${esc(item)}</span></li>`).join('')}</ul></div>`).join('')}</div></section>
${faqSection([
  { question: 'How does WiseCall pricing work?', answer: 'WiseCall pricing is based on the plan you choose, the number of AI-handled inbound calls included and the phone system requirements for your team. The best plan depends on your call volume and routing needs.' },
  { question: 'Does the phone system cost extra?', answer: 'WiseCall plans include the AI receptionist and a complete business phone system foundation, so teams do not need to buy a separate basic phone system just to start.' },
  { question: 'What happens if we receive more AI calls than our plan includes?', answer: 'If your business receives more AI-handled inbound calls than your monthly allowance, additional call handling can be charged as overage or moved to a more suitable plan.' },
], 'Pricing Questions')}
${relatedLinks([
  { path: '/compare/ai-receptionist-uk-comparison/', title: 'Compare AI receptionist options', text: 'See how WiseCall compares with human reception and voicemail-led alternatives.' },
  { path: '/resources/missed-call-calculator/', title: 'Calculate missed call value', text: 'Estimate the opportunity cost of unanswered calls before choosing a plan.' },
  { path: '/industries/', title: 'Industry examples', text: 'See how WiseCall applies to different UK sectors.' },
])}
${ctaBlock('Need help choosing a plan?', 'Book a free 15-minute demo and we will recommend a plan based on your current call volume.')}`;
  return layout(page, body, [organisationSchema(), webPageSchema(page), breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Pricing', path: page.path }])]);
}

function renderComparison() {
  const page = {
    title: 'Best AI Receptionist UK Comparison | WiseCall',
    description: 'Compare WiseCall with human receptionist services, voicemail, virtual assistants and generic AI call answering options for UK businesses.',
    path: '/compare/ai-receptionist-uk-comparison/',
  };
  const body = `${hero({ eyebrow: 'Comparison', h1: 'AI Receptionist UK <span class="text-[#7de8eb]">Comparison</span>', lead: 'A practical comparison for UK businesses evaluating AI receptionists, virtual receptionists, voicemail and in-house call handling.' })}
<section class="px-6 py-20"><div class="max-w-7xl mx-auto overflow-x-auto card p-3"><table class="w-full text-left text-sm"><thead><tr class="text-[#7de8eb]"><th class="p-4">Criteria</th><th class="p-4">WiseCall</th><th class="p-4">Human receptionist service</th><th class="p-4">Voicemail / callback</th></tr></thead><tbody>${comparisonRows.map((row) => `<tr class="border-t border-[#7de8eb]/10">${row.map((cell) => `<td class="p-4 text-white/72">${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>
${faqSection([
  { question: 'What is the best AI receptionist for UK businesses?', answer: 'The best AI receptionist for a UK business depends on call volume, routing needs, integrations, compliance expectations and whether a phone system is included. WiseCall is designed for UK service businesses that want AI call answering plus a business phone system foundation.' },
  { question: 'Is an AI receptionist better than voicemail?', answer: 'An AI receptionist is usually more useful than voicemail because it can answer immediately, ask questions, capture structured information and route next steps. Voicemail depends on the caller leaving a message and the team calling back later.' },
], 'AI Receptionist Comparison Questions')}
${relatedLinks([
  { path: '/pricing/', title: 'WiseCall pricing', text: 'Understand the WiseCall plan structure.' },
  { path: '/how-it-works/', title: 'How WiseCall works', text: 'See the call flow behind the comparison.' },
  { path: '/industries/legal/', title: 'AI receptionist for law firms', text: 'Explore a high-intent professional services use case.' },
])}
${ctaBlock('Compare WiseCall against your current setup', 'Book a demo and we will map WiseCall against your current call handling process.')}`;
  return layout(page, body, [organisationSchema(), webPageSchema(page), breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Compare', path: '/compare/' }, { name: 'AI Receptionist UK Comparison', path: page.path }])]);
}

function renderCalculator() {
  const page = {
    title: 'Missed Call Calculator UK | WiseCall',
    description: 'Estimate the potential value of missed calls for a UK business using your own call volume, lead value and conversion-rate assumptions.',
    path: '/resources/missed-call-calculator/',
  };
  const body = `${hero({ eyebrow: 'Resource', h1: 'Missed Call <span class="text-[#7de8eb]">Calculator</span>', lead: 'Estimate the potential monthly opportunity from calls your business does not answer. Use your own inputs and treat the result as a planning estimate.' })}
${missedCallCalculatorBlock()}
${relatedLinks(industries.map((industry) => ({ path: `/industries/${industry.slug}/`, title: industry.keyword, text: `See how missed call recovery applies to ${industry.name.toLowerCase()}.` })))}
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
<section class="px-6 py-20 bg-white/[.025]"><div class="max-w-7xl mx-auto"><h2 class="text-4xl md:text-5xl font-black mb-8">Industry system examples</h2><div class="grid md:grid-cols-3 gap-5">${industries.map((industry) => `<a href="/industries/${industry.slug}/" class="card p-7 block hover:border-[#7de8eb]/40"><h3 class="text-xl font-bold mb-3">${esc(industry.name)}</h3><p class="text-white/62 text-sm leading-relaxed mb-5">${esc(industry.integrations.join(', '))}</p><span class="text-[#7de8eb] font-bold">${esc(industry.keyword)}</span></a>`).join('')}</div></div></section>
${faqSection([
  { question: 'Can WiseCall integrate with our existing CRM?', answer: 'WiseCall can send structured call summaries and caller details into CRM and workflow systems where suitable integration routes are available. The exact setup depends on the CRM, available APIs and the level of automation required.' },
  { question: 'Can WiseCall update calendars?', answer: 'WiseCall can support calendar-led workflows such as callback windows and booking requests where the business has a clear availability process. Live booking depends on the calendar or diary system and the permissions available.' },
  { question: 'Can WiseCall work with our existing phone numbers?', answer: 'WiseCall can usually be configured around existing business call flows, including number routing, overflow rules and escalation paths. The best setup is confirmed during onboarding.' },
], 'Integration Questions')}
${relatedLinks([
  { path: '/how-it-works/', title: 'How call handling works', text: 'See how WiseCall captures details and sends summaries.' },
  { path: '/industries/dental/', title: 'Dental integrations', text: 'See dental practice workflow examples.' },
  { path: '/industries/legal/', title: 'Legal intake systems', text: 'See law firm intake workflow examples.' },
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
    title: 'WiseCall Case Studies | AI Receptionist Results and Placeholders',
    description:
      'A future case study hub for WiseCall AI receptionist examples, with clearly labelled placeholders until verified customer data and permissions are available.',
    path: '/case-studies/',
  };
  const body = `${hero({ eyebrow: 'Case studies', h1: 'Verified Proof <span class="text-[#7de8eb]">Will Live Here</span>', lead: 'This hub is ready for customer stories, but it intentionally avoids invented results. Add only approved, anonymised or named data when available.' })}
<section class="px-6 py-20"><div class="max-w-7xl mx-auto grid md:grid-cols-3 gap-5">${industries.map((industry) => `<div class="card p-7"><div class="eyebrow mb-5"><i data-lucide="file-text" class="w-4 h-4"></i>Placeholder</div><h2 class="text-2xl font-bold mb-3">${esc(industry.name)} case study</h2><p class="text-white/66 leading-relaxed mb-5">Add this only after customer permission, before/after data and anonymised transcript themes are verified.</p><a href="/industries/${industry.slug}/" class="text-[#7de8eb] font-bold">${esc(industry.keyword)}</a></div>`).join('')}</div></section>
${transcriptReadiness()}
${relatedLinks([
  { path: '/resources/call-transcript-guide/', title: 'Call transcript guide', text: 'Prepare anonymised transcript content safely.' },
  { path: '/blog/missed-calls-cost-uk-businesses/', title: 'Missed call guide', text: 'Use the first research-led content page while case studies are being prepared.' },
  { path: '/compare/ai-receptionist-uk-comparison/', title: 'Comparison page', text: 'Support decision-stage buyers without fake proof.' },
])}
${ctaBlock('Have real WiseCall data ready?', 'The next step is to turn approved customer outcomes into one short, verified case study.')}`;
  return layout(page, body, [organisationSchema(), webPageSchema(page), breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Case Studies', path: page.path }])]);
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
  const body = `${hero({ eyebrow: 'Resource', h1: 'Call Transcript <span class="text-[#7de8eb]">Content Guide</span>', lead: 'Use real call patterns to improve FAQs, examples and benchmark reports, but do it carefully and only with anonymised or approved data.' })}
<section class="px-6 py-20"><div class="max-w-7xl mx-auto grid md:grid-cols-4 gap-4">${[
  ['Collect', 'Group transcripts by industry, call reason and outcome.'],
  ['Anonymise', 'Remove personal data and commercially sensitive details.'],
  ['Extract', 'Identify repeated questions, objections and caller language.'],
  ['Publish carefully', 'Create FAQs, examples and reports without exposing callers.'],
].map(([title, text]) => `<div class="card p-6"><h2 class="font-bold text-xl mb-3">${esc(title)}</h2><p class="text-white/64 text-sm leading-relaxed">${esc(text)}</p></div>`).join('')}</div></section>
${faqSection(faqs, 'Transcript Content Questions')}
${relatedLinks([
  { path: '/case-studies/', title: 'Case study placeholders', text: 'See where verified proof can be published later.' },
  { path: '/industries/dental/', title: 'Dental FAQs', text: 'See an example of self-contained vertical FAQs.' },
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
  { path: '/industries/dental/', title: 'Missed calls in dental practices', text: 'See how WiseCall supports dental reception teams.' },
  { path: '/industries/legal/', title: 'Missed legal enquiries', text: 'See how WiseCall supports law firm intake.' },
  { path: '/industries/estate-agents/', title: 'Missed property enquiries', text: 'See how WiseCall supports estate agency branches.' },
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
    ...industries.map((industry) => `/industries/${industry.slug}/`),
    '/compare/ai-receptionist-uk-comparison/',
    '/resources/missed-call-calculator/',
    '/resources/call-transcript-guide/',
    '/blog/missed-calls-cost-uk-businesses/',
    '/ai-consultancy',
    '/ai-workshop',
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
- Dental practices: ${site.url}/industries/dental/
- Legal and professional services: ${site.url}/industries/legal/
- Estate agents: ${site.url}/industries/estate-agents/
- AI receptionist UK comparison: ${site.url}/compare/ai-receptionist-uk-comparison/
- Missed call calculator: ${site.url}/resources/missed-call-calculator/
- Call transcript guide: ${site.url}/resources/call-transcript-guide/
- Missed calls guide: ${site.url}/blog/missed-calls-cost-uk-businesses/

## Important positioning

- WiseCall is for UK businesses.
- WiseCall combines AI call answering with a business phone system foundation.
- WiseCall is useful for missed call recovery, out-of-hours call handling, structured caller summaries and team routing.
- Industry pages include dental practices, law firms and estate agents in the first implementation pass.
- Case studies, benchmark reports and transcript-derived content should only use verified, anonymised or approved customer data.
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
  await Promise.all(industries.map((industry) => write(`industries/${industry.slug}/index.html`, renderIndustryPage(industry))));
  await write('how-it-works/index.html', renderHowItWorks());
  await write('pricing/index.html', renderPricing());
  await write('integrations/index.html', renderIntegrations());
  await write('case-studies/index.html', renderCaseStudies());
  await write('compare/ai-receptionist-uk-comparison/index.html', renderComparison());
  await write('resources/missed-call-calculator/index.html', renderCalculator());
  await write('resources/call-transcript-guide/index.html', renderTranscriptGuide());
  await write('blog/missed-calls-cost-uk-businesses/index.html', renderBlogPost());
  await write('docs/seo-tracking-setup.md', renderTrackingDoc());
  await writePublic('robots.txt', renderRobots());
  await writePublic('sitemap.xml', renderSitemap());
  await writePublic('llms.txt', renderLlms());
}

await generate();
