// The controls over the scene, as HTML: fact cards that can be pinned and
// expanded, the timeline, the panel of what to show, and a story's bar.
// They mirror lib/ui.js in the GNOME extension, made for fingers: bigger
// targets, a timeline in two rows on narrow screens, and sheets that scroll
// by touch.

import * as Render from '../../lib/render.js';
import Cairo from './cairo.js';
import {icon} from './icons.js';

export function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false)
            continue;
        if (k === 'class')
            el.className = v;
        else if (k === 'style' && typeof v === 'object')
            Object.assign(el.style, v);
        else if (k === 'html')
            el.innerHTML = v;
        else if (k.startsWith('on'))
            el.addEventListener(k.slice(2), v);
        else
            el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
        if (c !== null && c !== undefined && c !== false)
            el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
}

export function iconButton(name, cls, onClick, label) {
    const b = h('button', {class: `btn ${cls ?? ''}`, html: icon(name), 'aria-label': label, title: label});
    b.addEventListener('click', e => {
        e.stopPropagation();
        onClick?.(e);
    });
    return b;
}

function pill(text, cls, onClick) {
    return h('button', {class: `pill ${cls ?? ''}`, onclick: e => {
        e.stopPropagation();
        onClick(e);
    }}, text);
}

// Presses inside a widget stay there: the scene underneath never sees them.
function absorb(el) {
    for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel'])
        el.addEventListener(type, e => e.stopPropagation());
}

// A card: title, subtitle and wrapped lines, plus a leader line to its
// subject (drawn by the scene). With details (stats, events or sections),
// it expands into a scrolling sheet; with `onClose` it is pinned.
//
// content: {title, subtitle, lines[], stats[[label, value]],
//           events[{ev, text, past}], zoomable,
//           sections[{title, stats[[label, value]], notes[], links[{text, subject, dim}]}]}
export class Card {
    constructor(parent, content, color, width, {expanded = false, interactive = true, onActivate, onClose, onEvent, onLink, onResize, onStory, onZoom} = {}) {
        this.color = color;
        this._onEvent = onEvent;
        this._onLink = onLink;
        this._onResize = onResize;
        this.expanded = false;
        this.alpha = 0;            // the leader's fade, stepped by the scene
        this.dismissed = false;
        this.touched = false;      // a finger on it: it does not expire
        this.width = width;
        this.box = h('div', {class: `card${onClose ? ' pinned' : ''}${interactive ? '' : ' passive'}`, style: {width: `${width}px`}});
        absorb(this.box);
        this.box.addEventListener('pointerdown', () => {
            this.touched = true;
        });
        for (const type of ['pointerup', 'pointercancel', 'pointerleave'])
            this.box.addEventListener(type, () => setTimeout(() => (this.touched = false), 1500));
        this.box.addEventListener('click', () => {
            if (onActivate)
                onActivate();
            else if (this._hasDetails && !this.expanded)
                this.setExpanded(true);
        });

        const header = h('div', {class: 'card-header'});
        this._title = h('div', {class: 'card-title', style: {color}}, content.title);
        header.append(this._title);
        this._hasDetails = !!(content.stats || content.sections || content.events);
        if (onStory)
            header.append(pill('▶ Story', 'small story', onStory));
        if (content.zoomable && onZoom)
            header.append(iconButton('zoomIn', 'card-btn', onZoom, 'Fly in for a close-up'));
        if (this._hasDetails) {
            this._expander = iconButton('down', 'card-btn', () => this.setExpanded(!this.expanded), 'More');
            header.append(this._expander);
        }
        if (onClose)
            header.append(iconButton('close', 'card-btn', onClose, 'Close'));
        this.box.append(header);
        this._subtitle = h('div', {class: 'card-subtitle'});
        this.box.append(this._subtitle);
        this._lines = h('div', {class: 'card-lines'});
        this.box.append(this._lines);
        this._sheet = h('div', {class: 'card-details', hidden: true});
        this.box.append(this._sheet);
        this._content = {};
        this.update(content);
        parent.append(this.box);
        if (expanded)
            this.setExpanded(true);
        this._measure();
        requestAnimationFrame(() => this.box.classList.add('shown'));
    }

    _measure() {
        const h = this.box.offsetHeight;
        if (h !== this.height) {
            this.height = h;
            this._onResize?.(this);
        }
    }

