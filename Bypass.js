// ==UserScript==
// @name         Exeygo Helper — 2026 flow (Continue → Turnstile → pixeldrain)
// @namespace    local
// @version      3.1.0
// @description  Updated rewrite for exe.io / exey.io / exeygo.com. Waits for the real "Continue" gate to unlock, handles the Turnstile step, decodes the base64 ?url= payload, skips the final countdown and lands on the pixeldrain link.
// @match        *://*.exe.io/*
// @match        *://*.exey.io/*
// @match        *://*.exeygo.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

/*
 * v3.1 — why the "Please disable Adblock" bounce happened
 * ---------------------------------------------------------------
 * v3.0 tried to POST #before-captcha as soon as the form existed
 * (requestSubmit, then a raw form.submit() after two attempts). The
 * shortener validates that POST server-side: if its own ad check has not
 * passed, it responds by re-rendering step 1 with
 * "Please disable Adblock to proceed to the destination page."
 * That is exactly the loop that was reported.
 *
 * Two things caused the check to fail:
 *   1. v2.x/v3.0 blocked the ad scripts by URL (wingsmob, cleverwebserver,
 *      netpub, dampedvisored). The shortener detects that and refuses.
 *   2. Posting before the Continue button unlocked skipped the gate.
 *
 * v3.1 therefore:
 *   - does NOT block ad scripts by default (CFG.blockAds = false);
 *   - waits for the site's own Continue button to become enabled and
 *     clicks it, so the page performs its own ad validation;
 *   - never raw-POSTs step 1;
 *   - detects the adblock message and stops instead of looping;
 *   - keeps the parts that do work: Turnstile auto-submit, ?url= base64
 *     jump straight to the media host, countdown acceleration, popunder
 *     and back-button defusing.
 *
 * If the wall still appears, your browser (uBlock / Brave Shields /
 * AdGuard) is blocking the ad script itself. Whitelist exe.io — no
 * userscript can fake that server-side check.
 */

