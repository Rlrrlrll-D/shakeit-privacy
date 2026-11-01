import { LiquidSim } from './LiquidSim.js';
import { createRng } from '../util/rng.js';

// Игровая модель жидкости без Phaser: частицы, краска, реакция на движение телефона и прогресс смешивания.
// Сцена только рисует; модель можно гонять в тестах под Node.
//
// Оси телефона (Android): x — вправо, y — вверх по экрану. Оси игры: x — вправо, y — вниз.
// Жидкость в стакане чувствует ускорение телефона с обратным знаком (инерция):
// телефон дёрнули вверх — жидкость прижало ко дну, резко остановили — она взлетает.
//
// Окраска: СКОЛЬКО окрашено — решают встряхивания игрока, ГДЕ — физика.
//  - progress 0..1 растёт только от встряхиваний (addStrokes): каждое — порция, без случайности;
//    одинаковая тряска — одинаковое время;
//  - affinity — "близость к краске" у каждой частицы: начинается от места падения капли, переносится
//    вместе с жидкостью и расплывается по соседям. Окрашены частицы с наибольшей affinity, их доля = progress.
// Краска растекается по живой жидкости и следует за плесканием, а количество — ровно то, что натряс игрок.
// Две капли (level.dyes = 2) — два этапа: первая капля окрашивает жидкость целиком, затем падает вторая,
// и её краситель смешивается с первым (синий + жёлтый → зелёный). У каждого красителя своя близость,
// окрашенность частиц и прогресс; встряхивания идут в краситель текущего этапа (stage).
// Оттенок (level.shade, коктейль по образцам): цвет густеет по всей жидкости понемногу — каждая частица
// окрашена на долю progress одним красителем (цвет идёт по прямой от основы к итоговому, через образец);
// сразу после капель ближние к ним гуще, и каждое встряхивание выравнивает разницу (unevenness). Сам уровень не завершается — игрок решает, что цвет совпал с образцом.
// Стакан с перегородками: красится только открытый отсек — сначала тот, куда упала капля. Соседний
// открывается, когда в него перелилось достаточно окрашенной жидкости (OPEN_SHARE его объёма), и дальше
// красится тряской как обычно. Прогресс не выше доли жидкости в открытых отсеках (reach) — встряхивания
// сверх неё не засчитываются. Перегородка с пробкой (gate) глухая до потолка; когда прогресс упёрся
// в неё (свой отсек прокрашен), пробка вылетает и вверху открывается окошко — перелить наклоном.
// Этапы не смешиваются: сначала только тряска, потом перелив, потом снова тряска.
export class LiquidModel {
    // shape — форма стакана (physics/GlassShape.js) или null для прямоугольного
    constructor(glass, liquid, level, shape = null) {
        this.cfg = liquid;
        this.level = level;
        this.count = liquid.particleCount;
        // Фигурный стакан: жидкость занимает не больше доли shape.fill его площади (в узких бокалах частиц
        // меньше). Скорость окраски от этого не зависит — она считается по встряхиваниям
        if (shape) {
            const cell = (liquid.particleRadius * 2) ** 2 * 0.866; // Площадь частицы в плотной укладке
            this.count = Math.min(this.count, Math.round((shape.fill * shape.area) / cell));
        }

        const n = this.count;
        const r = liquid.particleRadius;
        // Своя случайность с фиксированным зерном: каждый заезд начинается одинаково — честные рекорды
        const rng = this.rng = createRng(level.seed);
        // Перегородки уровня (levels.js, walls): доли ширины и высоты стакана → px
        this.walls = (level.walls || []).map((w) => {
            const top = glass.y + glass.height * (1 - w.height);
            // С пробкой стенка до открытия — до самого потолка (выше стакана: частицы не перелетят)
            return { x: glass.x + glass.width * w.x, top: w.gate ? glass.y - r * 4 : top, openTop: top, gate: !!w.gate, half: WALL_HALF };
        });
        this.gateOpened = false; // Пробка вылетела в этом кадре — для эффектов сцены
        this.chamberOpened = false; // Отсек открылся в этом кадре
        const chambers = this.walls.length + 1;
        this.chamberOpen = new Uint8Array(chambers);
        this.chamberSize = new Int32Array(chambers);
        this.chamberDyed = new Int32Array(chambers);
        this.sim = new LiquidSim({ ...liquid, count: n, radius: r, bounds: glass, walls: this.walls, shape, rng });
        this.reach = 1;       // Доля жидкости, до которой дошла краска (без перегородок — вся)

        this.mix = new Float32Array(n);      // Видимая окрашенность частицы: 0 — исходный цвет, 1 — целевой
        this.affinity = new Float32Array(n); // Близость к краске: кто окрасится следующим
        // Второй краситель: те же величины своим набором
        this.dual = level.dyes === 2;
        if (this.dual) {
            this.mix2 = new Float32Array(n);
            this.affinity2 = new Float32Array(n);
        }
        this.stage = 0;        // Этап: 0 — первый краситель, 1 — второй
        this.progress2 = 0;    // Прогресс второго красителя
        this.firstColored = false; // Первый краситель окрасил всё — пора второй капле
        this.unevenness = SHADE_UNEVEN; // Оттенок: насколько неровен цвет (выравнивается тряской)
        this.sorted = new Float32Array(n);   // Рабочий массив для порога окраски — без выделения памяти в кадре

        this.dyed = false;
        this.progress = 0;
        this.allColored = false;
        this.impact = 0;      // Для звука и вибрации: сила ударов о стенки за кадр на частицу (px/с); на физику не влияет

        // Стартовая укладка сотами от дна — без наложений. Случайная россыпь налезает частицами друг
        // на друга, и физика в первые кадры расталкивает их взрывом брызг. Лёгкий сдвиг — чтобы не было
        // идеальной решётки, которая стоит "кристаллом"
        if (shape) {
            this.fillShape(shape, r, rng);
            return;
        }
        const d = r * 2;
        const rowHeight = d * 0.87;
        const perRow = Math.floor((glass.width - d) / d);
        // Шаг чуть больше диаметра: ряды, в том числе сдвинутые на полчастицы, — от стенки до стенки,
        // без зазора у края, куда жидкость стекала бы в первые секунды
        const spacing = (glass.width - d - r) / (perRow - 1);
        const bottom = glass.y + glass.height - r;
        // Неполный верхний ряд растягивается на всю ширину — поверхность ровная, без ступеньки
        const lastRow = Math.floor((n - 1) / perRow);
        const lastCount = n - lastRow * perRow;
        for (let i = 0; i < n; i++) {
            const row = Math.floor(i / perRow);
            const col = i % perRow;
            const x = row === lastRow && lastCount < perRow
                ? glass.x + r + (col + 0.5) * (glass.width - d) / lastCount
                : glass.x + r + (row % 2 === 0 ? 0 : r) + col * spacing;
            this.sim.setPosition(i, x + (rng() - 0.5) * r * 0.2, bottom - row * rowHeight);
        }
    }

