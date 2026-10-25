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
const CARD_POSITION = [['auto', 'Auto'], ['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']];
const CARD_SIDE = [['left', 'Left'], ['right', 'Right']];
const CARD_POSITION_SUB = 'Auto: at the bottom of a phone; on a tablet the fact card at the top and mission news at the bottom';
const CARD_SIDE_SUB = 'On a tablet or a phone on its side. Cards on the left move the date and the missions to the right';
const SUNLIGHT_AUTO = [['manual', 'Never'], ['charging', 'While charging'], ['battery', 'On battery']];
const SUNLIGHT_AUTO_SUB = 'Turns the sunlight view on when the charger is plugged in (or out), and off again after; the ☀ button still works in between';
// Frame rates to pick from: 90 and 120 for screens that refresh that fast.
const RATES = [10, 15, 20, 24, 30, 45, 60, 90, 120];

// What is shown: off in the app is off everywhere (store.js, BOTH).
const ALSO_APP = 'Off in the app’s settings turns it off here too';

// The pages, in the menu's order. The first ones are the app's: the live
// wallpaper, the lock screen and the screensaver share them, except what
// they set for themselves on their own pages.
const PAGES = [
    {id: 'time', title: 'Clock, spin and tours', group: 'app'},
    {id: 'view', title: 'Camera', group: 'app'},
    {id: 'content', title: 'What is shown', group: 'app'},
    {id: 'text', title: 'Cards and text', group: 'app'},
    {id: 'music', title: 'Music', group: 'app'},
    {id: 'power', title: 'Power and screen', group: 'app'},
    {id: 'wallpaper', title: 'Live wallpaper', group: 'surface'},
    {id: 'lock', title: 'Lock screen', group: 'surface'},
    {id: 'dream', title: 'Screensaver', group: 'surface'},
    {id: 'about', title: 'About', group: 'about'},
];

// The sections of the one long page there was, and the links that still
// name them (the wallpaper picker's Settings opens 'wallpaper').
const ALIASES = {surfaces: null, spin: 'time', tours: 'time', craft: 'content'};

const pageOf = section => {
    const id = section in ALIASES ? ALIASES[section] : section;
    return PAGES.some(p => p.id === id) ? id : null;
};

