// Детектор тряски: превращает сырые замеры акселерометра в интенсивность 0..1,
// приращение скорости телефона (для инерции жидкости) и направление гравитации (для наклона).
// Не зависит ни от Phaser, ни от источника данных — один алгоритм для Android, браузера и отладки.
//
// Мощность тряски (drive) = √(сила × темп), без потолка — чем резче и чаще трясёшь, тем больше:
//  - сила — сглаженное среднеквадратичное ускорение без гравитации;
//  - темп — число разворотов движения в секунду по основной оси тряски. Частоту датчик меряет надёжно,
//    без "потолка" диапазона. Считаем развороты по оси, а не всплески модуля: при диагональной
//    или круговой тряске модуль почти не падает между рывками, и всплески сливаются.
// Среднее геометрическое: удвоил и силу, и темп — мощность удвоилась; одним махом без темпа не набрать.
// Интенсивность 0..1 — та же мощность, сжатая для индикатора и визуальной турбулентности.
//
// Встряхивания (strokes) — то, что красит жидкость: каждый разворот движения — одно встряхивание,
// его сила 0..1 — от пикового ускорения за полупериод, с насыщением: вдвое резче почти не даёт
// прибавки, вдвое чаще — вдвое больше. Ровный темп выгоднее изматывающих рывков.
// Время встряхивания — момент пика ускорения (точка разворота, где шейкер "щёлкает"); по часам
// вызывающего (wall), если они переданы, — для ритма: сверки с битом метронома.
export class ShakeDetector {
    constructor(params) {
        this.p = params;
        this.peakTimes = new Float64Array(params.peakHistory);
        this.reset();
    }

    reset() {
        this.time = 0;
        this.gravityReady = false;
        this.gx = 0;
        this.gy = 0;
        this.gz = 0;
        this.energy = 0;
        this.axisEnergy = [0, 0, 0];
        this.axis = 0;
        this.side = 0;               // С какой стороны порога сейчас ускорение по основной оси: -1, 0, +1
        this.strokePeak = 0;         // Пик |ускорения| по оси в текущем полупериоде
        this.strokePeakTime = 0;     // Когда был этот пик
        this.strokes = 0;            // Встряхиваний с прошлого consumeStrokes
        this.strokePower = 0;        // Их суммарная сила
        this.strokeTimes = [];       // Время и сила каждого — для ритма
        this.strokePowers = [];
        this.sampleTime = 0;         // Время текущего замера (wall или собственные часы)
        this.lastPeakTime = -Infinity;
        this.peakHead = 0;
        this.peakTimes.fill(-Infinity);
        this.impulseX = 0;
        this.impulseY = 0;
        this.impulseZ = 0;
        this.drive = 0;
        this.intensity = 0;
        this.staleTime = 0;
        this.stale = true;
    }

    // ax, ay, az — ускорение с гравитацией (м/с²), dt — время с прошлого замера (с),
    // wall — время этого замера по общим часам игры (с), если известно
    addSample(ax, ay, az, dt, wall) {
        const p = this.p;
        if (!(dt > 0)) return;
        if (dt > p.maxDt) dt = p.maxDt;

        this.time += dt;
        this.sampleTime = wall ?? this.time;
        this.staleTime = 0;
        this.stale = false;

        if (!this.gravityReady) {
            this.gx = ax;
            this.gy = ay;
            this.gz = az;
            this.gravityReady = true;
            return;
        }

        // Низкочастотный фильтр выделяет гравитацию, остаток — движение руки.
        // Модуль вектора по трём осям: не важны ни наклон телефона, ни знаки осей у разных платформ
        const kg = 1 - Math.exp(-dt / p.gravityTau);
        this.gx += (ax - this.gx) * kg;
        this.gy += (ay - this.gy) * kg;
        this.gz += (az - this.gz) * kg;

        const lx = ax - this.gx;
        const ly = ay - this.gy;
        const lz = az - this.gz;
        let mag = Math.sqrt(lx * lx + ly * ly + lz * lz);
        if (mag > p.maxMagnitude) mag = p.maxMagnitude;

        const m = mag > p.deadZone ? mag - p.deadZone : 0;

        // Интеграл ускорения на полной частоте датчика = приращение скорости телефона.
        // Пики между кадрами не теряются; дрожание руки в мёртвой зоне не толкает жидкость
        if (m > 0) {
            const scale = m / mag;
            this.impulseX += lx * scale * dt;
            this.impulseY += ly * scale * dt;
            this.impulseZ += lz * scale * dt;
        }
        const ke = 1 - Math.exp(-dt / p.energyTau);
        this.energy += (m * m - this.energy) * ke;

        const e = this.axisEnergy;
        e[0] += (lx * lx - e[0]) * ke;
        e[1] += (ly * ly - e[1]) * ke;
        e[2] += (lz * lz - e[2]) * ke;

        this.detectReversal(lx, ly, lz);
    }

