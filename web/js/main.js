// Starts Orrery in a page: the app, the live wallpaper (and lock screen) or
// the screensaver, as the host says. Runs the frame clock, turns touches
// into taps, pinches and drags, and keeps the music, the power saving and
// the dimming in step, as the extension's enable() and _tick() do.

import * as Astro from '../../lib/astro.js';
import * as Host from './host.js';
import {Music} from './music.js';
import {Scene} from './scene.js';
import {SettingsPage} from './settings.js';
import {Store} from './store.js';

const IDLE_FPS = 10;
const STILL_FPS = 5;
const LONG_PRESS_MS = 520;
const DOUBLE_TAP_MS = 320;

const surface = Host.surface();
const store = new Store(Host.backend(), surface);
const root = document.getElementById('root');
document.body.dataset.surface = surface;
const app = surface === 'app';

const music = new Music();
let power = {onBattery: false, saver: false, charging: true, known: false};
let visible = !document.hidden;
let hostVisible = true;
let insets = {top: 0, right: 0, bottom: 0, left: 0};

const scene = new Scene(root, store, {
    controls: app,
    onOpenPrefs: () => openSettings(),
    onMusicToggle: () => store.set('music-mode', store.get('music-mode') === 'muted' ? 'background' : 'muted'),
});
scene.onActivity = () => wake();

let settingsPage = null;
function openSettings(section = null) {
    settingsPage ??= new SettingsPage(document.body, store, {onClose: () => {
        scene.relayout();
        syncRunning();
    }});
    settingsPage.open(section);
    syncRunning();
}

// ---- Size and insets ----

// The lock screen keeps the middle of the screen, clear of the clock above
// and the notifications and shortcuts below; the wallpaper keeps clear of
// the status and navigation bars.
function effectiveInsets() {
    const H = window.innerHeight;
    if (store.surface === 'lock')
        return {...insets, top: Math.max(insets.top, Math.round(H * 0.3)), bottom: Math.max(insets.bottom, Math.round(H * 0.16))};
    if (store.surface === 'wallpaper')
        return {...insets, top: Math.max(insets.top, 28), bottom: Math.max(insets.bottom, 40)};
    return insets;
}

function resize() {
    scene.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
}
window.addEventListener('resize', resize);
scene.setInsets(effectiveInsets());
resize();
document.fonts?.ready.then(() => scene.fontsReady());

// ---- The frame clock ----

let last = performance.now();
let lastFrame = 0;
let idle = false;
let lastTouch = performance.now();
let frameId = 0;

function saving() {
    return store.get('battery-saver') && (power.saver || (!Host.onAndroid && power.onBattery));
}

function fps() {
    let f = store.get('fps');
    if (saving())
        f = Math.min(f, store.get('battery-fps'));
    if (idle)
        f = Math.min(f, IDLE_FPS);
    if (store.get('adaptive-fps') && scene.still)
        f = Math.min(f, STILL_FPS);
    return f;
}

function frame(now) {
    frameId = 0;
    if (!running())
        return;
    frameId = requestAnimationFrame(frame);
    // A frame when the rate allows: requestAnimationFrame comes at the
    // screen's rate, 60 or 120 a second.
    if (now - lastFrame < 1000 / fps() - 4)
        return;
    lastFrame = now;
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    try {
        scene.tick(dt);
        scene.draw();
        if (store.surface === 'wallpaper' || store.surface === 'lock')
            scene.expirePeek();
        checkIdle(now);
    } catch (e) {
        report(e);
    }
}

// A throw inside the frame would stop the clock; say it once and go on.
const reported = new Set();
function report(e) {
    if (reported.has(e.message))
        return;
    reported.add(e.message);
    console.error(`Orrery: ${e.message}\n${e.stack}`);
}

function running() {
    return visible && hostVisible && !(settingsPage?.isOpen);
}

function start() {
    if (frameId || !running())
        return;
    last = performance.now();
    frameId = requestAnimationFrame(frame);
}

function syncRunning() {
    if (running()) {
        start();
    } else {
        cancelAnimationFrame(frameId);
        frameId = 0;
        scene.saveTime();
    }
    syncMusic();
}

// Dim after a while untouched (the screensaver: after a while running).
function checkIdle(now) {
    const minutes = store.get('idle-dim-minutes');
    const isIdle = minutes > 0 && now - lastTouch > minutes * 60000;
    if (isIdle !== idle) {
        idle = isIdle;
        scene.setDim(idle ? store.get('idle-brightness') / 100 : 1);
    }
}

function wake() {
    lastTouch = performance.now();
    if (idle) {
        idle = false;
        scene.setDim(1);
    }
    music.unlock();
}

document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    syncRunning();
});
window.addEventListener('pagehide', () => scene.saveTime());

// ---- Music ----

function wantMusic() {
    if (!running())
        return false;
    if (store.surface === 'dream')
        return store.get('music');
    return app && store.get('music-mode') !== 'muted';
}

function syncMusic() {
    music.setVolume(store.get('music-volume') / 100);
    if (wantMusic())
        music.play();
    else
        music.pause();
    scene.setMusicState(app ? store.get('music-mode') : 'hidden');
}

// ---- Settings that reach past the scene ----

store.connect(key => {
    if (key === 'music-mode' || key === 'music-volume' || key === 'music')
        syncMusic();
    else if (key === 'keep-screen-on' || key === 'immersive')
        syncWindow();
    else if (key === 'sunlight-auto')
        syncSunlightAuto(true);
    else if (key === 'battery-saver')
        scene.powerSaving = saving();
});

function syncWindow() {
    if (app) {
        Host.call('keepScreenOn', store.get('keep-screen-on'));
        Host.call('immersive', store.get('immersive'));
    }
}

