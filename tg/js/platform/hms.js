// Адаптер Android-приложения для устройств Huawei: реклама Huawei Ads (HMS Ads Kit, Petal Ads) через
// плагин @hmscore/cordova-plugin-hms-ads. На телефонах Huawei без сервисов Google AdMob не работает,
// поэтому там вместо него — этот адаптер (выбор: platform.js). Интерфейс тот же, что у admob.js.
//
// Плагин Cordova: Capacitor подгружает его глобальные объекты (HMSAds, HMSRewardAd, HMSInterstitialAd) сам.
// События объявлений приходят по имени. Любой сбой = «ролика нет», игра идёт дальше.
// Идентификаторы блоков — из config.js (HMS_ADS); пока там тестовые публичные, ничего не оплачивающие.
import { HMS_ADS } from '../config.js';

const LOAD_TIMEOUT = 8;    // с: объявление не загрузилось за это время — ролика нет
const SHOW_TIMEOUT = 120;  // с: ролик открыт, а «закрыт» не пришло — не держим игру вечно

// Плагин кладёт в window обёртки вида { HMSRewardAd: class }, а не сами классы
const klass = (name) => {
    const g = window[name];
    return typeof g === 'function' ? g : g && g[name];
};

const timeout = (seconds) => new Promise((resolve) => setTimeout(() => resolve('timeout'), seconds * 1000));

export function createHms() {
    let ready = null;

    const boot = async () => {
        await window.HMSAds.init();
    };

    // Ролик: создаём объект, ждём загрузки события, показываем, ждём закрытия. Награда — событием 'rewarded'
    const show = async (kind) => {
        await ready;
        const rewarded = kind === 'rewarded';
        const ad = rewarded ? new (klass('HMSRewardAd'))() : new (klass('HMSInterstitialAd'))();
        const ev = rewarded
            ? { loaded: 'reward_ad_loaded', failed: 'reward_ad_failed_to_load', failedShow: 'reward_ad_failed_to_show', closed: 'reward_ad_closed', reward: 'rewarded' }
            : { loaded: 'interstitial_ad_loaded', failed: 'interstitial_ad_failed', failedShow: 'interstitial_ad_failed', closed: 'interstitial_ad_closed' };
        let rewardedFlag = false;
        let resolveLoad;
        let resolveClose;
        const loaded = new Promise((r) => { resolveLoad = r; });
        const closed = new Promise((r) => { resolveClose = r; });
        ad.on(ev.loaded, () => resolveLoad(true));
        ad.on(ev.failed, () => { resolveLoad(false); resolveClose(false); });
        if (ev.failedShow !== ev.failed) ad.on(ev.failedShow, () => resolveClose(false));
        if (ev.reward) ad.on(ev.reward, () => { rewardedFlag = true; });
        ad.on(ev.closed, () => resolveClose(true));
        try {
            if (rewarded) {
                await ad.create(HMS_ADS.rewarded);
                await ad.setRewardAdListener();     // Без подписки нативный слой не присылает события (в том числе ошибки)
                await ad.loadAd({});
            } else {
                await ad.create(true);
                await ad.setAdListener();
                await ad.setAdId(HMS_ADS.interstitial);
                await ad.loadAd({});
            }
            if ((await Promise.race([loaded, timeout(LOAD_TIMEOUT)])) !== true) return false;
            await (rewarded ? ad.show(true) : ad.show());
            const end = await Promise.race([closed, timeout(SHOW_TIMEOUT)]);
            return rewarded ? rewardedFlag : end === true;
        } finally {
            if (rewarded && ad.destroy) ad.destroy().catch(() => {});
        }
    };

    const canShow = async () => {
        try {
            await ready;
            return true;
        } catch (e) {
            return false;
        }
    };

    return {
        name: 'hms',
        async init() {
            ready = boot();
            ready.catch(() => {});
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
            canShowRewarded: canShow,
            canShowInterstitial: canShow,
            showRewarded: () => show('rewarded'),
            showInterstitial: () => show('interstitial')
        }
    };
}