    // Разворот = ускорение по основной оси перешло через порог в другую сторону (гистерезис ±порог)
    detectReversal(lx, ly, lz) {
        const p = this.p;
        const e = this.axisEnergy;
        const axis = e[0] >= e[1] && e[0] >= e[2] ? 0 : (e[1] >= e[2] ? 1 : 2);
        if (axis !== this.axis) {
            this.axis = axis;
            this.side = 0;
            this.strokePeak = 0;
        }

        const a = axis === 0 ? lx : (axis === 1 ? ly : lz);
        const absA = Math.abs(a);
        let side = this.side;
        if (a > p.reversalThreshold) side = 1;
        else if (a < -p.reversalThreshold) side = -1;
        if (side === this.side) {
            if (absA > this.strokePeak) {
                this.strokePeak = absA;
                this.strokePeakTime = this.sampleTime;
            }
            return;
        }

        const reversed = this.side !== 0;
        this.side = side;
        if (reversed && this.time - this.lastPeakTime >= p.minPeakInterval) {
            this.lastPeakTime = this.time;
            this.peakTimes[this.peakHead] = this.time;
            this.peakHead = (this.peakHead + 1) % this.peakTimes.length;
            // Закончился полупериод — встряхивание засчитано с силой по его пику
            const power = Math.max(0, 1 - Math.exp(-(this.strokePeak - p.reversalThreshold) / p.strokeRef));
            this.strokes++;
            this.strokePower += power;
            this.strokeTimes.push(this.strokePeakTime);
            this.strokePowers.push(power);
        }
        this.strokePeak = absA;
        this.strokePeakTime = this.sampleTime;
    }

    peakRate() {
        const from = this.time - this.p.tempoWindow;
        let count = 0;
        for (let i = 0; i < this.peakTimes.length; i++) {
            if (this.peakTimes[i] > from) count++;
        }
        return count / this.p.tempoWindow;
    }

    // Вызывается раз в кадр: пересчитывает сглаженную интенсивность
    update(dt) {
        const p = this.p;

        this.staleTime += dt;
        if (!this.stale && this.staleTime > p.staleTimeout) {
            // Датчик замолчал (пауза приложения, нет сенсора) — не оставляем "залипшую" тряску
            this.stale = true;
            this.energy = 0;
            this.axisEnergy.fill(0);
            this.side = 0;
            this.strokePeak = 0;
            this.peakTimes.fill(-Infinity);
        }

        const force = Math.sqrt(this.energy) / p.forceRef;
        const tempo = this.peakRate() / p.tempoRef;
        const target = Math.sqrt(force * tempo);

        const tau = target > this.drive ? p.attackTau : p.releaseTau;
        this.drive += (target - this.drive) * (1 - Math.exp(-dt / tau));
        this.intensity = 1 - Math.exp(-this.drive);
    }

    // Приращение скорости телефона (м/с, оси телефона) с прошлого вызова; записывается в out без выделения памяти
    consumeImpulse(out) {
        out.impulseX = this.impulseX;
        out.impulseY = this.impulseY;
        out.impulseZ = this.impulseZ;
        this.impulseX = 0;
        this.impulseY = 0;
        this.impulseZ = 0;
    }

    // Встряхивания с прошлого вызова: количество, суммарная сила, время и сила каждого; записывается в out
    // (массивы out переиспользуются — без выделения памяти в кадре)
    consumeStrokes(out) {
        out.strokes = this.strokes;
        out.strokePower = this.strokePower;
        out.strokeTimes = copyInto(out.strokeTimes, this.strokeTimes);
        out.strokePowers = copyInto(out.strokePowers, this.strokePowers);
        this.strokes = 0;
        this.strokePower = 0;
        this.strokeTimes.length = 0;
        this.strokePowers.length = 0;
    }
}

function copyInto(target, source) {
    const out = target || [];
    out.length = source.length;
    for (let i = 0; i < source.length; i++) out[i] = source[i];
    return out;
}
