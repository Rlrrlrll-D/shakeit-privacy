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
    storage: null,
    ads: null
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

// Реклама. Площадка сама ограничивает частоту, но игроку это тоже ощущается, поэтому свои пределы:
// первый ролик не раньше чем через FIRST_AD_AFTER с сессии, дальше не чаще раза в AD_GAP с
const FIRST_AD_AFTER = 120;
const AD_GAP = 120;
const sessionStart = Date.now();
let lastInterstitial = 0;
let adBusy = false;
let adHooks = { start() {}, end() {} };   // Звук на время ролика: ставит игра

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

    // Реклама. Любой сбой или недоступность — просто «не показано»: игра идёт дальше как без рекламы
    ads: {
        // Игра задаёт, что делать со звуком на время ролика (площадка требует остановить фоновый звук)
        setHooks(hooks) {
            adHooks = { ...adHooks, ...hooks };
        },

        // Есть ли вообще ролик за награду на этой площадке: по этому в итогах рисуется кнопка
        get supportsRewarded() {
            return Boolean(safe(() => adapter.ads && adapter.ads.supportsRewarded, false));
        },

        // Ролик за награду по кнопке игрока. true — досмотрел до конца, награду выдавать можно
        async rewarded() {
            if (adBusy || !this.supportsRewarded) return false;
            adBusy = true;
            try {
                if (!(await adapter.ads.canShowRewarded())) return false;
                adHooks.start();
                return Boolean(await adapter.ads.showRewarded());
            } catch (e) {
                return false;
            } finally {
                adHooks.end();
                adBusy = false;
            }
        },

        // Ролик между уровнями. Не показываем рано в сессии и слишком часто; true — реклама была
        async interstitial() {
            const now = Date.now();
            const a = adapter.ads;
            if (adBusy || !a || !a.supportsInterstitial) return false;
            if (now - sessionStart < FIRST_AD_AFTER * 1000) return false;
            if (lastInterstitial && now - lastInterstitial < AD_GAP * 1000) return false;
            adBusy = true;
            try {
                if (!(await a.canShowInterstitial())) return false;
                adHooks.start();
                const shown = Boolean(await a.showInterstitial());
                if (shown) lastInterstitial = Date.now();
                return shown;
            } catch (e) {
                return false;
            } finally {
                adHooks.end();
                adBusy = false;
            }
        }
    },

    // Площадка просит выключить звук (приоритетнее кнопки звука в игре)
    get muted() {
        return Boolean(safe(() => adapter.muted, false));
    },

    onMuteChange(callback) {
        safe(() => adapter.onMuteChange(callback));
    }
};