    // Та же укладка сотами от дна, но в форме: в каждом ряду — сколько помещается между стенками на этой
    // высоте; неполный верхний ряд растянут на всю ширину
    fillShape(shape, r, rng) {
        const d = r * 2;
        const rowHeight = d * 0.87;
        let placed = 0;
        for (let y = shape.bottom - r * 1.2; placed < this.count && y > shape.top + r; y -= rowHeight) {
            const half = Math.min(shape.halfWidthAt(y - r), shape.halfWidthAt(y), shape.halfWidthAt(y + r)) - r * 1.1;
            if (half <= 0) continue;
            const fit = Math.floor((half * 2) / d) + 1;
            const take = Math.min(fit, this.count - placed);
            for (let k = 0; k < take; k++) {
                const x = take === 1 ? shape.cx : shape.cx - half + (k * half * 2) / (take - 1);
                this.sim.setPosition(placed++, x + (rng() - 0.5) * r * 0.2, y);
            }
        }
    }

    // Капля краски: близость к краске убывает от точки удара; ближайшие частицы окрашены сразу и разлетаются.
    // second — капля второго красителя
    addDye(x, y, second = false) {
        const { sim, count, level } = this;
        // Оттенок: обе капли — один краситель, близость — к ближайшей из них
        const merge = second && level.shade;
        const affinity = second && !merge ? this.affinity2 : this.affinity;
        const spread = level.affinitySpread;
        const order = new Array(count);
        const dist = new Float32Array(count);
        const chamber = this.chamberOf(x);
        this.chamberOpen[chamber] = 1;
        for (let i = 0; i < count; i++) {
            dist[i] = Math.hypot(sim.x[i] - x, sim.y[i] - y);
            // За перегородкой краски нет совсем — она придёт только с жидкостью
            const near = this.chamberOf(sim.x[i]) === chamber ? Math.exp(-dist[i] / spread) : 0;
            affinity[i] = merge ? Math.max(affinity[i], near) : near;
            order[i] = i;
        }
        order.sort((a, b) => dist[a] - dist[b]);
        const splashed = Math.max(1, Math.round(count * level.dyeFraction));
        for (let k = 0; k < splashed; k++) {
            const i = order[k];
            const d = dist[i] || 1;
            sim.vx[i] += (sim.x[i] - x) / d * level.splashVelocity;
            sim.vy[i] += Math.abs(sim.y[i] - y) / d * level.splashVelocity;
        }

        this.dyed = true;
        if (second && level.shade) {
            // Оттенок: оба красителя густеют вместе, этапов нет
        } else if (second) {
            this.stage = 1;
            this.progress2 = level.dyeFraction;
        } else {
            this.progress = level.dyeFraction;
        }
        this.updateReach();
        this.updateColors(1);
    }

