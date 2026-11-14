// Адаптер Playgama (Playgama Bridge SDK 2.x, https://wiki.playgama.com/playgama/bridge-sdk/api).
// Bridge подключён обычным скриптом первым в <head> (требование площадки), init() ждёт его готовности.
// Обязательные шаги площадки: язык из platform.language, сохранения только через bridge.storage (читаем все
// ключи одним get при старте, пишем пачкой), звук и пауза по событиям Bridge, game_ready на первом кадре,
// интерстиции без своих таймеров — частоту решает Bridge (ownLimits: false), ролик за награду только по
// состоянию rewarded.

// Все ключи, которые игра держит в хранилище: прогресс, монеты и настройки (Settings.js добавляет префикс)
const KEYS = [
    'shakeit.progress.v1',
    'shakeit.economy.v1',
    ...['language', 'muted', 'shopSeen', 'rhythmOffset', 'tutorialSeen'].map((name) => 'shakeit.setting.' + name)
];
const FLUSH_DELAY = 1.5;     // с тишины, после которых пачка записей уходит в Bridge
const AD_OPEN_TIMEOUT = 25;  // с: ролик не открылся за это время — считаем, что рекламы нет
const AD_MAX = 180;          // с: ролик открыт, но 'closed' так и не пришёл — не держим игру вечно
const AD_END_GRACE = 2;      // с после снятия паузы площадки: если 'closed' не пришёл, ролик закончился

export function createPlaygama(bridge) {
    const cache = {};
    const dirty = new Set();
    let timer = 0;
    let paused = false;
    const muteListeners = [];

    const flush = () => {
        clearTimeout(timer);
        if (!dirty.size) return;
        const keys = [...dirty];
        dirty.clear();
        bridge.storage.set(keys, keys.map((k) => cache[k])).catch(() => {});   // Играем дальше: всё в памяти
    };

    // Ролик: Bridge сообщает состояния событием; награда — только при 'rewarded'
    function playAd(module, eventName, start, wantReward) {
        return new Promise((resolve) => {
            let opened = false;
            let rewarded = false;
            let done = false;
            let guard = 0;
            let cleanup = () => {};
            // Ролик рисуется площадкой поверх рамки игры, и сигнал «закрыт» до игры доходит не всегда (так на
            // Playgama: игрок закрыл ролик, а кнопки итогов остались заблокированными). Пока ролик открыт,
            // касание в рамке игры невозможно — значит, первое касание после 'opened' и есть конец ролика
            let touchGuard = 0;
            const onTouch = () => finish();
            const watchTouch = () => {
                touchGuard = setTimeout(() => {
                    for (const type of ['pointerdown', 'touchstart', 'mousedown', 'keydown']) window.addEventListener(type, onTouch, true);
                }, 600);
            };
            const unwatchTouch = () => {
                clearTimeout(touchGuard);
                for (const type of ['pointerdown', 'touchstart', 'mousedown', 'keydown']) window.removeEventListener(type, onTouch, true);
            };
            const onState = (state) => {
                if (state === 'opened') { opened = true; clearTimeout(guard); guard = setTimeout(finish, AD_MAX * 1000); watchTouch(); }
                else if (state === 'rewarded') rewarded = true;
                else if (state === 'closed' || state === 'failed') finish();
            };
            const finish = () => {
                if (done) return;
                done = true;
                clearTimeout(guard);
                try { module.off(eventName, onState); } catch (e) { /* уже снят */ }
                cleanup();
                unwatchTouch();
                // Площадка на время ролика ставит игру на паузу, а «пауза снята» присылает не всегда (так на Playgama:
                // звук оставался выключенным навсегда). Ролик кончился — пауза от него тоже
                paused = false;
                muteListeners.forEach((fn) => fn());
                resolve(wantReward ? rewarded : opened);
            };
            guard = setTimeout(finish, AD_OPEN_TIMEOUT * 1000);
            module.on(eventName, onState);
            // Площадка снимает паузу игры, когда ролик закончился: подстраховка на случай потерянного 'closed'
            const onPause = (isPaused) => {
                if (!isPaused && opened) setTimeout(finish, AD_END_GRACE * 1000);
            };
            bridge.platform.on(bridge.EVENT_NAME.PAUSE_STATE_CHANGED, onPause);
            const offPause = () => { try { bridge.platform.off(bridge.EVENT_NAME.PAUSE_STATE_CHANGED, onPause); } catch (e) { /* снят */ } };
            cleanup = offPause;
            try {
                start();
            } catch (e) {
                finish();
            }
        });
    }

    const platform = () => bridge.platform;

    return {
        name: 'playgama',

        async init() {
            await bridge.initialize();
            // Прогресс восстанавливаем до показа игры; сбой хранилища — стартуем с нуля
            try {
                const values = await bridge.storage.get(KEYS);
                KEYS.forEach((key, i) => {
                    const v = Array.isArray(values) ? values[i] : values && values[key];
                    if (typeof v === 'string') cache[key] = v;
                    else if (v !== null && v !== undefined) cache[key] = JSON.stringify(v);
                });
            } catch (e) { /* пустое хранилище */ }
            platform().on(bridge.EVENT_NAME.PAUSE_STATE_CHANGED, (value) => { paused = Boolean(value); });
        },

        get storage() {
            return {
                getItem(key) {
                    return key in cache ? cache[key] : null;
                },
                setItem(key, value) {
                    cache[key] = value;
                    dirty.add(key);
                    clearTimeout(timer);
                    timer = setTimeout(flush, FLUSH_DELAY * 1000);
                }
            };
        },

        loadingStart() {},

        // Первый играбельный кадр на экране: площадка прячет свою заставку
        loadingStop() {
            platform().sendMessage('game_ready').catch(() => {});
        },

        gameplayStart() {
            platform().sendMessage('gameplay_started').catch(() => {});
        },

        gameplayStop() {
            platform().sendMessage('gameplay_stopped').catch(() => {});
        },

        ownLimits: false,

        ads: {
            get supportsRewarded() {
                return Boolean(bridge.advertisement.isRewardedSupported);
            },
            supportsInterstitial: true,
            async canShowRewarded() {
                return Boolean(bridge.advertisement.isRewardedSupported);
            },
            async canShowInterstitial() {
                return Boolean(bridge.advertisement.isInterstitialSupported);
            },
            showRewarded() {
                const ad = bridge.advertisement;
                return playAd(ad, bridge.EVENT_NAME.REWARDED_STATE_CHANGED, () => ad.showRewarded('double_coins'), true);
            },
            showInterstitial() {
                const ad = bridge.advertisement;
                return playAd(ad, bridge.EVENT_NAME.INTERSTITIAL_STATE_CHANGED, () => ad.showInterstitial('level_completed'), false);
            }
        },

        // Площадка просит тишину (вкладка скрыта, ролик, её собственная кнопка звука) — приоритетнее нашей кнопки
        get muted() {
            return !platform().isAudioEnabled || paused;
        },

        onMuteChange(callback) {
            const tell = () => callback(!platform().isAudioEnabled || paused);
            muteListeners.push(tell);
            platform().on(bridge.EVENT_NAME.AUDIO_STATE_CHANGED, tell);
            platform().on(bridge.EVENT_NAME.PAUSE_STATE_CHANGED, tell);
        }
    };
}
