// The solar system on a canvas, with its HUD, cards, timeline and panel in
// HTML above it: the GNOME extension's OrreryScene (extension.js), laid out
// for phones and tablets and drawn in one pass a frame.
//
// One scene runs per surface: the app, the live wallpaper (which turns into
// the lock screen while the phone is locked) and the screensaver. The
// wallpaper, lock screen and screensaver are for looking at, so they leave
// out the controls.

import * as Astro from '../../lib/astro.js';
import {BODY, LAGRANGE, LPOINT, MOON, PLANETS, SMALL, SMALL_BODIES, SMALL_PLANETS, moonsOf, placeName} from '../../lib/bodies.js';
import {SAT} from '../../lib/satellites.js';
import {FactDeck, clearCache, details, eventCard, eventDate, eventTitle, missionDetails, missionStatus} from '../../lib/facts.js';
import {MISSIONS, buildTrajectories} from '../../lib/missions.js';
import * as Render from '../../lib/render.js';
import {planSpan, planetTour, storyPlan} from '../../lib/tour.js';
import Cairo from './cairo.js';
import {FarLayer} from './far.js';
import {PlanetView} from './focus.js';
import {Picture} from './sprite.js';
import * as Text from './text.js';
import {Card, LayersPanel, StoryBar, Timeline, h} from './ui.js';

const HOLD_SECONDS = 20;          // pause on "today" before the replay starts over
const EVENT_CARD_SECONDS = 8;
const TRAIL_HZ = 4;
const HUD_HZ = 2;
const CONTROLS_SECONDS = 6;       // the timeline fades this long after the last touch
const BROWSE_SECONDS = 120;       // live mode returns to today after this long untouched
const FUTURE_DAYS = 2 * 365.25;   // the timeline reaches at least this far past today
const LAST_JD = Astro.jd('2049-12-31');  // and never past the end of the planets' ephemeris
const SPEEDS = [0.5, 1, 2, 4, 8, 12, 20, 30, 60, 120, 240, 400];
// Zooming out: the stops the buttons step through (0 is the planets, 1 the
// nearest stars).
const ZOOM_STOPS = [0, 0.22, 0.6, 1];
const WHEEL_STEP = 0.06;
const FAR_FROM = 0.3;                   // past this, time quickens with the view
const FAR_END = Astro.jd('2500-01-01');     // how far the timeline reaches then
const FAR_QUICKEN = 0.5;
const FAR_RATES = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64];   // times the far view's own pace
const FOCUS_RATES = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16];   // times the close-up's own pace
const FOCUS_MS = 750;
const SUN_LEVELS = [10000, 3000, 1361, 300, 100, 30, 10, 3, 1];
const NARROW = 640;               // narrower than this (CSS px): the phone layout
// Which planets keep their names when there is no room for them all.
const NAME_RANK = ['earth', 'jupiter', 'saturn', 'uranus', 'neptune', 'mars', 'venus', 'mercury', 'pluto', 'ceres', 'vesta'];

// Changing these lays the scene out again.
const RELAYOUT_KEYS = ['distance-scale', 'tilt', 'portrait-tilt', 'azimuth', 'zoom', 'planet-scale', 'show-orbits',
    'show-stars', 'show-belts', 'show-pluto', 'show-labels', 'show-hud', 'show-missions', 'show-facts',
    'timeline', 'show-moons', 'show-small-bodies', 'show-lagrange', 'card-position', 'card-side'];

const smooth = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
const easeInOutCubic = x => x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

// Distance from (x, y) to a polyline of [x, y, ...] points.
function polylineDistance(pts, x, y) {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const dx = x1 - x0, dy = y1 - y0;
        const len2 = dx * dx + dy * dy;
        const k = len2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2)) : 0;
        best = Math.min(best, Math.hypot(x - x0 - k * dx, y - y0 - k * dy));
    }
    return best;
}

const sameSubject = (a, b) => !!a && !!b && (a.tr ? a.tr === b.tr : a.id === b.id);
const LAGRANGE_COLOR = '#9fb4d8';
const TROJAN_COLOR = '#c9b48a';

// Color of any place on screen.
function placeColor(id) {
    if (SAT[id])
        return SAT[id].color ?? '#f2d6a0';
    if (LPOINT[id])
        return id.startsWith('j') ? TROJAN_COLOR : LAGRANGE_COLOR;
    return (BODY[id] ?? MOON[id] ?? SMALL[id])?.color ?? '#ffffff';
}

// A stable pseudo-random number in [0, 1) for a name.
function hashUnit(name) {
    let h = 2166136261;
    for (const c of name)
        h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return (h >>> 0) / 4294967296;
}

const rgbaCss = (rgb, a) => `rgba(${rgb.map(c => Math.round(c * 255)).join(',')},${a})`;

export class Scene {
    // root: the element to fill; settings: a Store; controls: whether this
    // surface has the timeline, the panel and the like (the app does).
    constructor(root, settings, {controls = true, onOpenPrefs = null, onMusicToggle = null} = {}) {
        this._settings = settings;
        this._controls = controls;
        this.onOpenPrefs = onOpenPrefs;
        this.onMusicToggle = onMusicToggle;
        this.onActivity = null;
        this._facts = new FactDeck();
        this._far = new FarLayer();
        this._realTime = 0;
        this._hold = 0;
        this._trailClock = 0;
        this._hudClock = 0;
        this._factClock = 0;
        this._factCard = null;
        this._eventCards = [];
        this._factCount = 0;
        this._playing = true;
        this._browsing = false;
        this._browseClock = 0;
        this._lastActivity = -Infinity;
        this._selected = null;
        this._hover = null;
        this._pin = null;
        this._dim = 1;
        this._fade = 1;               // the replay starting over fades out and in
        this._moonClock = 0;
        this._zoomOut = 0;
        this._zoomTarget = 0;
        this._farMul = 1;
        this._focus = null;
        this._focusMul = 1;
        this._drift = 0;
        this._tour = null;
        this._storyOnly = null;
        this._fly = null;             // the flight in to or out of a close-up
        this._pulses = [];
        this._camera = {azimuth: 0, tilt: 0};   // turned by dragging, on top of the settings
        this._offset = 0;             // the home screen's page, for the wallpaper
        this._insets = {top: 0, right: 0, bottom: 0, left: 0};
        this.musicState = 'hidden';
        this.powerSaving = false;

        this.root = root;
        this._content = h('div', {class: 'content'});
        this._canvas = h('canvas', {class: 'scene'});
        this._hud = h('div', {class: 'hud'});
        this._content.append(this._canvas, this._hud);
        root.append(this._content);
        this._ctx = this._canvas.getContext('2d', {alpha: false});
        this._cr = new Cairo.Context(this._ctx);

        this._buildHud();
        this._buildTrajectories();
        this._resetTime();
        this._unwatch = settings.connect(key => this._onSetting(key));
    }

    destroy() {
        this._unwatch();
        this._content.remove();
        clearCache();
    }

    get jd() {
        return this._jd;
    }

    // ---- Time ----

    _live() {
        return this._settings.get('mode') === 'live';
    }

    _startJd() {
        const t = Astro.jd(`${this._settings.get('replay-start-year')}-01-01`);
        return this._tour ? Math.min(t, this._tour.start) : t;
    }

    // Far enough ahead to take in every planned mission event.
    _endJd() {
        if (this._isFar)
            return FAR_END;
        const last = this._events?.length ? this._events.at(-1).t + 120 : 0;
        return Math.min(LAST_JD, Math.max(Astro.jdNow() + FUTURE_DAYS, last));
    }

    _intoFuture() {
        return !this._live() && this._settings.get('replay-into-future');
    }

    _resetTime() {
        const s = this._settings;
        if (this._live()) {
            this._jd = Astro.jdNow();
        } else {
            const saved = s.get('replay-jd');
            this._jd = saved > this._startJd() && saved < Astro.jdNow() ? saved : this._startJd();
        }
        this._browsing = false;
        this._hold = 0;
        this._seekEvents();
    }

    // Where the replay is, kept so it carries on from there next time.
    saveTime() {
        if (!this._live() && this._settings.surface === 'app' && this._jd)
            this._settings.set('replay-jd', Math.min(this._jd, Astro.jdNow() - 1));
    }

    _advance(dt) {
        if (this._tour) {
            // A tour keeps its own time, up to the end of each step.
            const to = this._tour.steps[this._tour.index]?.to;
            this._jd = Math.min(this._endJd(), to ?? Infinity, this._jd + dt * this._dps());
            return;
        }
        const now = Astro.jdNow();
        if (this._live() && !this._browsing) {
            this._jd = now;
            return;
        }
        // (Not while zoomed in or out: looking around there is the point.)
        if (this._live() && !this._focus && !this._isFar && (this._browseClock += dt) > BROWSE_SECONDS) {
            this._goNow();
            return;
        }
        if (!this._playing || this._timeline?.dragging)
            return;
        // Play up to today, or to the end of the timeline if someone moved
        // past today on purpose (or the replay goes on into the future).
        const end = this._jd > now + 1 || this._intoFuture() || this._isFar || this._focus ? this._endJd() : now;
        if (this._jd < end) {
            this._jd = Math.min(end, this._jd + dt * this._dps());
            if (this._live() && this._jd >= now)
                this._browsing = false;
            return;
        }
        if (this._live()) {
            this._browsing = false;
            return;
        }
        // Hold on today for a moment, then fade out and start over.
        this._hold += dt;
        if (this._hold > HOLD_SECONDS && !this._restarting)
            this._restart();
    }

    _restart() {
        this._restarting = {t: 0};
    }

    _stepRestart(dt) {
        const r = this._restarting;
        if (!r)
            return;
        r.t += dt;
        if (r.t < 1.2) {
            this._fade = 1 - smooth(r.t / 1.2);
        } else if (!r.done) {
            r.done = true;
            this._jd = this._startJd();
            this._hold = 0;
            this._seekEvents();
            this._updateAll(0);
        } else if (r.t < 2.7) {
            this._fade = smooth((r.t - 1.2) / 1.5);
        } else {
            this._fade = 1;
            this._restarting = null;
        }
        this._applyOpacity();
    }

    // Is the date on screen moving fast enough to see?
    _timeRuns() {
        if (this._tour)
            return this._dps() > 0;
        if (this._live() && !this._browsing)
            return false;
        return this._playing && !this._timeline?.dragging &&
            this._jd < (this._jd > Astro.jdNow() + 1 || this._intoFuture() || this._isFar || this._focus ? this._endJd() : Astro.jdNow());
    }

    _spinning() {
        return this._settings.get('spin-planets') && (!this.powerSaving || this._spinAnyway);
    }

    set powerSaving(on) {
        if (on !== this._powerSaving)
            this._spinAnyway = false;
        this._powerSaving = on;
        if (this._timeline)
            this._syncTimelineState();
    }

    get powerSaving() {
        return !!this._powerSaving;
    }

    _toggleSpin() {
        if (this._settings.get('spin-planets') && this.powerSaving && !this._spinAnyway) {
            this._spinAnyway = true;
            this._activity();
            this._syncTimelineState();
            return;
        }
        this._spinAnyway = false;
        this._settings.set('spin-planets', !this._settings.get('spin-planets'));
    }

    // Nothing moves: the frame rate can drop to a few a second.
    get still() {
        return !this._timeRuns() && !this._spinning() && !this._restarting && !this._fly && !this._pulses.length &&
            Math.abs(this._zoomTarget - this._zoomOut) < 1e-4 && this._realTime - this._lastActivity > 3 && !this._eventCards.length;
    }

    get interacting() {
        return this._realTime - this._lastActivity < CONTROLS_SECONDS || !!this._timeline?.dragging;
    }

    // Jump the clock; `done` is false while the playhead is being dragged.
    _seek(t, done = true, ev = null) {
        const lead = Math.min(60, 3 * this._dps());
        if (ev) {
            // Land a little before the event so it plays out, and follow
            // the mission it belongs to.
            t = ev.t - lead;
            const tr = this._trajectories.find(x => x.mission === ev.mission);
            if (tr)
                this._select({tr}, {expand: this._pin?.expanded});
            this._playing = true;
        }
        t = Math.max(this._startJd(), Math.min(this._endJd(), t));
        if (this._live())
            this._browsing = Math.abs(t - Astro.jdNow()) > 0.5;
        this._browseClock = 0;
        this._jd = t;
        this._drift = 0;
        this._hold = 0;
        this._seekEvents();
        if (done) {
            for (const c of this._eventCards)
                c.card.dismiss();
            this._eventCards = [];
        }
        this._updateAll(0);
    }

    _goNow() {
        this._browsing = false;
        this._browseClock = 0;
        this._playing = true;
        this._seek(Astro.jdNow());
    }

    _togglePlay() {
        if (this._tour) {
            this._tour.paused = !this._tour.paused;
            this._playing = !this._tour.paused;
            this._syncTimelineState();
            this._updateHud();
            return;
        }
        if (this._live() && !this._browsing) {
            // Pausing live time means looking at this moment for a while.
            this._browsing = true;
            this._playing = false;
        } else {
            this._playing = !this._playing;
            const end = this._intoFuture() ? this._endJd() : Astro.jdNow();
            if (this._playing && !this._live() && !this._focus && !this._isFar && this._jd >= end - 0.5 && this._jd <= end + 1)
                this._seek(this._startJd());
        }
        this._browseClock = 0;
        this._syncTimelineState();
        this._updateHud();
    }

