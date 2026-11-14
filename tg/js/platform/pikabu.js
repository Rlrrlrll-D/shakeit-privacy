// Адаптер «Пикабу Игры» (SDK: https://games.pikabu.ru/sdk/docs/sdk/init).
// SDK живёт только на странице игры у площадки и по тестовой ссылке Студии; на своём домене его нет,
// и игра работает как без площадки. У Пикабу всего одно событие готовности — gameStarted() после
// загрузки ресурсов; «начала» и «паузы» игры, в отличие от CrazyGames, у них не существует.
//
// Сохранения у них обязательны для публикации: set() кладёт значение синхронно, а flush() подтверждает
// запись на сервер. Запись отложена: сохранений у нас мало (конец уровня, покупка), но подряд их может
// быть несколько, а площадка принимает не больше 100 flush за 5 минут — отсюда пауза FLUSH_DELAY.
const SDK_WAIT = 5;          // с: сколько ждём загрузку скрипта SDK (он подключён с async)
const FLUSH_DELAY = 4;       // с тишины после записи, через которые подтверждаем сохранение на сервере

export async function waitForPikabu(timeout = SDK_WAIT) {
    const deadline = Date.now() + timeout * 1000;
    while (!window.PkbSDK) {
        if (Date.now() > deadline) return null;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return window.PkbSDK;
}

export function createPikabu(PkbSDK) {
    let sdk = null;
    let timer = 0;

    // Подтверждение записи на сервер: откладываем, пока идут новые записи
    const scheduleFlush = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            sdk.storage.flush().catch(() => {});   // Причину молчим: игра уже сохранила всё локально
        }, FLUSH_DELAY * 1000);
    };

    return {
        name: 'pikabu',

        async init() {
            sdk = await PkbSDK.init();
            // Сохранение с другого устройства или вкладки ломает запись до перезагрузки игры — не наш случай,
            // но без обработчика ошибка ушла бы в консоль молча
            sdk.on('storageSaveError', (reason) => console.warn('Пикабу: сохранение не прошло —', reason));
        },

        // Прогресс и монеты живут в аккаунте игрока; у гостя — локально, и переносятся при входе
        get storage() {
            return {
                getItem(key) {
                    const value = sdk.storage.get(key);
                    return value === undefined ? null : value;
                },
                setItem(key, value) {
                    sdk.storage.set(key, value);
                    scheduleFlush();
                }
            };
        },

        loadingStart() {},

        loadingStop() {
            sdk.gameStarted();
        },

        gameplayStart() {},
        gameplayStop() {},

        // Реклама SDK (https://games.pikabu.ru/sdk/docs/sdk/ads): fullscreen — между уровнями (площадка сама держит
        // паузу не меньше 120 с), rewarded — по нажатию игрока, награда только если show() вернул reward.
        // Перед каждым показом — canShow(): формат может быть недоступен (блокировщик, частота, занят интерфейс)
        ads: {
            get supportsRewarded() {
                return Boolean(sdk && sdk.ads.rewarded.isSupported);
            },
            get supportsInterstitial() {
                return Boolean(sdk && sdk.ads.fullscreen.isSupported);
            },
            async canShowRewarded() {
                return sdk.ads.rewarded.canShow();
            },
            async canShowInterstitial() {
                return sdk.ads.fullscreen.canShow();
            },
            async showRewarded() {
                const result = await sdk.ads.rewarded.show();
                return Boolean(result.rendered && result.reward);
            },
            async showInterstitial() {
                const result = await sdk.ads.fullscreen.show();
                return Boolean(result.rendered);
            }
        },

        get muted() {
            return false;      // Площадка звуком не управляет
        },

        onMuteChange() {}
    };
}
