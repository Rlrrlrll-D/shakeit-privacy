// Ритм: метроном и сверка ударов с битом. Без Phaser — тот же код работает в калибровке.
//
// Доли идут с частотой rate (в секунду): каждая доля ждёт один удар — как у шейкера-инструмента.
// Удар — резкий разворот руки: ускорение уходит в одну сторону и тут же в другую, детектор видит
// в нём два встряхивания с интервалом ~50 мс. Встряхивания ближе mergeGap друг к другу — один удар
// (время удара — по первому, сила — сумма).
// Доля засчитана "в такт", если в её окне РОВНО ОДИН удар и он близко к доле (±window).
// Беспорядочная частая тряска даёт по 2–3 удара на долю — бонуса не получает: ритм не обмануть
// скоростью. Бонус растёт с серией долей в такт подряд. Пустая доля серию не рвёт (можно бить
// в полтемпа — на каждый второй щелчок), рвут промах и две пустые доли подряд.
//
// offset — задержка "щелчок прозвучал → рука ударила → датчик засчитал": звук телефона, конвейер
// датчика и манера игрока. Подстраивается сама, когда игрок ровно бьёт в темпе (несколько чистых
// долей подряд): смещение ударов относительно долей усредняется.
export class Rhythm {
    // config — RHYTHM из config.js; start — время первой доли (часы игры, с)
    constructor(rate, config, start, offset) {
        this.cfg = config;
        this.period = 1 / rate;
        this.window = Math.min(config.maxWindow, Math.max(config.minWindow, this.period * config.windowShare));
        this.start = start;
        this.offset = offset;
        this.pending = new Map(); // Доля → { count, dev, power }
        this.lastFinal = -1;      // Последняя подведённая доля
        this.hitStart = -Infinity; // Начало текущего удара
        this.hitBeat = null;      // Доля, куда попал текущий удар (досчитать силу второго встряхивания)
        this.streak = 0;          // Доли в такт подряд
        this.bestStreak = 0;
        this.empty = 0;           // Пустые доли подряд
        this.clean = 0;           // Чистые доли подряд (один удар), даже если не в окне — для подстройки
        this.hits = 0;
        this.beats = 0;           // Доли, в которые игрок бил (пустые не считаются)
    }

    beatTime(k) {
        return this.start + k * this.period;
    }

    // Встряхивание в момент time (часы игры) с силой power
    addStroke(time, power) {
        if (time - this.hitStart < this.cfg.mergeGap) {
            if (this.hitBeat) this.hitBeat.power += power;
            return;
        }
        this.hitStart = time;
        this.hitBeat = null;
        const rel = time - this.offset - this.start;
        if (rel < -this.period / 2) return;
        const k = Math.round(rel / this.period);
        if (k <= this.lastFinal) return; // Доля уже подведена — удар пришёл слишком поздно
        let beat = this.pending.get(k);
        if (beat) {
            beat.count++;
        } else {
            beat = { count: 1, dev: rel - k * this.period, power };
            this.pending.set(k, beat);
        }
        this.hitBeat = beat;
    }

    // Подводит доли, окно которых закрылось; события дописывает в events:
    // { type: 'hit', bonus, power, streak } — в такт (power — сила удара, bonus — добавка за серию);
// { type: 'break' } — серия прервалась
    update(time, events) {
        // Встряхивание засчитывается в точке разворота, а приходит позже — ждём с запасом
        const closed = time - this.offset - this.start - this.period / 2 - this.cfg.settleDelay;
        const upTo = Math.floor(closed / this.period);
        for (let k = this.lastFinal + 1; k <= upTo; k++) {
            const beat = this.pending.get(k);
            this.pending.delete(k);
            if (beat === this.hitBeat) this.hitBeat = null;

            if (!beat) {
                this.empty++;
                if (this.empty >= 2 && this.streak > 0) {
                    this.streak = 0;
                    events.push({ type: 'break' });
                }
                continue;
            }
            this.empty = 0;
            this.beats++;

            const single = beat.count === 1;
            this.clean = single ? this.clean + 1 : 0;
            if (single && this.clean >= this.cfg.adaptAfter) {
                // Игрок держит темп — сдвигаем окно к его ударам (задержка телефона и привычка игрока)
                // Без сворачивания по периоду: задержка в секундах переносится на уровни с другим темпом
                this.offset = Math.min(this.cfg.maxOffset, Math.max(this.cfg.minOffset, this.offset + beat.dev * this.cfg.adapt));
            }

            if (single && Math.abs(beat.dev) <= this.window) {
                this.hits++;
                this.streak++;
                if (this.streak > this.bestStreak) this.bestStreak = this.streak;
                const ramp = Math.min(1, this.streak / this.cfg.streakRamp);
                events.push({ type: 'hit', bonus: beat.power * this.cfg.bonus * ramp, power: beat.power, streak: this.streak });
            } else if (this.streak > 0) {
                this.streak = 0;
                events.push({ type: 'break' });
            }
        }
        if (upTo > this.lastFinal) this.lastFinal = upTo;
    }
}
