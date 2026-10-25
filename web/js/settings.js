// The settings, as a page over the scene: the GNOME extension's preferences
// (prefs.js) for a phone, plus how Orrery runs as the live wallpaper, on the
// lock screen and as the screensaver.

import {MISSIONS} from '../../lib/missions.js';
import * as Host from './host.js';
import {iconButton, h} from './ui.js';

const STORY_MISSIONS = MISSIONS.filter(m => m.group !== 'observatory')
    .sort((a, b) => a.events[0].date.localeCompare(b.events[0].date))
    .map(m => [m.id, `${m.short ?? m.name} · ${m.events[0].date.slice(0, 4)}`]);

const MODE = [['replay', 'Replay history'], ['live', 'Live']];
const TOUR = [['off', 'Off'], ['planets', 'Planet flybys'], ['stories', 'Every story'], ['mission', 'One story']];

// What each of the wallpaper, the lock screen and the screensaver sets for
// itself, in the order shown.
const OWN_ROWS = prefix => [
    ['choice', 'Clock', `${prefix}/mode`, MODE, 'Replay runs the space age forward and loops; Live shows the solar system right now'],
    ['number', 'Replay speed', `${prefix}/days-per-second`, 'Days per second', 0.5],
    ['switch', 'Fact cards', `${prefix}/show-facts`],
    ['switch', 'Date and mission list', `${prefix}/show-hud`],
    ['switch', 'Names', `${prefix}/show-labels`],
    ['switch', 'Spacecraft', `${prefix}/show-missions`],
    ['switch', 'Sunlight view', `${prefix}/sunlight-view`],
    ['choice', 'Tour', `${prefix}/tour`, TOUR, 'Flies past the planets or tells the missions’ stories by itself'],
    ['select', 'Story', `${prefix}/tour-mission`, STORY_MISSIONS, '', s => s.getRaw(`${prefix}/tour`) === 'mission'],
    ['number', 'Zoom', `${prefix}/zoom`, 'Percent; 100 fits Neptune’s orbit', 5],
    ['number', 'Brightness', `${prefix}/brightness`, 'Percent; lower spares OLED pixels', 5],
    ['number', 'Frames per second', `${prefix}/fps`, '', 1],
];

export class SettingsPage {
    constructor(parent, settings, {onClose}) {
        this._settings = settings;
        this._onClose = onClose;
        this._rows = [];
        this.el = h('div', {class: 'settings', hidden: true});
        for (const type of ['pointerdown', 'pointerup', 'click', 'wheel'])
            this.el.addEventListener(type, e => e.stopPropagation());
        const header = h('div', {class: 'settings-header'},
            iconButton('back', 'card-btn big', () => this.close(), 'Back'),
            h('div', {class: 'settings-title'}, 'Settings'));
        this._body = h('div', {class: 'settings-body'});
        this.el.append(header, this._body);
        parent.append(this.el);
        settings.onRaw(() => this._sync());
    }

    get isOpen() {
        return !!this._open;
    }

    // Back from the wallpaper picker or the screen saver settings: whether
    // Orrery is in use there now.
    refresh() {
        if (!this._open)
            return;
        const top = this._body.scrollTop;
        this._build();
        this._body.scrollTop = top;
    }

    open(section = null) {
        this._open = true;
        this._build();
        this.el.hidden = false;
        requestAnimationFrame(() => this.el.classList.add('shown'));
        if (section) {
            const target = this._body.querySelector(`[data-section="${section}"]`);
            target?.scrollIntoView({block: 'start'});
        } else {
            this._body.scrollTop = 0;
        }
    }

    close() {
        if (!this.isOpen)
            return;
        this._open = false;
        this.el.classList.remove('shown');
        setTimeout(() => {
            this.el.hidden = true;
        }, 200);
        this._onClose?.();
    }

