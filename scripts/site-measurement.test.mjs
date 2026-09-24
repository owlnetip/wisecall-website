import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildTrialUrl,
  classifyVisit,
  isAvaTelHref,
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
  }
});

test('trades visible copy has no em or en dash', () => {
  const html = readFileSync('trades.html', 'utf8');
  const body = html.slice(html.indexOf('<body'));
  assert.equal(/[—–]/.test(body), false);
  assert.equal(/[—–]/.test(html.slice(0, html.indexOf('<body'))), false);
});
