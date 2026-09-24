import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildTrialUrl,
  classifyVisit,
  isAvaTelHref,
  isCallAvaClick,
  isCallAvaTryHref,
  isTrialSetupHref,
  parseAttribution,
} from '../src/site-measurement.ts';

const base = {
  utm_source: '',
  utm_medium: '',
  utm_campaign: '',
};

test('paid google wins on gclid before referrer', () => {
  const result = classifyVisit({
    search: '?gclid=abc&utm_source=google&utm_medium=cpc',
    referrer: 'https://www.google.co.uk/',
    pageHost: 'wisecall.io',
    pathname: '/trades',
  });
  assert.equal(result.src, 'paid_google');
  assert.equal(result.lp, '/trades');
  assert.equal(result.utm_source, 'google');
  assert.equal(result.utm_medium, 'cpc');
});

test('paid google from utm without storing the click id', () => {
  const result = classifyVisit({
    search: '?utm_source=Google&utm_medium=PPC&utm_campaign=brand',
    referrer: '',
    pathname: '/',
  });
  assert.equal(result.src, 'paid_google');
  assert.equal(result.utm_campaign, 'brand');
  assert.equal(JSON.stringify(result).includes('gclid'), false);
});

test('paid meta from fbclid or source', () => {
  assert.equal(
    classifyVisit({ search: '?fbclid=1', referrer: 'https://example.com' }).src,
    'paid_meta',
  );
  assert.equal(classifyVisit({ search: '?utm_source=instagram' }).src, 'paid_meta');
  assert.equal(classifyVisit({ search: '?utm_source=meta' }).src, 'paid_meta');
});

test('gclid beats fbclid', () => {
  assert.equal(classifyVisit({ search: '?fbclid=1&gclid=2' }).src, 'paid_google');
});

test('gbraid is paid google even with a google referrer', () => {
  const result = classifyVisit({
    search: '?gbraid=x',
    referrer: 'https://www.google.co.uk/search?q=wisecall',
    pageHost: 'wisecall.io',
  });
  assert.equal(result.src, 'paid_google');
  assert.equal(JSON.stringify(result).includes('gbraid'), false);
});

test('wbraid is paid google with no referrer', () => {
  const result = classifyVisit({ search: '?wbraid=x', referrer: '' });
  assert.equal(result.src, 'paid_google');
  assert.equal(JSON.stringify(result).includes('wbraid'), false);
});

test('google ads and adwords sources are paid google', () => {
  assert.equal(classifyVisit({ search: '?utm_source=google_ads' }).src, 'paid_google');
  assert.equal(classifyVisit({ search: '?utm_source=Google_Ads' }).src, 'paid_google');
  assert.equal(classifyVisit({ search: '?utm_source=ADWORDS' }).src, 'paid_google');
  assert.equal(classifyVisit({ search: '?utm_source=adwords', referrer: 'https://www.bing.com/' }).src, 'paid_google');
});

test('fb and ig sources are paid meta', () => {
  assert.equal(classifyVisit({ search: '?utm_source=fb' }).src, 'paid_meta');
  assert.equal(classifyVisit({ search: '?utm_source=FB' }).src, 'paid_meta');
  assert.equal(classifyVisit({ search: '?utm_source=ig' }).src, 'paid_meta');
  assert.equal(classifyVisit({ search: '?utm_source=IG', referrer: 'https://www.google.co.uk/' }).src, 'paid_meta');
});

test('microsoft click ids and bing paid mediums are paid other, not organic bing', () => {
  assert.equal(
    classifyVisit({ search: '?msclkid=x', referrer: 'https://www.bing.com/search?q=wisecall' }).src,
    'paid_other',
  );
  assert.equal(classifyVisit({ search: '?utm_source=bing&utm_medium=cpc' }).src, 'paid_other');
  assert.equal(classifyVisit({ search: '?utm_source=Bing&utm_medium=PPC', referrer: 'https://www.bing.com/' }).src, 'paid_other');
  assert.equal(classifyVisit({ search: '?utm_source=bing&utm_medium=paid' }).src, 'paid_other');
  assert.equal(classifyVisit({ referrer: 'https://www.bing.com/search?q=x' }).src, 'organic_bing');
  assert.equal(classifyVisit({ search: '?utm_source=bing', referrer: 'https://www.bing.com/' }).src, 'organic_bing');
  assert.equal(classifyVisit({ search: '?utm_source=microsoft' }).src, 'paid_other');
  assert.equal(classifyVisit({ search: '?utm_source=BingAds', referrer: 'https://www.bing.com/' }).src, 'paid_other');
});

