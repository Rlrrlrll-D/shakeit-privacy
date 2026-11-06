// Волна на поверхности: уравнения мелкой воды поверх частиц. Только для отрисовки, физику не меняет.
//
// Частицы честно считают, куда идёт масса, но верхний ряд у них зернистый: поверхность складывается из
// отдельных частиц и волна по ней не бежит единым фронтом. Здесь поверхность ведётся как слой столбцов:
//
//   dq/dt = H·(gt − gn·dη/dx) − трение    расход через грань столбца
//   dη/dt = −dq/dx + κ·(η частиц − η)     уровень столбца, притянутый к тому, что показывают частицы
//
// Вода между столбцами переходит только через грани, поэтому волна бежит и отражается от стенок как
// настоящая, а тяжесть наклоняет уровень ровно на угол телефона. Глубина H — с поправкой на глубокую
// воду, иначе стакан качался бы быстрее настоящего. Притягивание держит слой на массе: он сглаживает
// и ведёт её верх, но не живёт отдельно.
//
// Уравнения верны, пока жидкость лежит на дне. В сильной тряске масса летает, поэтому вклад слоя
// плавно уходит в ноль по средней скорости частиц, и картинка показывает частицы как есть.
const COLUMN = 20;       // px: ширина столбца
const STEP = 1 / 240;    // с: шаг уравнений, от частоты кадров не зависит
const MAX_STEPS = 12;    // Не больше шагов за кадр: после паузы слой не догоняет потерянное время
const CALM_SPEED = 90;   // px/с: средняя скорость частиц, ниже которой слой работает в полную силу...
const WILD_SPEED = 300;  // ...а выше этой выключен
const REACH = 54;        // px: на такую глубину от поверхности частицы следуют за слоем
const HEADROOM = 16;     // px: столбец со стенкой ближе этого над поверхностью не свободен: верх жидкости
                         // там упирается в стекло

export class SurfaceWaves {
    // bounds — прямоугольник стакана, shape — форма (или null), count — число частиц
    constructor(bounds, shape, count, { damping = 0.5, viscosity = 500, follow = 5 } = {}) {
        this.left = bounds.x;
        this.right = bounds.x + bounds.width;
        this.top = bounds.y;
        this.bottom = shape ? shape.bottom : bounds.y + bounds.height;
        this.shape = shape;
        this.damping = damping;
        this.viscosity = viscosity;
        this.follow = follow;
        const n = this.n = Math.ceil(bounds.width / COLUMN);
        this.dx = bounds.width / n;
        this.eta = new Float32Array(n);       // Высота поверхности столбца (вверх — плюс), px от верха стакана
        this.seen = new Float32Array(n);      // Что показывают частицы
        this.raw = new Float32Array(n);
        this.shift = new Float32Array(n + 1); // Сдвиг частиц: узлы по границам столбцов
        this.free = new Uint8Array(n);        // Столбец со свободной поверхностью
        this.was = new Uint8Array(n);         // Был свободным в прошлом шаге: у вернувшегося уровень берётся у частиц
        this.q = new Float32Array(n + 1);     // Расход через грани; крайние — стенки
        this.lap = new Float32Array(n + 1);
        this.x = null;
        this.y = new Float32Array(count);
        this.count = count;
        this.acc = 0;
        this.weight = 0;
        this.ready = false;
        this.force = null;   // Для сравнения вариантов: 0 — слой выключен, 1 — в полную силу
    }

    // Верх массы по столбцам: наивысшая частица в окрестности столбца. Окрестность — два столбца,
    // иначе столбец между рядами частиц ловил бы частицу ниже и на поверхности появлялась бы зазубрина
    measure(x, y) {
        const { n, dx, left, raw, seen, free, shape, count } = this;
        raw.fill(-Infinity);
        for (let i = 0; i < count; i++) {
            const u = (x[i] - left) / dx - 0.5;
            const a = Math.floor(u);
            const h = -y[i];
            if (a >= 0 && a < n && h > raw[a]) raw[a] = h;
            if (a + 1 >= 0 && a + 1 < n && h > raw[a + 1]) raw[a + 1] = h;
        }
        for (let c = 0; c < n; c++) {
            let on = raw[c] > -Infinity;
            if (on && shape) {
                const cx = left + (c + 0.5) * dx;
                on = shape.distance(cx, -raw[c] - HEADROOM) > 0;
            }
            free[c] = on ? 1 : 0;
        }
        // Лёгкое сглаживание вдоль поверхности: зерно верхнего ряда — не волна
        for (let c = 0; c < n; c++) {
            if (!free[c]) { seen[c] = raw[c]; continue; }
            const l = c > 0 && free[c - 1] ? raw[c - 1] : raw[c];
            const r = c < n - 1 && free[c + 1] ? raw[c + 1] : raw[c];
            seen[c] = (l + 2 * raw[c] + r) / 4;
        }
    }

