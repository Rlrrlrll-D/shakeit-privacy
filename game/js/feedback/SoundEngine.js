// Звук жидкости на Web Audio. Записанные звуки (www/sounds) используются, если загрузились;
// иначе — синтезированная замена:
//  - всплески: когда жидкость бьётся о стенки (сила = сила удара). С записью шейкера — её нарезка
//    на отдельные удары: кусок звучит в момент удара в игре, поэтому звук попадает в ритм тряски игрока;
//  - капля, победа и рекорд — отдельные короткие звуки;
//  - метроном — отдельный канал мимо компрессора: громкие всплески не приглушают щелчки,
//    а пока идёт ритм, звук жидкости тише (duck).
// Если Web Audio недоступен, все методы молча ничего не делают
const MIN_PLAUSIBLE_LATENCY = 0.02;
const TYPICAL_LATENCY = 0.1;

export class SoundEngine {
    constructor(params) {
        this.p = params;
        this.ctx = null;
        this.lastSplash = 0;
        this.muted = false;
        this.samples = {};
        this.shakeHits = [];

        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        try {
            this.ctx = new Ctx();
        } catch (e) {
            return;
        }

        const ctx = this.ctx;
        this.master = ctx.createGain();
        this.master.gain.value = params.volume;
        // Компрессор не даёт наложению всплесков уйти в перегруз
        const compressor = ctx.createDynamicsCompressor();
        this.master.connect(compressor).connect(ctx.destination);
        // Звук жидкости — через свою громкость, её прибирает ритм
        this.liquidBus = ctx.createGain();
        this.liquidBus.connect(this.master);
        // Метроном: щелчок короткий и сам не перегрузит выход
        this.tickBus = ctx.createGain();
        this.tickBus.gain.value = params.volume;
        this.tickBus.connect(ctx.destination);

        // Шум для синтезированных всплесков — на случай, если запись шейкера не загрузилась
        this.noise = createNoiseBuffer(ctx, 2);

        // Свёрнутое приложение не должно звучать и тратить батарею
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) ctx.suspend().catch(() => {});
            else ctx.resume().catch(() => {});
        });
    }

    setMuted(muted) {
        this.muted = muted;
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        this.master.gain.setTargetAtTime(muted ? 0 : this.p.volume, t, 0.03);
        this.tickBus.gain.setTargetAtTime(muted ? 0 : this.p.volume, t, 0.03);
    }

    // Пока идёт ритм, жидкость звучит тише — щелчки метронома слышны сквозь тряску
    duck(on) {
        if (this.ctx) this.liquidBus.gain.setTargetAtTime(on ? this.p.duckLevel : 1, this.ctx.currentTime, 0.1);
    }

    // Загрузка записанных звуков; не загрузился — остаётся синтез. urls: { drop, shake }
    async loadSamples(urls) {
        if (!this.ctx) return;
        await Promise.all(Object.entries(urls).map(async ([key, url]) => {
            try {
                const response = await fetch(url);
                if (!response.ok) return;
                const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
                this.samples[key] = buffer;
                if (key === 'shake') this.shakeHits = findHits(buffer, this.p);
            } catch (e) {
                // Нет файла или формат не поддержан — работаем на синтезе
            }
        }));
    }

    // Браузер может держать звук на паузе до первого касания — вызывается по жесту пользователя
    resume() {
        // iOS после звонка или сворачивания ставит контекст в 'interrupted' — его тоже будим
        if (this.ctx && (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted')) this.ctx.resume().catch(() => {});
    }

    // Раз в кадр. impact — сила ударов жидкости о стенки
    update(impact) {
        const ctx = this.ctx;
        if (!ctx || ctx.state !== 'running' || this.muted) return;
        const p = this.p;
        const now = ctx.currentTime;

        if (impact > p.impactMin && now - this.lastSplash >= p.splashMinInterval) {
            this.lastSplash = now;
            const strength = Math.min(1, (impact - p.impactMin) / p.impactRef);
            if (this.shakeHits.length > 0) this.shakeHit(strength);
            else this.splash(strength);
        }
    }

    splash(strength) {
        const ctx = this.ctx;
        const now = ctx.currentTime;
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 350 + Math.random() * 900 + strength * 500;
        filter.Q.value = 1.1;
        const gain = ctx.createGain();
        const peak = 0.15 + 0.6 * strength;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(peak, now + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12 + 0.12 * strength);
        src.connect(filter).connect(gain).connect(this.liquidBus);
        src.start(now, Math.random() * 1.5);
        src.stop(now + 0.3);
    }

    // Кусок записи шейкера вокруг случайного удара; громкость выровнена по пику куска
    shakeHit(strength) {
        const ctx = this.ctx;
        const now = ctx.currentTime;
        const hit = this.shakeHits[(Math.random() * this.shakeHits.length) | 0];
        const length = this.p.shakeHitLength;
        const src = ctx.createBufferSource();
        src.buffer = this.samples.shake;
        src.playbackRate.value = 0.92 + Math.random() * 0.16; // Чуть разный тон — без эффекта "пулемёта"
        const gain = ctx.createGain();
        const level = Math.min(4, this.p.shakeHitVolume / hit.peak) * (0.35 + 0.65 * strength);
        gain.gain.setValueAtTime(level, now);
        gain.gain.setTargetAtTime(0, now + length * 0.6, length * 0.15);
        src.connect(gain).connect(this.liquidBus);
        src.start(now, Math.max(0, hit.time - 0.01), length);
    }

    // Капля упала в жидкость: тон падает сверху вниз + всплеск
    plop() {
        const ctx = this.ctx;
        if (!ctx || this.muted) return;
        const now = ctx.currentTime;
        if (this.samples.drop) {
            const src = ctx.createBufferSource();
            src.buffer = this.samples.drop;
            const gain = ctx.createGain();
            gain.gain.value = this.p.dropVolume;
            src.connect(gain).connect(this.master);
            src.start(now);
            return;
        }
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(750, now);
        osc.frequency.exponentialRampToValueAtTime(130, now + 0.16);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.55, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
        osc.connect(gain).connect(this.master);
        osc.start(now);
        osc.stop(now + 0.3);
        this.splash(0.7);
    }

    // Победа — восходящее арпеджио; рекорд — длиннее и выше
    win(isRecord) {
        const ctx = this.ctx;
        if (!ctx || this.muted) return;
        const notes = isRecord ? [523, 659, 784, 1047, 1319, 1568] : [523, 659, 784, 1047];
        const now = ctx.currentTime;
        notes.forEach((freq, i) => {
            const at = now + i * 0.09;
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.value = freq;
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.0001, at);
            gain.gain.exponentialRampToValueAtTime(0.35, at + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + (i === notes.length - 1 ? 0.6 : 0.18));
            osc.connect(gain).connect(this.master);
            osc.start(at);
            osc.stop(at + 0.7);
        });
    }

    // Задержка вывода звука (с): щелчок слышен позже, чем запланирован, — для синхронизации ритма.
    // Android WebView сообщает 0–4 мс, хотя на деле ~100 мс: неправдоподобно малое значение заменяем типичным
    // (точную задержку ударов всё равно подстраивает ритм — см. game/Rhythm.js)
    get outputLatency() {
        const reported = this.ctx ? Math.max(this.ctx.outputLatency || 0, this.ctx.baseLatency || 0) : 0;
        return reported >= MIN_PLAUSIBLE_LATENCY ? reported : TYPICAL_LATENCY;
    }

    // Щелчок метронома в момент wallTime (часы игры, с); accent — сильная доля (каждая четвёртая).
    // Тембр "деревянной коробочки": прямоугольная волна (много обертонов) через полосовой фильтр —
    // чистый тон тонет в шуме шейкера, а звонкий щелчок с резкой атакой пробивается сквозь него
    tick(wallTime, accent) {
        const ctx = this.ctx;
        if (!ctx || this.muted || ctx.state !== 'running') return;
        const at = ctx.currentTime + (wallTime - performance.now() / 1000);
        if (at < ctx.currentTime) return;
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = accent ? 2000 : 1500;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = accent ? 3000 : 2400;
        filter.Q.value = 1.5;
        const gain = ctx.createGain();
        const level = this.p.tickVolume * (accent ? 1.3 : 1);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(level, at + 0.001);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
        osc.connect(filter).connect(gain).connect(this.tickBus);
        osc.start(at);
        osc.stop(at + 0.05);
    }

    // Короткий звон; step — ступень (каждая на тон выше): рост комбо, появление звёзд
    chime(step) {
        const ctx = this.ctx;
        if (!ctx || this.muted) return;
        const now = ctx.currentTime;
        const freq = 660 * Math.pow(2, (step * 2) / 12);
        for (const [mult, level] of [[1, 0.28], [2, 0.08]]) {
            const osc = ctx.createOscillator();
            osc.type = mult === 1 ? 'triangle' : 'sine';
            osc.frequency.value = freq * mult;
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(level, now + 0.008);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
            osc.connect(gain).connect(this.master);
            osc.start(now);
            osc.stop(now + 0.45);
        }
    }

    lose() {
        const ctx = this.ctx;
        if (!ctx || this.muted) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(330, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.5);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.3, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
        osc.connect(gain).connect(this.master);
        osc.start(now);
        osc.stop(now + 0.65);
    }
}

