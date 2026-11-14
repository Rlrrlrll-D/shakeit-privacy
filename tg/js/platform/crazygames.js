// Адаптер CrazyGames (SDK v3, https://docs.crazygames.com/sdk/intro/): события игры, сохранения в аккаунте
// игрока, просьба портала выключить звук, реклама (sdk.ad: midgame между уровнями и rewarded по кнопке).
// Модули SDK (game, data) доступны только после init(), до него обращение к ним бросает исключение —
// поэтому берём их внутри методов, а не при создании адаптера
// Запрос рекламы: SDK отвечает колбэками, мы превращаем их в обещание «досмотрели или нет»
function requestAd(sdk, type) {
    return new Promise((resolve) => {
        try {
            sdk.ad.requestAd(type, {
                adStarted() {},
                adFinished() { resolve(true); },
                adError() { resolve(false); }
            });
        } catch (e) {
            resolve(false);
        }
    });
}

export function createCrazyGames(sdk) {
    return {
        name: 'crazygames',
        async init() {
            await sdk.init();
        },
        // Модуль данных включается при отправке игры (Progress Save); без него вызовы падают — тогда прогресс
        // остаётся в localStorage страницы
        get storage() {
            const data = sdk.data;
            try {
                data.getItem('shakeit.probe');
                return data;
            } catch (e) {
                return null;
            }
        },
        loadingStart() {
            sdk.game.loadingStart();
        },
        loadingStop() {
            sdk.game.loadingStop();
        },
        gameplayStart() {
            sdk.game.gameplayStart();
        },
        gameplayStop() {
            sdk.game.gameplayStop();
        },
        // Блокировщик рекламы: награду за ролик не выдать, кнопку не показываем
        ads: {
            supportsRewarded: true,
            supportsInterstitial: true,
            async canShowRewarded() {
                return !(await sdk.ad.hasAdblock());
            },
            async canShowInterstitial() {
                return !(await sdk.ad.hasAdblock());
            },
            showRewarded() {
                return requestAd(sdk, 'rewarded');
            },
            showInterstitial() {
                return requestAd(sdk, 'midgame');
            }
        },
        get muted() {
            return Boolean(sdk.game.settings && sdk.game.settings.muteAudio);
        },
        onMuteChange(callback) {
            sdk.game.addSettingsChangeListener((settings) => callback(Boolean(settings.muteAudio)));
        }
    };
}