    // Один шаг уравнений. Грань между несвободными столбцами закрыта: вода через стекло не течёт
    solve(gn, gt, depth) {
        const { n, dx, q, eta, lap, free, seen } = this;
        const h = STEP;
        const decay = Math.exp(-this.damping * h);
        const nu = this.viscosity * h / (dx * dx);
        const pull = 1 - Math.exp(-this.follow * h);
        for (let f = 1; f < n; f++) lap[f] = q[f - 1] - 2 * q[f] + q[f + 1];
        for (let f = 1; f < n; f++) {
            if (!free[f - 1] || !free[f]) { q[f] = 0; continue; }
            q[f] += h * depth * (gt - gn * (eta[f] - eta[f - 1]) / dx);
            q[f] = (q[f] + nu * lap[f]) * decay;
        }
        for (let c = 0; c < n; c++) {
            // Пустой столбец уровня не имеет: seen там -Infinity, и копировать его в eta нельзя —
            // когда в столбец вернётся жидкость, уровень остался бы бесконечным, а позиции частиц
            // ушли бы в NaN (жидкость пропадала целиком на несколько кадров). Столбец помним как
            // «не был свободен» и при возврате берём то, что видят частицы
            if (!free[c]) { this.was[c] = 0; continue; }
            if (!this.was[c]) { eta[c] = seen[c]; this.was[c] = 1; continue; }
            eta[c] += -h * (q[c + 1] - q[c]) / dx + (seen[c] - eta[c]) * pull;
        }
    }

    // Возвращает положения для отрисовки: себя (x, y) — как DrawPositions
    update(draw, sim, dt) {
        const { n, eta, seen, free, shift, count } = this;
        const x = this.x = draw.x;
        const y = draw.y;
        this.measure(x, y);
        if (!this.ready) {
            eta.set(seen);
            this.ready = true;
        }

        // Ширина свободной поверхности и глубина задают волну: тот же стакан качается по-разному
        // при разном уровне (поправка на глубокую воду: H = tanh(kD)/k)
        let width = 0, level = 0;
        for (let c = 0; c < n; c++) if (free[c]) { width += this.dx; level += seen[c]; }
        if (width > 0) {
            level /= width / this.dx;
            const k = Math.PI / width;
            const depthAll = Math.max(1, this.bottom + level);
            const depth = Math.tanh(k * depthAll) / k;
            const g = Math.hypot(sim.gravityX, sim.gravityY);
            const gn = Math.max(g * 0.2, sim.gravityY);
            this.acc = Math.min(this.acc + dt, MAX_STEPS * STEP);
            while (this.acc >= STEP) {
                this.acc -= STEP;
                this.solve(gn, sim.gravityX, depth);
            }
        }

        // Вклад слоя — по тому, насколько масса спокойна
        const { vx, vy } = sim;
        let energy = 0;
        for (let i = 0; i < count; i++) energy += vx[i] * vx[i] + vy[i] * vy[i];
        const speed = Math.sqrt(energy / count);
        const t = Math.min(1, Math.max(0, (speed - CALM_SPEED) / (WILD_SPEED - CALM_SPEED)));
        this.weight = this.force !== null ? this.force : 1 - t * t * (3 - 2 * t);

        // Сдвиг в узлах по границам столбцов; между ними — линейно
        for (let k = 0; k <= n; k++) {
            const a = k > 0 ? k - 1 : 0;
            const b = k < n ? k : n - 1;
            const sa = free[a] ? eta[a] - seen[a] : 0;
            const sb = free[b] ? eta[b] - seen[b] : 0;
            shift[k] = (sa + sb) / 2;
        }
        const out = this.y;
        const left = this.left, dx = this.dx, w = this.weight;
        if (w <= 0) {
            out.set(y.subarray(0, count));
            return this;
        }
        for (let i = 0; i < count; i++) {
            const u = Math.max(0, Math.min(n - 0.001, (x[i] - left) / dx));
            const c = u | 0;
            const f = u - c;
            const s = shift[c] + (shift[c + 1] - shift[c]) * f;
            // Глубина частицы под поверхностью своего столбца: верх следует за слоем целиком, глубже — всё меньше
            const under = (free[c] ? seen[c] : -y[i]) + y[i];
            const fade = under >= REACH ? 0 : 1 - under / REACH;
            const moved = y[i] - s * fade * w;
            // Последний рубеж: нечисловое положение означало бы пропавшую частицу — рисуем как есть
            out[i] = moved === moved && moved > -1e5 && moved < 1e5 ? moved : y[i];
        }
        return this;
    }
}
