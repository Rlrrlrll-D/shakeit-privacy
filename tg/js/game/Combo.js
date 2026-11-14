// Комбо-серия и очки. Без Phaser — проверяется тестами под Node.
//
// Серия идёт, пока встряхивания не прерываются дольше grace. Каждые step секунд непрерывной
// серии множитель растёт на 1 (до max). Пауза дольше grace — серия сгорает.
// Очки за встряхивание = его сила × множитель: трясти без остановки выгоднее, чем рывками,
// даже при том же числе встряхиваний.
// Итог уровня = очки за тряску + бонус за скорость (каждая секунда до лимита времени).
export class Combo {
    constructor(params) {
        this.p = params;
        this.reset();
    }

    reset() {
        this.streak = 0;         // Длительность непрерывной серии, с
        this.idle = Infinity;    // Сколько секунд не было встряхиваний (до первого — серии нет)
        this.multiplier = 1;
        this.shakePoints = 0;
    }

    // Бонус за встряхивание в такт: очки как за встряхивание силой power
    addBonus(power) {
        this.shakePoints += power * this.p.pointsPerStroke * this.multiplier;
    }

    get points() {
        return this.shakePoints;
    }

    // strokes, power — встряхивания за кадр и их суммарная сила.
    // Возвращает изменение множителя в этом кадре (для эффектов): > 0 — вырос, < 0 — серия сгорела
    update(dt, strokes, power) {
        const p = this.p;
        if (strokes > 0) {
            this.idle = 0;
        } else {
            this.idle += dt;
            if (this.idle > p.grace) this.streak = 0;
        }
        if (this.idle <= p.grace) this.streak += dt;

        const previous = this.multiplier;
        this.multiplier = Math.min(p.max, 1 + Math.floor(this.streak / p.step));
        this.shakePoints += power * p.pointsPerStroke * this.multiplier;
        return this.multiplier - previous;
    }

    // Затухание серии для индикатора: 1 — идёт, 0 — вот-вот сгорит
    get heat() {
        return this.streak > 0 ? Math.max(0, 1 - this.idle / this.p.grace) : 0;
    }

    timeBonus(time, maxTime) {
        return Math.round(Math.max(0, maxTime - time) * this.p.timeBonusPerSecond);
    }
}