    // The tallest the whole card may be; the sheet scrolls past that.
    setMaxHeight(px) {
        this._maxHeight = px;
        this.box.style.maxHeight = `${Math.max(140, Math.round(px))}px`;
        this._measure();
    }

    setWidth(width) {
        this.width = width;
        this.box.style.width = `${width}px`;
        this._measure();
    }

    setExpanded(expanded) {
        if (!this._hasDetails || expanded === this.expanded)
            return;
        this.expanded = expanded;
        this._expander.innerHTML = icon(expanded ? 'up' : 'down');
        this._lines.hidden = expanded;
        this._sheet.hidden = !expanded;
        this.box.classList.toggle('expanded', expanded);
        this._measure();
    }

    // Refresh the text in place; the sheet is rebuilt only when its shape
    // changes, so it keeps its scroll position while the numbers tick.
    update(content) {
        const old = this._content;
        this._content = content;
        if (this._title.textContent !== content.title)
            this._title.textContent = content.title;
        this._subtitle.textContent = content.subtitle ?? '';
        this._subtitle.hidden = !content.subtitle;

        const lines = (content.lines ?? []).filter(Boolean);
        const oldLines = (old.lines ?? []).filter(Boolean);
        if (lines.length === oldLines.length && this._lines.children.length === lines.length) {
            lines.forEach((text, i) => {
                if (this._lines.children[i].textContent !== text)
                    this._lines.children[i].textContent = text;
            });
        } else {
            this._lines.replaceChildren(...lines.map(text => h('div', {class: 'card-line'}, text)));
        }
        this._lines.hidden = this.expanded || !lines.length;
        if (this._hasDetails) {
            const shape = c => JSON.stringify([
                (c.stats ?? []).map(([k]) => k),
                (c.events ?? []).map(e => `${e.text}${e.past}`),
                (c.sections ?? []).map(x => [x.title, (x.stats ?? []).map(([k]) => k), x.notes?.length, (x.links ?? []).map(l => l.text)]),
            ]);
            const sig = shape(content);
            if (sig === this._shape) {
                for (const set of this._setters)
                    set(content);
            } else {
                this._shape = sig;
                this._buildSheet(content);
            }
        }
        if (this.box.isConnected)
            this._measure();
    }

    _buildSheet(content) {
        this._sheet.replaceChildren();
        this._setters = [];
        const set = (el, get) => this._setters.push(c => {
            const text = get(c);
            if (text !== undefined && el.textContent !== text)
                el.textContent = text;
        });
        const statRows = (box, rows, get) => {
            rows.forEach(([key, value], i) => {
                const v = h('div', {class: 'stat-value'}, value);
                box.append(h('div', {class: 'stat'}, h('div', {class: 'stat-key'}, key), v));
                set(v, c => get(c)?.[i]?.[1]);
            });
        };
        const block = cls => {
            const b = h('div', {class: cls});
            this._sheet.append(b);
            return b;
        };
        if (content.stats?.length)
            statRows(block('card-stats'), content.stats, c => c.stats);
        if (content.events?.length) {
            const box = block('card-events');
            for (const item of content.events) {
                const dot = h('span', {class: 'event-dot', style: item.past ? {background: this.color} : {border: `1px solid ${this.color}`}});
                box.append(h('button', {class: `event-row${item.past ? ' past' : ''}`, onclick: e => {
                    e.stopPropagation();
                    this._onEvent?.(item.ev);
                }}, dot, h('span', {class: 'event-text'}, item.text)));
            }
        }
        (content.sections ?? []).forEach((section, si) => {
            const box = block('card-section');
            if (section.title)
                box.append(h('div', {class: 'section-title'}, section.title.toUpperCase()));
            if (section.stats?.length)
                statRows(box, section.stats, c => c.sections?.[si]?.stats);
            (section.notes ?? []).forEach((text, ni) => {
                const l = h('div', {class: 'card-note'}, section.title ? `·  ${text}` : text);
                box.append(l);
                set(l, c => {
                    const t = c.sections?.[si]?.notes?.[ni];
                    return t === undefined ? undefined : section.title ? `·  ${t}` : t;
                });
            });
            for (const link of section.links ?? []) {
                box.append(h('button', {class: `event-row${link.dim ? ' past' : ''}`, onclick: e => {
                    e.stopPropagation();
                    this._onLink?.(link.subject);
                }}, h('span', {class: 'link-arrow'}, '›'), h('span', {class: 'event-text'}, link.text)));
            }
        });
    }

    place(x, y) {
        this.x = x;
        this.y = y;
        this.box.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }

