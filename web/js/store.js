// Settings: the GNOME extension's keys (minus the ones that only make sense
// on a desktop) plus a few for phones, with per-surface versions of some for
// the live wallpaper, the lock screen and the screensaver.
//
// The app, the wallpaper and the screensaver each run their own copy of the
// scene; on Android they share one store kept by the host (see host.js),
// which tells every copy when something changes.

export const SURFACES = ['app', 'wallpaper', 'lock', 'dream'];

// key: [default, {min, max} | [choices]]
const BASE = {
    // Time
    'mode': ['replay', ['replay', 'live']],
    'replay-start-year': [1966, {min: 1957, max: 2025}],
    'days-per-second': [12, {min: 0.5, max: 400}],
    'replay-jd': [0],
    'replay-into-future': [false],
    'seconds-per-earth-day': [12, {min: 2, max: 600}],
    'spin-planets': [true],
    // Tours
    'tour': ['off', ['off', 'planets', 'stories', 'mission']],
    'tour-mission': ['voyager1'],
    'tour-idle-minutes': [5, {min: 0, max: 120}],
    // View
    'distance-scale': ['auto', ['auto', 'sqrt', 'log', 'linear']],
    'tilt': [58, {min: 0, max: 80}],
    'portrait-tilt': [38, {min: 0, max: 80}],
    'azimuth': [0, {min: 0, max: 359}],
    'zoom': [100, {min: 40, max: 250}],
    'planet-scale': [100, {min: 40, max: 300}],
    'brightness': [90, {min: 20, max: 100}],
    // Content
    'show-orbits': [true],
    'show-labels': [true],
    'show-facts': [true],
    'show-missions': [true],
    'show-trails': [true],
    'show-stars': [true],
    'show-belts': [true],
    'show-pluto': [true],
    'show-moons': [true],
    'show-small-bodies': [true],
    'show-lagrange': [true],
    'show-hud': [true],
    'fact-interval': [14, {min: 5, max: 120}],
    // Where the cards go: auto puts them at the bottom of a phone, and on a
    // wide screen the fact card top right and the news bottom right.
    'card-position': ['auto', ['auto', 'top', 'middle', 'bottom']],
    'card-side': ['right', ['left', 'right']],
    'trail-years': [8, {min: 0.5, max: 60}],
    'disabled-missions': [[]],
    // Interaction
    'timeline': ['auto', ['auto', 'always']],
    'sunlight-view': [false],
    'sunlight-auto': ['manual', ['manual', 'charging', 'battery']],
    // Music
    'music-mode': ['muted', ['muted', 'background']],
    'music-volume': [35, {min: 0, max: 100}],
    // The ambient piece, or the tracks in a folder of your own, shuffled.
    // On Android the folder is the one Android gave access to; its name is
    // kept for the settings.
    'music-source': ['ambient', ['ambient', 'folder']],
    'music-folder': [''],
    'music-folder-name': [''],
    // Power and OLED care
    // Up to 120 for the screens that refresh 90 or 120 times a second.
    'fps': [30, {min: 10, max: 120}],
    'adaptive-fps': [true],
    'battery-saver': [true],
    'battery-fps': [15, {min: 5, max: 60}],
    'idle-dim-minutes': [0, {min: 0, max: 60}],
    'idle-brightness': [40, {min: 5, max: 100}],
    'pixel-shift': [true],
    // The app's window
    'keep-screen-on': [false],
    'immersive': [true],
};

// What the wallpaper, the lock screen and the screensaver set for
// themselves. Each has its own default, so a quiet lock screen does not
// need the app to be quiet too.
const OWN = {
    'mode': {wallpaper: 'replay', lock: 'live', dream: 'replay'},
    'days-per-second': {wallpaper: 8, lock: 4, dream: 12},
    'show-facts': {wallpaper: false, lock: false, dream: true},
    'show-hud': {wallpaper: false, lock: false, dream: true},
    'show-labels': {wallpaper: true, lock: true, dream: true},
    'show-missions': {wallpaper: true, lock: true, dream: true},
    'sunlight-view': {wallpaper: false, lock: false, dream: false},
    'sunlight-auto': {wallpaper: 'manual', lock: 'manual', dream: 'manual'},
    'tour': {wallpaper: 'off', lock: 'off', dream: 'stories'},
    'tour-mission': {wallpaper: 'voyager1', lock: 'voyager1', dream: 'voyager1'},
    'tour-idle-minutes': {wallpaper: 0, lock: 0, dream: 0},
    'zoom': {wallpaper: 100, lock: 100, dream: 100},
    'brightness': {wallpaper: 80, lock: 70, dream: 85},
    'fps': {wallpaper: 24, lock: 20, dream: 30},
    'idle-dim-minutes': {wallpaper: 0, lock: 0, dream: 10},
    'card-position': {wallpaper: 'auto', lock: 'auto', dream: 'auto'},
    'card-side': {wallpaper: 'right', lock: 'right', dream: 'right'},
};

