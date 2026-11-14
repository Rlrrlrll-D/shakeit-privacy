// Форма стакана для физики: настоящие изогнутые стенки вместо прямоугольника. Без Phaser.
//
// Форма — профиль левой стенки внутренности: опорные точки [доля полуширины прямоугольника стакана,
// доля высоты внутренности от верха], от ободка вниз до центра дна (0, 1). Через точки проходит гладкая
// кривая (сплайн Катмулла — Рома, затем сглаживание кривизны): S-образные изгибы без изломов — даже
// в бликах на стекле. В центре дна кривая подходит к оси горизонтально — дно круглое, без «V». Пропорции — по настоящим бокалам
// (харрикейн Libbey Squall, поко гранде, рокс с тяжёлым дном). Внутренность занимает верхнюю долю height
// прямоугольника, ниже — толстое дно или ножка (рисуются стеклом). Сверху стакан закрыт, как и
// прямоугольный: телефон — это шейкер.
//
// Для столкновений один раз строится поле расстояний до стенок (SDF) на сетке с шагом CELL: в узле —
// расстояние до ближайшей стенки (внутри положительное) и направление от неё внутрь. Частица ближе
// своего радиуса к стенке выталкивается по этому направлению — так же дёшево, как прямоугольник,
// но для любой формы. Поле считается один раз на форму и размер стакана и запоминается.
const CELL = 3;          // px: шаг сетки поля расстояний
const NEAR = 64;         // px: дальше от стенки точное расстояние не нужно — частица её не касается
const SEGMENT_STEPS = 48; // Точек кривой на участок между опорными точками
const ASPECT_X = 320;    // Сглаживание — в пикселях опорного стакана: полуширина…
const ASPECT_Y = 1000;   // …и высота внутренности
const SMOOTH_STEP = 2;   // px: шаг точек при сглаживании
const SMOOTH_SIGMA = 26; // px: ширина сглаживания кривизны
const TABLE = 2048;      // Таблица полуширины по высоте

export const GLASS_SHAPES = {
    // Харрикейн: раструб шириной с чашу, тонкая талия, круглая чаша; ниже — короткая толстая ножка
    hurricane: {
        height: 0.86,
        points: [[0.9, 0], [0.72, 0.19], [0.57, 0.42], [0.8, 0.63], [0.93, 0.78], [0.86, 0.91], [0.56, 0.985], [0, 1]]
    },
    // Тюльпан (поко гранде, классика для пина колады): ободок уже чаши, чаша-яйцо, мягко сходится
    // к ножке
    tulip: {
        height: 0.78,
        points: [[0.74, 0], [0.84, 0.12], [0.94, 0.38], [0.88, 0.64], [0.62, 0.86], [0.28, 0.98], [0, 1]]
    },
    // Рокс: широкий, прямые стенки сужаются книзу, плоское дно со скруглёнными углами, тяжёлое дно
    rocks: {
        height: 0.8,
        points: [[0.97, 0], [0.86, 0.78], [0.83, 0.93], [0.76, 0.99], [0.58, 1], [0, 1]]
    },
    // Банка (мейсон): горлышко с резьбой, покатые плечики, прямое тело, скруглённое дно
    jar: {
        height: 0.92,
        points: [[0.78, 0], [0.78, 0.06], [0.86, 0.12], [0.95, 0.19], [0.96, 0.32], [0.96, 0.84], [0.92, 0.95], [0.72, 0.995], [0, 1]]
    },
    // Гранёный стакан: гладкий ободок сверху, ниже грани, сужается книзу, толстое дно
    faceted: {
        height: 0.88,
        points: [[0.95, 0], [0.93, 0.12], [0.9, 0.22], [0.83, 0.88], [0.79, 0.96], [0.6, 0.997], [0, 1]]
    },
    // Пилснер: высокий конус, расширяется кверху, внизу — тяжёлая подставка
    pilsner: {
        height: 0.88,
        points: [[0.95, 0], [0.88, 0.28], [0.72, 0.64], [0.54, 0.88], [0.42, 0.97], [0.22, 0.997], [0, 1]]
    },
    // Гоблет: глубокая чаша-«U» на короткой ножке
    goblet: {
        height: 0.76,
        points: [[0.92, 0], [0.92, 0.22], [0.88, 0.52], [0.74, 0.8], [0.46, 0.95], [0.18, 0.997], [0, 1]]
    },
    // Бочонок: выпуклые бока, сужается к ободку и к дну, обручи — в рисунке стекла
    barrel: {
        height: 0.92,
        points: [[0.82, 0], [0.9, 0.16], [0.96, 0.44], [0.93, 0.74], [0.85, 0.93], [0.64, 0.995], [0, 1]]
    },
    // Коллинз: высокий узкий, прямые стенки, тяжёлое дно
    collins: {
        height: 0.9,
        points: [[0.8, 0], [0.78, 0.5], [0.76, 0.9], [0.71, 0.98], [0.5, 1], [0, 1]]
    },
    // Мартини: широкий конус на тонкой высокой ножке, у дна чуть скруглён. Жидкости меньше: у конуса
    // половина площади наверху, иначе для плеска не осталось бы места
    martini: {
        height: 0.66,
        fill: 0.36,
        points: [[0.98, 0], [0.76, 0.24], [0.48, 0.56], [0.24, 0.84], [0.1, 0.96], [0.03, 0.995], [0, 1]]
    },
    // Абсентный бокал: конус сужается к шейке, под ней — шарик-резервуар; на ножке
    absinthe: {
        height: 0.8,
        fill: 0.42,
        points: [[0.84, 0], [0.74, 0.28], [0.56, 0.58], [0.4, 0.76], [0.3, 0.83], [0.4, 0.9], [0.38, 0.96], [0.18, 0.996], [0, 1]]
    },
    // Снифтер (коньячный): широкая чаша-шар, узкое горлышко, короткая ножка
    snifter: {
        height: 0.8,
        points: [[0.6, 0], [0.72, 0.08], [0.9, 0.3], [0.96, 0.52], [0.88, 0.76], [0.62, 0.93], [0.26, 0.995], [0, 1]]
    }
};