    _changeSpeed(dir) {
        // Up close and far away keep their own speeds.
        const step = (list, v) => {
            const i = list.findIndex(x => x >= v - 1e-9);
            return list[Math.max(0, Math.min(list.length - 1, (i < 0 ? list.length - 1 : i) + dir))];
        };
        if (this._focus) {
            this._focusMul = step(FOCUS_RATES, this._focusMul);
            this._syncTimelineState();
            this._updateHud();
            return;
        }
        if (this._isFar) {
            this._farMul = step(FAR_RATES, this._farMul);
            this._syncTimelineState();
            this._updateHud();
            return;
        }
        const dps = this._settings.get('days-per-second');
        let i = SPEEDS.findIndex(v => v >= dps - 1e-6);
        if (i < 0)
            i = SPEEDS.length - 1;
        else if (dir < 0 && SPEEDS[i] > dps + 1e-6)
            i--;
        this._settings.set('days-per-second', SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))]);
    }

    _applyOpacity() {
        const o = this._settings.get('brightness') / 100 * this._dim * this._fade;
        if (Math.abs(o - (this._opacity ?? -1)) > 0.002) {
            this._opacity = o;
            this._content.style.opacity = o.toFixed(3);
        }
    }

    // Dim the whole scene (idle) or bring it back (dim = 1).
    setDim(dim) {
        if (dim === this._dim)
            return;
        this._dim = dim;
        this._content.style.transition = `opacity ${dim < 1 ? 3 : 0.4}s ease-out`;
        this._applyOpacity();
    }

    // ---- Spacecraft ----

    _buildTrajectories() {
        const disabled = this._settings.get('disabled-missions');
        // (A story shows its mission alone, even one turned off.)
        this._trajectories = buildTrajectories(MISSIONS.filter(m => this._storyOnly ? m.id === this._storyOnly : !disabled.includes(m.id)));
        this._events = this._trajectories.flatMap(tr => tr.milestones).sort((a, b) => a.t - b.t);
        const horizon = this._endJd() + 365.25;
        for (const tr of this._trajectories) {
            tr.cache = tr.samples(tr.launch, Math.min(tr.end, horizon));
            tr.rgb = Render.hexToRgb(tr.mission.color);
            tr.size = 0;
        }
        // Asteroids and comets that are only shown while a mission visits:
        // from its launch until a year after it leaves (or ends).
        this._smallWindows = new Map();
        for (const tr of this._trajectories) {
            const visits = tr.events.filter(ev => SMALL[ev.at]);
            for (const id of new Set(visits.map(ev => ev.at))) {
                const last = visits.filter(ev => ev.at === id).at(-1);
                const until = last.kind === 'arrive' ? (isFinite(tr.end) ? tr.end : Infinity) : last.t;
                const list = this._smallWindows.get(id) ?? [];
                list.push([tr.launch, until + 365]);
                this._smallWindows.set(id, list);
            }
        }
        this._seekEvents();
    }

    _seekEvents() {
        if (!this._events || this._jd === undefined)
            return;
        this._eventIndex = this._events.findIndex(ev => ev.t > this._jd);
        if (this._eventIndex < 0)
            this._eventIndex = this._events.length;
    }

    // ---- Layout ----

    // insets: room kept clear of the status bar, a notch or the lock
    // screen's clock, in CSS pixels.
    setInsets(insets) {
        this._insets = {top: 0, right: 0, bottom: 0, left: 0, ...insets};
        if (this._W)
            this.relayout();
    }

    resize(W, H, dpr) {
        if (W === this._W && H === this._H && dpr === this._dpr)
            return;
        this._W = W;
        this._H = H;
        this._dpr = dpr;
        this._canvas.width = Math.round(W * dpr);
        this._canvas.height = Math.round(H * dpr);
        this._canvas.style.width = `${W}px`;
        this._canvas.style.height = `${H}px`;
        this.relayout();
    }

    get narrow() {
        return this._W < NARROW;
    }

    // A phone held sideways: wide, but with little height for cards.
    get short() {
        return !this.narrow && this._H < 560;
    }

    get portrait() {
        return this._H > this._W * 1.15;
    }

    relayout() {
        if (!this._W)
            return;
        const s = this._settings;
        const W = this._W, H = this._H;
        const ins = this._insets;
        this._area = {left: ins.left, right: W - ins.right, top: ins.top, bottom: H - ins.bottom};
        this._backdrop = new Picture(W, H, this._dpr);
        this._trailLayer = new Picture(W, H, this._dpr);
        this._applyOpacity();
        this._layoutHud();
        this._layoutProjection();
        this._buildBodies();
        this._buildCraft();
        this._setHover(null);

        // Cards are sized to the screen: rebuild the pinned one, move the rest.
        const selected = this._selected, expanded = this._pin?.expanded;
        this._pin?.destroy();
        this._pin = this._selected = null;
        if (selected && (!selected.tr || this._trajectories.includes(selected.tr)))
            this._select(selected, {expand: expanded});
        if (this._factCard) {
            this._factCard.setWidth(this._cardWidth);
            this._placeFactCard(this._factCard);
        }
        for (const c of this._eventCards)
            c.card.setWidth(this._cardWidth);
        this._stackEventCards();
        if (this._focus) {
            const id = this._focus.id;
            this._focus = this._makeFocus(id);
        }
        this._applyCamera();
        if (this._panel?.isOpen)
            this._togglePanel(true);
        this._updateAll(0);
        this._showHighlight();
    }

    // Where the planets go: the middle of what the HUD and the cards leave.
    _layoutProjection() {
        const s = this._settings;
        const {left, right, top, bottom} = this._area;
        const W = this._W;
        const tilt = (this.portrait ? s.get('portrait-tilt') : s.get('tilt'));
        const zoom = s.get('zoom') / 100;
        // On a phone held upright, the date sits above and the cards and the
        // timeline below.
        const sceneTop = this._slots.sceneTop, sceneBottom = this._slots.sceneBottom;
        const availH = sceneBottom - sceneTop;
        // A phone on its side has no room to spare: the planets keep left
        // of the cards.
        const column = this._cardWidth + 2 * this._margin;
        const leftSide = this._settings.get('card-side') === 'left';
        const sceneLeft = this.short && leftSide ? left + column : left;
        const sceneRight = this.short && !leftSide ? right - column : right;
        const availW = sceneRight - sceneLeft;
        const fitPx = Math.min(availW * (this.narrow ? 0.48 : 0.46), availH * 0.46 / Math.max(0.2, Math.cos(tilt * Math.PI / 180))) * zoom;
        // Automatic: logarithmic on a phone (either way up), where the inner planets would
        // otherwise huddle around the Sun.
        let mode = s.get('distance-scale');
        if (mode === 'auto')
            mode = this.narrow || this.short ? 'log' : 'sqrt';
        this._projParams = {
            cx: (sceneLeft + sceneRight) / 2, cy: sceneTop + availH / 2, fitPx,
            mode, tilt, azimuth: s.get('azimuth'),
        };
        this._farReach = new Astro.Projection({...this._projParams, zoomOut: FAR_FROM}).reach;
        // Planets in proportion to the screen; a phone's are a little larger
        // for its size, or they would be specks.
        const diag = Math.sqrt(W * this._H);
        this._unit = Math.max(3.2, diag / (this.narrow ? 150 : 165)) * s.get('planet-scale') / 100;
        this._proj = new Astro.Projection({...this._projParams, zoomOut: this._zoomOut});
        this._orbitCache = new Map();
        this._trojanCloudPts = null;
        void W;
    }

    _bodyRadius(id) {
        if (id === 'sun')
            return this._unit * 3.1;
        return Math.max(2.2, this._unit * (BODY[id].radiusKm / 6371) ** 0.45);
    }

    _buildBodies() {
        const showPluto = this._settings.get('show-pluto');
        const showSmall = this._settings.get('show-small-bodies');
        this._bodies = [];
        const dpr = this._dpr;

        const sunR = this._bodyRadius('sun');
        const sunSize = Math.ceil(sunR * 7);
        const sun = new Picture(sunSize, sunSize, dpr);
        sun.paint(cr => Render.drawSun(cr, sunSize, sunR));
        this._sun = {id: 'sun', R: sunR, size: sunSize, sprite: sun, pos: [0, 0, 0], moons: []};
        this._bodies.push(this._sun);

        for (const body of PLANETS) {
            if (body.id === 'pluto' && !showPluto || SMALL_PLANETS.includes(body.id) && !showSmall)
                continue;
            const r = this._bodyRadius(body.id);
            const size = 2 * Render.spriteExtent(body.id, r);
            const pole = Astro.unit(this._proj.view(Astro.equatorialToEcliptic(...body.pole)));
            const b = {id: body.id, R: r, size, pole, phase: 0, light: [1, 0, 0], drawn: null, cache: null,
                sprite: new Picture(size, size, dpr), atmosphere: body.atmosphere, label: this._settings.get('show-labels')};
            this._buildMoons(b);
            this._bodies.push(b);
        }
        this._buildSmallBodies();
        this._buildMarkers();
    }

    _paintPlanet(b) {
        const {id, size, R, pole} = b;
        b.sprite.paint(cr => {
            if (Render.RINGS[id])
                Render.drawRings(cr, size, id, R, pole, -1);
            b.cache ??= Render.bandCache(id, size, R, pole, this._dpr);
            Render.drawSurface(cr, size, id, R, {pole, phase: b.phase, cache: b.cache});
            Render.drawShade(cr, size, R, b.light, b.atmosphere);
            if (Render.RINGS[id])
                Render.drawRings(cr, size, id, R, pole, +1);
        });
    }

    // Moons circle their planet on a squeezed scale: just outside the planet
    // (or its rings) out to a few planet radii, spaced by the logarithm of
    // their real distances, in the planet's equatorial plane (the ecliptic
    // for our Moon).
    _buildMoons(b) {
        b.moons = [];
        const list = this._settings.get('show-moons') ? moonsOf(b.id) : [];
        if (!list.length)
            return;
        const rings = Render.RINGS[b.id];
        const inner = (rings ? rings.at(-1)[1] * b.R : b.R) + 4;
        const span = Math.max(10, Math.min(34, b.R * 1.6));
        const logs = list.map(m => Math.log(m.a));
        const [lo, hi] = [Math.min(...logs), Math.max(...logs)];
        const planetPole = Astro.equatorialToEcliptic(...BODY[b.id].pole);
        for (const m of list) {
            const pole = m.ecliptic ? [0, 0, 1] : planetPole;
            const e1 = Astro.unit(Math.abs(pole[2]) > 0.99 ? Astro.cross(pole, [1, 0, 0]) : Astro.cross(pole, [0, 0, 1]));
            const e2 = Astro.cross(pole, e1);
            const r = list.length === 1 ? inner + span * 0.45 : inner + span * (Math.log(m.a) - lo) / (hi - lo);
            const dot = Math.max(1.2, Math.min(2.8, this._unit * (m.radiusKm / 6371) ** 0.45 * 0.42));
            const size = Math.ceil(2 * dot + 1);
            b.moons.push({
                id: m.id, data: m, r, size, R: dot, rgb: Render.hexToRgb(m.color), e1: this._proj.view(e1), e2: this._proj.view(e2),
                phase0: 2 * Math.PI * hashUnit(m.id), front: true,
            });
        }
        b.orbitRings = b.moons.map(moon => Array.from({length: 73}, (_, i) => {
            const a = i / 72 * 2 * Math.PI;
            return [moon.r * (Math.cos(a) * moon.e1[0] + Math.sin(a) * moon.e2[0]),
                -moon.r * (Math.cos(a) * moon.e1[1] + Math.sin(a) * moon.e2[1])];
        }));
    }

    // Comets and the asteroids missions visit.
    _buildSmallBodies() {
        this._smalls = SMALL_BODIES.map(s => ({id: s.id, data: s, R: 3, rgb: Render.hexToRgb(s.color), tail: [0, 0], shown: false,
            size: s.comet ? Math.ceil(this._unit * 12) : 9}));
    }

    // Lagrange points: Sun-Earth L1 to L5, and Jupiter's Trojan camps.
    _buildMarkers() {
        this._lpoints = [];
        if (!this._settings.get('show-lagrange'))
            return;
        for (const l of LAGRANGE) {
            const rgb = Render.hexToRgb(placeColor(l.id));
            this._lpoints.push({id: l.id, data: l, R: 4, rgb, alpha: l.id.startsWith('j') ? 0.45 : 0.6,
                text: l.id.startsWith('j') ? l.id.slice(1).toUpperCase() : l.short, color: rgbaCss(rgb, 0.55)});
        }
    }

    _projectTrails() {
        for (const tr of this._trajectories) {
            tr.projected = tr.cache.map(({t, p}) => {
                const [x, y] = this._proj.project(p);
                return [x, y, t];
            });
        }
    }

    _buildCraft() {
        this._craftSize = Math.ceil(this._unit * 2.2) | 1;
        this._projectTrails();
    }

    // ---- Camera ----

    // Zoomed out: everything is projected again, the planets shrink to a
    // knot and the far layer fades in. Dragging turns the camera too.
    _applyCamera() {
        if (!this._projParams)
            return;
        const u = this._zoomOut;
        // The camera rises as it pulls back, so things heading up out of
        // the plane of the planets (Voyager 1) are not seen end-on.
        const tilt0 = Math.max(0, Math.min(85, this._projParams.tilt + this._camera.tilt));
        const azimuth = this._projParams.azimuth + this._camera.azimuth + this._offset;
        this._proj = new Astro.Projection({...this._projParams, zoomOut: u, azimuth,
            tilt: tilt0 + (Math.min(tilt0, 25) - tilt0) * smooth(u / 0.6)});
        this._orbitCache = new Map();
        this._trojanCloudPts = null;
        this._projectTrails();
        this._backdropDirty = true;
        this._bodyScale = 1 - 0.7 * smooth(u / 0.35);
        // The planets' poles and their moons' planes turn with the camera,
        // in steps of a few degrees (each step draws every planet afresh).
        const poleKey = `${Math.round((this._camera.azimuth + this._offset) / 3)},${Math.round(this._camera.tilt / 3)}`;
        if (poleKey !== (this._poleKey ?? '0,0')) {
            this._poleKey = poleKey;
            for (const b of this._bodies ?? []) {
                if (b.id === 'sun')
                    continue;
                b.pole = Astro.unit(this._proj.view(Astro.equatorialToEcliptic(...BODY[b.id].pole)));
                b.cache = null;
                b.drawn = null;
                this._buildMoons(b);
            }
        }
        this._sunLabels = null;
        const far = u > FAR_FROM;
        if (far !== this._isFar) {
            this._isFar = far;
            // Coming back in from a far future, return to today.
            if (!far && this._jd > this._endJd())
                this._seek(Math.min(this._jd, Astro.jdNow()));
            if (far && this._live())
                this._browsing = true;
            this._timelineRange();
        }
        this._syncTimelineState();
        this._updateTrails();
        this._showHighlight();
    }

    // Turn the camera by a drag: degrees around the Sun and of tilt.
    turnCamera(dAzimuth, dTilt) {
        if (this._focus)
            return;
        const base = this._projParams?.tilt ?? 0;
        this._camera.azimuth = (this._camera.azimuth + dAzimuth) % 360;
        this._camera.tilt = Math.max(-base, Math.min(85 - base, this._camera.tilt + dTilt));
        this._cameraMoved = true;
        this._activity();
    }

    resetCamera() {
        this._camera = {azimuth: 0, tilt: 0};
        this._cameraMoved = true;
    }

    get cameraTurned() {
        return !!(this._camera.azimuth || this._camera.tilt);
    }

    // The home screen's page (0 to 1), which turns the wallpaper a little.
    setOffset(x) {
        const deg = (x - 0.5) * 40;
        if (Math.abs(deg - this._offset) < 0.05)
            return;
        this._offset = deg;
        this._cameraMoved = true;
    }

    // Zoom one step: out toward the stars or back, or in to a planet
    // (the one picked, or Earth).
    zoom(dir, near = null) {
        if (dir < 0) {
            if (this._focus) {
                this._leaveFocus();
                return;
            }
            this._zoomTarget = ZOOM_STOPS.find(z => z > this._zoomTarget + 0.01) ?? 1;
        } else if (this._zoomTarget > 0.01) {
            this._zoomTarget = [...ZOOM_STOPS].reverse().find(z => z < this._zoomTarget - 0.01) ?? 0;
        } else if (!this._focus) {
            const pick = s => s && !s.tr && BODY[s.id] && s.id !== 'sun' ? s.id : null;
            this._focusOn(pick(near) ?? pick(this._selected) ?? 'earth');
        }
        this._activity();
        this._syncTimelineState();
    }

    // A mouse wheel, or a pinch: out toward the stars, in to a planet.
    wheel(steps, x, y) {
        this._tourYield();
        this._activity();
        if (steps < 0 && this._focus) {
            this._leaveFocus();
            return;
        }
        if (steps > 0 && this._zoomTarget <= 0.001 && !this._focus) {
            const hit = this._hitTest(x, y, 24);
            if (hit && !hit.tr && BODY[hit.id] && hit.id !== 'sun')
                this._focusOn(hit.id);
            return;
        }
        this._zoomTarget = Math.max(0, Math.min(1, this._zoomTarget - steps * WHEEL_STEP));
        this._syncTimelineState();
    }

    // A pinch going on: k is how much the fingers have spread since they
    // landed (2: twice as far apart). Returns true when it did something
    // that ends the gesture (flying in or out).
    pinch(k, startZoom, x, y) {
        this._tourYield();
        this._activity();
        if (this._focus) {
            if (k < 0.7) {
                this._leaveFocus();
                return true;
            }
            return false;
        }
        if (startZoom <= 0.001 && k > 1.5) {
            const hit = this._hitTest(x, y, 40);
            const id = hit && !hit.tr && BODY[hit.id] && hit.id !== 'sun' ? hit.id : this._nearestPlanet(x, y, 80);
            if (id) {
                this._focusOn(id);
                return true;
            }
        }
        this._zoomTarget = Math.max(0, Math.min(1, startZoom - Math.log2(k) * 0.3));
        this._syncTimelineState();
        return false;
    }

    get zoomTarget() {
        return this._zoomTarget;
    }

    _nearestPlanet(x, y, reach) {
        let best = null, bestD = reach;
        for (const b of this._bodies.slice(1)) {
            const d = Math.hypot(x - b.x, y - b.y);
            if (d < bestD)
                [best, bestD] = [b.id, d];
        }
        return best;
    }

    _makeFocus(id) {
        const view = new PlanetView(id, {
            view: v => this._proj.view(v), area: this._focusArea(), W: this._W, H: this._H, dpr: this._dpr,
            trajectories: this._trajectories, showLabels: this._settings.get('show-labels'),
        });
        view.update(this._jd + this._drift);
        return view;
    }

    // Up close the planet sits in the middle of the room the HUD leaves.
    _focusArea() {
        const {left, right} = this._area;
        return {left, right, top: this._slots.sceneTop, bottom: this._slots.sceneBottom};
    }

    // Fly in: the system swells around the planet and fades as the
    // close-up grows out of it.
    _focusOn(id) {
        if (this._focus?.id === id)
            return;
        if (this._focus)
            this._leaveFocus(false);
        if (this._zoomOut) {
            this._zoomOut = this._zoomTarget = 0;
            this._applyCamera();
        }
        if (this.cameraTurned) {
            // Up close the planet faces the way it does from the usual view.
            this.resetCamera();
            this._cameraMoved = false;
            this._applyCamera();
            this._updateBodies();
        }
        const b = this._bodyById(id);
        const [px, py] = [b?.x ?? this._W / 2, b?.y ?? this._H / 2];
        this._drift = 0;
        this._focus = this._makeFocus(id);
        this._focusMul = 1;
        if (this._live())
            this._browsing = true;
        this._playing = true;
        this._fly = {into: true, t: 0, px, py, view: this._focus};
        this._setHover(null);
        this._showHighlight();
        this._syncTimelineState();
        this._updateHud();
        this._refreshFact();
    }

    // A new fact card for the new view (unless one is pinned).
    _refreshFact() {
        if (!this._pin && this._settings.get('show-facts'))
            this._factClock = this._settings.get('fact-interval');
    }

    // Fly back out to the planet's place in the system.
    _leaveFocus(animate = true) {
        const leaving = this._focus;
        if (!leaving)
            return;
        this._focus = null;
        this._focusMul = 1;
        this._drift = 0;
        this._updateAll(0);
        const b = this._bodyById(leaving.id);
        const [px, py] = [b?.x ?? this._W / 2, b?.y ?? this._H / 2];
        this._fly = animate ? {into: false, t: 0, px, py, view: leaving} : null;
        if (this._live())
            this._goNow();
        this._setHover(null);
        this._syncTimelineState();
        this._updateHud();
        this._refreshFact();
    }

    // ---- Tours and stories ----

    // kind: 'planets' (fly past each planet), 'story' (one mission, from
    // launch to the end) or 'stories' (each mission's in turn). An automatic
    // tour (started after the screen sits untouched) loops, and stops at
    // the first touch.
    startTour(kind, missionId = null, {auto = false} = {}) {
        if (this._tour)
            this._endTour(false);
        const ids = kind === 'stories' ? this._storyIds(missionId) : [missionId];
        if (kind !== 'planets' && !ids[0])
            return;
        this._tour = {
            kind, auto, ids, which: 0, steps: [], index: -1, clock: 0, dps: null, start: Infinity,
            saved: {jd: this._jd, playing: this._playing, zoom: this._zoomTarget, focus: this._focus?.id ?? null,
                browsing: this._browsing, expanded: this._pin?.expanded,
                selected: this._selected?.tr ? {mission: this._selected.tr.mission.id} : this._selected},
        };
        if (this._panel?.isOpen)
            this._togglePanel(false);
        this._loadTour();
    }

    // Missions with a story, in launch order, from the given one on.
    _storyIds(from = null) {
        const disabled = this._settings.get('disabled-missions');
        const ids = MISSIONS.filter(m => m.group !== 'observatory' && !disabled.includes(m.id))
            .sort((a, b) => Astro.jd(a.events[0].date) - Astro.jd(b.events[0].date)).map(m => m.id);
        const i = Math.max(0, ids.indexOf(from));
        return [...ids.slice(i), ...ids.slice(0, i)];
    }

    _loadTour() {
        const tour = this._tour;
        let steps;
        if (tour.kind === 'planets') {
            this._setStoryOnly(null);
            steps = planetTour();
            tour.name = 'Planet flybys';
        } else {
            const id = tour.ids[tour.which % tour.ids.length];
            this._setStoryOnly(id);
            const tr = this._trajectories[0];
            if (!tr) {
                this._endTour();
                return;
            }
            steps = storyPlan(tr);
            for (const step of steps) {
                if (step.pick)
                    step.pick = {tr};
            }
            tour.name = tr.mission.short ?? tr.mission.name;
        }
        tour.steps = steps;
        tour.start = Math.min(planSpan(steps, this._jd)[0], this._jd) - 30;
        if (this._live())
            this._browsing = true;
        this._playing = true;
        this._timelineRange();
        // (An automatic tour is to watch, not to steer: no bar.)
        if (!tour.auto && this._storyBar)
            this._storyBar.show(tour.name);
        this._tourStep(0);
    }

    // Only this mission on screen (null: the usual ones).
    _setStoryOnly(id) {
        if (id === this._storyOnly)
            return;
        this._storyOnly = id;
        this._onSetting('disabled-missions');
    }

    _tourStep(i) {
        const tour = this._tour;
        const step = tour.steps[i];
        tour.index = i;
        tour.clock = 0;
        if (step.from !== undefined && Math.abs(step.from - this._jd) > 1e-4)
            this._tourSeek(step.from);
        tour.dps = step.to !== undefined ? Math.max(0, (step.to - this._jd) / step.seconds) : step.dps ?? null;
        if (step.view === 'system' || step.view === 'far') {
            if (this._focus)
                this._leaveFocus();
            this._zoomTarget = step.zoom ?? (step.view === 'far' ? 0.6 : 0);
        } else if (this._focus?.id !== step.view) {
            this._focusOn(step.view);
        }
        if (step.pick && !sameSubject(step.pick, this._selected))
            this._select(step.pick);
        this._storyBar?.setStep(step.title, i, tour.steps.length);
        this._syncTimelineState();
        this._updateHud();
    }

    // Jump within a tour: no clamping to the replay's range, no lingering cards.
    _tourSeek(t) {
        for (const c of this._eventCards)
            c.card.dismiss();
        this._eventCards = [];
        this._jd = t;
        this._drift = 0;
        this._seekEvents();
        this._updateAll(0);
    }

    _updateTour(dt) {
        const tour = this._tour;
        if (!tour) {
            // Start the automatic tour once the screen has sat untouched.
            const kind = this._settings.get('tour');
            if (kind !== 'off' && this._proj && !this._timeline?.dragging && !this._panel?.isOpen &&
                this._realTime - Math.max(0, this._lastActivity, this._tourRest ?? 0) > this._settings.get('tour-idle-minutes') * 60 + 2)
                this.startTour(kind === 'mission' ? 'story' : kind, this._settings.get('tour-mission') || null, {auto: true});
            return;
        }
        const step = tour.steps[tour.index];
        if (tour.paused)
            return;
        tour.clock += dt;
        const done = step.to !== undefined ? this._jd >= step.to - 1e-9 || tour.clock > step.seconds * 1.5 + 3 : tour.clock >= step.seconds;
        if (done)
            this._nextTourStep();
    }

    _nextTourStep() {
        const tour = this._tour;
        if (tour.index + 1 < tour.steps.length) {
            this._tourStep(tour.index + 1);
            return;
        }
        // The end: on to the next story, round again, or back to before.
        if (tour.kind === 'stories' && (tour.auto || tour.which + 1 < tour.ids.length)) {
            tour.which++;
            this._loadTour();
        } else if (tour.auto) {
            this._loadTour();
        } else {
            this._endTour();
        }
    }

    _prevTourStep() {
        const tour = this._tour;
        let i = tour.clock < 2 ? Math.max(0, tour.index - 1) : tour.index;
        const startOf = k => {
            for (let j = k; j >= 0; j--) {
                if (tour.steps[j].from !== undefined)
                    return tour.steps[j].from;
                if (j < k && tour.steps[j].to !== undefined)
                    return tour.steps[j].to;
            }
            return this._jd;
        };
        while (i > 0 && tour.steps[i].to === undefined && tour.steps[i].from === undefined)
            i--;
        this._tourSeek(startOf(i));
        this._tourStep(i);
    }

    // Stop, and put things back as they were.
    _endTour(restore = true) {
        const tour = this._tour;
        if (!tour)
            return;
        this._tour = null;
        this._storyBar?.hide();
        this._setStoryOnly(null);
        if (restore) {
            const {saved} = tour;
            if (saved.focus)
                this._focusOn(saved.focus);
            else if (this._focus)
                this._leaveFocus();
            this._zoomTarget = saved.zoom;
            this._browsing = saved.browsing;
            if (this._live() && !saved.browsing)
                this._goNow();
            else
                this._seek(saved.jd);
            this._playing = saved.playing;
            const tr = saved.selected?.mission && this._trajectories.find(x => x.mission.id === saved.selected.mission);
            const subject = tr ? {tr} : saved.selected?.id ? saved.selected : null;
            if (subject)
                this._select(subject, {expand: saved.expanded});
            else if (this._selected)
                this._deselect();
        }
        this._tourRest = this._realTime;
        this._timelineRange();
        this._syncTimelineState();
        this._updateHud();
    }

    // Someone took the controls: a tour gives way.
    _tourYield() {
        if (this._tour)
            this._endTour(this._tour.auto);
    }

    // Simulated days per real second, for the view on screen.
    _dps() {
        if (this._tour?.paused)
            return 0;
        if (this._tour?.dps !== null && this._tour?.dps !== undefined)
            return this._tour.dps;
        if (this._focus)
            return this._focus.rate * this._focusMul / Astro.DAY_S;
        const dps = this._settings.get('days-per-second');
        if (this._isFar)
            return dps * this._farMul * (this._proj.reach / this._farReach) ** FAR_QUICKEN;
        return dps;
    }

    _speedText() {
        if (this._focus && this._tour?.dps !== null && this._tour?.dps !== undefined)
            return `×${Astro.formatCount(Math.round(this._tour.dps * Astro.DAY_S))}`;
        if (this._focus)
            return `×${Astro.formatCount(Math.round(this._focus.rate * this._focusMul))}`;
        const dps = this._dps(), round = v => v < 10 ? +v.toFixed(1) : Math.round(v);
        return dps >= 36.5 ? `${round(dps / 365.25)} y/s` : `${round(dps)} d/s`;
    }

    // ---- HUD ----

    _buildHud() {
        this._dateBox = h('div', {class: 'datebox'});
        this._dateLabel = h('div', {class: 'date'});
        this._caption = h('div', {class: 'caption'});
        this._dateBox.append(this._dateLabel, this._caption);
        this._legend = h('div', {class: 'legend', hidden: true},
            h('div', {class: 'legend-title'}, 'Sunlight, W/m²'));
        const marks = [1, 10, 100, 1000, 10000];
        this._legendBar = h('canvas', {class: 'legend-bar'});
        const ticks = h('div', {class: 'legend-ticks'});
        for (const [i, text] of ['1', '10', '100', '1k', '10k'].entries())
            ticks.append(h('span', {style: {left: `${Math.round(100 * Math.log10(marks[i]) / Math.log10(30000))}%`}}, text));
        this._legend.append(this._legendBar, ticks);
        this._missionBox = h('div', {class: 'missions'});
        this._missionRows = new Map();
        this._hud.append(this._dateBox, this._legend, this._missionBox);

        if (this._controls) {
            this._timeline = new Timeline(this._hud, {
                seek: (t, done, ev) => {
                    this._tourYield();
                    this._seek(t, done, ev);
                },
                toggle: () => this._togglePlay(),
                restart: () => {
                    this._tourYield();
                    this._playing = true;
                    this._seek(this._startJd());
                    this._syncTimelineState();
                },
                speed: dir => {
                    this._tourYield();
                    this._changeSpeed(dir);
                },
                now: () => {
                    this._tourYield();
                    this._goNow();
                },
                zoom: dir => {
                    this._tourYield();
                    this.zoom(dir);
                },
                layers: () => this._togglePanel(),
                spin: () => this._toggleSpin(),
                sunlight: () => this._settings.set('sunlight-view', !this._settings.get('sunlight-view')),
                music: () => this.onMusicToggle?.(),
                hint: (what, x, ms) => this._timelineHint(what, x, ms),
                activity: () => this._activity(),
            });

            this._panel = new LayersPanel(this._hud, {
                settings: this._settings, missions: MISSIONS,
                onTour: kind => this.startTour(kind, kind === 'stories' ? this._selected?.tr?.mission.id ?? null : null),
                onPrefs: () => {
                    this._togglePanel(false);
                    this.onOpenPrefs?.();
                },
                onClose: () => this._togglePanel(false),
                activity: () => this._activity(),
                quick: [
                    {text: 'Spin the planets', isOn: () => this._spinning(), toggle: () => this._toggleSpin()},
                    {text: '☀ Sunlight view', isOn: () => this._settings.get('sunlight-view'),
                        toggle: () => this._settings.set('sunlight-view', !this._settings.get('sunlight-view'))},
                    {text: '♪ Music', isOn: () => this._settings.get('music-mode') !== 'muted', toggle: () => this.onMusicToggle?.()},
                    {text: 'Zoom out to the stars', isOn: () => this._zoomTarget > 0.01, toggle: () => {
                        this._tourYield();
                        if (this._focus)
                            this._leaveFocus();
                        this._zoomTarget = this._zoomTarget > 0.01 ? 0 : 1;
                        this._syncTimelineState();
                    }},
                    {text: 'Reset the view', isOn: () => false, toggle: () => {
                        this.resetCamera();
                        this._zoomTarget = 0;
                        if (this._focus)
                            this._leaveFocus();
                    }},
                ],
            });

            // Back out of a close-up or a zoom, from the top of the screen.
            this._backButton = h('button', {class: 'pill back', hidden: true, onclick: e => {
                e.stopPropagation();
                if (this._focus)
                    this._leaveFocus();
                else
                    this._zoomTarget = 0;
                this._syncTimelineState();
            }}, '‹  Back to the solar system');
            for (const type of ['pointerdown', 'pointerup'])
                this._backButton.addEventListener(type, e => e.stopPropagation());
            this._hud.append(this._backButton);

            this._storyBar = new StoryBar(this._hud, {
                onPrev: () => this._tour && this._prevTourStep(),
                onNext: () => this._tour && this._nextTourStep(),
                onExit: () => this._endTour(),
                onResize: () => this._placeStoryBar(),
                activity: () => this._tour?.auto || this._activity(),
            });
        }

        // One bubble for what was touched and pressed, shared by the scene
        // and the timeline.
        this._tooltip = h('div', {class: 'tooltip'});
        this._hud.append(this._tooltip);
    }

    _layoutHud() {
        const s = this._settings;
        const show = s.get('show-hud');
        const {left, right, top, bottom} = this._area;
        const W = this._W, H = this._H;
        const narrow = this.narrow;
        const m = narrow ? 12 : Math.round(Math.max(14, W * 0.018));
        this._margin = m;
        this._hud.classList.toggle('narrow', narrow);
        // Cards on the left of a wide screen: the date and the missions go
        // to the right.
        this._hudRight = !narrow && s.get('card-side') === 'left';
        this._hud.classList.toggle('hud-right', this._hudRight);
        this._dateBox.hidden = !show;
        this._cardWidth = narrow ? Math.min(520, right - left - 2 * m) : Math.round(Math.min(380, Math.max(280, W * 0.28)));

        // The timeline: along the bottom, in two rows on a phone.
        let th = 0, ty = bottom;
        const on = !!this._timeline;
        if (on) {
            this._timeline.setNarrow(narrow);
            this._panel.setNarrow(narrow);
            const tw = narrow ? right - left - 2 * m
                : Math.round(Math.max(Math.min(1100, right - left - 2 * (this._cardWidth + 2 * m)), Math.min(820, right - left - 2 * m)));
            const tx = Math.round((left + right - tw) / 2);
            this._timeline.place(tx, 0, tw);
            th = this._timeline.height || (narrow ? 92 : 50);
            ty = bottom - m - th;
            this._timeline.place(tx, ty, tw);
            if (s.get('timeline') === 'always' || this.interacting)
                this._timeline.show();
            else
                this._timeline.hide();
        }
        this._timelineTop = ty;
        const gap = 10;
        const dateH = show ? (this._dateBox.offsetHeight || 60) : 0;
        const topY = top + Math.round(m * 0.6);
        this._dateTop = topY;
        this._hudPlace(this._dateBox, 0, topY);
        this._topY = show && narrow ? topY + dateH + 6 : topY;
        // Where the planets may go: below the date on a phone, above the
        // timeline; craft names and edge arrows keep inside it too.
        // A phone held upright keeps room for the cards, below the planets
        // or above them.
        const pos = this._cardPosition();
        const room = narrow && this.portrait ? Math.min(150, H * 0.16) : 0;
        const sceneTop = (narrow && show ? topY + dateH + 10 : top) + (pos === 'top' ? room : 0);
        const sceneBottom = (on ? (narrow && this.portrait ? ty - 10 : ty - 4) : bottom) - (pos === 'bottom' ? room : 0);
        this._slots = {
            cardTop: narrow ? null : top + m,
            cardBottom: (on ? ty - gap : bottom - m),
            eventBottom: on ? ty - gap : bottom - m,
            listTop: narrow ? topY + dateH + 4 : null,
            listBottom: narrow ? sceneTop + (sceneBottom - sceneTop) * 0.3 : (on ? bottom - m : bottom - m),
            sceneTop, sceneBottom,
        };
        // Clear of the timeline on the left side of a wide screen.
        if (!narrow && on)
            this._slots.listBottom = ty - gap;
        this._missionBox.hidden = !show || !s.get('show-missions');
        if (this._backButton) {
            this._backButton.hidden = true;
            this._placeBackButton();
        }
        this._placeStoryBar();
        this._layoutLegend();
        this._timelineRange();
        this._syncTimelineState();
        this._updateHud();
    }

    _placeBackButton() {
        const b = this._backButton;
        if (!b)
            return;
        const w = b.offsetWidth || 220;
        const {left, right} = this._area;
        b.style.transform = `translate(${Math.round((left + right - w) / 2)}px, ${this._barY()}px)`;
    }

    // The back button and the story bar: under the date, and on a phone
    // under the missions in flight as well.
    _barY() {
        if (!this.narrow || this._missionBox.hidden || !this._slots)
            return this._topY;
        const legendH = this._legend.hidden ? 0 : 50;
        return this._slots.listTop + legendH + this._missionBox.offsetHeight + 4;
    }

    _placeStoryBar() {
        if (!this._storyBar || this._topY === undefined)
            return;
        const {left, right} = this._area;
        const w = this._storyBar.width;
        this._storyBar.el.style.transform = `translate(${Math.round((left + right - w) / 2)}px, ${this._barY()}px)`;
    }

    _layoutLegend() {
        const bar = this._legendBar;
        const dpr = this._dpr || 1;
        bar.width = Math.round(200 * dpr);
        bar.height = Math.round(9 * dpr);
        const ctx = bar.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, 200, 9);
        Render.drawSunlightLegend(new Cairo.Context(ctx), 200, 9, [1, 10, 100, 1000, 10000]);
    }

    // Open or close the chip panel: above the timeline's right end on a
    // wide screen, across the bottom on a phone.
    _togglePanel(open = !this._panel.isOpen) {
        if (!this._panel)
            return;
        if (open) {
            const {left, right, top} = this._area;
            const m = this._margin, tl = this._timeline;
            const w = this.narrow ? right - left - 2 * m : Math.min(440, right - left - 2 * m);
            const x = this.narrow ? left + m : Math.max(left + m, Math.min(right - m - w, tl.x + tl.width - w));
            this._panel.place(x, hh => this._timelineTop - 10 - hh, w, this._timelineTop - 10 - (top + m));
            this._panel.open();
            this._timeline.show();
        } else {
            this._panel.close();
        }
        this._syncTimelineState();
    }

    get panelOpen() {
        return !!this._panel?.isOpen;
    }

    _timelineRange() {
        if (!this._timeline || !this._events)
            return;
        const t0 = this._startJd(), now = Astro.jdNow(), t1 = this._endJd();
        const y0 = Astro.yearOfJd(t0), y1 = Astro.yearOfJd(t1);
        const span = this.narrow ? 2 : 1;
        const step = y1 - y0 > 300 ? 100 : y1 - y0 > 120 ? 25 : y1 - y0 > 40 ? 10 * span : 5 * span;
        const years = [], labels = [];
        for (let y = y0; y <= y1; y++) {
            const t = Astro.jd(`${y}-01-01`);
            if (t < t0 || t > t1)
                continue;
            if (y1 - y0 < 120 || y % step === 0)
                years.push([t, y % step === 0]);
            if (y % step === 0)
                labels.push([t, `${y}`]);
        }
        const events = this._events.filter(ev => ev.kind !== 'note' && ev.kind !== 'point' || ev.title)
            .map(ev => ({t: ev.t, kind: ev.kind, ev, rgb: Render.hexToRgb(ev.mission.color)}));
        this._timeline.setRange({t0, t1, now, years, labels, events});
    }

    _syncTimelineState() {
        if (!this._timeline)
            return;
        if (this._backButton) {
            // On a phone the open panel may reach up over it.
            const show = !this._tour && (!!this._focus || this._zoomTarget > 0.01) && !(this.narrow && this.panelOpen);
            const text = this._focus ? '‹  Back to the solar system' : '‹  Back to the planets';
            if (this._backButton.hidden === show || this._backButton.textContent !== text) {
                this._backButton.hidden = !show;
                this._backButton.textContent = text;
                this._placeBackButton();
            }
        }
        this._timeline.setState({
            playing: this._live() && !this._browsing ? true : this._playing,
            speed: this._speedText(),
            zoom: this._focus ? 'planet' : this._zoomTarget >= 0.999 ? 'max' : this._zoomTarget > 0.01 ? 'far' : 'system',
            live: this._live() && !this._browsing,
            music: this.musicState,
            layers: this._panel?.isOpen,
            spinning: this._spinning(),
            sunlight: this._settings.get('sunlight-view'),
        });
        this._panel?.sync();
    }

    _updateHud() {
        const s = this._settings;
        const live = this._live();
        // Up close, time runs in minutes and hours.
        const clock = new Date(Astro.msFromJd(this._jd));
        const date = this._focus
            ? `${Astro.formatDate(this._jd)}  ${String(clock.getUTCHours()).padStart(2, '0')}:${String(clock.getUTCMinutes()).padStart(2, '0')} UTC`
            : Astro.formatDate(this._jd);
        if (this._dateLabel.textContent !== date)
            this._dateLabel.textContent = date;
        const now = Astro.jdNow();
        const today = Math.abs(this._jd - now) < 0.5;
        const dps = +s.get('days-per-second').toFixed(1);
        let caption;
        if (this._tour) {
            const step = this._tour.steps[this._tour.index];
            caption = `${this._tour.auto ? 'Tour · ' : ''}${this._tour.name} · ${step?.title ?? ''}${this._tour.paused ? ' · paused' : ` · ${this._speedText()}`}`;
        } else if (this._focus) {
            caption = `${BODY[this._focus.id].name} up close · ${this._speedText()} real speed${this._playing ? ''
                : this._spinning() ? ' · date paused, orbits still turning' : ' · paused'}`;
        } else if (this._isFar) {
            caption = `From beyond the planets · ${this._speedText()}${this._playing ? '' : ' · paused'}`;
        } else if (live && !this._browsing) {
            caption = 'Live · the solar system right now';
        } else if (live) {
            caption = `Exploring${this._playing ? ` · ${dps} days per second` : ' · paused'} · back to live soon`;
        } else if (!this._playing) {
            caption = this._controls ? 'Paused · press play on the timeline to go on' : 'Paused';
        } else if (this._jd > now + 0.5) {
            caption = `Ahead of today: planned missions · ${dps} days per second`;
        } else if (today) {
            caption = 'Today · the replay starts over shortly';
        } else {
            caption = `Replaying the space age · ${dps} days per second`;
        }
        if (s.get('sunlight-view'))
            caption += ' · sunlight';
        if (this._caption.textContent !== caption)
            this._caption.textContent = caption;
        this._timeline?.setTime(this._jd);
        this._syncTimelineState();
        this._refreshPin();

        const legendOn = s.get('sunlight-view');
        this._legend.hidden = !legendOn;
        if (legendOn) {
            const dh = this._dateBox.hidden ? 0 : this._dateBox.offsetHeight;
            const {top} = this._area;
            this._hudPlace(this._legend, 0, top + Math.round(this._margin * 0.6) + dh + 10);
        }
        this._updateMissionList();
    }

    _updateMissionList() {
        if (this._missionBox.hidden)
            return;
        let active = [];
        for (const tr of this._trajectories) {
            const status = tr.mission.group === 'observatory' ? null : missionStatus(tr, this._jd);
            if (status)
                active.push([tr, status]);
        }
        // Not much room: keep the picked one and those with the most going
        // on (an event nearest in time), and count the rest.
        const rowH = 22;
        const narrow = this.narrow;
        const legendH = this._legend.hidden ? 0 : 50;
        const room = narrow
            ? Math.min(4 * rowH, this._slots.listBottom - this._slots.listTop - legendH)
            : this._slots.listBottom - (this._dateTop + (this._dateBox.offsetHeight || 60) + legendH + 40);
        const fit = Math.max(narrow ? 0 : 1, Math.floor(room / rowH) - 1);
        let more = 0;
        if (active.length > fit + 1) {
            const busy = tr => sameSubject(this._selected, {tr}) ? -Infinity
                : Math.min(...tr.milestones.map(ev => Math.abs(ev.t - this._jd)));
            const keep = new Set(active.map(([tr]) => tr).sort((a, b) => busy(a) - busy(b)).slice(0, fit));
            more = active.length - fit;
            active = active.filter(([tr]) => keep.has(tr));
        }
        const ids = new Set(active.map(([tr]) => tr.mission.id));
        for (const [id, row] of this._missionRows) {
            if (!ids.has(id)) {
                row.box.remove();
                this._missionRows.delete(id);
            }
        }
        for (const [tr, status] of active) {
            let row = this._missionRows.get(tr.mission.id);
            if (!row) {
                row = {status: h('span', {class: 'mission-status'})};
                row.box = h('button', {class: 'mission', onclick: e => {
                    e.stopPropagation();
                    this._select({tr}, {toggle: true});
                }},
                h('span', {class: 'mission-dot', style: {background: tr.mission.color}}),
                h('span', {class: 'mission-name', style: {color: tr.mission.color}}, tr.mission.short ?? tr.mission.name),
                row.status);
                for (const type of ['pointerdown', 'pointerup'])
                    row.box.addEventListener(type, e => e.stopPropagation());
                this._missionBox.append(row.box);
                this._missionRows.set(tr.mission.id, row);
            }
            if (row.status.textContent !== status)
                row.status.textContent = status;
            row.box.classList.toggle('selected', sameSubject(this._selected, {tr}));
        }
        this._moreLabel ??= h('div', {class: 'mission-more'});
        if (more) {
            this._moreLabel.textContent = `+ ${more} more in flight`;
            this._missionBox.append(this._moreLabel);
        } else {
            this._moreLabel.remove();
        }
        if (narrow) {
            const legendTop = this._slots.listTop + legendH;
            this._hudPlace(this._missionBox, -6, legendTop);
            const y = this._barY();
            if (y !== this._lastBarY) {
                this._lastBarY = y;
                this._placeBackButton();
                this._placeStoryBar();
                // Cards at the top sit under the missions.
                if (this._cardPosition() === 'top')
                    this._stackEventCards();
            }
        } else {
            const hh = this._missionBox.offsetHeight;
            this._hudPlace(this._missionBox, -6, this._slots.listBottom - hh);
        }
    }

    // ---- Backdrop ----

    _paintBackdrop() {
        const s = this._settings;
        const sunlight = s.get('sunlight-view');
        this._backdrop.paint((cr, ctx) => {
            if (s.get('show-stars') && !sunlight) {
                // Phones have fewer, larger pixels to the inch than a desktop
                // monitor: more stars per pixel keep the sky as full.
                Render.drawStars(cr, this._W, this._H, this.narrow ? 2.2 : 1.3);
            }
            if (sunlight) {
                Render.drawSunlightField(cr, {
                    cx: this._proj.cx, cy: this._proj.cy, squash: this._proj.squash,
                    radiusPx: r => this._proj.radiusPx(r), levels: SUN_LEVELS, zone: Astro.HABITABLE_ZONE,
                });
            }
            if (s.get('show-belts')) {
                const rnd = Render.seeded(4);
                const belt = (n, a0, a1, alpha) => {
                    const pts = [];
                    for (let i = 0; i < n; i++) {
                        const a = a0 + (a1 - a0) * rnd() ** 0.8, th = rnd() * 2 * Math.PI;
                        pts.push([...this._proj.project([a * Math.cos(th), a * Math.sin(th), (rnd() - 0.5) * 0.12 * a]).slice(0, 2), 0.4 + rnd() * 0.6]);
                    }
                    Render.drawDots(cr, pts, alpha, 0.5);
                };
                belt(1600, 2.15, 3.3, sunlight ? 0.2 : 0.32);
                belt(900, 30, 48, sunlight ? 0.1 : 0.16);
            }
            if (s.get('show-orbits')) {
                for (const b of this._bodies.slice(1)) {
                    const pts = this._orbitPath(b.id);
                    const minor = SMALL_PLANETS.includes(b.id);
                    Render.strokePath(cr, pts, Render.hexToRgb(BODY[b.id].color), b.id === 'pluto' ? 0.13 : minor ? 0.1 : 0.2, 1,
                        b.id === 'pluto' || minor ? [3, 4] : null);
                }
            }
            this._far.draw(cr, ctx, {proj: this._proj, W: this._W, H: this._H, trajectories: this._trajectories,
                area: {...this._area, top: this._slots.sceneTop, bottom: this._slots.sceneBottom}});
            if (sunlight)
                this._drawSunLabels(ctx);
        });
        this._backdropDirty = false;
        this._backdropJd = this._jd;
    }

    // Contour labels along a ray to the upper right, outermost first, so
    // the inner ones give way when crowded; the habitable zone below.
    _drawSunLabels(ctx) {
        const {cx, cy, squash} = this._proj;
        const {left, right, top, bottom} = this._area;
        const ang = -52 * Math.PI / 180;
        let lastY = -Infinity;
        for (const e of [...SUN_LEVELS].reverse()) {
            const rho = this._proj.radiusPx(Astro.irradianceRadius(e));
            const x = cx + rho * Math.cos(ang) + 4, y = cy + rho * squash * Math.sin(ang) - 14;
            if (rho < this._sun.R * 2.2 || x < left || y < top + 40 || y - lastY < 15)
                continue;
            const text = e === Astro.SOLAR_CONSTANT ? `${Astro.formatIrradiance(e)} · Earth` : Astro.formatIrradiance(e);
            const [w] = Text.size(ctx, 'sunContour', text);
            if (x + w > right)
                continue;
            const [r, g, b] = Render.sunlightColor(e).map(c => Math.round(255 * (0.65 * c + 0.35)));
            Text.draw(ctx, 'sunContour', text, x, y, `rgba(${r},${g},${b},0.75)`);
            lastY = y;
        }
        const [zIn, zOut] = Astro.HABITABLE_ZONE.map(r => this._proj.radiusPx(r));
        const text = 'Habitable zone';
        const [zw] = Text.size(ctx, 'sunZone', text);
        const zy = cy + (zIn + zOut) / 2 * squash - 6;
        if (zy < bottom && zOut - zIn > 6)
            Text.draw(ctx, 'sunZone', text, cx - zw / 2, zy);
    }

    // Projected orbit; orbits drift so slowly that a decade-old one is fine.
    _orbitPath(id) {
        const hit = this._orbitCache.get(id);
        if (hit && Math.abs(hit.jd - this._jd) < 3650)
            return hit.pts;
        const pts = Astro.orbitPoints(Astro.planetOrbit(id, this._jd)).map(p => this._proj.project(p));
        this._orbitCache.set(id, {jd: this._jd, pts});
        this._backdropDirty = true;
        return pts;
    }

    // ---- Per frame ----

    tick(dt) {
        if (!this._proj)
            return;
        this._realTime += dt;
        if (!this._timeRuns() && this._spinning() && !this._restarting && !(this._live() && !this._browsing)) {
            this._drift += dt * (this._focus ? this._dps()
                : 1 / this._settings.get('seconds-per-earth-day'));
        }
        const dz = this._zoomTarget - this._zoomOut;
        if (Math.abs(dz) > 1e-4 || this._cameraMoved) {
            if (Math.abs(dz) > 1e-4)
                this._zoomOut = Math.abs(dz) < 0.002 ? this._zoomTarget : this._zoomOut + dz * Math.min(1, dt * 5);
            this._cameraMoved = false;
            this._applyCamera();
        }
        if (this._fly) {
            this._fly.t += dt * 1000 / FOCUS_MS;
            if (this._fly.t >= 1)
                this._fly = null;
        }
        this._stepRestart(dt);
        this._advance(dt);
        this._updateTour(dt);
        this._updateAll(dt);
        for (const p of this._pulses)
            p.t += dt / 1.6;
        this._pulses = this._pulses.filter(p => p.t < 1);
        if (this._timeline && this._settings.get('timeline') !== 'always' && this._timeline.shown && !this.interacting && !this._panel.isOpen)
            this._timeline.hide();
        // Pixel shift: a slow drift of a few pixels spreads OLED wear.
        if (this._settings.get('pixel-shift')) {
            const t = this._realTime;
            const dx = Math.round(4 * Math.sin(t * 2 * Math.PI / 600));
            const dy = Math.round(3 * Math.sin(t * 2 * Math.PI / 830));
            if (dx !== this._shift?.[0] || dy !== this._shift?.[1]) {
                this._shift = [dx, dy];
                this._content.style.transform = `translate(${dx}px, ${dy}px)`;
            }
        } else if (this._shift) {
            this._shift = null;
            this._content.style.transform = '';
        }
    }

    _updateAll(dt) {
        if (!this._proj)
            return;
        // Up close, the system behind is left alone once the flight in is over.
        const system = !this._focus || this._fly;
        if (system) {
            this._updateBodies();
            this._updateCraft();
        }
        if (this._focus)
            this._focus.update(this._jd + this._drift);
        this._fireEvents();
        this._updateCards(dt);

        this._trailClock += dt;
        if (dt === 0 || this._trailClock >= 1 / TRAIL_HZ) {
            this._trailClock = 0;
            this._updateTrails();
        }
        this._hudClock += dt;
        if (dt === 0 || this._hudClock >= 1 / HUD_HZ) {
            this._hudClock = 0;
            this._updateHud();
        } else {
            this._timeline?.setTime(this._jd);
        }
    }

    _updateBodies() {
        const spinDay = this._settings.get('seconds-per-earth-day');
        const spinning = this._spinning();
        for (const b of this._bodies) {
            const p = b.id === 'sun' ? [0, 0, 0] : Astro.planetPosition(b.id, this._jd);
            b.pos = p;
            [b.x, b.y, b.depth] = this._proj.project(p);
            if (b.id === 'sun')
                continue;
            // Spin: one Earth day lasts spinDay seconds; others in proportion.
            // When spinning is off, the planets keep the face they had.
            if (spinning) {
                const hours = BODY[b.id].rotationHours;
                b.phase = wrapAngle(2 * Math.PI * this._realTime / (Math.abs(hours) / 23.9345 * spinDay) * Math.sign(hours));
            }
            b.light = Astro.unit(this._proj.view(Astro.scale(p, -1)));
            // Redraw only when something moved by most of a pixel, at most
            // 20 times a second.
            const turned = b.drawn && Math.abs(wrapAngle(b.phase - b.drawn.phase)) * b.R > 0.8 && this._realTime - b.drawn.at > 0.05;
            const lit = b.drawn && b.R * Math.sqrt(Math.max(0, 2 * (1 - Astro.dot(b.light, b.drawn.light)))) > 0.6;
            if (!b.drawn || turned || lit) {
                b.drawn = {phase: b.phase, at: this._realTime, light: b.light};
                this._paintPlanet(b);
            }
            this._updateMoons(b, spinDay);
        }
        if (spinning)
            this._moonClock = this._realTime;
        this._updateMarkers();
        this._updateSmallBodies();
    }

    _updateMoons(b, spinDay) {
        for (const m of b.moons) {
            let a;
            if (m.id === 'moon') {
                // Our Moon sits where it really is.
                a = Astro.moonAngle(m.data, this._jd + this._drift);
            } else {
                a = m.phase0 + 2 * Math.PI * this._moonClock / (Math.abs(m.data.period) * spinDay) * Math.sign(m.data.period);
            }
            const [ca, sa] = [Math.cos(a), Math.sin(a)];
            m.dx = m.r * (ca * m.e1[0] + sa * m.e2[0]);
            m.dy = -m.r * (ca * m.e1[1] + sa * m.e2[1]);
            m.front = ca * m.e1[2] + sa * m.e2[2] > 0;
            m.x = b.x + m.dx;
            m.y = b.y + m.dy;
        }
    }

    _smallVisible(x) {
        const s = x.data, jd = this._jd, get = k => this._settings.get(k);
        if (s.show === 'always')
            return get('show-small-bodies');
        if (s.show === 'far')
            return get('show-small-bodies') && this._zoomOut > 0.05;
        if (Array.isArray(s.show))
            return get('show-small-bodies') && jd > Astro.jd(s.show[0]) && jd < Astro.jd(s.show[1]);
        return get('show-missions') && (this._smallWindows.get(x.id) ?? []).some(([t0, t1]) => jd > t0 && jd < t1);
    }

    // Comets (with a tail pointing away from the Sun, longer up close) and
    // asteroids, each while it is of interest.
    _updateSmallBodies() {
        const [sx, sy] = [this._proj.cx, this._proj.cy];
        for (const x of this._smalls) {
            x.shown = this._smallVisible(x);
            if (!x.shown)
                continue;
            const p = Astro.bodyPosition(x.id, this._jd);
            [x.x, x.y] = this._proj.project(p);
            x.pos = p;
            if (x.data.comet) {
                const r = Astro.norm(p);
                x.tail = [Math.atan2(x.y - sy, x.x - sx), r < 4 ? this._unit * 5 * (4 - r) / 3 : 0];
            }
        }
    }

    // Is a mission at (or within a few months of) this asteroid?
    _smallNear(id) {
        return this._events.some(ev => ev.at === id && Math.abs(ev.t - this._jd) < 120) ||
            this._trajectories.some(tr => tr.segmentAt(this._jd)?.body === id);
    }

    // L1 and L2 are only 1.5 million km from Earth, far too close to see at
    // this scale, so they are drawn a little way out along the Sun-Earth
    // line, past the Moon. The others sit where they really are.
    _updateMarkers() {
        if (!this._lpoints.length)
            return;
        const earth = this._bodyById('earth');
        const [dx, dy] = [this._proj.cx - earth.x, this._proj.cy - earth.y];
        const n = Math.hypot(dx, dy) || 1;
        const k = Math.max(earth.R * 3.2, (earth.moons[0]?.r ?? earth.R * 2) + 9);
        for (const x of this._lpoints) {
            if (x.id === 'l1' || x.id === 'l2') {
                const s = x.id === 'l1' ? k : -k;
                [x.x, x.y] = [earth.x + dx / n * s, earth.y + dy / n * s];
            } else {
                [x.x, x.y] = this._proj.project(Astro.bodyPosition(x.id, this._jd));
            }
        }
    }

    // A swarm of dots 60 degrees either side of Jupiter: the Trojans.
    _trojans() {
        const jup = this._bodyById('jupiter');
        if (!this._settings.get('show-belts') || !jup?.pos)
            return null;
        if (!this._trojanCloud) {
            const rnd = Render.seeded(1772);
            const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 0.5;
            this._trojanCloud = Array.from({length: 520}, (_, i) =>
                [(i % 2 ? 60 : -60) + gauss() * 11, 1 + gauss() * 0.035, gauss() * 0.12, 0.35 + rnd() * 0.65]);
        }
        const o = Astro.planetOrbit('jupiter', this._jd);
        const n = Astro.unit(Astro.cross(o.p, o.q));
        const p = jup.pos;
        return this._trojanCloud.map(([dl, dr, dz, a]) => {
            const q = Astro.add(Astro.scale(Astro.rotateAbout(p, n, dl), dr), Astro.scale(n, dz * Astro.norm(p)));
            return [...this._proj.project(q).slice(0, 2), a];
        });
    }

    _bodyById(id) {
        return this._bodies?.find(b => b.id === id) ?? this._smalls?.find(x => x.id === id) ??
            this._lpoints?.find(x => x.id === id) ?? this._moonById(id);
    }

    _moonById(id) {
        for (const b of this._bodies ?? []) {
            const m = b.moons?.find(x => x.id === id);
            if (m)
                return m;
        }
        return null;
    }

    _updateCraft() {
        const show = this._settings.get('show-missions');
        const {left, right} = this._area;
        const {sceneTop: top, sceneBottom: bottom} = this._slots;
        const inset = 10;
        for (const tr of this._trajectories) {
            const seg = show ? tr.segmentAt(this._jd) : null;
            tr.now = null;
            tr.seg = seg;
            tr.onScreen = false;
            if (!seg)
                continue;
            let x, y;
            if (seg.kind === 'stay') {
                // Circle the body it orbits (or loop around its Lagrange point).
                const b = this._bodyById(seg.body);
                const ang = this._realTime * 2 * Math.PI / 6 + 2 * Math.PI * hashUnit(tr.mission.id);
                const rr = (b?.R ?? 2) + (LPOINT[seg.body] ? 2 + 3 * hashUnit(`${tr.mission.id}r`) : 5);
                [x, y] = [(b?.x ?? 0) + rr * Math.cos(ang), (b?.y ?? 0) + rr * Math.sin(ang) * 0.55];
            } else if (tr.lunar) {
                [x, y] = this._lunarSpot(tr);
            } else if (seg.hop) {
                // Short trips near a planet slide between the places as drawn,
                // since L1 and L2 are drawn away from their true spots.
                const [a, b] = [this._screenOf(seg.from), this._screenOf(seg.to)];
                const k = smooth((this._jd - seg.t0) / (seg.t1 - seg.t0));
                [x, y] = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
            } else {
                [x, y] = this._proj.project(seg.pos(this._jd));
            }
            tr.now = [x, y];
            tr.onScreen = x > left + inset && x < right - inset && y > top + inset && y < bottom - inset;
        }
    }

    // Missions to the Moon: Earth's neighborhood drawn with the Moon on its
    // ring, and the craft near the Moon around its dot.
    _lunarSpot(tr) {
        const earth = this._bodyById('earth');
        const m = earth.moons.find(x => x.id === 'moon');
        const k = (m?.r ?? earth.R * 2 + 6) / 384400;
        const place = v => {
            const d = this._proj.view(v);
            return [earth.x + d[0] * k, earth.y - d[1] * k, d[2] * k];
        };
        const moon = m ? [m.x, m.y, 0] : place(Astro.moonPosition(this._jd));
        const p = tr.screen(this._jd, {place, moon, R: Math.max(2, m?.R ?? 2), view: v => this._proj.view(v)});
        return p ?? [earth.x, earth.y];
    }

    _screenOf(ev) {
        const b = ev?.at && this._bodyById(ev.at);
        if (b)
            return [b.x, b.y];
        return ev ? this._proj.project(ev.via ?? Astro.bodyPosition(ev.at ?? 'earth', ev.t)).slice(0, 2) : [0, 0];
    }

    // Trails, the picked one's path and the Trojans: redrawn a few times a
    // second into their own layer.
    _updateTrails() {
        if (!this._trailLayer || !this._proj)
            return;
        this._trailHits = [];
        const s = this._settings;
        const draws = [];
        if (s.get('show-trails') && s.get('show-missions')) {
            const window = s.get('trail-years') * 365.25;
            const jd = this._jd;
            for (const tr of this._trajectories) {
                if (jd < tr.launch || jd - Math.min(jd, tr.end) > window)
                    continue;
                const pts = [];
                for (const [x, y, t] of tr.projected) {
                    if (t > jd)
                        break;
                    const age = jd - t;
                    if (age > window)
                        continue;
                    pts.push([x, y, 0.85 * (1 - age / window) ** 1.4]);
                }
                const seg = tr.seg;
                if (tr.now && seg && seg.kind !== 'stay')
                    pts.push([...tr.now, 0.85]);
                // The rest of the current leg, faint and dashed.
                const ahead = [];
                if (seg?.kind === 'fly' && isFinite(seg.t1)) {
                    if (tr.now)
                        ahead.push(tr.now);
                    for (const [x, y, t] of tr.projected) {
                        if (t > jd && t <= seg.t1)
                            ahead.push([x, y]);
                    }
                }
                if (pts.length < 2 && ahead.length < 2)
                    continue;
                draws.push({pts, ahead, rgb: tr.rgb});
                this._trailHits.push({tr, pts: pts.filter(p => p[2] > 0.08)});
            }
        }
        const highlight = this._highlightPaths();
        const trojans = this._focus && !this._fly ? null : this._trojans();
        const width = Math.max(1, this._unit * 0.17);
        this._trailLayer.paint(cr => {
            if (trojans)
                Render.drawDots(cr, trojans, 0.28, 0.55);
            for (const draw of highlight)
                draw(cr);
            for (const {pts, ahead, rgb} of draws) {
                Render.strokePath(cr, ahead, rgb, 0.16, 1, [2, 4]);
                Render.strokeTrail(cr, pts, rgb, width);
            }
        });
    }

    // ---- Events and fact cards ----

    _fireEvents() {
        if (!this._events || (this._live() && !this._browsing && !this._tour))
            return;
        while (this._eventIndex < this._events.length && this._events[this._eventIndex].t <= this._jd) {
            const ev = this._events[this._eventIndex++];
            if (!this._settings.get('show-missions') || !this._settings.get('show-facts') || this._isFar && !this._tour)
                continue;
            // Skip events left far behind (e.g. after the replay speed was
            // raised) and the ones swept past while dragging the timeline.
            if (this._jd - ev.t > 120 || this._timeline?.dragging)
                continue;
            this._queueEvent(ev);
        }
    }

    _queueEvent(ev) {
        const tr = this._trajectories.find(t => t.mission === ev.mission);
        const card = new Card(this._hud, eventCard(ev), ev.mission.color, this._cardWidth, {
            interactive: this._controls,
            onActivate: tr && this._controls ? () => this._select({tr}, {expand: true}) : null,
            onResize: () => this._stackEventCards(),
        });
        this._eventCards.unshift({card, ev, tr, age: 0});
        // A phone has room for fewer.
        while (this._eventCards.length > (this.narrow || this.short ? 1 : 3))
            this._eventCards.pop().card.dismiss();
        this._stackEventCards();
        if (ev.kind === 'flyby' || ev.kind === 'arrive')
            this._pulse(tr);
    }

    // Where the cards go, as the settings say. Auto: at the bottom on a
    // phone; on a wide screen the fact card at the top and the news at the
    // bottom.
    _cardPosition() {
        return this._settings.get('card-position');
    }

    // The column the cards keep to: clear of the date and the missions
    // above, and of the timeline below.
    _cardColumn() {
        const {top} = this._area;
        const m = this._margin;
        if (this.narrow) {
            let colTop = this._slots.sceneTop - (this._cardPosition() === 'top' ? Math.min(150, this._H * 0.16) : 0);
            if (!this._missionBox.hidden)
                colTop = Math.max(colTop, this._barY() + 2);
            for (const bar of [this._backButton, this._storyBar?.el]) {
                if (bar && !bar.hidden && bar.offsetHeight)
                    colTop = Math.max(colTop, this._barY() + bar.offsetHeight + 8);
            }
            return [colTop, this._slots.cardBottom];
        }
        // On the left the date and the missions have moved out of the way.
        return [top + m, this._slots.eventBottom];
    }

    // Lays out the cards: the pinned card (or the fact card) and the event
    // cards, newest nearest it. Cards that no longer fit give way.
    _stackEventCards() {
        if (!this._slots)
            return;
        const [colTop, colBottom] = this._cardColumn();
        const x = this._cardX();
        const gap = 10;
        let pos = this._cardPosition();
        const main = [this._pin, this._factCard].find(c => c && !c.dismissed) ?? null;
        if (main && main === this._pin) {
            const maxH = Math.round((colBottom - colTop) * (this.narrow ? 0.62 : 1));
            if (main._maxHeight !== maxH)
                main.setMaxHeight(maxH);
        }
        // Auto on a wide screen: the main card at the top, the news stacked
        // up from the bottom.
        if (pos === 'auto' && !this.narrow) {
            let y = colBottom, floor = colTop;
            if (main) {
                main.place(x, colTop);
                floor = colTop + main.height + gap;
            }
            this._eachEventCard((c, first) => {
                y -= c.card.height;
                if (!first && y < floor)
                    return false;
                c.card.place(x, y);
                y -= gap;
                return true;
            });
            return;
        }
        if (pos === 'auto')
            pos = 'bottom';
        // Otherwise one stack: from the bottom, the main card lowest; from
        // the top or the middle, the main card first.
        const room = colBottom - colTop;
        const cards = [];
        let total = main ? main.height : -gap;
        for (const c of this._eventCards) {
            if (cards.length && total + gap + c.card.height > room) {
                cards.push([c, false]);
                continue;
            }
            total += gap + c.card.height;
            cards.push([c, true]);
        }
        let y;
        if (pos === 'bottom') {
            y = colBottom;
            if (main) {
                y -= main.height;
                main.place(x, y);
                y -= gap;
            }
            for (const [c, fits] of cards) {
                if (!fits)
                    continue;
                y -= c.card.height;
                c.card.place(x, y);
                y -= gap;
            }
        } else {
            y = pos === 'top' ? colTop : Math.max(colTop, Math.round(colTop + (room - total) / 2));
            if (main) {
                main.place(x, y);
                y += main.height + gap;
            }
            for (const [c, fits] of cards) {
                if (!fits)
                    continue;
                c.card.place(x, y);
                y += c.card.height + gap;
            }
        }
        this._eachEventCard((c, first) => first || cards.find(([d]) => d === c)?.[1] !== false);
    }

    // Keeps the event cards for which keep(card, first) is true.
    _eachEventCard(keep) {
        for (const [i, c] of [...this._eventCards].entries()) {
            if (keep(c, i === 0))
                continue;
            this._eventCards.splice(this._eventCards.indexOf(c), 1);
            c.card.dismiss();
        }
    }

    _cardX() {
        const {left, right} = this._area;
        if (this.narrow)
            return Math.round((left + right - this._cardWidth) / 2);
        return this._settings.get('card-side') === 'left' ? left + this._margin : right - this._margin - this._cardWidth;
    }

    // The rotating fact card goes where the stack puts it.
    _placeFactCard(_card) {
        this._stackEventCards();
    }

    // The date, the legend and the missions: from the left edge, or from
    // the right one while the cards take the left.
    _hudPlace(el, dx, y) {
        // Called on every tick of the date: nothing is written unless it moved.
        const key = `${this._hudRight}|${Math.round(this._W - this._area.right)}|${Math.round(this._area.left)}|${this._margin + dx}|${Math.round(y)}`;
        if (el._placed === key)
            return;
        el._placed = key;
        if (this._hudRight) {
            el.style.left = 'auto';
            el.style.right = `${Math.round(this._W - this._area.right + this._margin + dx)}px`;
            el.style.transform = `translateY(${Math.round(y)}px)`;
        } else {
            el.style.left = '';
            el.style.right = '';
            el.style.transform = `translate(${Math.round(this._area.left + this._margin + dx)}px, ${Math.round(y)}px)`;
        }
    }

    // A brief ring that swells around a craft at a gravity assist.
    _pulse(tr) {
        if (!tr?.now)
            return;
        this._pulses.push({tr, t: 0, rgb: tr.rgb});
    }

    _updateCards(dt) {
        const showFacts = this._settings.get('show-facts');
        // On a phone the open panel takes the bottom of the screen.
        const panelUp = this.narrow && this._panel?.isOpen;
        // Event cards follow their craft and expire, unless a finger is on them.
        for (const c of [...this._eventCards]) {
            if (!c.card.touched)
                c.age += dt;
            if (c.age > EVENT_CARD_SECONDS || !showFacts || panelUp) {
                c.card.dismiss();
                this._eventCards.splice(this._eventCards.indexOf(c), 1);
                this._stackEventCards();
                continue;
            }
            c.card.target = c.tr ? this._target({tr: c.tr}) : null;
        }

        // A pinned card stays until closed and follows its subject.
        if (this._pin) {
            this._pin.target = this._target(this._selected);
            return;
        }
        // A phone on its side has room for one card at a time: news first.
        if (!showFacts || panelUp || this.short && this._eventCards.length) {
            this._factCard?.dismiss();
            this._factCard = null;
            this._factSubject = null;
            return;
        }
        if (!this._factCard?.touched)
            this._factClock += dt;
        if (!this._factCard || this._factClock > this._settings.get('fact-interval')) {
            this._factClock = 0;
            this._nextFact();
        }
        if (this._factCard)
            this._factCard.target = this._target(this._factSubject);
    }

    // Where a subject is on screen: [x, y, radius], or null if hidden.
    _target(subject) {
        if (!subject)
            return null;
        if (this._focus)
            return this._fly ? null : this._focus.targetOf(subject);
        if (subject.tr) {
            const n = subject.tr.now;
            return n && subject.tr.onScreen ? [n[0], n[1], 6] : null;
        }
        const b = this._bodyById(subject.id);
        return b && b.x !== undefined && b.shown !== false ? [b.x, b.y, (b.R ?? 3) * (b.moons ? this._bodyScale ?? 1 : 1) + 4] : null;
    }

    _nextFact() {
        this._factCard?.dismiss();
        this._factCard = null;
        const jd = this._jd;
        this._factCount++;

        // Every third card spotlights a spacecraft that is out there now.
        let subject = null, content = null, color = '#ffffff';
        if (this._factCount % 3 === 0 && this._settings.get('show-missions')) {
            const flying = this._trajectories.filter(tr => tr.seg);
            const tr = flying[Math.floor(Math.random() * flying.length)];
            if (tr) {
                const last = [...tr.milestones].reverse().find(ev => ev.t <= jd && ev.note);
                subject = {tr};
                color = tr.mission.color;
                content = {
                    title: tr.mission.name,
                    subtitle: `${tr.mission.agency} · launched ${Astro.formatDate(tr.launch)}`,
                    lines: [missionStatus(tr, jd), last ? `${eventDate(last, true)}: ${last.note}` : null],
                };
            }
        }
        if (!content) {
            const extras = [
                ...this._bodies.flatMap(b => b.moons.map(m => m.id)),
                ...this._smalls.filter(x => x.shown).map(x => x.id),
                ...this._lpoints.map(x => x.id),
            ];
            const pool = this._focus ? `focus:${this._focus.id}` : this._factCount % 4 === 1 && extras.length ? 'extras' : 'bodies';
            this._factOrder ??= {};
            if (!this._factOrder[pool]?.length) {
                const ids = this._focus ? [this._focus.id, ...this._focus.present]
                    : pool === 'extras' ? extras : this._bodies.map(b => b.id);
                this._factOrder[pool] = ids.map(id => [Math.random(), id]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
            }
            let id = this._factOrder[pool].pop();
            if (!this._bodyById(id) && !this._focus?.has({id}))
                id = this._focus?.id ?? 'sun';
            subject = {id};
            color = placeColor(id);
            content = this._facts.card(id, jd);
        }
        this._factSubject = subject;
        // Tapping a fact card pins it and opens it up.
        const card = new Card(this._hud, content, color, this._cardWidth, {
            interactive: this._controls,
            onActivate: this._controls ? () => this._select(subject, {expand: true}) : null,
            onResize: c => {
                if (this._factCard === c)
                    this._placeFactCard(c);
                this._stackEventCards();
            },
        });
        this._placeFactCard(card);
        this._factCard = card;
        this._stackEventCards();
        this._showHighlight();
    }

    // ---- Selection ----

    _subject() {
        return this._selected ?? this._factSubject;
    }

    _subjectColor(subject) {
        return subject.tr ? subject.tr.mission.color : placeColor(subject.id);
    }

    _details(subject) {
        if (subject.tr)
            return missionDetails(subject.tr, this._jd);
        return details(subject.id, this._jd, {sunlightView: this._settings.get('sunlight-view'), residents: this._residents(subject.id)});
    }

    // Missions staying at a place now, and those that stayed there before.
    _residents(id) {
        const now = [], past = [];
        for (const tr of this._trajectories) {
            const stays = tr.segments.filter(sg => (sg.kind === 'stay' || sg.phase === 'orbit' || sg.phase === 'surface') && sg.body === id);
            if (stays.some(sg => this._jd >= sg.t0 && this._jd < Math.min(sg.t1, tr.end)))
                now.push(tr.mission.id);
            else if (stays.some(sg => sg.t0 <= this._jd))
                past.push(tr.mission.id);
        }
        return {now, past};
    }

    // A link from a card: a place, or a spacecraft (if it is turned on).
    _follow(link) {
        if (link.mission) {
            const tr = this._trajectories.find(x => x.mission.id === link.mission);
            if (tr)
                this._select({tr}, {expand: true});
        } else if (this._bodyById(link.id) || this._focus?.has({id: link.id})) {
            this._select({id: link.id}, {expand: true});
        }
    }

    // Pin a card for a subject; toggle: a second tap on it lets go.
    _select(subject, {expand = false, toggle = false} = {}) {
        if (toggle && sameSubject(subject, this._selected)) {
            this._deselect();
            return;
        }
        if (sameSubject(subject, this._selected)) {
            if (expand)
                this._pin.setExpanded(true);
            return;
        }
        const wasExpanded = this._pin?.expanded;
        this._pin?.dismiss();
        this._pin = null;
        this._factCard?.dismiss();
        this._factCard = null;
        this._factSubject = null;
        this._selected = subject;
        this._pin = new Card(this._hud, this._details(subject), this._subjectColor(subject), this._cardWidth, {
            expanded: expand || wasExpanded,
            interactive: true,
            onClose: () => this._deselect(),
            onEvent: ev => {
                this._tourYield();
                this._seek(ev.t, true, ev);
            },
            onLink: link => this._follow(link),
            onZoom: this._controls ? () => {
                this._tourYield();
                this._focusOn(subject.id);
            } : null,
            onStory: this._controls && subject.tr && subject.tr.mission.group !== 'observatory' ? () => this.startTour('story', subject.tr.mission.id) : null,
            onResize: c => {
                if (this._pin === c)
                    this._placePin();
            },
        });
        this._placePin();
        this._pin.target = this._target(subject);
        this._showHighlight();
        this._updateHud();
    }

    // Top right on a tablet; on a phone, up from the timeline.
    _placePin() {
        if (this._pin)
            this._stackEventCards();
    }

    _deselect() {
        if (!this._selected)
            return;
        this._pin?.dismiss();
        this._pin = null;
        this._selected = null;
        // The next fact card comes along shortly.
        this._factClock = this._settings.get('fact-interval') - 2;
        this._showHighlight();
        this._updateHud();
    }

    _refreshPin() {
        if (this._pin && this._selected)
            this._pin.update(this._details(this._selected));
    }

    // Path for the current subject: a brighter orbit, or the craft's whole
    // flight, flown part solid and the rest dashed. Drawn with the trails.
    _highlightPaths() {
        const out = [];
        const add = (subject, strong, hover) => {
            if (!subject || this._focus)
                return;
            const rgb = Render.hexToRgb(this._subjectColor(subject));
            if (subject.tr) {
                const past = subject.tr.projected.filter(([, , t]) => t <= this._jd);
                const future = strong ? subject.tr.projected.filter(([, , t]) => t >= this._jd) : [];
                if (subject.tr.now && past.length)
                    past.push(subject.tr.now);
                out.push(cr => {
                    Render.strokePath(cr, past, rgb, hover ? 0.35 : strong ? 0.5 : 0.3, hover ? 1.3 : strong ? 1.6 : 1.2);
                    Render.strokePath(cr, future, rgb, 0.22, 1, [3, 4]);
                });
            } else if (this._orbitOf(subject.id) && (strong || hover || this._settings.get('show-orbits'))) {
                // A Lagrange point lights up its planet's orbit, faintly.
                const id = this._orbitOf(subject.id), faint = id !== subject.id;
                const pts = this._orbitPath(id);
                out.push(cr => Render.strokePath(cr, pts, rgb, (hover ? 0.45 : strong ? 0.7 : 0.5) * (faint ? 0.5 : 1),
                    hover ? 1.4 : strong ? 1.8 : 1.4, faint ? [2, 4] : null));
            }
        };
        const subject = this._subject();
        add(subject, !!this._selected, false);
        if (this._hover && !sameSubject(this._hover, subject))
            add(this._hover, false, true);
        return out;
    }

    _showHighlight() {
        this._updateTrails();
    }

    // Whose orbit to trace for a place: its own, its host planet's for a
    // Lagrange point, none for moons and the Sun.
    _orbitOf(id) {
        if (LPOINT[id])
            return id.startsWith('j') ? 'jupiter' : 'earth';
        return id !== 'sun' && (BODY[id] || SMALL[id]) ? id : null;
    }

    // ---- Drawing ----

    draw() {
        const ctx = this._ctx, cr = this._cr;
        if (!this._proj)
            return;
        const dpr = this._dpr;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cr.reset();

        // The system, and the close-up: during a flight one swells and fades
        // while the other grows out of it.
        const fly = this._fly;
        const k = fly ? easeInOutCubic(Math.min(1, fly.t)) : 1;
        const showSystem = !this._focus || fly;
        if (showSystem) {
            ctx.save();
            if (fly) {
                const into = fly.into ? k : 1 - k;
                const s = 1 + 5 * into;
                ctx.globalAlpha = 1 - into;
                ctx.translate(fly.px, fly.py);
                ctx.scale(s, s);
                ctx.translate(-fly.px, -fly.py);
            }
            this._drawSystem(ctx, cr);
            ctx.restore();
        }
        const view = fly ? fly.view : this._focus;
        if (view) {
            ctx.save();
            if (fly) {
                const into = fly.into ? k : 1 - k;
                const s = 0.12 + 0.88 * into;
                ctx.globalAlpha = into;
                ctx.translate((fly.px - view.cx) * (1 - into), (fly.py - view.cy) * (1 - into));
                ctx.translate(view.cx, view.cy);
                ctx.scale(s, s);
                ctx.translate(-view.cx, -view.cy);
            }
            if (!fly || fly.into || this._focus !== view) {
                const featured = it => sameSubject(this._subject(), it.tr ? {tr: it.tr} : {id: it.id}) ||
                    sameSubject(this._hover, it.tr ? {tr: it.tr} : {id: it.id});
                view.placeLabels(ctx, featured);
            }
            view.draw(ctx, cr);
            ctx.restore();
        }
        this._drawLeaders(ctx);
    }

    _drawSystem(ctx, cr) {
        if (this._backdropDirty || !this._backdrop || this._backdrop.empty)
            this._paintBackdrop();
        this._backdrop.drawAt(ctx, 0, 0);
        this._trailLayer.drawAt(ctx, 0, 0);

        // Comets and asteroids.
        for (const x of this._smalls) {
            if (!x.shown)
                continue;
            cr.save();
            cr.translate(x.x - x.size / 2, x.y - x.size / 2);
            if (x.data.comet)
                Render.drawComet(cr, x.size, x.tail[0], x.tail[1], x.rgb);
            else
                Render.drawSpeck(cr, x.size, x.rgb);
            cr.restore();
            cr.newPath();
        }

        // The Sun and planets, farther first, with their moons.
        const featuredParents = new Set();
        const parentOf = s => s && !s.tr ? MOON[s.id]?.parent ?? s.id : null;
        featuredParents.add(parentOf(this._subject()));
        featuredParents.add(parentOf(this._hover));
        const scale = this._bodyScale ?? 1;
        const moonsOn = this._zoomOut < 0.04;
        for (const b of [...this._bodies].sort((a, c) => a.depth - c.depth)) {
            if (b.id === 'sun') {
                b.sprite.drawCentered(ctx, b.x, b.y, scale);
                continue;
            }
            if (featuredParents.has(b.id) && b.moons.length && moonsOn) {
                cr.save();
                Render.drawMoonOrbits(cr, 0, b.orbitRings.map(ring => ring.map(([x, y]) => [x + b.x, y + b.y])), 0.16);
                cr.restore();
                cr.newPath();
            }
            if (moonsOn)
                this._drawMoons(cr, b, false);
            b.sprite.drawCentered(ctx, b.x, b.y, scale);
            if (moonsOn)
                this._drawMoons(cr, b, true);
        }

        // Lagrange points.
        if (this._zoomOut < 0.12) {
            for (const x of this._lpoints) {
                cr.save();
                cr.translate(x.x - 4.5, x.y - 4.5);
                Render.drawMarker(cr, 9, x.rgb, x.alpha);
                cr.restore();
                cr.newPath();
            }
        }

        // Spacecraft, and the rings that swell at a flyby.
        const size = this._craftSize;
        for (const tr of this._trajectories) {
            if (!tr.now || !tr.onScreen)
                continue;
            cr.save();
            cr.translate(Math.round(tr.now[0] - size / 2), Math.round(tr.now[1] - size / 2));
            Render.drawCraft(cr, size, tr.rgb);
            cr.restore();
            cr.newPath();
        }
        for (const p of this._pulses) {
            const now = p.tr.now;
            if (!now)
                continue;
            const e = 1 - (1 - p.t) ** 3;
            const r = this._unit * 3 * (0.3 + 1.9 * e);
            ctx.beginPath();
            ctx.arc(now[0], now[1], r, 0, 2 * Math.PI);
            ctx.strokeStyle = rgbaCss(p.rgb, 0.9 * (1 - e));
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
        this._drawLabels(ctx);
    }

    _drawMoons(cr, b, front) {
        const light = b.light;
        for (const m of b.moons) {
            if (m.front !== front)
                continue;
            cr.save();
            cr.translate(Math.round(m.x - m.size / 2), Math.round(m.y - m.size / 2));
            Render.drawMoon(cr, m.size, m.rgb, light);
            cr.restore();
            cr.newPath();
        }
    }

    // Names: planets first, then whatever is picked or pressed, spacecraft,
    // comets, asteroids and Lagrange points; the less important give way.
    _drawLabels(ctx) {
        const s = this._settings;
        const showLabels = s.get('show-labels');
        const sunlight = s.get('sunlight-view');
        const featured = sub => sameSubject(this._subject(), sub) || sameSubject(this._hover, sub);
        const labels = [];
        const scale = this._bodyScale ?? 1;
        if (showLabels) {
            for (const b of this._bodies.slice(1)) {
                const name = BODY[b.id].name.toUpperCase();
                const text = sunlight ? `${name}  ${Astro.formatIrradiance(Astro.irradiance(Astro.norm(b.pos)))}` : name;
                const style = sameSubject(this._hover, {id: b.id}) ? 'planetHover' : SMALL_PLANETS.includes(b.id) ? 'small' : 'planet';
                const [w] = Text.size(ctx, style, text);
                const r = b.R * scale;
                // On a phone the inner planets crowd together: the bigger
                // names win and the others give way.
                const prio = this._zoomOut > 0.1 ? 2 : this.narrow ? 1.1 + 0.1 * NAME_RANK.indexOf(b.id) : 0;
                labels.push({style, text, x: Math.round(b.x - w / 2), y: Math.round(b.y + r + 3 + (b.id === 'saturn' ? r * 0.5 : 0)), prio});
            }
        }
        const {left, right} = this._area;
        const {sceneTop: top, sceneBottom: bottom} = this._slots;
        const inset = 10;
        const edges = [];
        for (const tr of this._trajectories) {
            if (!tr.now)
                continue;
            const isFeatured = featured({tr});
            if (tr.onScreen) {
                // Telescopes crowd around L1 and L2, so they are named only on
                // request, and Moon missions crowd around Earth.
                if (!(showLabels && !tr.mission.group || isFeatured))
                    continue;
                const r = Astro.norm(tr.seg.pos(this._jd));
                const name = tr.mission.short ?? tr.mission.name;
                let text = r > 40 && tr.seg.kind !== 'stay' ? `${name} · ${r.toFixed(0)} AU` : name;
                if (sunlight)
                    text += ` · ${Astro.formatRatio(Astro.irradiance(r) / Astro.SOLAR_CONSTANT)} sun`;
                labels.push({style: 'craft', text, x: Math.round(tr.now[0] + 7), y: Math.round(tr.now[1] - 7),
                    color: tr.mission.color, prio: isFeatured ? 1 : 2});
            } else if (this._zoomOut < 0.999 || isFeatured) {
                // Off screen: an arrow at the edge, pointing the way.
                const r = Astro.norm(tr.seg.pos(this._jd));
                const [cx, cy] = [this._proj.cx, this._proj.cy];
                const [x, y] = tr.now;
                const ang = Math.atan2(y - cy, x - cx);
                const arrow = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'][((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
                const text = `${tr.mission.short ?? tr.mission.name} ${arrow} ${r.toFixed(0)} AU`;
                const [w, hh] = Text.size(ctx, 'edge', text);
                const sx = Math.cos(ang), sy = Math.sin(ang);
                const tx = sx > 0 ? (right - inset - cx) / sx : sx < 0 ? (left + inset - cx) / sx : Infinity;
                const ty = sy > 0 ? (bottom - inset - cy) / sy : sy < 0 ? (top + inset - cy) / sy : Infinity;
                const k = Math.min(tx, ty);
                const ex = Math.max(left + inset, Math.min(right - inset - w, cx + sx * k - (sx > 0 ? w : 0)));
                let ey = Math.max(top + inset, Math.min(bottom - inset - hh, cy + sy * k - (sy > 0 ? hh : 0)));
                const step = (ey > cy ? -1 : 1) * (hh + 2);
                while (edges.some(([x0, y0, x1, y1]) => ex < x1 && ex + w > x0 && ey < y1 && ey + hh > y0))
                    ey += step;
                edges.push([ex, ey, ex + w, ey + hh]);
                Text.draw(ctx, 'edge', text, ex, ey, tr.mission.color, 0.85);
            }
        }
        for (const x of this._smalls) {
            if (!x.shown || !showLabels)
                continue;
            const isFeatured = featured({id: x.id});
            if (!(isFeatured || x.data.comet || this._smallNear(x.id)))
                continue;
            const text = (x.data.short ?? x.data.name).toUpperCase();
            const [w] = Text.size(ctx, 'small', text);
            labels.push({style: 'small', text, x: Math.round(x.x - w / 2), y: Math.round(x.y + 5), prio: isFeatured ? 1 : x.data.comet ? 3 : 4});
        }
        if (this._zoomOut < 0.12) {
            for (const x of this._lpoints) {
                const [w] = Text.size(ctx, 'marker', x.text);
                labels.push({style: 'marker', text: x.text, x: Math.round(x.x - w / 2), y: Math.round(x.y + 5), color: x.color,
                    prio: featured({id: x.id}) ? 1 : 5});
            }
        }
        // A planet's moons are named while it, or one of them, is picked.
        const parentOf = sub => sub && !sub.tr ? MOON[sub.id]?.parent ?? sub.id : null;
        const parents = new Set([parentOf(this._subject()), parentOf(this._hover)]);
        if (this._zoomOut < 0.04) {
            for (const b of this._bodies) {
                if (!parents.has(b.id))
                    continue;
                for (const m of b.moons) {
                    const text = m.data.name.replace(/^The /, '');
                    const [w] = Text.size(ctx, 'moon', text);
                    labels.push({style: 'moon', text, x: Math.round(m.x - w / 2), y: Math.round(m.y + m.R + 2), prio: featured({id: m.id}) ? 1 : 3});
                }
            }
        }
        for (const l of Text.declutter(ctx, labels))
            Text.draw(ctx, l.style, l.text, l.x, l.y, l.color);
    }

    // Leader lines from the cards to what they are about.
    _drawLeaders(ctx) {
        const cards = [this._pin, this._factCard, ...this._eventCards.map(c => c.card)];
        for (const card of cards) {
            if (!card)
                continue;
            const want = card.dismissed ? 0 : 1;
            card.alpha += Math.sign(want - card.alpha) * Math.min(Math.abs(want - card.alpha), 1 / 0.45 / 30);
            const t = card.target;
            if (!t || card.alpha <= 0.01 || card.x === undefined)
                continue;
            const [tx, ty, gap] = t;
            const [sx, sy] = card.anchor(tx, ty);
            const len = Math.hypot(tx - sx, ty - sy) - gap;
            ctx.globalAlpha = card.alpha;
            if (len > 4) {
                const a = Math.atan2(ty - sy, tx - sx);
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len);
                ctx.strokeStyle = 'rgba(255,255,255,0.16)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
            ctx.beginPath();
            ctx.arc(tx, ty, Math.round(gap), 0, 2 * Math.PI);
            ctx.strokeStyle = 'rgba(255,255,255,0.42)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }

    // ---- Touch ----

    _activity() {
        this._lastActivity = this._realTime;
        if (this._tour?.auto)
            this._endTour();
        this._browseClock = 0;
        if (this._timeline && !this._timeline.shown) {
            this._timeline.show();
            this._syncTimelineState();
        }
        this.onActivity?.();
    }

    // Something was touched, so the controls come back.
    touched() {
        this._activity();
    }

    // A tap: pick what is there, or let go. A second tap on a planet flies
    // in to it.
    tap(x, y, {double = false} = {}) {
        const hit = this._hitTest(x, y, 22);
        if (double && hit && !hit.tr && BODY[hit.id] && hit.id !== 'sun' && this._focus?.id !== hit.id && this._controls) {
            this._tourYield();
            this._select(hit);
            this._focusOn(hit.id);
        } else if (double && !hit && this._focus && this._controls) {
            this._leaveFocus();
        } else if (hit) {
            if (this._tour?.auto)
                this._endTour();
            this._select(hit, {toggle: true});
        } else if (this._panel?.isOpen) {
            this._togglePanel(false);
        } else {
            this._deselect();
        }
        this._activity();
    }

    // A tap on the live wallpaper: a card for what is there, for a while.
    peek(x, y) {
        const hit = this._hitTest(x, y, 28);
        if (hit) {
            this._select(hit, {toggle: true});
            this._peekClock = this._realTime;
        } else {
            this._deselect();
        }
    }

    // Let a card a tap brought up on the wallpaper go after a while.
    expirePeek(seconds = 12) {
        if (this._peekClock !== undefined && this._realTime - this._peekClock > seconds) {
            this._peekClock = undefined;
            this._deselect();
        }
    }

    // A long press: trace what is there and say what it is.
    press(x, y) {
        const hit = this._hitTest(x, y, 22);
        this._setHover(hit, {x, y});
        this._activity();
    }

    release() {
        if (this._hover)
            setTimeout(() => this._setHover(null), 1600);
    }

    // What is at (x, y): a craft, a body, an orbit or a trail.
    _hitTest(x, y, reach = 10) {
        if (!this._proj)
            return null;
        if (this._focus)
            return this._focus.hitTest(x, y, reach);
        let best = null, bestD = Infinity;
        for (const tr of this._trajectories) {
            if (!tr.now || !tr.onScreen)
                continue;
            const d = Math.hypot(x - tr.now[0], y - tr.now[1]);
            if (d < reach && d < bestD)
                [best, bestD] = [{tr}, d];
        }
        // Moons, comets, asteroids and markers are small: a tight reach,
        // checked against the planets they sit next to.
        const points = [
            ...(this._zoomOut < 0.04 ? this._bodies.flatMap(b => b.moons) : []),
            ...this._smalls.filter(sm => sm.shown),
            ...(this._zoomOut < 0.12 ? this._lpoints : []),
        ];
        for (const pt of points) {
            if (pt.x === undefined)
                continue;
            const d = Math.hypot(x - pt.x, y - pt.y);
            if (d < Math.max(reach * 0.6, pt.R + 3) && d < bestD)
                [best, bestD] = [{id: pt.id}, d];
        }
        // A planet wins over a craft or moon only if the touch is nearer it.
        for (const b of this._bodies) {
            const r = b.R * (this._bodyScale ?? 1);
            const d = Math.max(0, Math.hypot(x - b.x, y - b.y) - r);
            if (d < Math.max(reach * 0.6, 8) && d < bestD)
                [best, bestD] = [{id: b.id}, d];
        }
        if (best)
            return best;
        bestD = reach * 0.6;
        if (this._settings.get('show-orbits')) {
            for (const b of this._bodies.slice(1)) {
                const d = polylineDistance(this._orbitPath(b.id), x, y);
                if (d < bestD)
                    [best, bestD] = [{id: b.id}, d];
            }
        }
        for (const {tr, pts} of this._trailHits ?? []) {
            const d = polylineDistance(pts, x, y);
            if (d < bestD)
                [best, bestD] = [{tr}, d];
        }
        return best;
    }

    _setHover(subject, {x, y} = {}) {
        if (sameSubject(subject, this._hover) || (!subject && !this._hover))
            return;
        this._hover = subject;
        this._updateTrails();
        this._showTooltip(subject ? this._hoverText(subject) : null, x, y);
    }

    _hoverText(subject) {
        const jd = this._jd;
        if (subject.tr) {
            const p = subject.tr.position(jd);
            const name = subject.tr.mission.short ?? subject.tr.mission.name;
            return p ? `${name} · ${Astro.norm(p).toFixed(Astro.norm(p) < 10 ? 2 : 0)} AU from the Sun` : name;
        }
        const id = subject.id;
        if (id === 'sun')
            return 'The Sun';
        if (SAT[id])
            return `${SAT[id].short ?? SAT[id].name} · ${SAT[id].kind}`;
        if (MOON[id])
            return id === 'moon' ? 'The Moon' : `${MOON[id].name} · moon of ${BODY[MOON[id].parent].name}`;
        if (LPOINT[id])
            return `${LPOINT[id].name} · ${LPOINT[id].where}`;
        const r = Astro.norm(Astro.bodyPosition(id, jd));
        const sunlight = this._settings.get('sunlight-view') ? ` · ${Astro.formatIrradiance(Astro.irradiance(r))}` : '';
        return `${placeName(id)} · ${r.toFixed(2)} AU${sunlight}`;
    }

    _showTooltip(text, x, y, ms = 0) {
        const tip = this._tooltip;
        clearTimeout(this._tipTimer);
        if (!text) {
            tip.classList.remove('shown');
            return;
        }
        tip.textContent = text;
        tip.classList.add('shown');
        const w = tip.offsetWidth, hh = tip.offsetHeight;
        const {left, right, top, bottom} = this._area;
        // Above the finger, so it is not hidden under it.
        const px = Math.max(left + 4, Math.min(right - w - 4, (x ?? this._W / 2) - w / 2));
        const py = Math.max(top + 4, Math.min(bottom - hh - 4, (y ?? this._H / 2) - hh - 36));
        tip.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
        if (ms)
            this._tipTimer = setTimeout(() => tip.classList.remove('shown'), ms);
    }

    _timelineHint(what, x, ms = 0) {
        if (!what) {
            if (!ms)
                this._showTooltip(null);
            return;
        }
        const text = what.ev
            ? `${Astro.formatDate(what.ev.t)} · ${what.ev.mission.short ?? what.ev.mission.name} · ${eventTitle(what.ev)}`
            : Astro.formatMonth(what.t);
        this._showTooltip(text, x, this._timelineTop + 30, ms);
    }

    // The back button: close what is open, step out of what was stepped
    // into. False when there is nothing left to back out of.
    back() {
        if (this._panel?.isOpen) {
            this._togglePanel(false);
            return true;
        }
        if (this._tour) {
            this._endTour();
            return true;
        }
        if (this._pin?.expanded) {
            this._pin.setExpanded(false);
            return true;
        }
        if (this._selected) {
            this._deselect();
            return true;
        }
        if (this._focus) {
            this._leaveFocus();
            return true;
        }
        if (this._zoomTarget > 0.01) {
            this._zoomTarget = 0;
            this._syncTimelineState();
            return true;
        }
        if (this.cameraTurned) {
            this.resetCamera();
            return true;
        }
        return false;
    }

    _onSetting(key) {
        if (RELAYOUT_KEYS.includes(key)) {
            clearTimeout(this._relayoutTimer);
            this._relayoutTimer = setTimeout(() => this.relayout(), 120);
            return;
        }
        if (key === 'disabled-missions') {
            if (this._selected?.tr)
                this._deselect();
            for (const c of this._eventCards)
                c.card.dismiss();
            this._eventCards = [];
            if (this._factSubject?.tr) {
                this._factCard?.dismiss();
                this._factCard = null;
                this._factSubject = null;
            }
            if (this._hover?.tr)
                this._setHover(null);
            this._trailHits = [];
            this._buildTrajectories();
            if (this._proj)
                this._buildCraft();
            if (this._focus)
                this._focus = this._makeFocus(this._focus.id);
            this._timelineRange();
            this._updateAll(0);
        } else if (key === 'mode' || key === 'replay-start-year') {
            if (this._settings.surface === 'app')
                this._settings.set('replay-jd', 0);
            this._resetTime();
            this._playing = true;
            this._backdropDirty = true;
            this._timelineRange();
            this._syncTimelineState();
            this._updateAll(0);
        } else if (key === 'replay-jd') {
            // Set to 0 by the settings' Restart button.
            if (this._settings.get('replay-jd') === 0 && !this._live()) {
                this._resetTime();
                this._playing = true;
                this._updateAll(0);
            }
        } else if (key === 'brightness') {
            this._applyOpacity();
        } else if (key === 'trail-years' || key === 'show-trails') {
            this._updateTrails();
        } else if (key === 'sunlight-view') {
            this._backdropDirty = true;
            this._layoutHud();
            this._syncTimelineState();
            this._updateAll(0);
        } else if (key === 'tour' || key === 'tour-mission' || key === 'tour-idle-minutes') {
            if (this._tour?.auto)
                this._endTour();
            this._tourRest = this._realTime;
        } else if (key === 'days-per-second' || key === 'spin-planets' || key === 'music-mode') {
            this._syncTimelineState();
            this._updateHud();
        } else if (key === 'pixel-shift' || key === 'fps') {
            // Read every frame.
        }
    }

    setMusicState(state) {
        this.musicState = state;
        this._syncTimelineState();
    }

    // Fonts arrived: names are measured again.
    fontsReady() {
        Text.forget();
        this._backdropDirty = true;
        this._layoutHud();
    }
}