function createNoiseBuffer(ctx, seconds) {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
}

// Нарезка записи на удары: огибающая громкости окнами по 10 мс; удар — локальный всплеск заметно
// громче фона. Возвращает самые сильные удары: { time, peak }
function findHits(buffer, p) {
    const data = buffer.getChannelData(0);
    const win = Math.max(1, Math.floor(buffer.sampleRate * 0.01));
    const env = new Float32Array(Math.floor(data.length / win));
    for (let w = 0; w < env.length; w++) {
        let sum = 0;
        for (let i = w * win, end = i + win; i < end; i++) sum += data[i] * data[i];
        env[w] = Math.sqrt(sum / win);
    }
    const sorted = Array.from(env).sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.5)];
    const minGap = Math.round(p.shakeHitMinGap / 0.01);
    const hits = [];
    let last = -Infinity;
    for (let w = 2; w < env.length - 2; w++) {
        const v = env[w];
        const isPeak = v > env[w - 1] && v >= env[w + 1] && v > floor * p.shakeHitContrast;
        if (!isPeak || w - last < minGap) continue;
        // Начало удара: откатываемся к моменту, где громкость ещё близка к фону
        let start = w;
        while (start > 0 && env[start - 1] > v * 0.3 && w - start < 8) start--;
        hits.push({ time: start * 0.01, peak: v });
        last = w;
    }
    hits.sort((a, b) => b.peak - a.peak);
    return hits.slice(0, p.shakeHitCount);
}