const cache = new Map();

// Форма по имени для прямоугольника стакана; null — обычный прямоугольный стакан
export function glassShape(name, rect) {
    const spec = GLASS_SHAPES[name];
    if (!spec) return null;
    const key = `${name}:${rect.x},${rect.y},${rect.width},${rect.height}`;
    if (!cache.has(key)) cache.set(key, new GlassShape(spec, rect));
    return cache.get(key);
}

// Профиль внутренности в долях: плотная ломаная левой стенки [x, y] от ободка до центра дна
export function profileCurve(points) {
    const n = points.length;
    // 1. Кривая через точки — центростремительный сплайн Катмулла — Рома (без петель и выбросов).
    // Мнимые точки по краям: над ободком — продолжение стенки, за дном — зеркало предпоследней точки
    // через ось (кривая подходит к центру дна горизонтально, дно круглое)
    const first = [2 * points[0][0] - points[1][0], 2 * points[0][1] - points[1][1]];
    const last = [-points[n - 2][0], points[n - 2][1]];
    const all = [first, ...points, last];
    const dense = [];
    for (let i = 1; i < all.length - 2; i++) {
        const segment = catmullRom(all[i - 1], all[i], all[i + 1], all[i + 2]);
        for (let k = i === 1 ? 0 : 1; k <= SEGMENT_STEPS; k++) dense.push(segment(k / SEGMENT_STEPS));
    }
    // 2. Сглаживание кривизны: у этого сплайна кривизна на опорных точках меняется скачком, и блики
    // на стекле выдают каждый скачок «переломом». Равномерно по длине (в пикселях опорного стакана)
    // и гауссово сглаживаем; за ободком кривая продолжается своим отражением, за дном — зеркалом
    // через ось. Форма почти не меняется, излом размывается
    const px = dense.map(([x, y]) => [x * ASPECT_X, y * ASPECT_Y]);
    const lengths = [0];
    for (let i = 1; i < px.length; i++) lengths.push(lengths[i - 1] + Math.hypot(px[i][0] - px[i - 1][0], px[i][1] - px[i - 1][1]));
    const total = lengths[lengths.length - 1];
    const count = Math.ceil(total / SMOOTH_STEP);
    const even = [];
    for (let k = 0, j = 0; k <= count; k++) {
        const at = (k / count) * total;
        while (j < px.length - 2 && lengths[j + 1] < at) j++;
        const f = (at - lengths[j]) / (lengths[j + 1] - lengths[j] || 1);
        even.push([px[j][0] + (px[j + 1][0] - px[j][0]) * f, px[j][1] + (px[j + 1][1] - px[j][1]) * f]);
    }
    const reach = Math.ceil((SMOOTH_SIGMA * 3) / SMOOTH_STEP);
    const pointAt = (i) => {
        if (i < 0) return [2 * even[0][0] - even[-i][0], 2 * even[0][1] - even[-i][1]];
        if (i > count) return [-even[2 * count - i][0], even[2 * count - i][1]];
        return even[i];
    };
    const weights = [];
    for (let d = -reach; d <= reach; d++) weights.push(Math.exp(-((d * SMOOTH_STEP) ** 2) / (2 * SMOOTH_SIGMA ** 2)));
    const out = [];
    for (let i = 0; i <= count; i++) {
        let sx = 0, sy = 0, sw = 0;
        for (let d = -reach; d <= reach; d++) {
            const [x, y] = pointAt(i + d);
            const w = weights[d + reach];
            sx += x * w;
            sy += y * w;
            sw += w;
        }
        out.push([sx / sw / ASPECT_X, sy / sw / ASPECT_Y]);
    }
    // Ободок — точно на месте (сглаживание его чуть стягивает), стенка не нависает, дно — в центре
    out[0] = [points[0][0], 0];
    for (let i = 1; i < out.length; i++) out[i][1] = Math.min(1, Math.max(out[i][1], out[i - 1][1]));
    out[out.length - 1] = [0, 1];
    return out;
}

