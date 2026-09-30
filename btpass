// ==UserScript==
// @name         Exeygo Helper (Stealth Rewrite + HUD)
// @namespace    local
// @version      2.1
// @description  Working rewrite of exe.io/exeygo bypass with native-disguise stealth
// @match        *://*.exe.io/*
// @match        *://*.exey.io/*
// @match        *://*.exeygo.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';
    if (window.top !== window.self) return;

    // ---------- 0. Native refs ----------
    const _setInterval      = window.setInterval;
    const _setTimeout       = window.setTimeout;
    const _createElement    = Document.prototype.createElement;
    const _toString         = Function.prototype.toString;
    const _defineProperty   = Object.defineProperty;
    const _getOwnPropDesc   = Object.getOwnPropertyDescriptor;

    const NATIVE = 'function () { [native code] }';
    const nativeMap = new WeakMap();

    // ---------- 1. toString disguise ----------
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
        nativeMap.set(fn, `function ${nativeName}() { [native code] }`);
        try { _defineProperty(fn, 'name', { value: nativeName, configurable: true }); } catch (e) {}
        return fn;
    }

    // ---------- 1b. HUD (built *before* createElement is hooked) ----------
    const hud = (function buildHud() {
        // Build the host element using the ORIGINAL createElement so we don't
        // trip our own hook, and so the host looks like an ordinary div.
        const host = _createElement.call(document, 'div');
        host.id = '_hud';
        host.style.cssText = [
            'position:fixed',
            'top:8px',
            'left:50%',
            'transform:translateX(-50%)',
            'z-index:2147483647',
            'pointer-events:none'
        ].join(';');

        const root = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;

        if (host.attachShadow) {
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

            const dot = _createElement.call(document, 'span');
            dot.textContent = '●';
            dot.style.cssText = 'color:#4ade80;margin-right:6px;transition:color .2s';

            const txt = _createElement.call(document, 'span');
            txt.textContent = 'exeygo helper: ready';

            box.appendChild(dot);
            box.appendChild(txt);
            root.appendChild(box);

            host._dot = dot;
            host._txt = txt;
        } else {
            host.textContent = 'exeygo helper: ready';
            host.style.cssText += ';font:12px monospace;background:#141418cc;color:#fff;padding:4px 8px;border-radius:6px';
            host._dot = { style: {} };
            host._txt = host;
        }

        const attach = () => {
            if (document.body) document.body.appendChild(host);
            else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(host), { once: true });
        };
        attach();

        let hideTimer = null;
        function set(msg, color) {
            host._txt.textContent = 'exeygo helper: ' + msg;
            host._dot.style.color = color || '#4ade80';
        }
        function flash(msg, color) {
            set(msg, color || '#fbbf24');
            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => set('idle'), 1500);
        }
        return { set, flash, el: host };
    })();

    hud.set('initialising', '#60a5fa');

    // ---------- 2. Timer acceleration ----------
    const TIMER_MIN = 900;
    const TIMER_MAX = 1100;
    const FACTOR    = 0.9;

    // throttle status updates from the timer hook (fires a lot)
    let lastTimerNote = 0;
    function noteTimer(delay, newDelay) {
        const now = Date.now();
        if (now - lastTimerNote < 1500) return;
        lastTimerNote = now;
        hud.set(`accelerating timer ${delay}ms → ${newDelay}ms`, '#a78bfa');
    }

    const fastInterval = disguise(function setInterval(fn, delay, ...rest) {
        if (typeof delay === 'number' && delay >= TIMER_MIN && delay <= TIMER_MAX) {
            const nd = Math.max(50, Math.round(delay * FACTOR));
            noteTimer(delay, nd);
            delay = nd;
        }
        return _setInterval.call(window, fn, delay, ...rest);
    }, 'setInterval');

    const fastTimeout = disguise(function setTimeout(fn, delay, ...rest) {
        if (typeof delay === 'number' && delay >= TIMER_MIN && delay <= TIMER_MAX) {
            const nd = Math.max(50, Math.round(delay * FACTOR));
            noteTimer(delay, nd);
            delay = nd;
        }
        return _setTimeout.call(window, fn, delay, ...rest);
    }, 'setTimeout');

    try {
        _defineProperty(window, 'setInterval', { value: fastInterval, writable: true, configurable: true });
        _defineProperty(window, 'setTimeout',  { value: fastTimeout,  writable: true, configurable: true });
    } catch (e) {}

    // ---------- 3. Ad script blocking ----------
    const BLOCK_RE = /(llvpn\.com|doubleclick\.net|googlesyndication|googleadservices|adservice|popads|popcash|propellerads|adsterra|hilltopads)/i;

    const patchedCreateElement = disguise(function createElement(tag, options) {
        const el = _createElement.call(this, tag, options);
        if (typeof tag === 'string' && tag.toLowerCase() === 'script') {
            const origSetAttr = el.setAttribute;
            el.setAttribute = function (name, value) {
                if (name === 'src' && typeof value === 'string' && BLOCK_RE.test(value)) {
                    hud.flash('blocked ad script: ' + value.slice(0, 60), '#f87171');
                    return;
                }
                return origSetAttr.call(this, name, value);
            };
            try {
                const desc = _getOwnPropDesc(HTMLScriptElement.prototype, 'src');
                if (desc && desc.set) {
                    _defineProperty(el, 'src', {
                        configurable: true,
                        get() { return desc.get.call(this); },
                        set(v) {
                            if (typeof v === 'string' && BLOCK_RE.test(v)) {
                                hud.flash('blocked ad script: ' + v.slice(0, 60), '#f87171');
                                return;
                            }
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

    // ---------- 4. Visibility spoofing ----------
    const spoof = (obj, prop, value) => {
        try {
            _defineProperty(obj, prop, { get() { return value; }, configurable: true });
        } catch (e) {}
    };
    spoof(document, 'hidden', false);
    spoof(document, 'visibilityState', 'visible');
    spoof(document, 'webkitHidden', false);
    spoof(document, 'webkitVisibilityState', 'visible');

    const swallow = (e) => { e.stopImmediatePropagation(); };
    window.addEventListener('visibilitychange', swallow, true);
    window.addEventListener('webkitvisibilitychange', swallow, true);
    window.addEventListener('blur', swallow, true);

    // ---------- 5. Auto-submit + auto-click ----------
    let lastAction = 0;
    const COOLDOWN = 1000;
    function canAct() {
        const now = Date.now();
        if (now - lastAction < COOLDOWN) return false;
        lastAction = now;
        return true;
    }

    const FINAL_HOST_RE = /(pixeldrain|mega\.nz|mediafire|drive\.google|1fichier|gofile|rapidgator|katfile|nitroflare|filecrypt|clicknupload|uploadhaven|drop\.download)/i;

    function isVisible(el) {
        if (!el || !el.isConnected) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    function submitFormWithButton(form) {
        if (!form) return false;
        const btn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
        if (btn) { btn.click(); return true; }
        if (typeof form.requestSubmit === 'function') {
            try { form.requestSubmit(); return true; } catch (e) {}
        }
        return false;
    }

    function tick() {
        // (a) Get Link
        const candidates = document.querySelectorAll('a, button, input[type="button"], input[type="submit"]');
        for (const el of candidates) {
            const text = (el.innerText || el.value || '').trim();
            if (!/^get\s*link$/i.test(text)) continue;
            if (!isVisible(el)) continue;
            if (!canAct()) return;

            const href = el.href || el.getAttribute('href') || '';
            if (href && FINAL_HOST_RE.test(href)) {
                hud.set('redirecting → ' + href.slice(0, 50), '#22d3ee');
                window.location.replace(href);
            } else {
                hud.set('clicking "Get Link"', '#22d3ee');
                el.click();
            }
            return;
        }

        // (b) before-captcha
        const beforeForm = document.getElementById('before-captcha');
        if (beforeForm && isVisible(beforeForm)) {
            if (!canAct()) return;
            hud.set('submitting #before-captcha', '#fbbf24');
            submitFormWithButton(beforeForm);
            return;
        }

        // (c) link-view (waits for Turnstile)
        const linkForm = document.getElementById('link-view');
        if (linkForm && isVisible(linkForm)) {
            const token = document.querySelector('[name="cf-turnstile-response"]');
            if (token && token.value && token.value.length > 10) {
                if (!canAct()) return;
                hud.set('submitting #link-view (token ok)', '#fbbf24');
                submitFormWithButton(linkForm);
            } else {
                hud.set('waiting for Turnstile token', '#f59e0b');
            }
            return;
        }

        // Nothing to do — show idle only if we're not mid-flash
        if (!hud.el._flashing) hud.set('idle · watching page', '#4ade80');
    }

    // ---------- 6. Main loop ----------
    const mo = new MutationObserver(() => { try { tick(); } catch (e) {} });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

    function loop() {
        try { tick(); } catch (e) {}
        _setTimeout.call(window, loop, 400 + Math.random() * 400);
    }
    _setTimeout.call(window, loop, 500);

})();