// Only some surfaces have these.
const ONLY = {
    'parallax': [true, ['wallpaper']],            // turn with the home screen's pages
    'tap-cards': [true, ['wallpaper']],           // a tap on the wallpaper shows a card
    'music': [false, ['dream']],                  // the ambient music while it runs
};

export const SCHEMA = {...BASE};
for (const [key, by] of Object.entries(OWN)) {
    for (const [surface, def] of Object.entries(by))
        SCHEMA[`${surface}/${key}`] = [def, BASE[key][1]];
}
for (const [key, [def, surfaces]] of Object.entries(ONLY)) {
    for (const surface of surfaces)
        SCHEMA[`${surface}/${key}`] = [def];
}

// Every key a surface can set for itself.
export const ownKeys = surface => Object.keys(SCHEMA).filter(k => k.startsWith(`${surface}/`)).map(k => k.slice(surface.length + 1));

function valid(key, value) {
    const spec = SCHEMA[key];
    if (!spec)
        return false;
    const [def, rule] = spec;
    if (typeof value !== typeof def || Array.isArray(def) !== Array.isArray(value))
        return false;
    if (Array.isArray(rule))
        return rule.includes(value);
    if (rule && typeof value === 'number')
        return value >= rule.min && value <= rule.max;
    return true;
}

export class Store {
    // backend: {load() -> {key: value}, save(key, value | undefined)}
    constructor(backend, surface = 'app') {
        this._backend = backend;
        this._values = {};
        for (const [key, value] of Object.entries(backend.load() ?? {})) {
            if (valid(key, value))
                this._values[key] = value;
        }
        this._surface = surface;
        this._listeners = new Set();
    }

    get surface() {
        return this._surface;
    }

    // The wallpaper switches to its lock-screen settings while locked.
    set surface(surface) {
        if (surface === this._surface)
            return;
        const before = Object.fromEntries(Object.keys(BASE).map(k => [k, this.get(k)]));
        this._surface = surface;
        for (const key of Object.keys(BASE)) {
            if (JSON.stringify(this.get(key)) !== JSON.stringify(before[key]))
                this._emit(key);
        }
        for (const key of Object.keys(ONLY))
            this._emit(key);
    }

    // The key as this surface reads it: its own version if it has one.
    resolve(key) {
        const own = `${this._surface}/${key}`;
        return SCHEMA[own] ? own : key;
    }

    get(key) {
        return this.getRaw(this.resolve(key));
    }

    set(key, value) {
        this.setRaw(this.resolve(key), value);
    }

    getRaw(full) {
        if (full in this._values)
            return this._values[full];
        const def = SCHEMA[full]?.[0];
        return Array.isArray(def) ? [...def] : def;
    }

    setRaw(full, value) {
        if (!valid(full, value)) {
            console.warn(`Orrery: ignoring ${full} = ${JSON.stringify(value)}`);
            return;
        }
        if (JSON.stringify(this.getRaw(full)) === JSON.stringify(value))
            return;
        this._values[full] = value;
        this._backend.save(full, value);
        this._changed(full);
    }

    reset(full) {
        if (!(full in this._values))
            return;
        delete this._values[full];
        this._backend.save(full, undefined);
        this._changed(full);
    }

    // A change made elsewhere: another surface, or the app.
    external(full, value) {
        if (value === undefined || value === null)
            delete this._values[full];
        else if (valid(full, value))
            this._values[full] = value;
        else
            return;
        this._changed(full);
    }

    _changed(full) {
        const slash = full.indexOf('/');
        const key = slash < 0 ? full : full.slice(slash + 1);
        // Only the version this surface reads matters to it.
        if (this.resolve(key) === full)
            this._emit(key);
        this._emitRaw?.(full);
    }

    _emit(key) {
        for (const fn of this._listeners)
            fn(key);
    }

    connect(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    // Every change to any key, own versions included (the settings page).
    onRaw(fn) {
        this._emitRaw = fn;
    }

    spec(full) {
        return SCHEMA[full];
    }
}

// Settings kept in the browser, for running the web app on its own.
export function localBackend(name = 'orrery-settings') {
    let cache = {};
    try {
        cache = JSON.parse(localStorage.getItem(name) ?? '{}') ?? {};
    } catch {
        cache = {};
    }
    return {
        load: () => cache,
        save(key, value) {
            if (value === undefined)
                delete cache[key];
            else
                cache[key] = value;
            try {
                localStorage.setItem(name, JSON.stringify(cache));
            } catch {}
        },
    };
}