export class GlassShape {
    constructor(spec, rect) {
        this.rect = rect;
        this.cx = rect.x + rect.width / 2;
        this.top = rect.y;
        this.bottom = rect.y + rect.height * spec.height; // Дно внутренности
        this.halfMax = rect.width / 2;
        this.fill = spec.fill ?? 0.5;     // Доля площади под жидкость (physics/LiquidModel.js)

        const profile = profileCurve(spec.points);
        // Таблица полуширины по высоте: внутри — быстрый поиск без обхода кривой
        this.table = new Float32Array(TABLE + 1);
        let k = 0;
        for (let i = 0; i <= TABLE; i++) {
            const t = i / TABLE;
            while (k < profile.length - 2 && profile[k + 1][1] < t) k++;
            const a = profile[k];
            const b = profile[k + 1];
            const s = b[1] > a[1] ? Math.min(1, Math.max(0, (t - a[1]) / (b[1] - a[1]))) : 1;
            this.table[i] = a[0] + (b[0] - a[0]) * s;
        }

        // Контур внутренности: левая стенка сверху вниз, правая снизу вверх (замкнут верхней кромкой)
        const height = this.bottom - this.top;
        const left = profile.map(([x, y]) => ({ x: this.cx - x * this.halfMax, y: this.top + y * height }));
        const right = left.map((p) => ({ x: 2 * this.cx - p.x, y: p.y })).reverse();
        this.left = left;
        this.points = left.concat(right);
        // Площадь внутренности (px²): сколько жидкости помещается
        this.area = 0;
        for (let i = 0; i < TABLE; i++) this.area += (this.table[i] + this.table[i + 1]) * this.halfMax * height / TABLE;
        this.buildField();
    }

    // Полуширина в долях на доле высоты t (0 — ободок, 1 — дно)
    curve(t) {
        if (t <= 0) return this.table[0];
        if (t >= 1) return 0;
        const f = t * TABLE;
        const i = f | 0;
        return this.table[i] + (this.table[i + 1] - this.table[i]) * (f - i);
    }

    // Полуширина внутренности на высоте y (0 — выше или ниже стакана)
    halfWidthAt(y) {
        const t = (y - this.top) / (this.bottom - this.top);
        if (t < 0 || t > 1) return 0;
        return this.curve(t) * this.halfMax;
    }

    inside(x, y) {
        return Math.abs(x - this.cx) < this.halfWidthAt(y);
    }