    _build() {
        this._rows = [];
        const body = this._body;
        body.replaceChildren();
        const status = Host.status();

        if (Host.onAndroid) {
            const surfaceRow = (title, sub, on, action, label) => {
                const b = h('button', {class: 'pill action', onclick: () => {
                    Host.call(action);
                }}, label);
                return h('div', {class: 'row'},
                    h('div', {class: 'row-text'},
                        h('div', {class: 'row-title'}, title, on ? h('span', {class: 'badge'}, 'In use') : null),
                        h('div', {class: 'row-sub'}, sub)),
                    b);
            };
            body.append(this._group('Use Orrery as', 'surfaces', [
                surfaceRow('Live wallpaper', 'The solar system behind your home screen. It turns a little as you swipe between pages.',
                    status.wallpaper, 'wallpaper', 'Set'),
                surfaceRow('Lock screen', 'Set the live wallpaper and choose “Home and lock screen” (or “Lock screen”). While the phone is locked it uses the lock screen settings below.',
                    status.lock, 'lockscreen', 'Set'),
                surfaceRow('Screensaver', 'While charging or docked. In the system settings, pick Orrery under Screen saver.',
                    status.dream, 'screensaver', 'Open'),
            ], status.lockNote ?? null));
        }

        body.append(this._group('Clock', 'time', [
            this._choice('Mode', 'mode', MODE, 'Replay runs the space age forward from the start year and loops; Live shows the solar system right now'),
            this._number('Replay starts in', 'replay-start-year', '', 1),
            this._number('Replay speed', 'days-per-second', 'Simulated days per second. 12 makes a year pass in about 30 seconds', 0.5),
            this._switch('Carry on into the future', 'replay-into-future',
                'Replay past today, through the planned flybys and arrivals up to the 2030s, before starting over'),
            this._button('Restart the replay', 'Jump back to the start year', 'Restart', () => this._settings.set('replay-jd', 0)),
        ]));
        body.append(this._group('Spin', 'spin', [
            this._switch('Spin the planets', 'spin-planets'),
            this._number('One Earth day lasts', 'seconds-per-earth-day',
                'Seconds per turn of the Earth. Jupiter turns 2.4 times as fast; Venus takes 243 times as long, backwards', 1,
                s => s.get('spin-planets')),
        ], 'Planets spin at their true speeds relative to each other, on their own slower clock so the fast ones do not blur.'));
        body.append(this._group('Tours', 'tours', [
            this._choice('Automatic tour', 'tour', TOUR),
            this._select('Story', 'tour-mission', STORY_MISSIONS, '', s => s.get('tour') === 'mission'),
            this._number('Starts after', 'tour-idle-minutes', 'Minutes untouched; 0 starts it right away', 1, s => s.get('tour') !== 'off'),
        ], 'A tour flies in close to each planet in turn; a story follows one spacecraft from launch to the end, slowing down for every flyby. A touch stops an automatic tour. To start one now, use the panel on the timeline, or ▶ Story on a mission’s card.'));
        body.append(this._group('Camera', 'view', [
            this._choice('Distance scale', 'distance-scale', [['auto', 'Auto'], ['sqrt', 'Square root'], ['log', 'Logarithmic'], ['linear', 'True to scale']],
                'Real distances span 0.4 to 30 AU, so they are compressed to fit one screen. Auto is logarithmic on a phone, square root on a tablet'),
            this._number('Tilt', 'tilt', '0° looks straight down on the Sun', 1),
            this._number('Tilt, held upright', 'portrait-tilt', 'A lower tilt fills a tall screen better', 1),
            this._number('Rotation', 'azimuth', 'Turns the whole system around the Sun. Drag the scene to turn it for a while', 5),
            this._number('Zoom', 'zoom', 'Percent; 100 fits Neptune’s orbit on screen. Pinch to zoom out to the stars', 5),
            this._number('Planet size', 'planet-scale', 'Percent', 5),
            this._number('Brightness', 'brightness', 'Percent; lower spares OLED pixels', 5),
        ]));
        body.append(this._group('Scene', 'content', [
            this._switch('Orbits', 'show-orbits'),
            this._switch('Names', 'show-labels'),
            this._switch('Stars', 'show-stars'),
            this._switch('Asteroid and Kuiper belts', 'show-belts', 'With Jupiter’s Trojan asteroids, 60° ahead and behind it'),
            this._switch('Pluto', 'show-pluto'),
            this._switch('Moons', 'show-moons', 'The 22 biggest moons, on a squeezed scale around their planets. Our Moon shows its real phase'),
            this._switch('Ceres, Vesta and comets', 'show-small-bodies',
                'The two biggest asteroids, Halley’s Comet and interstellar visitors like 3I/ATLAS. Asteroids that missions visit appear while they are there'),
            this._switch('Lagrange points', 'show-lagrange',
                'Where telescopes like JWST park (L1 and L2 are drawn a little way out from Earth, as they are too close to see)'),
        ]));
        body.append(this._group('Text', 'text', [
            this._switch('Fact cards', 'show-facts', 'Distances, speeds and trivia, plus a card at each mission event'),
            this._number('Each fact stays up for', 'fact-interval', 'Seconds', 1, s => s.get('show-facts')),
            this._switch('Date and mission list', 'show-hud'),
            this._choice('Timeline', 'timeline', [['auto', 'After a touch'], ['always', 'Always']], 'Scrub through time, change speed and jump to mission events'),
        ]));
        body.append(this._group('Spacecraft and sunlight', 'craft', [
            this._switch('Spacecraft', 'show-missions', 'Pick which ones from the panel on the timeline'),
            this._switch('Trails', 'show-trails'),
            this._number('Trail length', 'trail-years', 'Years of path kept on screen', 0.5, s => s.get('show-trails')),
            this._switch('Sunlight view', 'sunlight-view', 'Color the plane of the planets by how much sunlight falls there, from 9,000 W/m² at Mercury to 1.5 at Neptune'),
            this._choice('Sunlight view by itself', 'sunlight-auto', [['manual', 'Never'], ['charging', 'While charging'], ['battery', 'On battery']],
                'Switches when the charger is plugged in or out; the ☀ button still works in between'),
        ]));
        body.append(this._group('Music', 'music', [
            this._choice('Play', 'music-mode', [['muted', 'Muted'], ['background', 'While Orrery is open']],
                'A slow ambient piece made up as it plays: drifting chords, a low drone and soft bells in long echoes'),
            this._number('Volume', 'music-volume', 'Percent', 5),
        ]));
        body.append(this._group('Power and OLED care', 'power', [
            this._number('Frames per second', 'fps', '', 5),
            this._switch('Slow down when still', 'adaptive-fps', 'Drop to 5 frames per second while time is paused, the planets are not spinning and nobody is touching it'),
            this._switch('Battery saver', 'battery-saver', 'On battery saver mode (or on battery, in a browser), lower the frame rate and stop the planets spinning'),
            this._number('Frames per second when saving', 'battery-fps', '', 5, s => s.get('battery-saver')),
            this._number('Dim after', 'idle-dim-minutes', 'Minutes untouched; 0 never dims', 1),
            this._number('Dimmed brightness', 'idle-brightness', 'Percent of normal', 5, s => s.get('idle-dim-minutes') > 0),
            this._switch('Pixel shift', 'pixel-shift', 'Drift the whole scene by a few pixels over time to spread OLED wear'),
            this._switch('Keep the screen on', 'keep-screen-on', 'While Orrery is open: a desk clock of the solar system'),
            this._switch('Full screen', 'immersive', 'Hide the status and navigation bars; swipe from an edge to bring them back'),
        ]));

        const own = (title, prefix, extra, note) => this._group(title, prefix,
            [...OWN_ROWS(prefix).map(row => this._rowFrom(row)), ...extra], note);
        body.append(own('Live wallpaper', 'wallpaper', [
            this._switch('Turn with the home screen', 'wallpaper/parallax', 'Swiping between home screen pages turns the solar system a little', null, true),
            this._switch('Tap for a card', 'wallpaper/tap-cards', 'A tap on an empty spot of the home screen shows a card for the planet there', null, true),
        ], 'Everything else (what is shown, the spin, the camera) follows the settings above.'));
        body.append(own('Lock screen', 'lock', [],
            'While the phone is locked, the live wallpaper keeps to the middle of the screen, clear of the clock and the notifications.'));
        body.append(own('Screensaver', 'dream', [
            this._switch('Music', 'dream/music', 'Play the ambient music while the screensaver runs', null, true),
        ]));

        const version = status.version ? `Version ${status.version}` : 'Running in a browser';
        body.append(this._group('About', 'about', [
            h('div', {class: 'row about'},
                h('div', {class: 'row-text'},
                    h('div', {class: 'row-title'}, 'Orrery'),
                    h('div', {class: 'row-sub'}, `${version}. A live solar system: every planet where it really is, and the spacecraft of the space age on the paths they really flew. Orbits from NASA JPL. Free software under the GNU GPL, version 2 or later.`))),
            this._link('The project page', 'https://fqazzazee.github.io/orrery/'),
            this._link('Source code and license', 'https://github.com/fqazzazee/orrery'),
            this._link('Buy me a coffee', 'https://buymeacoffee.com/fqazzazee'),
        ]));
        this._sync();
    }