    // Where the leader starts on the card's edge, for a target at (tx, ty).
    anchor(tx, ty) {
        const {x, y, width: w, height: hh} = this;
        const sx = tx < x ? x : tx > x + w ? x + w : x + w / 2;
        const sy = tx >= x && tx <= x + w ? (ty < y ? y : y + hh) : Math.max(y + 14, Math.min(y + hh - 14, ty));
        return [sx, sy];
    }

    dismiss() {
        if (this.dismissed)
            return;
        this.dismissed = true;
        this.box.classList.remove('shown');
        this.box.style.pointerEvents = 'none';
        setTimeout(() => this.box.remove(), 450);
    }

    destroy() {
        this.dismissed = true;
        this.box.remove();
    }
}

// The timeline: transport buttons, a track from t0 to t1 with a tick for
// every mission event, and a playhead to drag (or tap to pause and play).
//
// handlers: {seek(t, done, ev), toggle(), restart(), speed(dir), now(),
//            spin(), sunlight(), music(), zoom(dir), layers(),
//            hint(text | null, x), activity()}
export class Timeline {
    constructor(parent, handlers) {
        this._handlers = handlers;
        this.el = h('div', {class: 'timeline'});
        absorb(this.el);
        this.el.addEventListener('pointerdown', () => handlers.activity());

        const button = (name, cb, label, cls = '') => {
            const b = iconButton(name, `tl-btn ${cls}`, () => {
                cb();
                handlers.activity();
            }, label);
            this.el.append(b);
            return b;
        };
        this._restart = button('restart', () => handlers.restart(), 'Back to the start', 'narrow-roomy');
        this._play = button('pause', () => handlers.toggle(), 'Play or pause', 'play');
        this._slower = button('slower', () => handlers.speed(-1), 'Slower');
        this._speed = h('div', {class: 'tl-speed'});
        this.el.append(this._speed);
        this._faster = button('faster', () => handlers.speed(+1), 'Faster');

        this._track = h('div', {class: 'tl-track'});
        this._canvas = h('canvas');
        this._years = h('div', {class: 'tl-years'});
        this._played = h('div', {class: 'tl-played'});
        this._head = h('div', {class: 'tl-head'});
        this._track.append(this._canvas, this._years, this._played, this._head);
        this.el.append(this._track);
        this._track.addEventListener('pointerdown', e => this._onDown(e));
        this._track.addEventListener('pointermove', e => this._onMove(e));
        this._track.addEventListener('pointerup', e => this._onUp(e));
        this._track.addEventListener('pointercancel', () => this._endDrag());
        this._track.addEventListener('wheel', e => this._onWheel(e), {passive: true});

        this._now = pill('Now', 'tl-now', () => {
            handlers.now();
            handlers.activity();
        });
        this.el.append(this._now);
        this._zoomOut = button('zoomOut', () => handlers.zoom(-1), 'Zoom out', 'wide-only-sm');
        this._zoomIn = button('zoomIn', () => handlers.zoom(+1), 'Zoom in', 'wide-only-sm');
        this._spin = button('spin', () => handlers.spin(), 'Spin the planets', 'toggle wide-only');
        this._sun = button('sun', () => handlers.sunlight(), 'Sunlight view', 'toggle wide-only');
        this._music = button('musicOff', () => handlers.music(), 'Music', 'toggle wide-only');
        this._layers = button('list', () => handlers.layers(), 'What to show, tours and settings', 'toggle');

        parent.append(this.el);
        this.shown = false;
        this._grab = null;
        new ResizeObserver(() => this._layoutTrack(true)).observe(this._track);
    }

    get height() {
        return this.el.offsetHeight;
    }

    // Narrow screens put the track on a row of its own, above the buttons,
    // and move the spin, sunlight and music toggles into the panel.
    setNarrow(narrow) {
        this.el.classList.toggle('narrow', narrow);
    }

    place(x, y, width) {
        this.el.style.width = `${width}px`;
        this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        this.x = x;
        this.y = y;
        this.width = width;
    }

    // range: {t0, t1, now, years[[t, major]], events[{t, rgb, kind, ev}], labels[[t, text]]}
    setRange(range) {
        this._range = range;
        this._layoutTrack(true);
    }