    // Номер отсека по x: сколько перегородок левее
    chamberOf(x) {
        let n = 0;
        for (const wall of this.walls) if (x > wall.x) n++;
        return n;
    }

    // Отсеки: сколько в каждом жидкости и сколько окрашенной; открытие отсека — навсегда.
    // reach — доля жидкости в открытых отсеках
    updateReach() {
        if (this.walls.length === 0) return;
        const { chamberOpen: open, chamberSize: size, chamberDyed: dyed } = this;
        size.fill(0);
        dyed.fill(0);
        const x = this.sim.x;
        for (let i = 0; i < this.count; i++) {
            const c = this.chamberOf(x[i]);
            size[c]++;
            if (this.mix[i] >= DYED_MIX) dyed[c]++;
        }
        let inOpen = 0;
        for (let c = 0; c < open.length; c++) {
            if (!open[c] && dyed[c] >= size[c] * OPEN_SHARE) {
                open[c] = 1;
                this.chamberOpened = true;
            }
            if (open[c]) inOpen += size[c];
        }
        this.reach = inOpen / this.count;
    }

    // Прогресс упёрся в доступную краске жидкость — пора переливать
    get blocked() {
        return this.reach < 1 && this.progress >= this.reach - 0.005;
    }

    // Встряхивания: каждое — порция прогресса, умноженная на его силу (0..1)
    addStrokes(power) {
        if (!this.dyed || power <= 0) return;
        if (this.level.shade) this.unevenness *= Math.pow(SHADE_EVEN_PER_STROKE, power);
        if (this.stage === 1) this.progress2 = Math.min(1, this.progress2 + power * this.level.portion);
        else this.progress = Math.min(this.reach, this.progress + power * this.level.portion);
    }


