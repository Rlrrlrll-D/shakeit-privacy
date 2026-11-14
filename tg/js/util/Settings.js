// Настройки игрока (звук и т.п.). Живут там же, где прогресс (util/storage.js): в localStorage или в
// хранилище площадки. Хранилище может быть недоступно — тогда настройки живут до закрытия игры, а игра
// работает со значениями по умолчанию
import { readStored, writeStored } from './storage.js';

const PREFIX = 'shakeit.setting.';

export function loadSetting(name, fallback) {
    try {
        const raw = readStored(PREFIX + name);
        return raw === null || raw === undefined ? fallback : JSON.parse(raw);
    } catch (e) {
        return fallback;
    }
}

export function saveSetting(name, value) {
    writeStored(PREFIX + name, JSON.stringify(value));
}