test('brave yandex and startpage are organic other', () => {
  assert.equal(classifyVisit({ referrer: 'https://search.brave.com/search?q=ai' }).src, 'organic_other');
  assert.equal(classifyVisit({ referrer: 'https://yandex.ru/search/?text=ai' }).src, 'organic_other');
  assert.equal(classifyVisit({ referrer: 'https://www.yandex.com/search/?text=ai' }).src, 'organic_other');
  assert.equal(classifyVisit({ referrer: 'https://yandex.com.tr/search/?text=ai' }).src, 'organic_other');
  assert.equal(classifyVisit({ referrer: 'https://yandex.by/search/?text=ai' }).src, 'organic_other');
  assert.equal(classifyVisit({ referrer: 'https://www.yandex.kz/search/?text=ai' }).src, 'organic_other');
  assert.equal(classifyVisit({ referrer: 'https://ya.ru/search/?text=ai' }).src, 'organic_other');
  assert.equal(classifyVisit({ referrer: 'https://www.startpage.com/sp/search' }).src, 'organic_other');
  assert.equal(classifyVisit({ referrer: 'https://not-yandex.example/search' }).src, 'referral');
  assert.equal(classifyVisit({ referrer: 'https://yandex.example.com/search' }).src, 'referral');
});

test('google product hosts are referral, not organic google', () => {
  assert.equal(classifyVisit({ referrer: 'https://mail.google.com/mail/u/0/' }).src, 'referral');
  assert.equal(classifyVisit({ referrer: 'https://docs.google.com/document/d/abc' }).src, 'referral');
  assert.equal(
    classifyVisit({ referrer: 'https://www.google.co.uk/search?q=ai', pageHost: 'wisecall.io' }).src,
    'organic_google',
  );
});

test('google app news and images are organic google', () => {
  assert.equal(
    classifyVisit({ referrer: 'android-app://com.google.android.googlequicksearchbox' }).src,
    'organic_google',
  );
  assert.equal(
    classifyVisit({ referrer: 'android-app://com.google.android.googlequicksearchbox/https/www.google.com' }).src,
    'organic_google',
  );
  assert.equal(
    classifyVisit({ referrer: 'android-app://com.google.android.googlequicksearchbox/https/www.google.com/search?q=ai' }).src,
    'organic_google',
  );
  assert.equal(classifyVisit({ referrer: 'https://news.google.com/' }).src, 'organic_google');
  assert.equal(classifyVisit({ referrer: 'https://news.google.co.uk/articles/abc' }).src, 'organic_google');
  assert.equal(classifyVisit({ referrer: 'https://news.google.com.au/' }).src, 'organic_google');
  assert.equal(classifyVisit({ referrer: 'https://images.google.com/' }).src, 'organic_google');
  assert.equal(classifyVisit({ referrer: 'https://images.google.co.uk/search?q=ai' }).src, 'organic_google');
  assert.equal(classifyVisit({ referrer: 'https://images.google.com.au/' }).src, 'organic_google');
  assert.equal(classifyVisit({ referrer: 'https://mail.google.com/mail/u/0/' }).src, 'referral');
  assert.equal(classifyVisit({ referrer: 'https://docs.google.com/document/d/abc' }).src, 'referral');
  assert.equal(classifyVisit({ referrer: 'android-app://com.google.android.gm' }).src, 'referral');
});

test('organic referrers', () => {
  assert.equal(
    classifyVisit({ referrer: 'https://www.google.co.uk/search?q=ai', pageHost: 'wisecall.io' }).src,
    'organic_google',
  );
  assert.equal(classifyVisit({ referrer: 'https://www.bing.com/search?q=x' }).src, 'organic_bing');
  assert.equal(classifyVisit({ referrer: 'https://duckduckgo.com/' }).src, 'organic_other');
  assert.equal(classifyVisit({ referrer: 'https://uk.search.yahoo.com/search' }).src, 'organic_other');
  assert.equal(classifyVisit({ referrer: 'https://www.ecosia.org/search' }).src, 'organic_other');
});

test('referral and direct', () => {
  assert.equal(classifyVisit({ referrer: 'https://news.example.co.uk/story' }).src, 'referral');
  assert.equal(classifyVisit({ referrer: '', pageHost: 'wisecall.io' }).src, 'direct');
  assert.equal(
    classifyVisit({ referrer: 'https://wisecall.io/pricing/', pageHost: 'www.wisecall.io', pathname: '/trades' }).src,
    'direct',
  );
  assert.equal(
    classifyVisit({ referrer: 'https://www.wisecall.io/', pageHost: 'wisecall.io' }).src,
    'direct',
  );
});

test('trial url keeps trial=calls first and passes utm', () => {
  const href = buildTrialUrl(
    'https://app.wisecall.io/setup?trial=calls',
    {
      ...base,
      src: 'organic_google',
      lp: '/trades/plumbers',
      utm_source: 'google',
      utm_medium: 'organic',
      utm_campaign: 'spring',
    },
  );
  assert.equal(
    href,
    'https://app.wisecall.io/setup?trial=calls&src=organic_google&lp=%2Ftrades%2Fplumbers&utm_source=google&utm_medium=organic&utm_campaign=spring',
  );
});

