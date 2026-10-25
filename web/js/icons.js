// Line icons for the controls, drawn on a 24-unit grid so they stay sharp at
// any size. currentColor strokes them, so CSS sets their color.

const P = {
    play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="2.6"/>',
    restart: '<path d="M6.5 5.5v13"/><path d="M18 5.5v13L9 12z" fill="currentColor" stroke="none"/>',
    slower: '<path d="M11.5 6v12L3.5 12zM20.5 6v12l-8-6z" fill="currentColor" stroke="none"/>',
    faster: '<path d="M12.5 6v12l8-6zM3.5 6v12l8-6z" fill="currentColor" stroke="none"/>',
    zoomIn: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M10.5 8v5M8 10.5h5"/>',
    zoomOut: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5"/>',
    spin: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19.5 4v4.5H15"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    musicOff: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>',
    musicOn: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    list: '<path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.5" cy="7" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="17" r="1.2" fill="currentColor"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    down: '<path d="M6.5 9.5l5.5 5.5 5.5-5.5"/>',
    up: '<path d="M6.5 14.5l5.5-5.5 5.5 5.5"/>',
    back: '<path d="M14.5 6l-6 6 6 6"/>',
    prev: '<path d="M6.5 5.5v13"/><path d="M18 5.5v13L9 12z" fill="currentColor" stroke="none"/>',
    next: '<path d="M17.5 5.5v13"/><path d="M6 5.5v13l9-6.5z" fill="currentColor" stroke="none"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.85 1.85M16.65 16.65l1.85 1.85M5.5 18.5l1.85-1.85M16.65 7.35l1.85-1.85"/>',
};

export function icon(name) {
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;
}
