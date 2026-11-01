// Адаптер CrazyGames (SDK v3, https://docs.crazygames.com/sdk/intro/): события игры, сохранения в аккаунте
// игрока, просьба портала выключить звук. Реклама пока не подключена (Basic Launch — без неё).
// Модули SDK (game, data) доступны только после init(), до него обращение к ним бросает исключение —
// поэтому берём их внутри методов, а не при создании адаптера
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
        get muted() {
            return Boolean(sdk.game.settings && sdk.game.settings.muteAudio);
        },
        onMuteChange(callback) {
            sdk.game.addSettingsChangeListener((settings) => callback(Boolean(settings.muteAudio)));
        }
    };
}