test('trial url keeps extra params and ignores other links', () => {
  const href = buildTrialUrl('https://app.wisecall.io/setup?website=https%3A%2F%2Fa.co.uk&trial=calls', {
    ...base,
    src: 'direct',
    lp: '/',
  });
  assert.equal(href, 'https://app.wisecall.io/setup?trial=calls&src=direct&lp=%2F&website=https%3A%2F%2Fa.co.uk');
  assert.equal(buildTrialUrl('https://app.wisecall.io/?signup=1&redirect=/billing', { ...base, src: 'direct', lp: '/' }), null);
  assert.equal(buildTrialUrl('/try', { ...base, src: 'direct', lp: '/' }), null);
  assert.equal(isTrialSetupHref('https://app.wisecall.io/setup?trial=calls&src=direct'), true);
});

test('ava telephone numbers', () => {
  assert.equal(isAvaTelHref('tel:+441135222277'), true);
  assert.equal(isAvaTelHref('tel:01135222277'), true);
  assert.equal(isAvaTelHref('tel:+44-113-522-2277'), true);
  assert.equal(isAvaTelHref('tel:+441135222278'), false);
  assert.equal(isAvaTelHref('https://wisecall.io'), false);
});

test('call ava tracks the try page label and the telephone link', () => {
  assert.equal(isCallAvaTryHref('/try'), true);
  assert.equal(isCallAvaTryHref('/try/'), true);
  assert.equal(isCallAvaTryHref('https://wisecall.io/try'), true);
  assert.equal(isCallAvaTryHref('https://example.com/try'), false);
  assert.equal(isCallAvaClick('/try', 'Call Ava'), true);
  assert.equal(isCallAvaClick('/try', 'Call Ava: 0113 522 2277'), true);
  assert.equal(isCallAvaClick('/try', 'hear Ava answer a real call'), false);
  assert.equal(isCallAvaClick('tel:+441135222277', 'Call the number'), true);
  assert.equal(isCallAvaClick('tel:+441135222278', 'Call Ava'), false);
});

test('stored attribution rejects junk', () => {
  assert.equal(parseAttribution(null), null);
  assert.equal(parseAttribution('{"src":"nope","lp":"/"}'), null);
  assert.deepEqual(parseAttribution('{"src":"direct","lp":"/trades"}'), {
    src: 'direct',
    lp: '/trades',
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
  });
});

test('html keeps a plain trial href for no-js', () => {
  const files = [
    'trades.html',
    'dental.html',
    'legal.html',
    'property.html',
    'trades/plumbers/index.html',
    'trades/electricians/index.html',
    'compare/wisecall-vs-fonio/index.html',
    'compare/ai-receptionist-uk-comparison/index.html',
    'compare/wisecall-vs-voicemail/index.html',
    'compare/wisecall-vs-answering-service/index.html',
  ];
  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    assert.match(html, /href="https:\/\/app\.wisecall\.io\/setup\?trial=calls"/, file);
    assert.equal(html.includes('setup?trial=calls&src='), false, file);
    assert.equal(html.includes('app.wisecall.io/?signup=1&redirect=/billing'), false, file);
    assert.equal(/href="tel:[^"]*" data-cta-position=/.test(html), false, file);
    assert.match(html, /href="\/try" data-cta-position="hero"/, file);
  }
});

test('trades copy does not sell a 7-day pilot', () => {
  const html = readFileSync('trades.html', 'utf8');
  const visible = html.slice(0, html.indexOf('<script'));
  assert.equal(/pilot|7-day|7 days/i.test(visible), false);
});

test('care homes calculator uses the trial link without an em dash', () => {
  const html = readFileSync('industries/care-homes/index.html', 'utf8');
  assert.match(html, /Stop the leak\. Try WiseCall now\./);
  assert.match(html, /href="https:\/\/app\.wisecall\.io\/setup\?trial=calls"/);
  assert.equal(html.includes('signup=1'), false);
  assert.equal(html.includes('Stop the leak —'), false);
});

test('trades visible copy has no em or en dash', () => {
  const html = readFileSync('trades.html', 'utf8');
  const body = html.slice(html.indexOf('<body'));
  assert.equal(/[—–]/.test(body), false);
  assert.equal(/[—–]/.test(html.slice(0, html.indexOf('<body'))), false);
});

test('electricians page marks hero, inline and footer pairs and keeps FAQ JSON in sync', () => {
  const html = readFileSync('trades/electricians/index.html', 'utf8');
  assert.equal(/[—–]/.test(html), false);
  for (const position of ['hero', 'inline', 'footer']) {
    assert.match(
      html,
      new RegExp(`href="https://app\\.wisecall\\.io/setup\\?trial=calls" data-cta-position="${position}"`),
      position,
    );
    assert.match(html, new RegExp(`href="/try" data-cta-position="${position}"[\\s\\S]*Call Ava: 0113 522 2277`), position);
  }
  assert.equal(html.includes('book a demo') || html.includes('Book a demo'), false);
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) =>
    JSON.parse(match[1]),
  );
  const faq = blocks.find((block) => block['@type'] === 'FAQPage');
  assert.ok(faq);
  assert.equal(faq.mainEntity.length, 6);
  for (const item of faq.mainEntity) {
    assert.ok(html.includes(item.name), item.name);
    assert.ok(html.includes(item.acceptedAnswer.text), item.name);
  }
});
