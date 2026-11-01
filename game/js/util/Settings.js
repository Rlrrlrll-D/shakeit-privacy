// Настройки игрока (звук и т.п.) в localStorage. Хранилище может быть недоступно — тогда настройки
// живут до закрытия игры, а игра работает со значениями по умолчанию
const PREFIX = 'shakeit.setting.';

export function loadSetting(name, fallback) {
    try {
        const raw = window.localStorage.getItem(PREFIX + name);
        return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
        return fallback;
    }
}

export function saveSetting(name, value) {
    try {
        window.localStorage.setItem(PREFIX + name, JSON.stringify(value));
    } catch (e) {
        // См. выше
    }
}
