/**
 * WiseCall marketing analytics — Meta Pixel, GA4, UTM capture, conversion events.
 *
 * Configure via meta tags (injected at deploy from env) or window globals:
 *   <meta name="wisecall:meta-pixel-id" content="YOUR_PIXEL_ID">
 *   <meta name="wisecall:ga4-id" content="G-XXXXXXXX">
 */
(function () {
  'use strict';

  var UTM_KEYS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'fbclid',
    'gclid',
  ];
  var UTM_STORAGE_KEY = 'wisecall_utms';

  function readMeta(name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    return el && el.content ? el.content.trim() : '';
  }

  function readConfig() {
    return {
      metaPixelId:
        readMeta('wisecall:meta-pixel-id') ||
        (window.WISECALL_META_PIXEL_ID || ''),
      ga4Id: readMeta('wisecall:ga4-id') || (window.WISECALL_GA4_ID || ''),
    };
  }

  function readPageContext() {
    return {
      page: document.body.getAttribute('data-wc-page') || 'unknown',
      path: window.location.pathname,
      referrer: document.referrer || '',
    };
  }

  function parseUtmsFromSearch(search) {
    var params = new URLSearchParams(search || window.location.search);
    var utms = {};
    UTM_KEYS.forEach(function (key) {
      var value = params.get(key);
      if (value) utms[key] = value;
    });
    return utms;
  }

  function loadStoredUtms() {
    try {
      var raw = sessionStorage.getItem(UTM_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_error) {
      return {};
    }
  }

  function storeUtms(utms) {
    if (!utms || !Object.keys(utms).length) return;
    try {
      var existing = loadStoredUtms();
      sessionStorage.setItem(
        UTM_STORAGE_KEY,
        JSON.stringify(Object.assign({}, existing, utms))
      );
    } catch (_error) {
      /* ignore private browsing */
    }
  }

  function getUtms() {
    return loadStoredUtms();
  }

  function appendUtmsToUrl(url) {
    var utms = getUtms();
    if (!Object.keys(utms).length) return url;

    try {
      var next = new URL(url, window.location.origin);
      Object.keys(utms).forEach(function (key) {
        if (!next.searchParams.has(key)) next.searchParams.set(key, utms[key]);
      });
      return next.toString();
    } catch (_error) {
      return url;
    }
  }

  function initUtms() {
    var incoming = parseUtmsFromSearch(window.location.search);
    storeUtms(incoming);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.async = true;
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function initMetaPixel(pixelId) {
    if (!pixelId || window.fbq) return;

    window.fbq =
      window.fbq ||
      function () {
        window.fbq.callMethod
          ? window.fbq.callMethod.apply(window.fbq, arguments)
          : window.fbq.queue.push(arguments);
      };
    if (!window._fbq) window._fbq = window.fbq;
    window.fbq.push = window.fbq;
    window.fbq.loaded = true;
    window.fbq.version = '2.0';
    window.fbq.queue = [];

    loadScript('https://connect.facebook.net/en_GB/fbevents.js')
      .then(function () {
        window.fbq('init', pixelId);
        window.fbq('track', 'PageView');
      })
      .catch(function () {
        /* ad blockers */
      });
  }

  function initGa4(measurementId) {
    if (!measurementId || window.gtag) return;

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', measurementId, { send_page_view: true });

    loadScript(
      'https://www.googletagmanager.com/gtag/js?id=' +
        encodeURIComponent(measurementId)
    ).catch(function () {
      /* ad blockers */
    });
  }

  function track(eventName, params) {
    var payload = Object.assign({}, readPageContext(), getUtms(), params || {});

    if (typeof window.fbq === 'function') {
      window.fbq('trackCustom', eventName, payload);
    }

    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, payload);
    }

    if (window.WISECALL_ANALYTICS_DEBUG) {
      console.info('[WiseCall analytics]', eventName, payload);
    }
  }

  function bindDemoCallLinks() {
    document.querySelectorAll('a[href^="tel:"]').forEach(function (link) {
      if (link.dataset.wcTrackedDemo === '1') return;
      link.dataset.wcTrackedDemo = '1';
      link.addEventListener('click', function () {
        track('demo_call_click', {
          demo_number: link.getAttribute('href'),
          label: link.getAttribute('aria-label') || link.textContent.trim(),
        });
      });
    });
  }

  function bindPilotLinks() {
    document.querySelectorAll('a.wc-pilot-link, a[href*="app.wisecall.io"][href*="signup"]').forEach(
      function (link) {
        if (link.dataset.wcTrackedPilot === '1') return;
        link.dataset.wcTrackedPilot = '1';

        var enhanced = appendUtmsToUrl(link.href);
        if (enhanced !== link.href) link.href = enhanced;

        link.addEventListener('click', function () {
          track('pilot_cta_click', {
            destination: link.href,
            inquiry: link.getAttribute('data-inquiry') || '',
          });
        });
      }
    );
  }

  function bindTrackedElements() {
    document.querySelectorAll('[data-wc-track]').forEach(function (el) {
      if (el.dataset.wcTracked === '1') return;
      el.dataset.wcTracked = '1';
      el.addEventListener('click', function () {
        track(el.getAttribute('data-wc-track'), {
          label: el.getAttribute('data-wc-label') || el.textContent.trim(),
        });
      });
    });
  }

  function bindCalculator(rootId) {
    var root = document.getElementById(rootId);
    if (!root || root.dataset.wcTrackedCalc === '1') return;
    root.dataset.wcTrackedCalc = '1';

    var fired = false;
    root.querySelectorAll('input, select').forEach(function (input) {
      input.addEventListener(
        'input',
        function () {
          if (fired) return;
          fired = true;
          track('missed_call_calculator_used', { calculator: rootId });
        },
        { once: true }
      );
    });
  }

  function enhanceDemoCallbackPayload(basePayload) {
    return Object.assign({}, basePayload || {}, {
      utm: getUtms(),
      landing_page: window.location.pathname,
      referrer: document.referrer || null,
    });
  }

  function init() {
    var config = readConfig();
    initUtms();
    initMetaPixel(config.metaPixelId);
    initGa4(config.ga4Id);
    bindDemoCallLinks();
    bindPilotLinks();
    bindTrackedElements();
    bindCalculator('calculator');
  }

  window.WiseCallAnalytics = {
    track: track,
    getUtms: getUtms,
    appendUtmsToUrl: appendUtmsToUrl,
    enhanceDemoCallbackPayload: enhanceDemoCallbackPayload,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