    // input: { impulseX, impulseY, impulseZ } — приращение скорости телефона за кадр (м/с) без гравитации,
    //        { gravityX, gravityY } — гравитация в осях телефона (м/с²), intensity — 0..1
    applyShake(input, dt) {
        const c = this.cfg;
        const sim = this.sim;

        if (c.tiltGravity) this.applyTilt(input.gravityX, input.gravityY);

        // Тишина: телефон держат неподвижно — после паузы в QUIET_AFTER секунд сопротивление плавно растёт
        // до settle от обычного. Так вода вольно плещет под тряской и быстро успокаивается, а не качается
        // десять секунд (энергия волны при обычном сопротивлении 0.94 вдвое падает только за ~10 с)
        // Затих — по самому толчку за кадр, а не по сглаженной интенсивности: та падает с постоянной времени
        // 0.5 с и до порога доползала секунды за полторы, и вода успокаивалась с большим опозданием
        const moving = Math.abs(input.impulseX) + Math.abs(input.impulseY) + Math.abs(input.impulseZ) > QUIET_IMPULSE;
        this.quietTime = moving ? 0 : (this.quietTime || 0) + dt;
        const settle = c.settle ?? 1;
        const t = Math.min(1, Math.max(0, (this.quietTime - QUIET_AFTER) / QUIET_RAMP));
        sim.dampScale = 1 - (1 - settle) * t * t * (3 - 2 * t);

        let ix = -input.impulseX * c.inertiaGain;
        // Движение "на экран" (ось z телефона) в плоском стакане не видно — в настоящем шейкере жидкость
        // бьётся о переднюю и заднюю стенки и взлетает. Показываем это как вертикальную тряску:
        // телефон рванул к игроку — жидкость прижало ко дну, затормозил — подбросило
        let iy = (input.impulseY + input.impulseZ * c.depthGain) * c.inertiaGain;
        // Игровое преувеличение: прижимание ко дну слабее подбрасывания — жидкость дольше летает по стакану
        if (iy > 0) iy *= c.inertiaDownScale;
        // Предел толчка за кадр: при очень сильной тряске жидкость не прилипает к потолку
        const impulse = Math.sqrt(ix * ix + iy * iy);
        if (impulse > c.maxImpulse) {
            const k = c.maxImpulse / impulse;
            ix *= k;
            iy *= k;
        }
        const jitter = input.intensity * c.jitter * dt;
        if (ix === 0 && iy === 0 && jitter < 1) return;

        // Масса движется за телефоном единым целым; небольшой разброс отклика частиц лишь разбивает
        // идеально жёсткое движение на живые брызги
        const { vx, vy } = sim;
        const rng = this.rng;
        const [lo, hi] = c.inertiaSpread;
        const range = hi - lo;
        for (let i = 0; i < this.count; i++) {
            const r = lo + rng() * range;
            vx[i] += ix * r + (rng() - 0.5) * jitter;
            vy[i] += iy * r + (rng() - 0.5) * jitter;
        }
    }

    // Жидкость стекает по наклону. Телефон лежит плашмя — проекция гравитации на экран мала,
    // тогда плавно возвращаемся к "вниз по экрану", чтобы жидкость не зависла в невесомости
    applyTilt(gx, gy) {
        const c = this.cfg;
        // Сила тяжести направлена против показаний датчика; ось y игры перевёрнута относительно телефона
        let dx = -gx;
        let dy = gy;
        const planar = Math.sqrt(dx * dx + dy * dy);
        const w = Math.min(1, Math.max(0, (planar - c.tiltMinGravity) / c.tiltBlend));
        if (planar > 0) {
            dx = dx / planar * w;
            dy = dy / planar * w + (1 - w);
        } else {
            dx = 0;
            dy = 1;
        }
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        this.sim.gravityX = dx / len * c.gravity;
        this.sim.gravityY = dy / len * c.gravity;
    }

    step(dt) {
        const sim = this.sim;
        sim.impact = 0;
        sim.step(dt);
        this.impact = sim.impact / this.count;

        if (!this.dyed) return;
        // Близость к краске расплывается по соседям (и быстрее, где жидкость бурлит) — краска течёт
        const l = this.level;
        sim.spread(this.affinity, dt, l.affinityDiffusion, l.affinityTurbulence, l.affinityNoiseSpeed, 1);
        if (this.stage === 1 || (this.dual && l.shade)) sim.spread(this.affinity2, dt, l.affinityDiffusion, l.affinityTurbulence, l.affinityNoiseSpeed, 1);
        this.chamberOpened = false;
        this.updateReach();
        this.gateOpened = false;
        if (this.blocked) {
            for (const wall of this.walls) {
                if (wall.gate && wall.top !== wall.openTop) {
                    wall.top = wall.openTop;
                    this.gateOpened = true;
                }
            }
        }
        this.updateColors(dt);
    }

    // Окрашены частицы с наибольшей близостью к краске, их доля = progress; граница — мягкий фронт.
    // Видимый цвет догоняет целевой за доли секунды: каждое встряхивание заметно двигает фронт
    updateColors(dt) {
        if (this.level.shade) {
            this.shadeChannel(this.affinity, this.mix, dt);
            if (this.dual) this.shadeChannel(this.affinity2, this.mix2, dt);
            this.allColored = false;
            return;
        }
        // Окраска пересчитывается каждый кадр; готовность — только когда прогресс дошёл до конца
        const colored = this.colorChannel(this.affinity, this.mix, this.progress, dt);
        const done = this.progress >= 1 && colored === this.count;
        if (!this.dual) {
            this.allColored = done;
            return;
        }
        this.firstColored = done;
        const colored2 = this.colorChannel(this.affinity2, this.mix2, this.progress2, dt);
        this.allColored = this.stage === 1 && this.progress2 >= 1 && colored2 === this.count;
    }

