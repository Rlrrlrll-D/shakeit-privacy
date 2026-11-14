// Адаптер Android-приложения: реклама Google AdMob через плагин @capacitor-community/admob.
// Только реклама: сохранения и события игры в приложении не нужны.
//
// Порядок: SDK поднимается в фоне (initialize), а согласие на рекламу (UMP: GDPR и другие регионы)
// спрашивается до первого ролика. Игра при этом не ждёт — иначе экран согласия заблокировал бы запуск
// по таймауту platform.init(). Любой сбой = «ролика нет», игра идёт дальше без рекламы.
//
// Идентификаторы — из config.js (ADMOB). Пока там тестовые, показываются тестовые ролики Google;
// настоящие подставляются после регистрации приложения в AdMob (docs/RELEASE.md).
import { ADMOB } from '../config.js';

export function createAdMob(plugin) {
    let ready = null;      // Обещание: SDK поднят и согласие получено

    const boot = async () => {
        try {
            const info = await plugin.requestConsentInfo();
            if (info.isConsentFormAvailable && info.status === 'REQUIRED') await plugin.showConsentForm();
        } catch (e) {
            // Нет сети или форма недоступна — играем с тем, что есть; без согласия там, где оно нужно, SDK роликов не даст
        }
        await plugin.initialize({ initializeForTesting: ADMOB.testing });
    };

    // Ролик: подготовка → показ. Награда приходит событием до закрытия окна, закрытие — отдельным событием
    const show = async (kind) => {
        await ready;
        const rewarded = kind === 'rewarded';
        const handles = [];
        let rewardedFlag = false;
        const finished = new Promise((resolve) => {
            const on = async (event, fn) => handles.push(await plugin.addListener(event, fn));
            if (rewarded) {
                on('onRewardedVideoAdReward', () => { rewardedFlag = true; });
                on('onRewardedVideoAdDismissed', () => resolve(rewardedFlag));
                on('onRewardedVideoAdFailedToShow', () => resolve(false));
            } else {
                on('onInterstitialAdDismissed', () => resolve(true));
                on('onInterstitialAdFailedToShow', () => resolve(false));
            }
        });
        try {
            const options = { adId: rewarded ? ADMOB.rewarded : ADMOB.interstitial, isTesting: ADMOB.testing };
            if (rewarded) {
                await plugin.prepareRewardVideoAd(options);
                await plugin.showRewardVideoAd();
            } else {
                await plugin.prepareInterstitial(options);
                await plugin.showInterstitial();
            }
            return await finished;
        } finally {
            for (const h of handles) h.remove && h.remove();
        }
    };

    // Можно ли показать: прогрузилось ли объявление. Подготовка потом повторяется при показе — SDK кеширует
    const canShow = async (kind) => {
        try {
            await ready;
            return true;
        } catch (e) {
            return false;
        }
    };

    return {
        name: 'admob',
        async init() {
            ready = boot();
            ready.catch(() => {});     // Ошибку не роняем: ролик просто не покажется
        },
        loadingStart() {},
        loadingStop() {},
        gameplayStart() {},
        gameplayStop() {},
        muted: false,
        onMuteChange() {},
        ads: {
            supportsRewarded: true,
            supportsInterstitial: true,
            canShowRewarded: () => canShow('rewarded'),
            canShowInterstitial: () => canShow('interstitial'),
            showRewarded: () => show('rewarded'),
            showInterstitial: () => show('interstitial')
        }
    };
}