// The sunlight view can follow the charger: switched when it is plugged in
// or out (so a tap on ☀ in between still holds).
let wasCharging = null;
function syncSunlightAuto(force = false) {
    const mode = store.get('sunlight-auto');
    if (!mode || mode === 'manual' || !power.known)
        return;
    if (!force && power.charging === wasCharging)
        return;
    wasCharging = power.charging;
    const on = mode === 'charging' ? power.charging : !power.charging;
    if (store.get('sunlight-view') !== on)
        store.set('sunlight-view', on);
}

function setPower(p) {
    power = {...power, ...p, known: true};
    scene.powerSaving = saving();
    syncSunlightAuto();
}
Host.watchPower(setPower);

// ---- Touch ----

const pointers = new Map();
let gesture = null;     // {mode: 'pending' | 'drag' | 'pinch' | 'press', ...}
let lastTap = null;

const pos = e => [e.clientX, e.clientY];

function onDown(e) {
    if (settingsPage?.isOpen)
        return;
    wake();
    scene.touched();
    root.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, pos(e));
    if (pointers.size === 1) {
        const [x, y] = pos(e);
        gesture = {mode: 'pending', x0: x, y0: y, x, y, t0: performance.now()};
        gesture.timer = setTimeout(() => {
            if (gesture?.mode === 'pending') {
                gesture.mode = 'press';
                scene.press(gesture.x, gesture.y);
            }
        }, LONG_PRESS_MS);
    } else if (pointers.size === 2) {
        clearTimeout(gesture?.timer);
        if (gesture?.mode === 'press')
            scene.release();
        const [a, b] = [...pointers.values()];
        gesture = {mode: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, zoom0: scene.zoomTarget, done: false};
    }
}

function onMove(e) {
    if (!pointers.has(e.pointerId) || !gesture)
        return;
    const [x, y] = pos(e);
    const [px, py] = pointers.get(e.pointerId);
    pointers.set(e.pointerId, [x, y]);
    if (gesture.mode === 'pinch' && pointers.size >= 2) {
        if (gesture.done)
            return;
        const [a, b] = [...pointers.values()];
        const k = Math.hypot(a[0] - b[0], a[1] - b[1]) / gesture.d0;
        gesture.done = scene.pinch(k, gesture.zoom0, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        return;
    }
    if (gesture.mode === 'pending' && Math.hypot(x - gesture.x0, y - gesture.y0) > 10) {
        clearTimeout(gesture.timer);
        gesture.mode = 'drag';
    }
    if (gesture.mode === 'drag') {
        // Sideways turns the system around the Sun; up and down tilts it
        // (down looks from higher above).
        scene.turnCamera(-(x - px) * 0.35, (y - py) * 0.25);
    }
    gesture.x = x;
    gesture.y = y;
}

function onUp(e) {
    if (!pointers.has(e.pointerId))
        return;
    pointers.delete(e.pointerId);
    if (!gesture)
        return;
    clearTimeout(gesture.timer);
    if (gesture.mode === 'press') {
        scene.release();
    } else if (gesture.mode === 'pending' && e.type === 'pointerup') {
        const [x, y] = pos(e);
        const now = performance.now();
        const double = !!lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < 40;
        lastTap = double ? null : {t: now, x, y};
        if (app)
            scene.tap(x, y, {double});
        else
            scene.peek(x, y);
    }
    if (gesture.mode === 'pinch' && pointers.size > 0)
        return;     // the other finger lifts later
    gesture = null;
}

root.addEventListener('pointerdown', onDown);
root.addEventListener('pointermove', onMove);
root.addEventListener('pointerup', onUp);
root.addEventListener('pointercancel', onUp);
root.addEventListener('wheel', e => {
    if (!app)
        return;
    e.preventDefault();
    wake();
    scene.wheel(Math.sign(-e.deltaY) * Math.min(1, Math.abs(e.deltaY) / 100), e.clientX, e.clientY);
}, {passive: false});
window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !back())
        Host.call('exit');
});

// The back button: the settings, then whatever the scene has open.
function back() {
    if (settingsPage?.isOpen) {
        settingsPage.close();
        return true;
    }
    return scene.back();
}

// ---- The host ----

window.orrery = {
    fromHost(type, data) {
        try {
            return handleHost(type, data);
        } catch (e) {
            report(e);
            return false;
        }
    },
    back,
    // For the tests and the screenshots: the scene, the store, the clock.
    scene, store, Astro,
};

function handleHost(type, data) {
    switch (type) {
    case 'setting':
        store.external(data.key, data.value);
        return true;
    case 'surface':
        // The wallpaper on the lock screen, or back on the home screen.
        if (data !== store.surface) {
            store.surface = data;
            document.body.dataset.surface = data;
            scene.setInsets(effectiveInsets());
            if (data !== 'lock')
                scene._deselect();
        }
        return true;
    case 'visible':
        hostVisible = !!data;
        if (hostVisible)
            settingsPage?.refresh();
        syncRunning();
        return true;
    case 'power':
        setPower(data);
        return true;
    case 'insets':
        insets = {top: 0, right: 0, bottom: 0, left: 0, ...data};
        scene.setInsets(effectiveInsets());
        return true;
    case 'offset':
        if (store.get('parallax'))
            scene.setOffset(data);
        return true;
    case 'tap':
        if (store.get('tap-cards') !== false) {
            wake();
            scene.peek(data.x, data.y);
        }
        return true;
    case 'back':
        return back();
    case 'settings':
        openSettings(data || null);
        return true;
    }
    return false;
}

// ---- Off we go ----

syncWindow();
syncMusic();
start();
Host.ready();
const params = new URLSearchParams(location.search);
if (app && params.has('settings'))
    openSettings(params.get('settings') || null);