    // Оттенок: окрашенность частицы — progress × (1 ± unevenness по близости к каплям), в среднем — ровно progress
    shadeChannel(affinity, mix, dt) {
        let max = 0;
        let sum = 0;
        for (let i = 0; i < this.count; i++) {
            if (affinity[i] > max) max = affinity[i];
            sum += affinity[i];
        }
        const inv = max > 0 ? 1 / max : 0;
        // Отклонение от среднего: неровность не сдвигает средний цвет — он всегда на образцовой шкале
        const mean = sum / this.count * inv;
        const k = 1 - Math.exp(-dt * this.level.colorRate);
        const u = this.unevenness;
        for (let i = 0; i < this.count; i++) {
            const target = Math.min(1, Math.max(0, this.progress * (1 + u * 2 * (affinity[i] * inv - mean))));
            mix[i] += (target - mix[i]) * k;
        }
    }

    // Следующий ингредиент коктейля: жидкость снова чистая
    resetDye() {
        this.mix.fill(0);
        this.affinity.fill(0);
        if (this.dual) {
            this.mix2.fill(0);
            this.affinity2.fill(0);
        }
        this.progress = 0;
        this.progress2 = 0;
        this.stage = 0;
        this.dyed = false;
        this.firstColored = false;
        this.allColored = false;
        this.unevenness = SHADE_UNEVEN;
    }

    // Один краситель: возвращает, сколько частиц им окрашено
    colorChannel(affinity, mix, progress, dt) {
        const { count, sorted, level } = this;

        let tauLo = Infinity;
        let tauHi = Infinity;
        if (progress >= 1) {
            tauLo = tauHi = -Infinity;
        } else if (progress > 0) {
            sorted.set(affinity);
            sorted.sort(); // По возрастанию: окрашенные — в конце массива
            const edge = count * (1 - progress);
            const half = count * level.frontWidth * 0.5;
            tauLo = sorted[Math.max(0, Math.min(count - 1, Math.floor(edge - half)))];
            tauHi = sorted[Math.max(0, Math.min(count - 1, Math.floor(edge + half)))];
        }

        const k = 1 - Math.exp(-dt * level.colorRate);
        const full = level.coloredAt;
        let colored = 0;
        for (let i = 0; i < count; i++) {
            const a = affinity[i];
            let target;
            if (a >= tauHi) target = 1;
            else if (a <= tauLo) target = 0;
            else target = (a - tauLo) / (tauHi - tauLo);
            mix[i] += (target - mix[i]) * k;
            if (mix[i] >= full) colored++;
        }
        return colored;
    }

    // Видимый цвет частицы 0..1 (второй краситель — colorLevel2)
    colorLevel(i) {
        return this.mix[i];
    }

    colorLevel2(i) {
        return this.mix2[i];
    }
}

const WALL_HALF = 8;      // px: полутолщина перегородки — частицы по разные стороны не касаются
const DYED_MIX = 0.5;     // Видимая окрашенность, с которой частица — окрашенная жидкость (для отсеков)
const OPEN_SHARE = 0.2;   // Отсек открывается, когда в нём столько окрашенной жидкости (доля его объёма)
const QUIET_IMPULSE = 0.06;     // м/с за кадр (~3.6 м/с²): слабее — телефон считается неподвижным
const QUIET_AFTER = 0.3;        // с тишины, после которых сопротивление начинает расти (паузы между ударами короче)
const QUIET_RAMP = 0.6;         // с, за которые оно доходит до settle
const SHADE_UNEVEN = 0.9;          // Оттенок: неровность цвета сразу после капель (±90% у ближних/дальних)...
const SHADE_EVEN_PER_STROKE = 0.95; // ...после каждого полноценного встряхивания остаётся столько от неё
