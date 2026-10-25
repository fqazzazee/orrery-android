// What the page asks of whatever runs it: on Android, the app's WebView
// bridge (window.OrreryHost, see android/.../Bridge.kt); in a plain
// browser, local storage and the URL.
//
// The host calls back into the page through window.orrery.fromHost(type,
// data), with type one of: setting, surface, visible, power, insets,
// offset, tap, back.

import {localBackend} from './store.js';

const bridge = window.OrreryHost ?? null;

export const onAndroid = !!bridge;

export function backend() {
    if (!bridge)
        return localBackend();
    return {
        load() {
            try {
                return JSON.parse(bridge.settings());
            } catch {
                return {};
            }
        },
        save(key, value) {
            bridge.save(key, value === undefined ? 'null' : JSON.stringify(value));
        },
    };
}

// app, wallpaper (which turns into the lock screen) or dream.
export function surface() {
    if (bridge)
        return bridge.surface();
    const s = new URLSearchParams(location.search).get('surface');
    return ['app', 'wallpaper', 'lock', 'dream'].includes(s) ? s : 'app';
}

// Ask the host to do something: set the wallpaper, open the screensaver
// settings, leave the app. Returns false if it cannot.
export function call(action, arg = '') {
    if (!bridge)
        return false;
    try {
        return bridge.call(action, String(arg)) !== 'no';
    } catch (e) {
        console.warn(`Orrery: ${action}: ${e.message}`);
        return false;
    }
}

// What the host knows: whether Orrery is the wallpaper, the lock screen,
// the screensaver; the app's version.
export function status() {
    if (!bridge)
        return {browser: true};
    try {
        return JSON.parse(bridge.status());
    } catch {
        return {};
    }
}

export function ready() {
    bridge?.ready();
}

// The battery, where the browser says (on Android the host tells instead).
export async function watchPower(onChange) {
    if (bridge || !navigator.getBattery)
        return;
    try {
        const battery = await navigator.getBattery();
        const send = () => onChange({onBattery: !battery.charging, charging: battery.charging, saver: false});
        battery.addEventListener('chargingchange', send);
        send();
    } catch {}
}