    _layoutTrack(force = false) {
        const w = this._track.clientWidth, hh = this._track.clientHeight;
        if (!this._range || w <= 0 || hh <= 0 || (!force && w === this._w && hh === this._h))
            return;
        [this._w, this._h] = [w, hh];
        const dpr = window.devicePixelRatio || 1;
        this._canvas.width = Math.round(w * dpr);
        this._canvas.height = Math.round(hh * dpr);
        this._canvas.style.width = `${w}px`;
        this._canvas.style.height = `${hh}px`;
        const ctx = this._canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, hh);
        const base = Math.round(hh * 0.62);
        // Render.drawTimeline puts the line at 68% of the height it is given.
        const cr = new Cairo.Context(ctx);
        cr.translate(0, base - Math.round(hh * 0.68));
        Render.drawTimeline(cr, w, hh, {...this._range, x: t => this._x(t)});
        this._years.replaceChildren();
        let lastX = -Infinity;
        for (const [t, text] of this._range.labels) {
            const l = h('span', {class: 'tl-year'}, text);
            this._years.append(l);
            const lw = l.offsetWidth;
            const x = Math.round(this._x(t) - lw / 2);
            if (x < lastX + 8 || x < 0 || x + lw > w) {
                l.remove();
                continue;
            }
            lastX = x + lw;
            l.style.transform = `translate(${x}px, ${base + 5}px)`;
        }
        this._base = base;
        this._played.style.top = `${base - 0.5}px`;
        this._head.style.top = `${base - 9}px`;
        this._headX = null;
        this.setTime(this._time ?? this._range.now);
    }

    _x(t) {
        const {t0, t1} = this._range;
        return (t - t0) / (t1 - t0) * (this._w ?? this._track.clientWidth);
    }

    _timeAt(x) {
        const {t0, t1} = this._range;
        return t0 + Math.max(0, Math.min(1, x / (this._w || 1))) * (t1 - t0);
    }

    setTime(t) {
        this._time = t;
        if (!this._range || !this._w || !this.shown)
            return;
        const x = Math.max(0, Math.min(this._w, this._x(t)));
        if (Math.abs(x - (this._headX ?? -1)) < 0.25)
            return;
        this._headX = x;
        this._played.style.width = `${Math.max(0.001, x)}px`;
        this._head.style.transform = `translateX(${Math.round(x - 2)}px)`;
    }

    // music: a music-mode, or 'hidden'
    setState(state) {
        this._state = state;
        const play = state.playing ? 'pause' : 'play';
        if (this._play.dataset.icon !== play) {
            this._play.dataset.icon = play;
            this._play.innerHTML = icon(play);
        }
        if (this._speed.textContent !== state.speed)
            this._speed.textContent = state.speed;
        const music = state.music === 'background' ? 'musicOn' : 'musicOff';
        if (this._music.dataset.icon !== music) {
            this._music.dataset.icon = music;
            this._music.innerHTML = icon(music);
        }
        this._music.hidden = state.music === 'hidden';
        this._zoomOut.disabled = state.zoom === 'max';
        this._zoomIn.disabled = state.zoom === 'planet';
        this._now.classList.toggle('on', !!state.live);
        this._spin.classList.toggle('on', !!state.spinning);
        this._sun.classList.toggle('on', !!state.sunlight);
        this._music.classList.toggle('on', state.music === 'background');
        this._layers.classList.toggle('on', !!state.layers);
        this._head.classList.toggle('paused', !state.playing);
    }

    // The event under x, if any, within a fingertip.
    _eventNear(x) {
        let best = null, bestD = 9;
        for (const e of this._range.events) {
            const d = Math.abs(this._x(e.t) - x);
            if (d < bestD || (best && d === bestD && e.kind === 'launch')) {
                best = e;
                bestD = d;
            }
        }
        return best;
    }

    _local(e) {
        return e.clientX - this._track.getBoundingClientRect().left;
    }

    _onDown(e) {
        if (!this._range)
            return;
        this._track.setPointerCapture(e.pointerId);
        this._grab = e.pointerId;
        this._dragged = false;
        this._pressX = this._local(e);
        this._handlers.activity();
    }

    _onMove(e) {
        if (this._grab !== e.pointerId || !this._range)
            return;
        const x = this._local(e);
        if (Math.abs(x - this._pressX) > 6)
            this._dragged = true;
        if (this._dragged) {
            const t = this._timeAt(x);
            this._handlers.seek(t, false);
            this._handlers.hint({t}, e.clientX);
        }
        this._handlers.activity();
    }

    _onUp(e) {
        if (this._grab !== e.pointerId)
            return;
        this._endDrag();
        const x = this._local(e);
        this._handlers.hint(null);
        // A tap on the playhead plays or pauses; one on an event tick jumps
        // to that event.
        if (!this._dragged && Math.abs(x - (this._headX ?? -99)) <= 14) {
            this._handlers.toggle();
            return;
        }
        const near = this._dragged ? null : this._eventNear(x);
        if (near)
            this._handlers.hint({ev: near.ev, t: near.t}, e.clientX, 2500);
        this._handlers.seek(near ? near.t : this._timeAt(x), true, near?.ev);
    }

    _onWheel(e) {
        const steps = Math.sign(-e.deltaY || e.deltaX);
        if (steps && this._range && this._time !== undefined)
            this._handlers.seek(Math.max(this._range.t0, Math.min(this._range.t1, this._time + steps * 30.44)), true);
        this._handlers.activity();
    }

    _endDrag() {
        this._grab = null;
    }

    get dragging() {
        return this._grab !== null;
    }

    show() {
        if (this.shown)
            return;
        this.shown = true;
        this.el.classList.add('shown');
        this._headX = null;
        this._layoutTrack();
        this.setTime(this._time);
    }

    hide() {
        if (!this.shown || this._grab !== null)
            return;
        this.shown = false;
        this.el.classList.remove('shown');
        this._handlers.hint(null);
    }

    destroy() {
        this.el.remove();
    }
}

