const BSPLINE_THEME_KEY = 'bsplineSharedTheme';
const BSPLINE_THEMES = [
    { id: 'windows31', name: 'Windows 3.1' },
    { id: 'plain', name: 'Plain CSS' },
    { id: 'dark-metal', name: 'Dark Metal' },
    { id: 'neumorphism', name: 'Neumorphism' },
    { id: 'bauhaus', name: 'Bauhaus' }
];

let currentBsplineTheme = null;
let storageWatchInterval = null;

function normalizeThemeId(themeId) {
    if (themeId === 'windows95') return 'windows31';
    return themeId;
}

function applyBsplineTheme(themeId, persist = false) {
    themeId = normalizeThemeId(themeId);
    if (!themeId) return;

    const body = document.body;
    BSPLINE_THEMES.forEach(theme => body.classList.remove('theme-' + theme.id));
    body.classList.add('theme-' + themeId);
    currentBsplineTheme = themeId;

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
    const themeBtn = document.getElementById('theme-btn');
    const themeDropdown = document.getElementById('theme-dropdown');
    const initialTheme = normalizeThemeId(getStoredBsplineTheme()) || 'dark-metal';

    if (themeDropdown) {
        themeDropdown.innerHTML = '';
        BSPLINE_THEMES.forEach(theme => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'theme-option';
            button.dataset.theme = theme.id;
            button.textContent = theme.name;
            button.addEventListener('click', () => {
                applyBsplineTheme(theme.id, true);
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
        select.addEventListener('change', () => applyBsplineTheme(select.value, true));
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
