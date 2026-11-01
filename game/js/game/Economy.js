// Монеты, покупки косметики и задание дня. Всё в localStorage, как прогресс.
//
// Монеты платят за умение: за новые звёзды и за побитые рекорды, плюс задание дня — повод заходить
// каждый день. Косметика ни на что в игре не влияет (game/cosmetics.js), поэтому рекорды сравнимы.
// Награда за заезд может быть удвоена роликом рекламы (REWARD_MULTIPLIER) — крючок под монетизацию
// на площадках; пока рекламы нет, кнопка не показывается (ADS_READY).
import { COSMETICS, DEFAULT_EQUIP, SLOTS, item } from './cosmetics.js';
import { loadSetting, saveSetting } from '../util/Settings.js';
import { readStored, writeStored } from '../util/storage.js';

const KEY = 'shakeit.economy.v1';

export const ADS_READY = false;        // Переключится, когда будет подключён показ рекламы
export const REWARD_MULTIPLIER = 2;    // Во столько раз ролик увеличивает награду за заезд

// Монеты за заезд: за каждую новую звезду, за первое прохождение и за побитые рекорды
export const REWARD = { star: 12, firstClear: 20, timeRecord: 15, scoreRecord: 10 };

// Задание дня: id, цель и награда. Прогресс считается за календарный день игрока
export const DAILY = [
    { id: 'runs', goal: 3, coins: 40 },        // Пройти 3 уровня
    { id: 'stars', goal: 4, coins: 50 },       // Заработать 4 звезды
    { id: 'records', goal: 1, coins: 45 },     // Побить рекорд
    { id: 'beat', goal: 12, coins: 55 },       // 12 попаданий в такт подряд
    { id: 'perfect', goal: 1, coins: 60 }      // Заезд на три звезды
];

export class Economy {
    constructor() {
        this.data = { coins: 0, owned: {}, equip: { ...DEFAULT_EQUIP }, daily: null, shopSeen: -1 };
        try {
            const raw = JSON.parse(readStored(KEY));
            if (raw && typeof raw === 'object') this.data = { ...this.data, ...raw, equip: { ...DEFAULT_EQUIP, ...raw.equip } };
        } catch (e) {
            // Нет хранилища или испорченные данные — начинаем с нуля
        }
        this.refreshDaily();
    }

    save() {
        writeStored(KEY, JSON.stringify(this.data));    // Хранилище недоступно — покупки живут до закрытия игры
    }

    get coins() {
        return this.data.coins;
    }

    add(coins) {
        this.data.coins += coins;
        this.save();
    }

    // Есть ли что купить на накопленное и не заходил ли игрок в магазин с такой же суммой: по этому
    // на карте пульсирует кошелёк. Заглянул в магазин — тихо, пока монет снова не станет больше
    get shopHasNews() {
        if (this.data.coins <= this.data.shopSeen) return false;
        return SLOTS.some((slot) => COSMETICS[slot].some((it) => !this.owns(slot, it.id) && it.price <= this.data.coins));
    }

    markShopSeen() {
        this.data.shopSeen = this.data.coins;
        this.save();
    }

    // Куплено ли (бесплатное — всегда)
    owns(slot, id) {
        return item(slot, id).price === 0 || Boolean(this.data.owned[slot + ':' + id]);
    }

    buy(slot, id) {
        const it = item(slot, id);
        if (this.owns(slot, id) || this.data.coins < it.price) return false;
        this.data.coins -= it.price;
        this.data.owned[slot + ':' + id] = 1;
        this.equip(slot, id);
        return true;
    }

    equip(slot, id) {
        if (!this.owns(slot, id)) return false;
        this.data.equip[slot] = id;
        this.save();
        return true;
    }

    // Надетое в слоте — сам предмет из каталога
    equipped(slot) {
        return item(slot, this.data.equip[slot]);
    }

    get equipment() {
        const out = {};
        for (const slot of SLOTS) out[slot] = this.equipped(slot);
        return out;
    }

    // Сколько монет даёт результат заезда (до удвоения роликом)
    static rewardFor(record, stars) {
        return (record.starsGained || 0) * REWARD.star
            + (record.firstClear ? REWARD.firstClear : 0)
            + (record.timeRecord && record.previousBestTime !== null ? REWARD.timeRecord : 0)
            + (record.scoreRecord && !record.firstClear ? REWARD.scoreRecord : 0);
    }

    // ---- Задание дня ----

    // Сегодняшняя дата игрока в его часовом поясе: YYYY-MM-DD
    static today() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // Новый день — новое задание (выбор по дате: у одного игрока оно одно и то же весь день)
    refreshDaily() {
        const today = Economy.today();
        if (this.data.daily && this.data.daily.date === today) return;
        const seed = today.split('-').reduce((a, p) => a + Number(p), 0);
        const task = DAILY[seed % DAILY.length];
        this.data.daily = { date: today, id: task.id, progress: 0, done: false, claimed: false };
        this.save();
    }

    get daily() {
        this.refreshDaily();
        const task = DAILY.find((t) => t.id === this.data.daily.id);
        return { ...this.data.daily, goal: task.goal, coins: task.coins };
    }

    // Засчитать продвижение по заданию; kind — его id, amount — на сколько
    progressDaily(kind, amount = 1) {
        this.refreshDaily();
        const state = this.data.daily;
        if (state.id !== kind || state.done || amount <= 0) return false;
        const task = DAILY.find((t) => t.id === kind);
        // «В такт подряд» — не сумма, а лучший результат заезда
        state.progress = kind === 'beat' ? Math.max(state.progress, amount) : state.progress + amount;
        if (state.progress >= task.goal) state.done = true;
        this.save();
        return state.done;
    }

    claimDaily() {
        const state = this.data.daily;
        if (!state.done || state.claimed) return 0;
        const task = DAILY.find((t) => t.id === state.id);
        state.claimed = true;
        this.data.coins += task.coins;
        this.save();
        return task.coins;
    }

    // Итоги заезда: начислить монеты и продвинуть задание дня. Возвращает, сколько начислено
    finishRun({ record, stars, bestStreak = 0 }) {
        const coins = Economy.rewardFor(record, stars);
        this.add(coins);
        this.progressDaily('runs');
        if (record.starsGained) this.progressDaily('stars', record.starsGained);
        if (record.timeRecord && record.previousBestTime !== null) this.progressDaily('records');
        if (bestStreak) this.progressDaily('beat', bestStreak);
        if (stars === 3) this.progressDaily('perfect');
        return coins;
    }
}

// Звук и язык лежат в своих настройках; экономике нужен только флажок «магазин открывали»
export function shopSeen() {
    return loadSetting('shopSeen', false);
}

export function markShopSeen() {
    saveSetting('shopSeen', true);
}