(function () {
    'use strict';
    if (window.top !== window.self) return;
    if (window.__exgHelper) return;
    window.__exgHelper = true;

    /* ------------------------------------------------------------------
     * 0. Config
     * ------------------------------------------------------------------ */
    const CFG = {
        timerFactor: 0.7,       // 1000 ms countdown tick -> 700 ms
        blockAds: false,        // true WILL trip the adblock gate; leave false
        submitRetryMs: 2500,    // min gap between two submit attempts
        captchaHintMs: 9000     // show "tick the checkbox" after this
    };

    /* ------------------------------------------------------------------
     * 1. Native refs + toString disguise
     * ------------------------------------------------------------------ */
    const _setInterval    = window.setInterval;
    const _setTimeout     = window.setTimeout;
    const _createElement  = Document.prototype.createElement;
    const _defineProperty = Object.defineProperty;
    const _toString       = Function.prototype.toString;
    const _getComputedStyle = window.getComputedStyle;

    const NATIVE = 'function () { [native code] }';
    const nativeMap = new WeakMap();

    const fakeToString = function toString() {
        if (nativeMap.has(this)) return nativeMap.get(this);
        return _toString.call(this);
    };
    nativeMap.set(fakeToString, NATIVE);

    try {
        _defineProperty(Function.prototype, 'toString', {
            value: fakeToString, writable: true, configurable: true, enumerable: false
        });
    } catch (e) {}

    function disguise(fn, nativeName) {
        nativeMap.set(fn, 'function ' + nativeName + '() { [native code] }');
        try { _defineProperty(fn, 'name', { value: nativeName, configurable: true }); } catch (e) {}
        return fn;
    }

    /* ------------------------------------------------------------------
     * 2. Target / ad host rules
     * ------------------------------------------------------------------ */
    const TARGET_RE = /(pixeldrain\.(com|net)|mega\.nz|mega\.co\.nz|mediafire\.com|drive\.google\.com|docs\.google\.com|1fichier\.com|gofile\.io|krakenfiles\.com|qiwi\.gg|rapidgator\.net|ddownload\.com|katfile\.com|nitroflare\.com|turbobit\.net|filecrypt\.|clicknupload\.|drop\.download)/i;

    const AD_HOST_RE = /(justkoalas|wingsmob|dampedvisored|cleverwebserver|netpub\.media|popads|popcash|propellerads|adsterra|hilltopads|monetag|onclickads|llvpn|doubleclick|googlesyndication|googleadservices|adservice|mgid\.com)/i;

    function urlOf(v) {
        if (!v) return '';
        try { return new URL(v, location.href).href; } catch (e) { return ''; }
    }

    function isTarget(u) {
        return /^https?:/i.test(u || '') && TARGET_RE.test(u) && !AD_HOST_RE.test(u);
    }

    /* ------------------------------------------------------------------
     * 3. HUD (built with the ORIGINAL createElement, before it is hooked)
     * ------------------------------------------------------------------ */
    const hud = (function buildHud() {
        const host = _createElement.call(document, 'div');
        host.id = '_exg_hud';
        host.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;';

        let txtEl, dotEl;
        if (host.attachShadow) {
            const root = host.attachShadow({ mode: 'closed' });
            const box = _createElement.call(document, 'div');
            box.style.cssText = [
                'font:12px/1.35 ui-monospace,Menlo,Consolas,monospace',
                'background:rgba(20,20,24,.85)',
                'color:#e8e8ea',
                'padding:6px 10px',
                'border-radius:8px',
                'box-shadow:0 2px 10px rgba(0,0,0,.35)',
                'border:1px solid rgba(255,255,255,.12)',
                'max-width:60vw',
                'white-space:nowrap',
                'overflow:hidden',
                'text-overflow:ellipsis',
                'backdrop-filter:blur(4px)'
            ].join(';');
            box.innerHTML = '<span style="color:#4ade80;margin-right:6px">●</span><span>exeygo helper: ready</span>';
            dotEl = box.firstChild;
            txtEl = box.lastChild;
            root.appendChild(box);
        } else {
            host.textContent = 'exeygo helper: ready';
            host.style.cssText += ';font:12px monospace;background:#141418cc;color:#fff;padding:4px 8px;border-radius:6px';
            dotEl = { style: {} };
            txtEl = host;
        }

        let tries = 0;
        (function mount() {
            if (document.body) { document.body.appendChild(host); return; }
            if (++tries > 300) return;
            _setTimeout.call(window, mount, 100);
        })();

        let lastMsg = '', lastColor = '';
        let flashTimer = null;

        function set(msg, color) {
            color = color || '#4ade80';
            if (msg === lastMsg && color === lastColor) return;
            lastMsg = msg;
            lastColor = color;
            txtEl.textContent = 'exeygo helper: ' + msg;
            dotEl.style.color = color;
        }

        function flash(msg, color) {
            if (flashTimer) clearTimeout(flashTimer);
            set(msg, color || '#fbbf24');
            flashTimer = _setTimeout.call(window, function () {
                lastMsg = '';
                set('watching page', '#4ade80');
            }, 1800);
        }

        return { set, flash };
    })();

    hud.set('initialising', '#60a5fa');

    /* ------------------------------------------------------------------
     * 4. Adblock-detector appeasement
     *
     * The shortener uses the usual bait-element + BlockAdBlock style
     * checks. Ad scripts are NOT blocked by default, but browser-level
     * blockers still hide the bait, so we force the bait to report a
     * normal size. This is not a substitute for whitelisting: if the
     * server itself checks, only a whitelist helps.
     * ------------------------------------------------------------------ */
    (function appeaseDetector() {
        try {
            window.canRunAds = true;
            window.isAdBlockActive = false;
            window.adblock = false;
            window.adBlockerDetected = false;
            window.isAdBlockDetected = false;
            window.adBlockDetected = false;
            window.adsbygoogle = window.adsbygoogle || [];
            window.adsbygoogle.loaded = true;
        } catch (e) {}

        // NB: deliberately no blockAdBlock / fuckAdBlock stub. The gate may
        // enable the Continue button from blockAdBlock.onNotDetected(), and
        // swallowing that callback would stall the page forever. Letting the
        // real detector run against our spoofed bait is the safer path.

        const BAIT_RE = /(^|[\s_-])(ads?box|ad-?banner|ad-?container|ad-?placement|adsbygoogle|text-?ad|advertisement|ad_?rect|ad_?element|sponsor)([\s_-]|$)/i;

        function isBait(el) {
            if (!el || el.nodeType !== 1) return false;
            const id = el.id;
            const className = el.className;
            if (!id && !className) return false;
            const cls = typeof className === 'string' ? className : '';
            const name = (id || '') + ' ' + cls;
            return name.length > 2 && (BAIT_RE.test(name) || name.indexOf('google_ads_iframe') !== -1);
        }

        const dims = [
            ['offsetHeight', 250], ['offsetWidth', 300],
            ['clientHeight', 250], ['clientWidth', 300]
        ];

        dims.forEach(function (pair) {
            const prop = pair[0];
            const value = pair[1];
            const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
            if (!desc || !desc.get) return;
            try {
                _defineProperty(HTMLElement.prototype, prop, {
                    configurable: true,
                    get: function () {
                        try { if (isBait(this)) return value; } catch (e) {}
                        return desc.get.call(this);
                    }
                });
            } catch (e) {}
        });

        try {
            _defineProperty(window, 'getComputedStyle', {
                configurable: true,
                writable: true,
                value: disguise(function getComputedStyle(el, pseudo) {
                    const s = _getComputedStyle.call(window, el, pseudo);
                    if (!isBait(el)) return s;
                    return new Proxy(s, {
                        get: function (t, p) {
                            if (p === 'display') return 'block';
                            if (p === 'visibility') return 'visible';
                            if (p === 'opacity') return '1';
                            const v = t[p];
                            return typeof v === 'function' ? v.bind(t) : v;
                        }
                    });
                }, 'getComputedStyle')
            });
        } catch (e) {}
    })();

    /* ------------------------------------------------------------------
     * 5. Timer acceleration (the 6 s counter ticks at 1000 ms)
     * ------------------------------------------------------------------ */
    function compress(delay) {
        if (typeof delay !== 'number') return delay;
        if (delay >= 900 && delay <= 1100) return Math.max(250, Math.round(delay * CFG.timerFactor));
        return delay;
    }

    const fastInterval = disguise(function setInterval(fn, delay) {
        const args = Array.prototype.slice.call(arguments, 2);
        return _setInterval.apply(window, [fn, compress(delay)].concat(args));
    }, 'setInterval');

    const fastTimeout = disguise(function setTimeout(fn, delay) {
        const args = Array.prototype.slice.call(arguments, 2);
        return _setTimeout.apply(window, [fn, compress(delay)].concat(args));
    }, 'setTimeout');

    try {
        _defineProperty(window, 'setInterval', { value: fastInterval, writable: true, configurable: true });
        _defineProperty(window, 'setTimeout',  { value: fastTimeout,  writable: true, configurable: true });
    } catch (e) {}

    /* ------------------------------------------------------------------
     * 6. Optional ad-script blocking (off by default — it trips the gate)
     * ------------------------------------------------------------------ */
    if (CFG.blockAds) {
        const patchedCreateElement = disguise(function createElement(tag, options) {
            const el = _createElement.call(document, tag, options);
            if (typeof tag === 'string' && tag.toLowerCase() === 'script') {
                const origSetAttr = el.setAttribute;
                el.setAttribute = function (name, value) {
                    if (name === 'src' && typeof value === 'string' && AD_HOST_RE.test(value)) return;
                    return origSetAttr.call(this, name, value);
                };
                try {
                    const desc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
                    if (desc && desc.set) {
                        _defineProperty(el, 'src', {
                            configurable: true,
                            get: function () { return desc.get.call(this); },
                            set: function (v) {
                                if (typeof v === 'string' && AD_HOST_RE.test(v)) return;
                                desc.set.call(this, v);
                            }
                        });
                    }
                } catch (e) {}
            }
            return el;
        }, 'createElement');

        try {
            _defineProperty(Document.prototype, 'createElement', {
                value: patchedCreateElement, writable: true, configurable: true
            });
        } catch (e) {}
    }

    /* ------------------------------------------------------------------
     * 7. Visibility spoof + popup / history-hijack defusing
     * ------------------------------------------------------------------ */
    const spoof = function (obj, prop, value) {
        try { _defineProperty(obj, prop, { get: function () { return value; }, configurable: true }); } catch (e) {}
    };
    spoof(document, 'hidden', false);
    spoof(document, 'visibilityState', 'visible');
    spoof(document, 'webkitHidden', false);
    spoof(document, 'webkitVisibilityState', 'visible');

    const swallow = function (e) { e.stopImmediatePropagation(); };
    window.addEventListener('visibilitychange', swallow, true);
    window.addEventListener('webkitvisibilitychange', swallow, true);
    window.addEventListener('blur', swallow, true);
    window.addEventListener('popstate', swallow, true);

    try {
        window.open = disguise(function open() { return null; }, 'open');
    } catch (e) {}

    try {
        const _pushState = history.pushState;
        history.pushState = function (state, title, url) {
            if (url && AD_HOST_RE.test(String(url))) return;
            return _pushState.apply(this, arguments);
        };
    } catch (e) {}

    /* ------------------------------------------------------------------
     * 8. Flow helpers
     * ------------------------------------------------------------------ */
    let done = false;
    let navigating = false;

    function textOf(el) {
        if (!el) return '';
        if (el.tagName === 'INPUT') return String(el.value || '');
        return String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function isVisible(el) {
        if (!el || !el.isConnected) return false;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const s = _getComputedStyle.call(window, el);
        return s.visibility !== 'hidden' && s.display !== 'none';
    }

    function short(s, n) {
        s = String(s || '');
        return s.length > n ? s.slice(0, n - 1) + '…' : s;
    }

    function decodeB64(s) {
        try {
            let t = String(s).trim().replace(/\s+/g, '');
            if (!/^[A-Za-z0-9+/_=-]+$/.test(t)) return '';
            t = t.replace(/-/g, '+').replace(/_/g, '/');
            while (t.length % 4) t += '=';
            return atob(t);
        } catch (e) { return ''; }
    }

    function targetFromQuery() {
        let raw = '';
        try { raw = new URLSearchParams(location.search).get('url') || ''; } catch (e) { return ''; }
        if (!raw) return '';

        let plain = raw;
        try { plain = decodeURIComponent(raw); } catch (e) {}

        if (isTarget(urlOf(plain))) return urlOf(plain);

        const decoded = decodeB64(plain);
        if (isTarget(urlOf(decoded))) return urlOf(decoded);

        return '';
    }

    function targetInDom() {
        const nodes = document.querySelectorAll('a[href], iframe[src], input[value], [data-url], [data-href]');
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            if (el.tagName === 'A' || el.tagName === 'IFRAME') {
                const u = urlOf(el.getAttribute('href') || el.getAttribute('src'));
                if (isTarget(u)) return u;
            } else {
                const v = el.value || el.getAttribute('data-url') || el.getAttribute('data-href') || '';
                const u = urlOf(v);
                if (isTarget(u)) return u;
                const d = decodeB64(v);
                if (isTarget(urlOf(d))) return urlOf(d);
            }
        }
        return '';
    }

    function go(url) {
        if (!isTarget(url) || navigating) return false;
        navigating = true;
        done = true;
        hud.set('→ ' + short(url, 64), '#22d3ee');
        try { location.replace(url); } catch (e) { try { location.href = url; } catch (_) {} }
        _setTimeout.call(window, function () { navigating = false; }, 5000);
        return true;
    }

    /* ------------------------------------------------------------------
     * 9. The adblock wall
     * ------------------------------------------------------------------ */
    const WALL_RE = /disable\s+(your\s+)?ad[\s-]?block|adblock(er)?\s+(has been|was|is)\s+detected|disable\s+adblock/i;

    // Brave blocks the ad script at the network layer; no userscript can
    // undo that, so name the culprit when we can.
    let isBrave = false;
    try {
        if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
            navigator.brave.isBrave().then(function (v) { isBrave = !!v; }).catch(function () {});
        }
    } catch (e) {}

    let lastWallCheck = 0;
    let wallNow = false;

    function wallVisible() {
        const now = Date.now();
        if (now - lastWallCheck < 1200) return wallNow;
        lastWallCheck = now;

        wallNow = false;

        const alerts = document.querySelectorAll('.alert, .alert-danger, .error, .notice, [role="alert"], .modal');
        for (let i = 0; i < alerts.length; i++) {
            const el = alerts[i];
            if (!el.isConnected) continue;
            if (WALL_RE.test(el.textContent || '')) { wallNow = true; return true; }
        }

        // Only the gate pages can carry the wall; skip the innerText pass on
        // the long article page.
        if (!document.getElementById('before-captcha') && !document.getElementById('link-view')) return false;

        if (document.body) {
            const txt = String(document.body.innerText || '');
            if (txt.length < 20000 && WALL_RE.test(txt)) wallNow = true;
        }
        return wallNow;
    }

    function showWall() {
        hud.set(isBrave ? 'Brave Shields ON → turn off for exe.io' : 'adblock blocked → whitelist exe.io', '#f87171');
        try { document.title = '⚠ Disable adblock for ' + location.hostname; } catch (e) {}
    }

    /* ------------------------------------------------------------------
     * 10. Step 1 — let the site's own Continue button do the POST
     * ------------------------------------------------------------------ */
    let step1Clicks = 0;
    let step1LastClick = 0;
    let step1Since = 0;
    let step1SoftTried = false;

    function handleStep1(form) {
        if (wallVisible()) { showWall(); return; }
        if (!step1Since) step1Since = Date.now();

        const btn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
        const ready = btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';

        if (ready) {
            const now = Date.now();
            if (now - step1LastClick > CFG.submitRetryMs && step1Clicks < 4) {
                step1LastClick = now;
                step1Clicks++;
                hud.set('clicking “' + short(textOf(btn), 24) + '”', '#38bdf8');
                try { btn.click(); } catch (e) {}
            } else {
                hud.set('Continue sent — waiting…', '#22d3ee');
            }
            return;
        }

        // Never raw-POST here: the server rejects it with the adblock wall.
        // After a long stall, fire the submit event once (still no forced POST).
        if (!step1SoftTried && Date.now() - step1Since > 20000) {
            step1SoftTried = true;
            hud.set('gate never unlocked — trying submit()', '#f59e0b');
            try {
                if (typeof form.requestSubmit === 'function') form.requestSubmit();
            } catch (e) {}
            return;
        }

        hud.set('waiting for Continue to unlock…', '#f59e0b');
    }

    /* ------------------------------------------------------------------
     * 11. Step 2 — Turnstile
     * ------------------------------------------------------------------ */
    const submitAttempts = new WeakMap();
    const submitLast = new WeakMap();

    function submitCaptcha(form) {
        const now = Date.now();
        if (now - (submitLast.get(form) || 0) < CFG.submitRetryMs) return;
        submitLast.set(form, now);

        const n = (submitAttempts.get(form) || 0) + 1;
        submitAttempts.set(form, n);
        if (n > 6) { hud.set('stuck — finish this step manually', '#f87171'); return; }

        const btn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
        if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
            hud.set('clicking “' + short(textOf(btn), 22) + '”', '#38bdf8');
            try { btn.click(); return; } catch (e) {}
        }
        if (typeof form.requestSubmit === 'function') {
            hud.set('requestSubmit step 2', '#38bdf8');
            try { form.requestSubmit(); return; } catch (e) {}
        }
        hud.set('POST step 2', '#fbbf24');
        try { HTMLFormElement.prototype.submit.call(form); } catch (e) {}
    }

    function formWithTurnstile() {
        const field = document.querySelector('[name="cf-turnstile-response"]');
        return field ? field.closest('form') : null;
    }

    let captchaSince = 0;
    function handleCaptcha(form) {
        if (wallVisible()) { showWall(); return; }
        if (!captchaSince) captchaSince = Date.now();

        const field = form.querySelector('[name="cf-turnstile-response"]');
        const value = field ? String(field.value || '') : '';

        if (value.length > 10) {
            hud.set('Turnstile ok → posting', '#22d3ee');
            submitCaptcha(form);
            return;
        }

        if (Date.now() - captchaSince > CFG.captchaHintMs) {
            hud.set('tick the Turnstile checkbox', '#f87171');
            const box = document.querySelector('.cf-turnstile');
            if (box) { try { box.scrollIntoView({ block: 'center' }); } catch (e) {} }
        } else {
            hud.set('waiting for Turnstile…', '#f59e0b');
        }
    }

    /* ------------------------------------------------------------------
     * 12. "Get Link" / final page
     * ------------------------------------------------------------------ */
    function findClickable(re) {
        const list = document.querySelectorAll('a, button, input[type="button"], input[type="submit"], [role="button"]');
        let best = null;
        for (let i = 0; i < list.length; i++) {
            const el = list[i];
            if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
            if (!isVisible(el)) continue;
            if (re.test(textOf(el))) best = el;
        }
        return best;
    }

    const clicked = new WeakMap();
    function clickOnce(el) {
        const now = Date.now();
        const rec = clicked.get(el) || { n: 0, t: 0 };
        if (rec.n >= 4 || now - rec.t < 1600) return;
        rec.n++;
        rec.t = now;
        clicked.set(el, rec);
        hud.set('clicking “' + short(textOf(el), 26) + '”', '#38bdf8');
        try { el.click(); } catch (e) {}
    }

    /* ------------------------------------------------------------------
     * 13. Main state machine
     * ------------------------------------------------------------------ */
    let lastTick = 0;

    function tick() {
        if (done) return;

        const now = Date.now();
        if (now - lastTick < 200) return;
        lastTick = now;

        // (a) Destination already handed to us in the query string.
        const fromQuery = targetFromQuery();
        if (fromQuery) { go(fromQuery); return; }

        // (b) Adblock wall — stop instead of bouncing off the server.
        if (wallVisible()) { showWall(); return; }

        // (c) Step 1 — the "Continue" gate (#before-captcha).
        const step1 = document.getElementById('before-captcha');
        if (step1) { handleStep1(step1); return; }

        // (d) Step 2 — Turnstile gate (#link-view).
        const step2 = document.getElementById('link-view') || formWithTurnstile();
        if (step2 && isVisible(step2)) { handleCaptcha(step2); return; }

        // (e) Destination link anywhere on the final page.
        const inDom = targetInDom();
        if (inDom) { go(inDom); return; }

        // (f) "Get Link" / "Continue" style controls.
        const ctrl = findClickable(/^(get\s*link|continue|click here to continue|proceed|go to link|download)$/i);
        if (ctrl) {
            const href = urlOf(ctrl.getAttribute('href') || ctrl.getAttribute('data-href') || '');
            if (isTarget(href)) { go(href); return; }
            clickOnce(ctrl);
            return;
        }

        // (g) Final countdown present — just report it.
        const timer = document.getElementById('timer');
        if (timer && isVisible(timer)) {
            const secs = textOf(timer).replace(/\D+/g, '');
            hud.set(secs ? 'countdown ' + secs + 's' : 'finishing…', '#f59e0b');
            return;
        }

        hud.set('watching page', '#4ade80');
    }

    /* ------------------------------------------------------------------
     * 14. Boot
     * ------------------------------------------------------------------ */
    let booted = false;
    function boot() {
        if (booted) return;
        booted = true;

        const early = targetFromQuery();
        if (early) { go(early); return; }

        try { tick(); } catch (e) {}

        const mo = new MutationObserver(function () {
            try { tick(); } catch (e) {}
        });
        try {
            mo.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true });
        } catch (e) {}

        (function loop() {
            try { tick(); } catch (e) {}
            _setTimeout.call(window, loop, 400 + Math.random() * 250);
        })();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
        _setTimeout.call(window, boot, 1500);
    } else {
        boot();
    }
})();