    _group(title, id, rows, note = null) {
        return h('section', {class: 'group', 'data-section': id},
            h('h2', {class: 'group-title'}, title),
            note ? h('p', {class: 'group-note'}, note) : null,
            h('div', {class: 'group-rows'}, rows));
    }

    _text(title, sub) {
        return h('div', {class: 'row-text'}, h('div', {class: 'row-title'}, title), sub ? h('div', {class: 'row-sub'}, sub) : null);
    }

    // full: the key as stored (a surface's own keys have its name in front).
    _get(key, full) {
        return full ? this._settings.getRaw(key) : this._settings.get(key);
    }

    _set(key, value, full) {
        if (full)
            this._settings.setRaw(key, value);
        else
            this._settings.set(key, value);
    }

    _switch(title, key, sub = '', enabled = null, full = key.includes('/')) {
        const input = h('input', {type: 'checkbox', class: 'switch', 'aria-label': title});
        input.addEventListener('change', () => this._set(key, input.checked, full));
        const row = h('label', {class: 'row'}, this._text(title, sub), input);
        this._rows.push({row, enabled, sync: () => {
            input.checked = !!this._get(key, full);
        }});
        return row;
    }

    _choice(title, key, options, sub = '', enabled = null, full = key.includes('/')) {
        const seg = h('div', {class: 'segmented'});
        const buttons = options.map(([value, text]) => {
            const b = h('button', {class: 'seg', onclick: () => {
                this._set(key, value, full);
                this._sync();
            }}, text);
            seg.append(b);
            return [b, value];
        });
        const row = h('div', {class: 'row column'}, this._text(title, sub), seg);
        this._rows.push({row, enabled, sync: () => {
            const v = this._get(key, full);
            for (const [b, value] of buttons)
                b.classList.toggle('on', v === value);
        }});
        return row;
    }