// A panel opened from the timeline: tours, quick switches (on narrow
// screens), then chips to show and hide things and missions. Each chip
// mirrors a setting.
const CONTENT = [
    ['show-orbits', 'Orbits'], ['show-labels', 'Names'], ['show-stars', 'Stars'], ['show-belts', 'Belts and Trojans'],
    ['show-moons', 'Moons'], ['show-pluto', 'Pluto'], ['show-small-bodies', 'Comets and asteroids'],
    ['show-lagrange', 'Lagrange points'], ['show-trails', 'Trails'],
    ['show-facts', 'Fact cards'], ['show-hud', 'Date and mission list'],
];

export class LayersPanel {
    // options: {settings, missions, onTour(kind), onPrefs(), onClose(), activity(),
    //           quick: [{text, isOn(), toggle()}]}
    constructor(parent, {settings, missions, onTour, onPrefs, onClose, activity, quick}) {
        this._settings = settings;
        this._activity = activity;
        this.isOpen = false;
        this.el = h('div', {class: 'card panel'});
        absorb(this.el);
        this.el.addEventListener('pointerdown', () => activity?.());

        const header = h('div', {class: 'card-header'},
            h('div', {class: 'card-title'}, 'On screen'),
            pill('Settings', '', () => onPrefs()),
            iconButton('close', 'card-btn', () => onClose(), 'Close'));
        this.el.append(header);
        const sheet = h('div', {class: 'panel-sheet'});
        this.el.append(sheet);
        this._chips = [];

        const flowOf = items => h('div', {class: 'chips'}, items.map(item => this._chip(item)));
        const heading = (text, all, {body, count, closed = false}) => {
            const title = h('button', {class: 'fold section-title'});
            const show = open => {
                title.textContent = `${open ? '▾' : '▸'}  ${text.toUpperCase()}${count && !open ? `  ·  ${count}` : ''}`;
                for (const b of body)
                    b.hidden = !open;
            };
            show(!closed);
            title.addEventListener('click', () => {
                show(body[0].hidden);
                this._activity?.();
            });
            const head = h('div', {class: 'panel-heading'}, title);
            if (all) {
                for (const [name, on] of [['All', true], ['None', false]])
                    head.append(pill(name, 'small', () => all(on)));
            }
            sheet.append(head);
        };
        const section = (text, items, all, closed = false) => {
            const flow = flowOf(items);
            heading(text, all, {body: [flow], count: closed ? items.length : 0, closed});
            sheet.append(flow);
        };

        // Spin, sunlight and music, which narrow timelines leave out.
        if (quick?.length) {
            this._quick = flowOf(quick);
            this._quick.classList.add('quick');
            sheet.append(this._quick);
        }

        const tours = h('div', {class: 'chips'});
        const hint = h('div', {class: 'panel-hint'}, 'Or press ▶ Story on a mission’s card.');
        heading('Tours', null, {body: [tours, hint]});
        for (const [kind, text] of [['planets', 'Fly past the planets'], ['stories', 'Every mission’s story']]) {
            tours.append(h('button', {class: 'chip tour', onclick: e => {
                e.stopPropagation();
                onTour(kind);
                this._activity?.();
            }}, `▶ ${text}`));
        }
        sheet.append(tours, hint);

        section('Show', CONTENT.map(([key, text]) => ({text, isOn: () => settings.get(key),
            toggle: () => settings.set(key, !settings.get(key))})));
        const disabled = () => settings.get('disabled-missions');
        const setMissions = (ids, on) => {
            const rest = disabled().filter(id => !ids.includes(id));
            settings.set('disabled-missions', on ? rest : [...rest, ...ids]);
        };
        const chipsFor = list => [...list].sort((a, b) => a.events[0].date.localeCompare(b.events[0].date)).map(m => ({
            text: m.short ?? m.name, color: m.color, isOn: () => !disabled().includes(m.id),
            toggle: () => setMissions([m.id], disabled().includes(m.id)),
        }));
        const craft = missions.filter(m => !m.group);
        const moon = missions.filter(m => m.group === 'moon');
        const scopes = missions.filter(m => m.group === 'observatory');
        section('Missions', [{text: 'Show missions', isOn: () => settings.get('show-missions'),
            toggle: () => settings.set('show-missions', !settings.get('show-missions'))}],
        on => {
            settings.set('disabled-missions', on ? [] : missions.map(m => m.id));
            if (on)
                settings.set('show-missions', true);
        });
        section('Spacecraft', chipsFor(craft), on => setMissions(craft.map(m => m.id), on), true);
        section('To the Moon', chipsFor(moon), on => setMissions(moon.map(m => m.id), on), true);
        section('Telescopes at L1 and L2', chipsFor(scopes), on => setMissions(scopes.map(m => m.id), on), true);

        this._unwatch = settings.connect(() => this.sync());
        parent.append(this.el);
        this.sync();
    }

