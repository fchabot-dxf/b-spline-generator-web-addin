const FRAME_BUILDER_THEME_KEY = 'frameBuilderTheme';
const FRAME_BUILDER_THEMES = [
    { id: 'windows95', name: 'Windows 95' },
    { id: 'fantasy', name: 'Fantasy' },
    { id: 'dark-metal', name: 'Dark Metal' },
    { id: 'neumorphism', name: 'Neumorphism' },
    { id: 'bauhaus', name: 'Bauhaus' }
];

function applyFrameBuilderTheme(themeId) {
    const body = document.body;
    FRAME_BUILDER_THEMES.forEach(t => body.classList.remove('theme-' + t.id));
    body.classList.add('theme-' + themeId);
    localStorage.setItem(FRAME_BUILDER_THEME_KEY, themeId);
    const themeSelects = document.querySelectorAll('#theme-select, #theme-select-settings');
    themeSelects.forEach(select => { if (select) select.value = themeId; });
}

function initFrameBuilderThemes() {
    const settingsBtn = document.getElementById('settings-btn');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const settingsPanel = document.getElementById('settings-panel');
    const settingsOverlay = document.getElementById('settings-overlay');
    const themeSelects = Array.from(document.querySelectorAll('#theme-select, #theme-select-settings'));

    const currentTheme = localStorage.getItem(FRAME_BUILDER_THEME_KEY) || 'dark-metal';
    applyFrameBuilderTheme(currentTheme);

    themeSelects.forEach(themeSelect => {
        FRAME_BUILDER_THEMES.forEach(theme => {
            const option = document.createElement('option');
            option.value = theme.id;
            option.textContent = theme.name;
            themeSelect.appendChild(option);
        });
        themeSelect.value = currentTheme;
        themeSelect.addEventListener('change', () => applyFrameBuilderTheme(themeSelect.value));
    });

    const toggleSettings = () => {
        if (!settingsPanel || !settingsOverlay) return;
        const open = settingsPanel.classList.toggle('open');
        settingsOverlay.classList.toggle('open', open);
    };

    if (settingsBtn) settingsBtn.addEventListener('click', toggleSettings);
    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', toggleSettings);
    if (settingsOverlay) settingsOverlay.addEventListener('click', toggleSettings);
}

window.initFrameBuilderThemes = initFrameBuilderThemes;