    _select(title, key, options, sub = '', enabled = null, full = key.includes('/')) {
        const select = h('select', {'aria-label': title}, options.map(([value, text]) => h('option', {value}, text)));
        select.addEventListener('change', () => this._set(key, select.value, full));
        const row = h('label', {class: 'row'}, this._text(title, sub), select);
        this._rows.push({row, enabled, sync: () => {
            select.value = this._get(key, full);
        }});
        return row;
    }

    _number(title, key, sub = '', step = 1, enabled = null, full = key.includes('/')) {
        const [, {min, max}] = this._settings.spec(key);
        const value = h('span', {class: 'value'});
        const input = h('input', {type: 'range', min, max, step, 'aria-label': title});
        const show = v => `${+(+v).toFixed(step < 1 ? 1 : 0)}`;
        input.addEventListener('input', () => {
            value.textContent = show(input.value);
        });
        input.addEventListener('change', () => this._set(key, +input.value, full));
        const row = h('div', {class: 'row column'},
            h('div', {class: 'row-head'}, this._text(title, sub), value), input);
        this._rows.push({row, enabled, sync: () => {
            const v = this._get(key, full);
            input.value = v;
            value.textContent = show(v);
        }});
        return row;
    }

    _button(title, sub, label, onClick) {
        return h('div', {class: 'row'}, this._text(title, sub), h('button', {class: 'pill action', onclick: onClick}, label));
    }

    _link(title, url) {
        return h('button', {class: 'row link', onclick: () => {
            if (!Host.call('open', url))
                window.open(url, '_blank', 'noopener');
        }}, this._text(title, url.replace(/^https:\/\//, '')), h('span', {class: 'link-arrow'}, '›'));
    }

    _rowFrom([kind, title, key, ...rest]) {
        if (kind === 'switch')
            return this._switch(title, key, '', null, true);
        if (kind === 'choice')
            return this._choice(title, key, rest[0], rest[1] ?? '', null, true);
        if (kind === 'select')
            return this._select(title, key, rest[0], rest[1] ?? '', rest[2] ?? null, true);
        return this._number(title, key, rest[0] ?? '', rest[1] ?? 1, null, true);
    }

    _sync() {
        if (!this._open)
            return;
        for (const {row, enabled, sync} of this._rows) {
            sync();
            row.classList.toggle('disabled', enabled ? !enabled(this._settings) : false);
        }
    }
}
