// Адаптер Telegram Mini App: реклама AdsGram (видео за награду и между уровнями) и жесты Telegram.
// Скрипты Telegram WebApp и AdsGram подключает сборка (scripts/build-web.mjs, цель telegram).
// Идентификаторы блоков — из config.js (ADSGRAM); пока они пустые, рекламы в игре нет, остальное работает.
// Любой сбой = «ролика нет», игра идёт дальше.
import { ADSGRAM } from '../config.js';

export function createTelegram(tg) {
    const controllers = {};

    // Контроллер блока создаём один раз: AdsGram.init({ blockId }) → объект с show()
    const controller = (kind) => {
        const id = kind === 'rewarded' ? ADSGRAM.rewarded : ADSGRAM.interstitial;
        if (!id || !window.Adsgram) return null;
        if (!controllers[kind]) controllers[kind] = window.Adsgram.init({ blockId: String(id) });
        return controllers[kind];
    };

    // show() отвечает { done } (досмотрел до конца) или отклоняет с описанием: нет объявления, ошибка, пропуск
    const show = async (kind) => {
        const c = controller(kind);
        if (!c) return false;
        try {
            const result = await c.show();
            return Boolean(result && result.done);
        } catch (e) {
            return false;
        }
    };

    return {
        name: 'telegram',

        async init() {
            try {
                tg.ready();
                tg.expand();                                  // На весь экран
                if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();   // Свайп вниз не закрывает игру посреди тряски
            } catch (e) { /* старая версия клиента */ }
        },

        loadingStart() {},
        loadingStop() {},
        gameplayStart() {},
        gameplayStop() {},
        muted: false,
        onMuteChange() {},

        // Язык игрока в Telegram (i18n берёт его через window.Telegram)
        get language() {
            return tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.language_code;
        },

        ads: {
            supportsRewarded: Boolean(ADSGRAM.rewarded),
            supportsInterstitial: Boolean(ADSGRAM.interstitial),
            canShowRewarded: async () => Boolean(controller('rewarded')),
            canShowInterstitial: async () => Boolean(controller('interstitial')),
            showRewarded: () => show('rewarded'),
            // Для ролика между уровнями «досмотрел» неважно: главное, что он был показан
            showInterstitial: async () => {
                const c = controller('interstitial');
                if (!c) return false;
                try {
                    await c.show();
                    return true;
                } catch (e) {
                    return false;
                }
            }
        }
    };
}
