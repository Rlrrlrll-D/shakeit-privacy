// Слой платформы: всё, что игре нужно от площадки, за одним интерфейсом. Сама игра о площадках не знает —
// на Android и на обычной странице работает пустой адаптер, на портале (CrazyGames, позже Poki) — его SDK.
// Какой адаптер включить, решает наличие SDK на странице: скрипт SDK в index.html вставляет только
// сборка для этого портала (scripts/build-web.mjs), в приложении и на других сайтах его нет и сети не нужно.
// Любой сбой SDK не должен ронять игру — вызовы обёрнуты, при ошибке работаем как без площадки.
import { useStorageBackend } from '../util/storage.js';
import { createCrazyGames } from './crazygames.js';
import { createPikabu, waitForPikabu } from './pikabu.js';

const none = {
    name: 'none',
    async init() {},
    loadingStart() {},
    loadingStop() {},
    gameplayStart() {},
    gameplayStop() {},
    muted: false,
    onMuteChange() {},
    storage: null
};

async function pick() {
    const portal = window.__SHAKEIT_BUILD && window.__SHAKEIT_BUILD.portal;
    // Скрипт SDK Пикабу подключён с async и может прийти позже нашего модуля
    if (portal === 'pikabu') {
        const sdk = await waitForPikabu();
        return sdk ? createPikabu(sdk) : none;
    }
    const cg = window.CrazyGames && window.CrazyGames.SDK;
    // На чужом домене SDK CrazyGames выбрасывает ошибку на любой вызов (environment 'disabled')
    if (cg && cg.environment !== 'disabled') return createCrazyGames(cg);
    return none;
}

function safe(fn, fallback) {
    try {
        return fn();
    } catch (e) {
        return fallback;
    }
}

const INIT_TIMEOUT = 5;    // с: дольше ждать площадку нельзя — игрок смотрит в пустой экран

let adapter = none;
let playing = false;   // Идёт ли игровой процесс; SDK ждёт пары start/stop, а не повторов

export const platform = {
    get name() {
        return adapter.name;
    },

    // До создания прогресса: SDK поднимается и отдаёт облачное хранилище
    async init() {
        try {
            adapter = await pick();
            // Вне площадки SDK может не ответить вовсе (так у Пикабу) — игра не должна ждать его вечно
            await Promise.race([
                adapter.init(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('площадка молчит')), INIT_TIMEOUT * 1000))
            ]);
            if (adapter.storage) useStorageBackend(adapter.storage);
            adapter.loadingStart();
        } catch (e) {
            adapter = none;    // SDK не поднялся (нет сети, блокировщик) — играем без площадки
        }
    },

    // Загрузка закончилась, дальше игрок
    loadingStop() {
        safe(() => adapter.loadingStop());
    },

    // Активная игра началась или продолжилась. Вызывать только на настоящем переходе: фокус окна SDK
    // отслеживает сам
    gameplayStart() {
        if (playing) return;
        playing = true;
        safe(() => adapter.gameplayStart());
    },

    // Любая пауза в игре: итог уровня, выход в меню
    gameplayStop() {
        if (!playing) return;
        playing = false;
        safe(() => adapter.gameplayStop());
    },

    // Площадка просит выключить звук (приоритетнее кнопки звука в игре)
    get muted() {
        return Boolean(safe(() => adapter.muted, false));
    },

    onMuteChange(callback) {
        safe(() => adapter.onMuteChange(callback));
    }
};
