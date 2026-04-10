const BSPLINE_THEME_KEY = 'bsplineSharedTheme';
const BSPLINE_THEMES = [
    { id: 'windows95', name: 'Windows 95' },
    { id: 'fantasy', name: 'Fantasy' },
    { id: 'dark-metal', name: 'Dark Metal' },
    { id: 'neumorphism', name: 'Neumorphism' },
    { id: 'bauhaus', name: 'Bauhaus' }
];

let currentBsplineTheme = null;
let storageWatchInterval = null;

function applyBsplineTheme(themeId, persist = false) {
    if (!themeId) return;

    const body = document.body;
    BSPLINE_THEMES.forEach(theme => body.classList.remove('theme-' + theme.id));
    body.classList.add('theme-' + themeId);
    currentBsplineTheme = themeId;

    const themeSelects = document.querySelectorAll('#theme-select, #theme-select-settings');
    themeSelects.forEach(select => {
        if (select) select.value = themeId;
    });

    if (persist) {
        try {
            localStorage.setItem(BSPLINE_THEME_KEY, themeId);
        } catch (e) {
            console.warn('[Theme] Failed to persist theme:', e);
        }
    }
}

function getStoredBsplineTheme() {
    try {
        return localStorage.getItem(BSPLINE_THEME_KEY);
    } catch (e) {
        console.warn('[Theme] Failed to read stored theme:', e);
        return null;
    }
}

function initBsplineTheme(options = {}) {
    const settings = Object.assign({ watchStorage: false }, options);
    const themeSelects = Array.from(document.querySelectorAll('#theme-select, #theme-select-settings'));
    const initialTheme = getStoredBsplineTheme() || 'dark-metal';

    themeSelects.forEach(select => {
        BSPLINE_THEMES.forEach(theme => {
            const option = document.createElement('option');
            option.value = theme.id;
            option.textContent = theme.name;
            select.appendChild(option);
        });
        select.value = initialTheme;
        select.addEventListener('change', () => applyBsplineTheme(select.value, true));
    });

    applyBsplineTheme(initialTheme, false);

    if (settings.watchStorage) {
        window.addEventListener('storage', event => {
            if (event.key !== BSPLINE_THEME_KEY) return;
            if (event.newValue && event.newValue !== currentBsplineTheme) {
                applyBsplineTheme(event.newValue, false);
            }
        });

        if (storageWatchInterval) {
            clearInterval(storageWatchInterval);
        }
        storageWatchInterval = setInterval(() => {
            const storedTheme = getStoredBsplineTheme();
            if (storedTheme && storedTheme !== currentBsplineTheme) {
                applyBsplineTheme(storedTheme, false);
            }
        }, 500);
    }
}

window.initBsplineTheme = initBsplineTheme;
window.applyBsplineTheme = applyBsplineTheme;
window.BSPLINE_THEMES = BSPLINE_THEMES;
