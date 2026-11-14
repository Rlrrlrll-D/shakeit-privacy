import { ShakeDetector } from './ShakeDetector.js';
import { PointerShake } from './PointerShake.js';

// Источники данных для детектора тряски, по приоритету:
//  1. native       — пакеты замеров ~200 Гц от Android (ShakeSensorBridge.java);
//  2. devicemotion — стандартное событие браузера (мобильный браузер, ~60 Гц);
//  3. pointer      — мышь или палец: зажать и водить, шейкер следует за курсором (PointerShake). Включается
//                    там, где датчика нет: на компьютере сразу, на телефоне — если датчик молчит дольше
//                    sensorSilence (закрыт политикой страницы, iOS без разрешения);
//  4. debug        — синтетическая тряска для отладки (адрес ?debug): зажать мышь или пробел.
// Как только пришли нативные данные, остальное игнорируется — иначе потоки смешаются.
// Каждый замер получает время по общим часам игры (performance.now, в секундах) — по ним ритм
// сверяет встряхивания с битом метронома.
export class ShakeInput {
    constructor(params, { debug = false, pointer = false } = {}) {
        this.p = params;
        this.detector = new ShakeDetector(params);
        this.source = 'none';

        // Мышь и палец. На устройстве с мышью (основной указатель — не палец) датчик ноутбука не слушаем:
        // трясти ноутбук никто не будет, а замеры сломали бы ввод мышью
        this.pointer = pointer ? new PointerShake(params) : null;
        this.pointerCarry = 0;
        this.sensorTime = -Infinity;     // Когда последний раз пришёл настоящий замер датчика (часы игры, с)
        this.preferPointer = pointer && !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

        // Снимок ввода за кадр — один переиспользуемый объект, без выделения памяти
        this.frame = {
            drive: 0, intensity: 0, impulseX: 0, impulseY: 0, impulseZ: 0, gravityX: 0, gravityY: 9.81,
            strokes: 0, strokePower: 0, strokeTimes: [], strokePowers: []
        };

        this.debugHeld = 0;
        this.debugPhase = 0;
        this.debugCarry = 0;

        this.attachNative();
        this.attachDeviceMotion();
        if (this.pointer) this.attachPointer();
        if (debug) this.attachDebug();
    }

    reset() {
        this.detector.reset();
    }

    // Раз в кадр: обрабатывает накопленные замеры и обновляет this.frame
    update(dt) {
        if (this.debugHeld > 0) this.feedDebug(dt);
        if (this.pointerActive()) {
            this.source = 'pointer';
            this.feedPointer(dt);
        }

        const d = this.detector;
        d.update(dt);

        const f = this.frame;
        f.drive = d.drive;
        f.intensity = d.intensity;
        d.consumeImpulse(f);
        d.consumeStrokes(f);
        if (d.gravityReady) {
            f.gravityX = d.gx;
            f.gravityY = d.gy;
        }
        return f;
    }

    attachNative() {
        // Плоский массив [dt, x, y, z, dt, x, y, z, ...]. Последний замер пакета — "только что";
        // время остальных — назад по их интервалам
        window.__shakeNative = (samples) => {
            this.source = 'native';
            let total = 0;
            for (let i = 0; i + 3 < samples.length; i += 4) total += samples[i];
            let wall = now() - total;
            for (let i = 0; i + 3 < samples.length; i += 4) {
                wall += samples[i];
                this.detector.addSample(samples[i + 1], samples[i + 2], samples[i + 3], samples[i], wall);
            }
        };
    }

    attachDeviceMotion() {
        let lastTime = 0;
        window.addEventListener('devicemotion', (event) => {
            if (this.source === 'native' || this.preferPointer) return;
            const a = event.accelerationIncludingGravity || event.acceleration;
            if (!a || a.x == null) return;

            this.sensorTime = performance.now() / 1000;
            const now = event.timeStamp;
            const dt = lastTime ? (now - lastTime) / 1000 : 0;
            lastTime = now;

            this.source = 'devicemotion';
            this.detector.addSample(a.x, a.y, a.z, dt, now / 1000);
        });
    }

    attachPointer() {
        const p = this.pointer;
        window.addEventListener('pointerdown', (e) => { if (e.button === 0) p.press(e.clientX, e.clientY); });
        window.addEventListener('pointermove', (e) => p.move(e.clientX, e.clientY));
        window.addEventListener('pointerup', () => p.release());
        window.addEventListener('pointercancel', () => p.release());
        window.addEventListener('blur', () => p.release());
    }

    // Мышь и палец заменяют датчик, когда датчика нет: на компьютере всегда, на телефоне — если он молчит
    pointerActive() {
        if (!this.pointer || this.source === 'native') return false;
        return this.preferPointer || now() - this.sensorTime > this.p.sensorSilence;
    }

    // Замеры «шейкера в руке» с частотой датчика, не кадра: тот же конвейер детектора, что и с телефона.
    // Идут и без нажатия — ровная гравитация нужна детектору, чтобы стакан не терял наклон
    feedPointer(dt) {
        const step = this.p.pointerSampleStep;
        this.pointerCarry += Math.min(dt, this.p.maxDt);
        const count = Math.floor(this.pointerCarry / step);
        let wall = now() - count * step;
        while (this.pointerCarry >= step) {
            this.pointerCarry -= step;
            wall += step;
            this.pointer.step(step);
            this.detector.addSample(this.pointer.ax, this.pointer.ay, 0, step, wall);
        }
    }

    attachDebug() {
        const press = () => { this.debugHeld++; };
        const release = () => { if (this.debugHeld > 0) this.debugHeld--; };

        window.addEventListener('pointerdown', press);
        window.addEventListener('pointerup', release);
        window.addEventListener('pointercancel', release);
        window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat) press(); });
        window.addEventListener('keyup', (e) => { if (e.code === 'Space') release(); });
        window.addEventListener('blur', () => { this.debugHeld = 0; });
    }

    // Синусоида ускорения по Y с частотой датчика, а не кадра — проверяет весь конвейер детектора
    feedDebug(dt) {
        const p = this.p;
        const step = p.debugSampleStep;
        const omega = 2 * Math.PI * p.debugFrequency;

        this.debugCarry += dt;
        const count = Math.floor(this.debugCarry / step);
        let wall = now() - count * step;
        while (this.debugCarry >= step) {
            this.debugCarry -= step;
            wall += step;
            this.debugPhase = (this.debugPhase + omega * step) % (2 * Math.PI);
            this.detector.addSample(0, 9.81 + p.debugAmplitude * Math.sin(this.debugPhase), 0, step, wall);
        }
    }
}

// Общие часы игры, секунды
export function now() {
    return performance.now() / 1000;
}

// iOS Safari выдаёт devicemotion только после разрешения, запрошенного по жесту пользователя
export function requestMotionPermission() {
    const DME = window.DeviceMotionEvent;
    if (DME && typeof DME.requestPermission === 'function') {
        DME.requestPermission().catch(() => {});
    }
}
