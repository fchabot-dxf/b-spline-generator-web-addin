const BSPLINE_THEME_KEY = 'bsplineSharedTheme';
const BSPLINE_THEMES = [
    { id: 'windows31', name: 'Windows 3.1' },
    { id: 'windows7', name: 'Windows 7' },
    { id: 'nes', name: 'NES' }
];

let currentBsplineTheme = null;
let storageWatchInterval = null;
let bsplineThemeInitialized = false;
let bsplineThemeApplyCount = 0;

function normalizeThemeId(themeId) {
    if (themeId === 'windows95') return 'windows31';
    return themeId;
}

function applyBsplineTheme(themeId, persist = false, source = 'unknown') {
    bsplineThemeApplyCount += 1;
    themeId = normalizeThemeId(themeId);
    if (!themeId) {
        console.warn('[Theme] applyBsplineTheme called with empty themeId, source=', source);
        return;
    }

    console.info(`[Theme] Applying theme (#${bsplineThemeApplyCount}, source=${source}):`, themeId, 'persist=', persist);
    if (bsplineThemeApplyCount > 1) {
        console.debug('[Theme] applyBsplineTheme stack trace:', new Error().stack);
    }

    const body = document.body;
    BSPLINE_THEMES.forEach(theme => body.classList.remove('theme-' + theme.id));
    body.classList.add('theme-' + themeId);
    currentBsplineTheme = themeId;
    console.debug('[Theme] Body classes now:', body.className);

    const themeSelects = document.querySelectorAll('#theme-select, #theme-select-settings');
    themeSelects.forEach(select => {
        if (select) select.value = themeId;
    });

    const themeItems = document.querySelectorAll('.theme-option');
    themeItems.forEach(item => {
        item.classList.toggle('active', item.dataset.theme === themeId);
    });

    const themeBtn = document.getElementById('theme-btn');
    const themeMeta = BSPLINE_THEMES.find(theme => theme.id === themeId);
    if (themeBtn && themeMeta) {
        themeBtn.title = `Theme: ${themeMeta.name}`;
    }

    if (persist) {
        try {
            localStorage.setItem(BSPLINE_THEME_KEY, themeId);
        } catch (e) {
            console.warn('[Theme] Failed to persist theme:', e);
        }
    }

    console.info('[Theme] Applied theme finished:', {
        appliedTheme: themeId,
        bodyClass: document.body.className,
        currentBsplineTheme,
        persistedTheme: getStoredBsplineTheme(),
        source: source,
        persist: persist
    });
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
    if (bsplineThemeInitialized) {
        console.warn('[Theme] initBsplineTheme called again; ignoring duplicate initialization.');
        return;
    }
    bsplineThemeInitialized = true;

    const settings = Object.assign({ watchStorage: false }, options);
    const themeSelects = Array.from(document.querySelectorAll('#theme-select, #theme-select-settings'));
    const themeBtn = document.getElementById('theme-btn');
    const themeDropdown = document.getElementById('theme-dropdown');
    const initialTheme = normalizeThemeId(getStoredBsplineTheme()) || 'windows7';

    console.info('[Theme] Initializing theme system, watchStorage=', settings.watchStorage);
    console.info('[Theme] Initial theme resolved to:', initialTheme);

    if (themeDropdown) {
        themeDropdown.innerHTML = '';
        BSPLINE_THEMES.forEach(theme => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'theme-option';
            button.dataset.theme = theme.id;
            button.textContent = theme.name;
            button.addEventListener('click', () => {
                applyBsplineTheme(theme.id, true, 'dropdown');
                themeDropdown.classList.add('hidden');
            });
            themeDropdown.appendChild(button);
        });
    }

    themeSelects.forEach(select => {
        BSPLINE_THEMES.forEach(theme => {
            const option = document.createElement('option');
            option.value = theme.id;
            option.textContent = theme.name;
            select.appendChild(option);
        });
        select.value = initialTheme;
        select.addEventListener('change', () => applyBsplineTheme(select.value, true, 'select'));
    });

    if (themeBtn && themeDropdown) {
        themeBtn.addEventListener('click', event => {
            event.stopPropagation();
            themeDropdown.classList.toggle('hidden');
        });

        document.addEventListener('click', () => {
            themeDropdown.classList.add('hidden');
        });
    }

    applyBsplineTheme(initialTheme, false, 'init');

    if (settings.watchStorage) {
        window.addEventListener('storage', event => {
            if (event.key !== BSPLINE_THEME_KEY) return;
            if (event.newValue && event.newValue !== currentBsplineTheme) {
                applyBsplineTheme(event.newValue, false, 'storage');
            }
        });

        if (storageWatchInterval) {
            clearInterval(storageWatchInterval);
        }
        storageWatchInterval = setInterval(() => {
            const storedTheme = getStoredBsplineTheme();
            if (storedTheme && storedTheme !== currentBsplineTheme) {
                applyBsplineTheme(storedTheme, false, 'storage-poll');
            }
        }, 500);
    }
}

window.initBsplineTheme = initBsplineTheme;
window.applyBsplineTheme = applyBsplineTheme;
window.BSPLINE_THEMES = BSPLINE_THEMES;