    buildField() {
        const { rect, left } = this;
        const cols = Math.ceil(rect.width / CELL) + 1;
        const rows = Math.ceil(rect.height / CELL) + 1;
        const dist = new Float32Array(cols * rows);
        // Левая стенка идёт сверху вниз — для строки сетки берём только её участки в пределах NEAR
        // по высоте (поиск делением пополам); правая — зеркало: расстояние до неё считаем от зеркальной
        // точки до левой. Плюс верхняя кромка
        const lowerBound = (y) => {
            let lo = 0;
            let hi = left.length - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (left[mid].y < y) lo = mid + 1; else hi = mid;
            }
            return lo;
        };
        const rim = left[0];
        for (let row = 0; row < rows; row++) {
            const y = rect.y + row * CELL;
            const from = Math.max(0, lowerBound(y - NEAR) - 1);
            const to = Math.min(left.length - 2, lowerBound(y + NEAR));
            for (let col = 0; col < cols; col++) {
                const x = rect.x + col * CELL;
                const mx = 2 * this.cx - x;
                let best = segmentDistanceSq(x, y, rim.x, rim.y, 2 * this.cx - rim.x, rim.y);
                for (let k = from; k <= to; k++) {
                    const a = left[k];
                    const b = left[k + 1];
                    const sq = Math.min(segmentDistanceSq(x, y, a.x, a.y, b.x, b.y), segmentDistanceSq(mx, y, a.x, a.y, b.x, b.y));
                    if (sq < best) best = sq;
                }
                const d = Math.min(NEAR, Math.sqrt(best));
                dist[row * cols + col] = this.inside(x, y) ? d : -d;
            }
        }
        // Направление внутрь — градиент поля (центральные разности)
        const gx = new Float32Array(cols * rows);
        const gy = new Float32Array(cols * rows);
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const i = row * cols + col;
                const l = dist[row * cols + Math.max(0, col - 1)];
                const r = dist[row * cols + Math.min(cols - 1, col + 1)];
                const u = dist[Math.max(0, row - 1) * cols + col];
                const dn = dist[Math.min(rows - 1, row + 1) * cols + col];
                gx[i] = r - l;
                gy[i] = dn - u;
            }
        }
        this.cols = cols;
        this.rows = rows;
        this.dist = dist;
        this.gx = gx;
        this.gy = gy;
    }

    // Расстояние до стенки в точке (внутри положительное) — билинейно по сетке
    distance(x, y) {
        return this.sample(this.dist, x, y);
    }

    // Направление от стенки внутрь (единичное) — в out[0], out[1]
    normal(x, y, out) {
        const nx = this.sample(this.gx, x, y);
        const ny = this.sample(this.gy, x, y);
        const len = Math.sqrt(nx * nx + ny * ny) || 1;
        out[0] = nx / len;
        out[1] = ny / len;
    }

    sample(field, x, y) {
        const { cols, rows, rect } = this;
        let fx = (x - rect.x) / CELL;
        let fy = (y - rect.y) / CELL;
        if (fx < 0) fx = 0; else if (fx > cols - 1.001) fx = cols - 1.001;
        if (fy < 0) fy = 0; else if (fy > rows - 1.001) fy = rows - 1.001;
        const c = fx | 0;
        const r = fy | 0;
        const tx = fx - c;
        const ty = fy - r;
        const i = r * cols + c;
        const top = field[i] + (field[i + 1] - field[i]) * tx;
        const bottom = field[i + cols] + (field[i + cols + 1] - field[i + cols]) * tx;
        return top + (bottom - top) * ty;
    }
}

function segmentDistanceSq(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    let t = len > 0 ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const ex = ax + dx * t - px;
    const ey = ay + dy * t - py;
    return ex * ex + ey * ey;
}

// Участок центростремительного сплайна Катмулла — Рома между p1 и p2: гладкий, без петель и выбросов
// на неравномерно расставленных точках
function catmullRom(p0, p1, p2, p3) {
    const knot = (a, b) => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])) || 1e-4;
    const t1 = knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const lerp = (a, b, ta, tb, t) => [
        ((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta),
        ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)
    ];
    return (s) => {
        const t = t1 + (t2 - t1) * s;
        const a1 = lerp(p0, p1, 0, t1, t);
        const a2 = lerp(p1, p2, t1, t2, t);
        const a3 = lerp(p2, p3, t2, t3, t);
        const b1 = lerp(a1, a2, 0, t2, t);
        const b2 = lerp(a2, a3, t1, t3, t);
        return lerp(b1, b2, t1, t2, t);
    };
}