    _chip(item) {
        const chip = h('button', {class: 'chip'});
        if (item.color)
            chip.append(h('span', {class: 'chip-dot', style: {background: item.color}}));
        chip.append(item.text);
        chip.addEventListener('click', e => {
            e.stopPropagation();
            item.toggle();
            this.sync();
            this._activity?.();
        });
        this._chips.push([chip, item]);
        return chip;
    }

    setNarrow(narrow) {
        if (this._quick)
            this._quick.hidden = !narrow;
    }

    sync() {
        for (const [chip, item] of this._chips)
            chip.classList.toggle('on', !!item.isOn());
    }

    // Top left at (x, y) (or y(height) for a panel that grows upward), no
    // taller than maxHeight.
    place(x, y, width, maxHeight) {
        this.el.style.width = `${width}px`;
        this.el.style.maxHeight = `${Math.max(160, maxHeight)}px`;
        const hh = Math.min(maxHeight, this.el.offsetHeight);
        this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(typeof y === 'function' ? y(hh) : y)}px)`;
    }

    open() {
        if (this.isOpen)
            return;
        this.isOpen = true;
        this.sync();
        this.el.classList.add('shown');
    }

    close() {
        if (!this.isOpen)
            return;
        this.isOpen = false;
        this.el.classList.remove('shown');
    }

    destroy() {
        this._unwatch();
        this.el.remove();
    }
}

// A story's or tour's controls: back a step, what is happening, on a step,
// and out.
export class StoryBar {
    constructor(parent, {onPrev, onNext, onExit, onResize, activity}) {
        this._onResize = onResize;
        this.el = h('div', {class: 'story'});
        absorb(this.el);
        this.el.addEventListener('pointerdown', () => activity?.());
        this._name = h('span', {class: 'story-name'});
        this._step = h('span', {class: 'story-step'});
        this.el.append(
            iconButton('prev', 'card-btn', onPrev, 'Back a step'),
            h('span', {class: 'story-text'}, this._name, this._step),
            iconButton('next', 'card-btn', onNext, 'On a step'),
            pill('Exit', 'small', onExit));
        parent.append(this.el);
    }

    get width() {
        return this.el.offsetWidth;
    }

    show(name) {
        this._name.textContent = name;
        this.el.classList.add('shown');
        this._onResize?.();
    }

    setStep(title, index, count) {
        this._step.textContent = `${title} · ${index + 1}/${count}`;
        this._onResize?.();
    }

    hide() {
        this.el.classList.remove('shown');
    }

    get shown() {
        return this.el.classList.contains('shown');
    }

    destroy() {
        this.el.remove();
    }
}