export class SettingsPage {
    constructor(parent, settings, {onClose, onPickFolder = null, musicStatus = null}) {
        this._settings = settings;
        this._onClose = onClose;
        this._onPickFolder = onPickFolder;
        this._musicStatus = musicStatus;
        this._rows = [];
        this._page = null;
        this.el = h('div', {class: 'settings', hidden: true});
        for (const type of ['pointerdown', 'pointerup', 'click', 'wheel'])
            this.el.addEventListener(type, e => e.stopPropagation());
        this._title = h('div', {class: 'settings-title'}, 'Settings');
        const header = h('div', {class: 'settings-header'},
            iconButton('back', 'card-btn big', () => this.back(), 'Back'),
            this._title);
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

    // section: a page to open at (or an old section name), else the menu.
    open(section = null) {
        this._open = true;
        this._page = pageOf(section);
        this._build();
        this._body.scrollTop = 0;
        this.el.hidden = false;
        requestAnimationFrame(() => this.el.classList.add('shown'));
    }

    // From a page to the menu, and from the menu out.
    back() {
        if (!this.isOpen)
            return;
        if (this._page) {
            const from = this._page;
            this._go(null);
            this._body.querySelector(`[data-page="${from}"]`)?.scrollIntoView({block: 'center'});
        } else {
            this.close();
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

    _go(page) {
        this._page = page;
        this._build();
        this._body.scrollTop = 0;
        this._body.classList.remove('enter');
        void this._body.offsetWidth;
        this._body.classList.add('enter');
    }

    _build() {
        this._rows = [];
        const page = PAGES.find(p => p.id === this._page);
        this._title.textContent = page?.title ?? 'Settings';
        const status = Host.status();
        let groups;
        switch (page?.id) {
        case 'time': groups = this._timePage(); break;
        case 'view': groups = this._viewPage(); break;
        case 'content': groups = this._contentPage(); break;
        case 'text': groups = this._textPage(); break;
        case 'music': groups = this._musicPage(); break;
        case 'power': groups = this._powerPage(); break;
        case 'wallpaper': case 'lock': case 'dream': groups = this._surfacePage(page.id, status); break;
        case 'about': groups = this._aboutPage(status); break;
        default: groups = this._menu(status);
        }
        this._body.replaceChildren(...groups);
        this._sync();
    }

    // ---- The menu ----

    _menu(status) {
        const s = this._settings;
        const on = v => v ? 'on' : 'off';
        const rate = fps => fps === 0 ? 'the app’s frame rate' : `${fps} frames a second`;
        const summary = {
            time: () => [s.getRaw('mode') === 'live' ? 'Live' : `Replay, ${s.getRaw('days-per-second')} days a second`,
                s.getRaw('spin-planets') ? 'planets spin' : 'no spin', `tour ${s.getRaw('tour') === 'off' ? 'off' : 'on'}`].join(' · '),
            view: () => `Zoom ${s.getRaw('zoom')}% · tilt ${s.getRaw('tilt')}° · brightness ${s.getRaw('brightness')}%`,
            content: () => `Orbits, moons, belts, spacecraft and trails · sunlight view ${on(s.getRaw('sunlight-view'))}`,
            text: () => `Fact cards ${on(s.getRaw('show-facts'))} · date ${on(s.getRaw('show-hud'))} · timeline ${s.getRaw('timeline') === 'always' ? 'always' : 'after a touch'}`,
            music: () => s.getRaw('music-mode') === 'muted' ? 'Muted'
                : s.getRaw('music-source') === 'folder' ? `My own music${s.getRaw('music-folder-name') ? ` · ${s.getRaw('music-folder-name')}` : ''}` : 'Made up as it plays',
            power: () => [rate(s.getRaw('fps')), s.getRaw('battery-saver') ? 'battery saver' : null, s.getRaw('pixel-shift') ? 'pixel shift' : null].filter(Boolean).join(' · '),
            about: () => status.version ? `Version ${status.version}` : 'Running in a browser',
        };
        for (const surface of ['wallpaper', 'lock', 'dream']) {
            summary[surface] = () => [
                s.getRaw(`${surface}/mode`) === 'live' ? 'Live' : 'Replay',
                `cards ${on(s.getRaw(`${surface}/show-facts`) && s.getRaw('show-facts'))}`,
                rate(s.getRaw(`${surface}/fps`)),
            ].join(' · ');
        }
        const nav = page => {
            const inUse = Host.onAndroid && status[page.id];
            return h('button', {class: 'row nav', 'data-page': page.id, onclick: () => this._go(page.id)},
                h('div', {class: 'row-text'},
                    h('div', {class: 'row-title'}, page.title, inUse ? h('span', {class: 'badge'}, 'In use') : null),
                    h('div', {class: 'row-sub'}, summary[page.id]())),
                h('span', {class: 'link-arrow'}, '›'));
        };
        const list = group => PAGES.filter(p => p.group === group).map(nav);
        return [
            this._group('The app', 'app', list('app'),
                'The live wallpaper, the lock screen and the screensaver use these too, except what they set for themselves.'),
            this._group('Use Orrery as', 'surfaces', list('surface'),
                'What each one shows, and how to set it up.'),
            this._group('Orrery', 'about-menu', list('about')),
        ];
    }

    // ---- The app's pages ----

    _timePage() {
        const replay = s => s.get('mode') === 'replay';
        return [
            this._group('Clock', 'time', [
                this._choice('Mode', 'mode', MODE, 'Replay runs the space age forward from the start year and loops; Live shows the solar system right now'),
                this._number('Replay starts in', 'replay-start-year', '', 1, replay),
                this._number('Replay speed', 'days-per-second', 'Simulated days per second. 12 makes a year pass in about 30 seconds', 0.5, replay),
                this._switch('Carry on into the future', 'replay-into-future',
                    'Replay past today, through the planned flybys and arrivals up to the 2030s, before starting over', replay),
                this._button('Restart the replay', 'Jump back to the start year', 'Restart', () => this._settings.set('replay-jd', 0), replay),
            ], 'The live wallpaper, the lock screen and the screensaver each have their own mode, speed and tour. The start year is shared.'),
            this._group('Spin', 'spin', [
                this._switch('Spin the planets', 'spin-planets'),
                this._number('One Earth day lasts', 'seconds-per-earth-day',
                    'Seconds per turn of the Earth. Jupiter turns 2.4 times as fast; Venus takes 243 times as long, backwards', 1,
                    s => s.get('spin-planets')),
            ], 'Planets spin at their true speeds relative to each other, on their own slower clock so the fast ones do not blur. Everywhere Orrery runs.'),
            this._group('Tours', 'tours', [
                this._choice('Automatic tour', 'tour', TOUR),
                this._select('Story', 'tour-mission', STORY_MISSIONS, '', s => s.get('tour') === 'mission'),
                this._number('Starts after', 'tour-idle-minutes', 'Minutes untouched; 0 starts it right away', 1, s => s.get('tour') !== 'off'),
            ], 'A tour flies in close to each planet in turn; a story follows one spacecraft from launch to the end, slowing down for every flyby. A touch stops an automatic tour. To start one now, use the panel on the timeline, or ▶ Story on a mission’s card.'),
        ];
    }

    _viewPage() {
        return [
            this._group('Camera', 'view', [
                this._choice('Distance scale', 'distance-scale', [['auto', 'Auto'], ['sqrt', 'Square root'], ['log', 'Logarithmic'], ['linear', 'True to scale']],
                    'Real distances span 0.4 to 30 AU, so they are compressed to fit one screen. Auto is logarithmic on a phone, square root on a tablet'),
                this._number('Tilt', 'tilt', '0° looks straight down on the Sun', 1),
                this._number('Tilt, held upright', 'portrait-tilt', 'A lower tilt fills a tall screen better', 1),
                this._number('Rotation', 'azimuth', 'Turns the whole system around the Sun. Drag the scene to turn it for a while', 5),
                this._number('Planet size', 'planet-scale', 'Percent', 5),
            ], 'Everywhere Orrery runs.'),
            this._group('In the app', 'view-app', [
                this._number('Zoom', 'zoom', 'Percent; 100 fits Neptune’s orbit on screen. Pinch to zoom out to the stars', 5),
                this._number('Brightness', 'brightness', 'Percent; lower spares OLED pixels', 5),
            ], 'The live wallpaper, the lock screen and the screensaver have their own zoom and brightness.'),
        ];
    }

    _contentPage() {
        const craft = s => s.get('show-missions');
        return [
            this._group('Scene', 'content', [
                this._switch('Orbits', 'show-orbits'),
                this._switch('Names', 'show-labels', 'Off here turns them off everywhere'),
                this._switch('Stars', 'show-stars'),
                this._switch('Asteroid and Kuiper belts', 'show-belts', 'With Jupiter’s Trojan asteroids, 60° ahead and behind it'),
                this._switch('Pluto', 'show-pluto'),
                this._switch('Moons', 'show-moons', 'The 22 biggest moons, on a squeezed scale around their planets. Our Moon shows its real phase'),
                this._switch('Ceres, Vesta and comets', 'show-small-bodies',
                    'The two biggest asteroids, Halley’s Comet and interstellar visitors like 3I/ATLAS. Asteroids that missions visit appear while they are there'),
                this._switch('Lagrange points', 'show-lagrange',
                    'Where telescopes like JWST park (L1 and L2 are drawn a little way out from Earth, as they are too close to see)'),
            ], 'Everywhere Orrery runs.'),
            this._group('Spacecraft', 'craft', [
                this._switch('Spacecraft', 'show-missions', 'Off here turns them off everywhere. Pick which ones from the panel on the timeline'),
                this._switch('Trails', 'show-trails', '', craft),
                this._number('Trail length', 'trail-years', 'Years of path kept on screen', 0.5, s => craft(s) && s.get('show-trails')),
            ]),
            this._group('Sunlight', 'sunlight', [
                this._switch('Sunlight view', 'sunlight-view', 'Color the plane of the planets by how much sunlight falls there, from 9,000 W/m² at Mercury to 1.5 at Neptune'),
                this._choice('Sunlight view by itself', 'sunlight-auto', SUNLIGHT_AUTO, SUNLIGHT_AUTO_SUB),
            ], 'In the app. The live wallpaper, the lock screen and the screensaver have their own.'),
        ];
    }

    _textPage() {
        const cards = s => s.get('show-facts');
        return [
            this._group('Cards', 'text', [
                this._switch('Fact cards', 'show-facts', 'Distances, speeds and trivia, plus a card at each mission event. Off here turns them off everywhere'),
                this._number('Each fact stays up for', 'fact-interval', 'Seconds', 1, cards),
                this._choice('Card position', 'card-position', CARD_POSITION, CARD_POSITION_SUB, cards),
                this._choice('Card side', 'card-side', CARD_SIDE, CARD_SIDE_SUB, cards),
            ], 'A tap on a planet or a spacecraft in the app still brings up its card with fact cards off. The live wallpaper, the lock screen and the screensaver place their cards themselves.'),
            this._group('On screen', 'hud', [
                this._switch('Date and mission list', 'show-hud', 'Off here turns it off everywhere'),
                this._choice('Timeline', 'timeline', [['auto', 'After a touch'], ['always', 'Always']], 'In the app: scrub through time, change speed and jump to mission events'),
            ]),
        ];
    }

    _musicPage() {
        return [
            this._group('Music', 'music', [
                this._choice('Play', 'music-mode', [['muted', 'Muted'], ['background', 'While Orrery is open']],
                    'In the app. The screensaver has its own switch, on its page'),
                this._choice('Music', 'music-source', [['ambient', 'Made up as it plays'], ['folder', 'My own music']],
                    'The built-in piece: drifting chords, a low drone and soft bells in long echoes, never quite the same twice. Or the tracks in a folder of yours, shuffled'),
                this._folderRow(s => s.get('music-source') === 'folder'),
                this._number('Volume', 'music-volume', 'Percent', 5),
            ], 'The live wallpaper and the lock screen are always silent.'),
        ];
    }

    _powerPage() {
        return [
            this._group('Frame rate', 'power', [
                this._rate('Frames per second', 'fps'),
                this._switch('Slow down when still', 'adaptive-fps', 'Drop to 5 frames per second while time is paused, the planets are not spinning and nobody is touching it'),
                this._switch('Battery saver', 'battery-saver', 'On battery saver mode (or on battery, in a browser), lower the frame rate and stop the planets spinning'),
                this._number('Frames per second when saving', 'battery-fps', '', 5, s => s.get('battery-saver')),
            ], 'The live wallpaper, the lock screen and the screensaver use the app’s frame rate unless they are given their own. Slowing down and the battery saver apply everywhere.'),
            this._group('OLED care', 'oled', [
                this._switch('Pixel shift', 'pixel-shift', 'Drift the whole scene by a few pixels over time to spread OLED wear, everywhere Orrery runs'),
                this._number('Dim after', 'idle-dim-minutes', 'In the app: minutes untouched; 0 never dims. The screensaver has its own', 1),
                this._number('Dimmed brightness', 'idle-brightness', 'Percent of normal, in the app and the screensaver', 5,
                    s => s.getRaw('idle-dim-minutes') > 0 || s.getRaw('dream/idle-dim-minutes') > 0),
            ]),
            this._group('The app’s window', 'window', [
                this._switch('Keep the screen on', 'keep-screen-on', 'While Orrery is open: a desk clock of the solar system'),
                this._switch('Full screen', 'immersive', 'Hide the status and navigation bars; swipe from an edge to bring them back'),
            ]),
        ];
    }

    _aboutPage(status) {
        const version = status.version ? `Version ${status.version}` : 'Running in a browser';
        return [this._group('About', 'about', [
            h('div', {class: 'row about'},
                h('div', {class: 'row-text'},
                    h('div', {class: 'row-title'}, 'Orrery'),
                    h('div', {class: 'row-sub'}, `${version}. A live solar system: every planet where it really is, and the spacecraft of the space age on the paths they really flew. Orbits from NASA JPL. Free software under the GNU GPL, version 2 or later.`))),
            this._link('The project page', 'https://fqazzazee.github.io/orrery/'),
            this._link('Source code and license', 'https://github.com/fqazzazee/orrery-android'),
            this._link('Orrery for GNOME', 'https://github.com/fqazzazee/orrery'),
            this._link('Buy me a coffee', 'https://buymeacoffee.com/fqazzazee'),
        ])];
    }

    // ---- The wallpaper's, the lock screen's and the screensaver's ----

    _surfacePage(surface, status) {
        const own = key => `${surface}/${key}`;
        // On here and in the app.
        const shown = key => s => s.getRaw(key) && s.getRaw(own(key));
        const groups = [];

        if (Host.onAndroid) {
            const use = {
                wallpaper: ['The solar system behind your home screen. It turns a little as you swipe between pages.', 'wallpaper', 'Set'],
                lock: ['Set the live wallpaper and choose “Home and lock screen” (or “Lock screen”). While the phone is locked it uses the settings on this page.', 'lockscreen', 'Set'],
                dream: ['While charging or docked. In the system settings, pick Orrery under Screen saver.', 'screensaver', 'Open'],
            }[surface];
            groups.push(this._group('Set up', `${surface}-use`, [
                h('div', {class: 'row'},
                    h('div', {class: 'row-text'},
                        h('div', {class: 'row-title'}, status[surface] ? 'In use' : 'Not in use',
                            status[surface] ? h('span', {class: 'badge'}, '✓') : null),
                        h('div', {class: 'row-sub'}, use[0])),
                    h('button', {class: 'pill action', onclick: () => Host.call(use[1])}, status[surface] && use[2] === 'Set' ? 'Change' : use[2])),
            ], surface === 'lock' ? status.lockNote ?? null : null));
        }

        groups.push(this._group('Clock', surface, [
            this._choice('Mode', own('mode'), MODE, surface === 'lock'
                ? 'Live suits a lock screen: the planets where they are right now'
                : 'Replay runs the space age forward and loops; Live shows the solar system right now'),
            this._number('Replay speed', own('days-per-second'), 'Days per second', 0.5, s => s.getRaw(own('mode')) === 'replay'),
            this._choice('Tour', own('tour'), TOUR, 'Flies past the planets or tells the missions’ stories by itself'),
            this._select('Story', own('tour-mission'), STORY_MISSIONS, '', s => s.getRaw(own('tour')) === 'mission'),
        ]));

        const cards = shown('show-facts');
        groups.push(this._group('Cards', `${surface}-cards`, [
            this._switch('Fact cards', own('show-facts'), `${surface === 'dream' ? 'Facts, mission news and the tours’ cards' : 'Facts, mission news, and the cards of a tour'}. ${ALSO_APP}`,
                s => s.getRaw('show-facts')),
            surface === 'wallpaper' ? this._switch('Tap for a card', own('tap-cards'),
                'A tap on an empty spot of the home screen shows a card for the planet there, while fact cards are on', cards) : null,
            this._choice('Card position', own('card-position'), CARD_POSITION, CARD_POSITION_SUB, cards),
            this._choice('Card side', own('card-side'), CARD_SIDE, CARD_SIDE_SUB, cards),
        ].filter(Boolean), surface === 'lock' ? 'Taps on the lock screen never bring up a card.' : null));

        groups.push(this._group('What is shown', `${surface}-content`, [
            this._switch('Date and mission list', own('show-hud'), ALSO_APP, s => s.getRaw('show-hud')),
            this._switch('Names', own('show-labels'), ALSO_APP, s => s.getRaw('show-labels')),
            this._switch('Spacecraft', own('show-missions'), ALSO_APP, s => s.getRaw('show-missions')),
            this._switch('Sunlight view', own('sunlight-view'), 'Color the plane of the planets by sunlight'),
            this._choice('Sunlight view by itself', own('sunlight-auto'), SUNLIGHT_AUTO,
                'Turns the sunlight view on when the charger is plugged in (or out), and off again after'),
        ], 'The orbits, the moons, the belts, the trails, the spin and the camera’s tilt follow the app’s settings.'));

        groups.push(this._group('Screen', `${surface}-screen`, [
            this._number('Zoom', own('zoom'), 'Percent; 100 fits Neptune’s orbit', 5),
            this._number('Brightness', own('brightness'), 'Percent; lower spares OLED pixels', 5),
            this._rate('Frames per second', own('fps')),
            surface === 'wallpaper' ? this._switch('Turn with the home screen', own('parallax'), 'Swiping between home screen pages turns the solar system a little') : null,
            surface === 'dream' ? this._number('Dim after', own('idle-dim-minutes'), 'Minutes running; 0 never dims. How dim: Power and screen ▸ Dimmed brightness', 1) : null,
        ].filter(Boolean)));

        if (surface === 'dream') {
            groups.push(this._group('Sound', 'dream-music', [
                this._switch('Music', own('music'), 'Play the music chosen under Music (the built-in piece or your own folder) while the screensaver runs'),
            ]));
        }
        return groups;
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

    // A frame rate, from RATES (and whatever was set before, if not one of
    // them). Rates past what the screen can show are marked.
    _rate(title, key, full = key.includes('/')) {
        const rates = Host.status().refreshRates ?? [];
        const top = rates.length ? Math.max(...rates) : 0;
        const label = n => n === 0 ? `Same as the app (${this._settings.getRaw('fps')})`
            : n > 60 && top && n > top + 1 ? `${n} (this screen shows ${Math.round(top)})`
            : n === 90 || n === 120 ? `${n}, smooth` : `${n}`;
        const select = h('select', {'aria-label': title});
        // A surface's own rate can follow the app's (0).
        const choices = full ? [0, ...RATES] : RATES;
        const fill = v => {
            const list = choices.includes(v) ? choices : [...choices, v].sort((a, b) => a - b);
            select.replaceChildren(...list.map(n => h('option', {value: String(n)}, label(n))));
            select.value = String(v);
        };
        select.addEventListener('change', () => this._set(key, +select.value, full));
        const sub = top ? `This screen refreshes up to ${Math.round(top)} times a second; more is smoother and uses more battery`
            : 'More is smoother and uses more battery; 90 and 120 need a screen that fast';
        const row = h('label', {class: 'row'}, this._text(title, sub), select);
        this._rows.push({row, enabled: null, sync: () => fill(this._get(key, full))});
        return row;
    }

    // The music folder: its name, how many tracks it has, and a button to
    // choose another.
    _folderRow(enabled = null) {
        const sub = h('div', {class: 'row-sub'});
        const row = h('div', {class: 'row'},
            h('div', {class: 'row-text'}, h('div', {class: 'row-title'}, 'Folder'), sub),
            h('button', {class: 'pill action', onclick: () => this._onPickFolder?.()}, 'Choose'));
        this._rows.push({row, enabled, sync: () => {
            const name = this._settings.get('music-folder-name');
            if (!this._settings.get('music-folder')) {
                sub.textContent = 'None chosen. Music files in it and its subfolders play, shuffled';
                return;
            }
            const status = this._musicStatus?.() ?? {};
            const count = status.tracks > 0 ? ` · ${status.tracks} track${status.tracks === 1 ? '' : 's'}` : '';
            sub.textContent = status.error ? `${name}: ${status.error}` : `${name || 'Chosen'}${count}`;
        }});
        return row;
    }

    _button(title, sub, label, onClick, enabled = null) {
        const row = h('div', {class: 'row'}, this._text(title, sub), h('button', {class: 'pill action', onclick: onClick}, label));
        this._rows.push({row, enabled, sync: () => {}});
        return row;
    }

    _link(title, url) {
        return h('button', {class: 'row link', onclick: () => {
            if (!Host.call('open', url))
                window.open(url, '_blank', 'noopener');
        }}, this._text(title, url.replace(/^https:\/\//, '')), h('span', {class: 'link-arrow'}, '›'));
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
