// Жидкость из частиц: position-based dynamics + поиск соседей через равномерную сетку.
//
// Главное ограничение — плотность (position-based fluids, Macklin & Muller): у каждой частицы
// считается плотность по соседям через ядро сглаживания, и решатель держит её равной плотности покоя.
// Где жидкости стало меньше нормы — частицы стягиваются обратно, где больше — расходятся. Это и есть
// «частица знает, что она часть массы»: одного расталкивания мало — оно умеет только разводить, и масса
// при рывке разлеталась хлопьями, которые уже ничем не притягивались назад.
// Своя симуляция вместо Arcade Physics: Arcade при плотной упаковке гасит скорости столкновениями,
// и масса частиц "зависает" в воздухе. Здесь частицы просто расталкиваются — стопка падает естественно.
// Все данные в типизированных массивах: в кадре нет выделения памяти.
//
// Густая жидкость (глицерин, смузи) — viscosity: над стаканом сетка скоростей, в узле — средняя
// скорость окрестной жидкости; каждая частица подтягивает свою скорость к течению своей области
// (доля viscosity за подшаг). Веса — квадратичный сплайн по 3×3 узлам: поле гладкое, жидкость
// не режется на слои по линиям сетки. Вся масса течёт единым полем: толкнул — едет целиком, тянется
// полотном и лениво оседает, а не рассыпается на капли или комки. Каждая частица — один раз за подшаг,
// без перебора соседей: дёшево и для слабых телефонов.
const FLOW_CELL = 2; // Шаг сетки течения, диаметров частицы
const TENSION_EDGE = 0.6; // Натяжение — где плотность ниже этой доли нормы (край, трещина)

const WALL_JITTER = 0.5;
const CONTACT_REACH = 1.15; // Частицы ближе 1.15 диаметра считаются соприкасающимися
const CONTACT_EPS = WALL_JITTER + 0.01; // Касание стенки с учётом микросдвига
const SPREAD_EPS = 0.002;

export class LiquidSim {
    constructor({ count, radius, bounds, gravity, substeps, iterations, stiffness, damping, maxVelocity, wallBounce = 0, minImpactSpeed = 250,
        viscosity = 0, tension = 0, walls = [], shape = null, rng = Math.random,
        pbf = false, smoothing = 1.7, cfm = 0.05, cohesion = 0.02, cohesionQ = 0.25, cohesionN = 4, xsph = 0.06,
        maxCorrection = 0.3, tolerance = 0.03, surface = 0, surfaceCohesion = 0.5,
        restSpeed = 0, restDamping = 1, correctionDamping = 1 }) {
        this.rng = rng;
        this.minImpactSpeed = minImpactSpeed;
        this.impact = 0; // Сумма скоростей ударов о стенки с последнего сброса (px/с)
        this.wallBounce = wallBounce;
        this.count = count;
        this.radius = radius;
        this.diameter = radius * 2;
        // Вектор гравитации: направление меняется при наклоне телефона
        this.gravityX = 0;
        this.gravityY = gravity;
        this.substeps = substeps;
        this.iterations = iterations;
        this.stiffness = stiffness;
        this.damping = damping;
        // Множитель сопротивления: модель понижает его, пока телефон держат неподвижно (settle в config.js).
        // Пока жидкость трясут — она вольная, как задано damping; затихла рука — трение о стенки берёт верх,
        // и волны гаснут за пару секунд, как у настоящей воды в стакане
        this.dampScale = 1;
        // Вязкое затухание на малых скоростях: у настоящей жидкости вязкость против инерции тем
        // заметнее, чем медленнее движение, поэтому она останавливается, а не дрожит бесконечно
        this.restSpeed = restSpeed;
        this.restDamping = restDamping;
        // Какая доля поправки решателя становится скоростью. Единица — как в чистом PBD: туда
        // уходит и невязка, а она копится и подкачивает жидкость энергией — масса в стакане
        // не успокаивается, поверхность вечно гуляет волной. Меньше единицы — лишнее гасится,
        // а передача импульса между частицами остаётся
        this.correctionDamping = correctionDamping;
        this.predX = new Float32Array(count);
        this.predY = new Float32Array(count);
        this.maxVelocity = maxVelocity;
        this.viscosity = viscosity;
        this.tension = tension;
        // Перегородки внутри стакана — вертикальные стенки от дна: { x, top, half } (px, half — полутолщина)
        this.walls = walls;
        // Форма стакана (physics/GlassShape.js): изогнутые стенки вместо прямоугольника bounds
        this.shape = shape;
        this.normalOut = new Float32Array(2);

        this.minX = bounds.x + radius;
        this.maxX = bounds.x + bounds.width - radius;
        this.minY = bounds.y + radius;
        this.maxY = bounds.y + bounds.height - radius;

        this.x = new Float32Array(count);
        this.y = new Float32Array(count);
        this.prevX = new Float32Array(count);
        this.prevY = new Float32Array(count);
        this.vx = new Float32Array(count);
        this.vy = new Float32Array(count);

        // Ячейка чуть больше диаметра: в окрестности 3×3 ячеек гарантированно все касающиеся соседи,
        // включая почти касающихся (для переноса краски)
        this.contactReach = this.diameter * CONTACT_REACH;
        this.originX = bounds.x;
        this.originY = bounds.y;
        this.cellSize = this.contactReach;
        this.cols = Math.ceil(bounds.width / this.cellSize) + 1;
        this.rows = Math.ceil(bounds.height / this.cellSize) + 1;
        this.cellHead = new Int32Array(this.cols * this.rows);
        this.next = new Int32Array(count);

        if (viscosity > 0 || tension > 0) {
            // Узлы сетки течения; по краю — запасной ряд под крайние веса сплайна
            this.flowCell = this.diameter * FLOW_CELL;
            this.flowCols = Math.ceil(bounds.width / this.flowCell) + 3;
            this.flowRows = Math.ceil(bounds.height / this.flowCell) + 3;
            this.flowWeights = new Float32Array(12); // Рабочие веса частицы: 3 по x, 3 по y и их производные
            // Плотность покоящейся жидкости в узле: частиц на площадь клетки при плотной укладке
            this.restW = (FLOW_CELL * FLOW_CELL) / 0.866;
            const nodes = this.flowCols * this.flowRows;
            this.flowVx = new Float32Array(nodes);
            this.flowVy = new Float32Array(nodes);
            this.flowW = new Float32Array(nodes);
        }

        // Ограничение плотности: ядра, плотность покоя и списки соседей
        this.pbf = pbf;
        if (pbf) {
            // Безразмерные настройки (как в config.js) — их крутит лаборатория жидкости,
            // а rescale пересчитывает из них рабочие величины в пикселях
            this.tuning = { smoothing, cfm, cohesion, cohesionQ, maxCorrection };
            const h = this.smoothing = this.diameter * smoothing;
            this.hSq = h * h;
            // Двумерные ядра: poly6 для плотности, spiky для её градиента
            this.poly6 = 4 / (Math.PI * Math.pow(h, 8));
            this.spiky = -30 / (Math.PI * Math.pow(h, 5));
            this.cohesionN = cohesionN;
            // Искусственное давление отсчитывается от ядра на этом расстоянии
            const q = cohesionQ * h;
            this.cohesionW = this.kernel(q * q);
            this.restDensity = this.hexDensity();
            // Множитель ограничения выходит в единицах «пиксели на ядро», и сами числа зависят от
            // размера частицы и радиуса сглаживания. Чтобы настройки были безразмерными, опираемся
            // на знаменатель в укладке покоя: cfm — его доля, cohesion — доля множителя при полном
            // отклонении плотности
            const refDenom = this.refDenom = this.hexDenominator();
            this.cfm = cfm * refDenom;
            this.cohesion = cohesion / refDenom;
            this.lambda = new Float32Array(count);
            // Соседей у частицы в плотной укладке около десятка; с запасом на сжатие
            this.maxNeighbors = 36;
            this.nbList = new Int32Array(count * this.maxNeighbors);
            this.nbCount = new Int32Array(count);
            this.deltaX = new Float32Array(count);
            this.deltaY = new Float32Array(count);
            this.nbCols = Math.ceil(bounds.width / h) + 2;
            this.nbRows = Math.ceil(bounds.height / h) + 2;
            this.nbHead = new Int32Array(this.nbCols * this.nbRows);
            this.nbNext = new Int32Array(count);
            this.xsph = xsph;
            // Предел поправки за итерацию: невязка решателя каждый подшаг превращается в скорость
            // (скорость = смещение / шаг), и без предела жидкость в покое кипит
            this.maxCorrection = maxCorrection * radius;
            // Мёртвая зона по плотности: отклонение меньше допуска не исправляется. Без неё у массы
            // нет положения равновесия — решатель вечно подталкивает частицы, и жидкость в покое
            // медленно бурлит вместо того, чтобы улечься
            this.tolerance = tolerance;
            this.smoothVx = new Float32Array(count);
            this.smoothVy = new Float32Array(count);
            // Поверхностное натяжение: сцепление (частицы тянутся друг к другу) и сглаживание
            // кривизны (разворот нормалей соседей выравнивается). Именно оно делает поверхность воды
            // в покое прямой линией: бугор размером меньше капиллярной длины натяжение разглаживает
            this.surface = surface;
            this.surfaceCohesion = surfaceCohesion;
            this.normalX = new Float32Array(count);
            this.normalY = new Float32Array(count);
            // Ядро сцепления: максимум на половине радиуса сглаживания — как у Акинчи
            this.cohesionPeak = this.kernel((0.5 * h) * (0.5 * h));
        }
    }

    // Пересчёт рабочих величин из безразмерных настроек: ядра, плотность покоя, масштабы
    rescale(bounds) {
        const t = this.tuning;
        const h = this.smoothing = this.diameter * t.smoothing;
        this.hSq = h * h;
        this.poly6 = 4 / (Math.PI * Math.pow(h, 8));
        this.spiky = -30 / (Math.PI * Math.pow(h, 5));
        const q = t.cohesionQ * h;
        this.cohesionW = this.kernel(q * q);
        this.cohesionPeak = this.kernel((0.5 * h) * (0.5 * h));
        this.restDensity = this.hexDensity();
        const refDenom = this.refDenom = this.hexDenominator();
        this.cfm = t.cfm * refDenom;
        this.cohesion = t.cohesion / refDenom;
        this.maxCorrection = t.maxCorrection * this.radius;
        if (bounds) {
            this.nbCols = Math.ceil(bounds.width / h) + 2;
            this.nbRows = Math.ceil(bounds.height / h) + 2;
            this.nbHead = new Int32Array(this.nbCols * this.nbRows);
        }
    }

    // Крутилки решателя на лету (лаборатория жидкости). Значения — те же, что в config.js:
    // безразмерные настройки идут через пересчёт, остальные ложатся как есть
    setTuning(values, bounds = null) {
        let rescale = false;
        for (const [key, value] of Object.entries(values)) {
            if (value === undefined || value === null) continue;
            if (this.tuning && key in this.tuning) {
                this.tuning[key] = value;
                rescale = true;
            } else {
                this[key] = value;
            }
        }
        if (rescale && this.pbf) this.rescale(bounds);
    }

    // Ядро плотности poly6 по квадрату расстояния
    kernel(distSq) {
        if (distSq >= this.hSq) return 0;
        const d = this.hSq - distSq;
        return this.poly6 * d * d * d;
    }

    // Плотность покоя: столько даёт ядро на плотной гексагональной укладке с шагом в диаметр.
    // Считаем один раз — иначе «норма» зависела бы от того, как жидкость уложилась в начале
    hexDensity() {
        const d = this.diameter;
        const rowHeight = d * Math.sqrt(3) / 2;
        const reach = Math.ceil(this.smoothing / Math.min(d, rowHeight)) + 1;
        let sum = 0;
        for (let row = -reach; row <= reach; row++) {
            for (let col = -reach; col <= reach; col++) {
                const x = col * d + (row % 2 ? d / 2 : 0);
                const y = row * rowHeight;
                sum += this.kernel(x * x + y * y);
            }
        }
        return sum;
    }

    // Знаменатель множителя в укладке покоя: сумма квадратов градиентов ограничения у частицы,
    // со всех сторон окружённой жидкостью. Служит единицей масштаба для cfm и сцепления
    hexDenominator() {
        const d = this.diameter;
        const rowHeight = d * Math.sqrt(3) / 2;
        const reach = Math.ceil(this.smoothing / Math.min(d, rowHeight)) + 1;
        const invRest = 1 / this.restDensity;
        let sumX = 0, sumY = 0, sq = 0;
        for (let row = -reach; row <= reach; row++) {
            for (let col = -reach; col <= reach; col++) {
                const x = col * d + (row % 2 ? d / 2 : 0);
                const y = row * rowHeight;
                const dist = Math.sqrt(x * x + y * y);
                if (dist < 1e-4 || dist >= this.smoothing) continue;
                const edge = this.smoothing - dist;
                const g = this.spiky * edge * edge / dist * invRest;
                const gx = g * x;
                const gy = g * y;
                sumX += gx;
                sumY += gy;
                sq += gx * gx + gy * gy;
            }
        }
        return sq + sumX * sumX + sumY * sumY;
    }

    // Списки соседей в радиусе сглаживания — один раз на подшаг, дальше итерации ходят по готовым
    buildNeighbors() {
        const { x, y, nbList, nbCount, maxNeighbors, hSq } = this;
        const next = this.nbNext, cellHead = this.nbHead, cols = this.nbCols, rows = this.nbRows;
        const cell = this.smoothing;
        const originX = this.originX, originY = this.originY;
        // Своя сетка под радиус сглаживания: ячейка ровно в радиус, значит хватает кольца 3x3
        cellHead.fill(-1);
        // Индекс ячейки через `| 0`: у частицы с нечисловой координатой (её может дать сбойный замер
        // датчика) индекс получился бы нечисловым, обход списка ушёл бы в бесконечный цикл, и игра
        // замирала бы намертво. Такие частицы чинит repairLost
        for (let i = 0; i < this.count; i++) {
            const cx = Math.min(cols - 1, Math.max(0, Math.floor((x[i] - originX) / cell))) | 0;
            const cy = Math.min(rows - 1, Math.max(0, Math.floor((y[i] - originY) / cell))) | 0;
            const c = cy * cols + cx;
            next[i] = cellHead[c];
            cellHead[c] = i;
        }
        const reach = 1;
        nbCount.fill(0);
        for (let i = 0; i < this.count; i++) {
            const cx = Math.min(cols - 1, Math.max(0, Math.floor((x[i] - originX) / cell))) | 0;
            const cy = Math.min(rows - 1, Math.max(0, Math.floor((y[i] - originY) / cell))) | 0;
            const xi = x[i], yi = y[i];
            let count = 0;
            const base = i * maxNeighbors;
            for (let oy = -reach; oy <= reach && count < maxNeighbors; oy++) {
                const ny = cy + oy;
                if (ny < 0 || ny >= rows) continue;
                for (let ox = -reach; ox <= reach && count < maxNeighbors; ox++) {
                    const nx = cx + ox;
                    if (nx < 0 || nx >= cols) continue;
                    for (let j = cellHead[ny * cols + nx]; j !== -1; j = next[j]) {
                        if (j === i) continue;
                        const dx = xi - x[j];
                        const dy = yi - y[j];
                        if (dx * dx + dy * dy >= hSq) continue;
                        nbList[base + count++] = j;
                        if (count >= maxNeighbors) break;
                    }
                }
            }
            nbCount[i] = count;
        }
    }

    // Одна итерация ограничения плотности: сначала у всех плотность и множитель, затем сдвиги.
    // Знаменатель множителя — сумма квадратов градиентов ограничения плюс смягчение cfm: без него
    // у края, где соседей мало, поправки взрывались бы
    solveDensity() {
        const { x, y, nbList, nbCount, maxNeighbors, lambda, deltaX, deltaY, normalX, normalY, count: n } = this;
        // Поля объекта в локальные переменные: внутренние циклы проходят по сотням тысяч пар за кадр
        const invRest = 1 / this.restDensity;
        const h = this.smoothing;
        const hSq = this.hSq;
        const poly6 = this.poly6;
        const spiky = this.spiky;
        const cfm = this.cfm;
        const cohesion = this.cohesion;
        const cohesionN = this.cohesionN;
        const invCohesionW = 1 / this.cohesionW;
        const maxCorr = this.maxCorrection;
        const tol = this.tolerance;
        const surface = this.surface;
        const surfCoh = this.surfaceCohesion;
        const invPeak = 1 / this.cohesionPeak;
        const self = poly6 * hSq * hSq * hSq;

        for (let i = 0; i < n; i++) {
            const base = i * maxNeighbors;
            const cnt = nbCount[i];
            const xi = x[i], yi = y[i];
            let density = self;
            let gradSumX = 0, gradSumY = 0, gradSq = 0;
            for (let k = 0; k < cnt; k++) {
                const j = nbList[base + k];
                const dx = xi - x[j];
                const dy = yi - y[j];
                const distSq = dx * dx + dy * dy;
                if (distSq >= hSq) continue;
                const w = hSq - distSq;
                density += poly6 * w * w * w;
                if (distSq < 1e-8) continue;
                const dist = Math.sqrt(distSq);
                const edge = h - dist;
                const g = spiky * edge * edge / dist * invRest;
                const gx = g * dx;
                const gy = g * dy;
                gradSumX += gx;
                gradSumY += gy;
                gradSq += gx * gx + gy * gy;
            }
            // Сумма градиентов — это и есть нормаль к поверхности: внутри массы она гасится
            // соседями со всех сторон, а на краю указывает наружу
            normalX[i] = gradSumX;
            normalY[i] = gradSumY;
            let c = density * invRest - 1;
            if (c > -tol && c < tol) { lambda[i] = 0; continue; }
            c = c > 0 ? c - tol : c + tol;
            lambda[i] = -c / (gradSq + gradSumX * gradSumX + gradSumY * gradSumY + cfm);
        }

        for (let i = 0; i < n; i++) {
            const base = i * maxNeighbors;
            const cnt = nbCount[i];
            const xi = x[i], yi = y[i];
            const li = lambda[i];
            const nxi = normalX[i], nyi = normalY[i];
            let sx = 0, sy = 0;
            let tx = 0, ty = 0;
            for (let k = 0; k < cnt; k++) {
                const j = nbList[base + k];
                const dx = xi - x[j];
                const dy = yi - y[j];
                const distSq = dx * dx + dy * dy;
                if (distSq >= hSq || distSq < 1e-8) continue;
                const dist = Math.sqrt(distSq);
                const edge = h - dist;
                const g = spiky * edge * edge / dist;
                // Искусственное давление: не даёт частицам слипаться в комки и держит поверхность —
                // капля в полёте собирается обратно в каплю, а не рассыпается
                const w = hSq - distSq;
                const ratio = poly6 * w * w * w * invCohesionW;
                let corr = ratio;
                for (let q = 1; q < cohesionN; q++) corr *= ratio;
                const s = (li + lambda[j] - cohesion * corr) * g * invRest;
                sx += s * dx;
                sy += s * dy;
                if (surface > 0) {
                    // Сцепление: тянет соседей друг к другу тем сильнее, чем они ближе к половине
                    // радиуса сглаживания; и выравнивание кривизны: разницу нормалей гасим
                    const pull = poly6 * w * w * w * invPeak * surfCoh / dist;
                    tx -= pull * dx + (nxi - normalX[j]);
                    ty -= pull * dy + (nyi - normalY[j]);
                }
            }
            if (surface > 0) {
                sx += tx * surface;
                sy += ty * surface;
            }
            const len = Math.sqrt(sx * sx + sy * sy);
            if (len > maxCorr) {
                const k = maxCorr / len;
                sx *= k;
                sy *= k;
            }
            deltaX[i] = sx;
            deltaY[i] = sy;
        }

        for (let i = 0; i < n; i++) {
            x[i] += deltaX[i];
            y[i] += deltaY[i];
        }
    }

    // Сглаживание скоростей между соседями (XSPH): частица подтягивает свою скорость к скорости
    // окружающей жидкости. Без него решатель плотности держит открытыми пустоты, и масса под сильной
    // тряской вспенивается — выглядит как мокрая губка, а не как жидкость
    applyXsph() {
        const { x, y, vx, vy, nbList, nbCount, maxNeighbors, smoothVx, smoothVy, count: n } = this;
        const hSq = this.hSq;
        const poly6 = this.poly6;
        const invRest = 1 / this.restDensity;
        const c = this.xsph;
        for (let i = 0; i < n; i++) {
            const base = i * maxNeighbors;
            const cnt = nbCount[i];
            const xi = x[i], yi = y[i], vxi = vx[i], vyi = vy[i];
            let ax = 0, ay = 0;
            for (let k = 0; k < cnt; k++) {
                const j = nbList[base + k];
                const dx = xi - x[j];
                const dy = yi - y[j];
                const distSq = dx * dx + dy * dy;
                if (distSq >= hSq) continue;
                const w = hSq - distSq;
                const k6 = poly6 * w * w * w * invRest;
                ax += (vx[j] - vxi) * k6;
                ay += (vy[j] - vyi) * k6;
            }
            smoothVx[i] = vxi + c * ax;
            smoothVy[i] = vyi + c * ay;
        }
        vx.set(smoothVx);
        vy.set(smoothVy);
    }

    // Частица с нечисловой или улетевшей координатой возвращается в стакан и гасится. Такое даёт
    // сбойный замер датчика (нулевой или отрицательный интервал между замерами); раньше решатель
    // просто терял её из виду, теперь она снова часть массы
    repairLost() {
        const { x, y, vx, vy, count: n } = this;
        const cx = (this.minX + this.maxX) / 2;
        const cy = (this.minY + this.maxY) / 2;
        let lost = 0;
        for (let i = 0; i < n; i++) {
            // Сравнение с самим собой отсеивает нечисловое значение дешевле проверок из Math
            const px = x[i], py = y[i];
            if (px === px && py === py && px > -1e5 && px < 1e5 && py > -1e5 && py < 1e5) continue;
            x[i] = this.prevX[i] = cx + (this.rng() - 0.5) * this.diameter;
            y[i] = this.prevY[i] = cy + (this.rng() - 0.5) * this.diameter;
            vx[i] = 0;
            vy[i] = 0;
            lost++;
        }
        this.lost = (this.lost || 0) + lost;
        return lost;
    }

    setPosition(i, x, y) {
        this.x[i] = this.prevX[i] = x;
        this.y[i] = this.prevY[i] = y;
        this.vx[i] = 0;
        this.vy[i] = 0;
    }

    step(dt) {
        const h = dt / this.substeps;
        const n = this.count;
        const gx = this.gravityX * h;
        const gy = this.gravityY * h;
        const damp = Math.pow(this.damping * this.dampScale, h);
        const maxV = this.maxVelocity;

        // Сглаживание скоростей — раз в кадр, на последнем подшаге: это фильтр скорости,
        // от повторов внутри кадра он только дороже
        const last = this.substeps - 1;
        this.repairLost();
        for (let s = 0; s < this.substeps; s++) {
            const restSq = this.restSpeed * this.restSpeed;
            const restDamp = restSq > 0 ? Math.pow(this.restDamping, h) : 1;
            for (let i = 0; i < n; i++) {
                let vx = this.vx[i] * damp + gx;
                let vy = this.vy[i] * damp + gy;
                // Почти остановившаяся частица гасится сильнее — жидкость доходит до покоя
                if (restSq > 0 && vx * vx + vy * vy < restSq) {
                    vx *= restDamp;
                    vy *= restDamp;
                }
                const speedSq = vx * vx + vy * vy;
                if (speedSq > maxV * maxV) {
                    const k = maxV / Math.sqrt(speedSq);
                    vx *= k;
                    vy *= k;
                }
                this.prevX[i] = this.x[i];
                this.prevY[i] = this.y[i];
                this.x[i] += vx * h;
                this.y[i] += vy * h;
                this.predX[i] = this.x[i];
                this.predY[i] = this.y[i];
            }

            this.buildGrid();
            if (this.pbf) {
                // Ограничение плотности: соседи ищутся раз на подшаг, итерации ходят по готовым спискам
                this.buildNeighbors();
                for (let it = 0; it < this.iterations; it++) {
                    this.solveDensity();
                    this.solveWalls();
                }
            } else {
                for (let it = 0; it < this.iterations; it++) {
                    this.solvePairs();
                    this.solveWalls();
                }
            }
            // Фигурный стакан: последний проход — стенками, расталкивание соседей не вдавит частицу в стекло
            if (this.shape) this.solveShape();

            // Скорость выводится из фактического смещения — коррекции позиций сами гасят/передают импульс.
            // От потолка и боковых стенок жидкость отскакивает (иначе прилипает к ним при сильной тряске);
            // в this.vx/vy пока лежит скорость до подшага — её и отражаем
            // Попутно копим силу ударов о стенки (для звука и вибрации): скорость удара сверх порога,
            // чтобы покоящаяся на дне жидкость не "стучала"
            const invH = 1 / h;
            const bounce = this.wallBounce;
            const minImpact = this.minImpactSpeed;
            const { minX, maxX, minY, maxY } = this;
            let impact = 0;
            if (this.shape) {
                this.impact += this.bounceShape(invH, bounce, minImpact);
                if (this.pbf && this.xsph > 0 && s === last) this.applyXsph();
                if (this.viscosity > 0 || this.tension > 0) this.solveFlow(h);
                continue;
            }
            const corrK = this.pbf ? this.correctionDamping : 1;
            for (let i = 0; i < n; i++) {
                let vx = ((this.predX[i] - this.prevX[i]) + (this.x[i] - this.predX[i]) * corrK) * invH;
                let vy = ((this.predY[i] - this.prevY[i]) + (this.y[i] - this.predY[i]) * corrK) * invH;
                const oldVx = this.vx[i];
                const oldVy = this.vy[i];
                if (this.y[i] <= minY + CONTACT_EPS && oldVy < 0) {
                    vy = -oldVy * bounce;
                    if (-oldVy > minImpact) impact += -oldVy - minImpact;
                } else if (this.y[i] >= maxY - CONTACT_EPS && oldVy > minImpact) {
                    impact += oldVy - minImpact;
                }
                if (this.x[i] <= minX + CONTACT_EPS && oldVx < 0) {
                    vx = -oldVx * bounce;
                    if (-oldVx > minImpact) impact += -oldVx - minImpact;
                } else if (this.x[i] >= maxX - CONTACT_EPS && oldVx > 0) {
                    vx = -oldVx * bounce;
                    if (oldVx > minImpact) impact += oldVx - minImpact;
                }
                this.vx[i] = vx;
                this.vy[i] = vy;
            }
            this.impact += impact;
            if (this.pbf && this.xsph > 0 && s === last) this.applyXsph();
            if (this.viscosity > 0 || this.tension > 0) this.solveFlow(h);
        }
    }

    // Веса квадратичного сплайна частицы i по 3 узлам на ось; возвращает индекс первого узла
    flowStencil(i, w) {
        const inv = 1 / this.flowCell;
        const fx = (this.x[i] - this.originX) * inv;
        const fy = (this.y[i] - this.originY) * inv;
        const bx = Math.floor(fx - 0.5);
        const by = Math.floor(fy - 0.5);
        const dx = fx - bx;
        const dy = fy - by;
        w[0] = 0.5 * (1.5 - dx) * (1.5 - dx);
        w[1] = 0.75 - (dx - 1) * (dx - 1);
        w[2] = 0.5 * (dx - 0.5) * (dx - 0.5);
        w[3] = 0.5 * (1.5 - dy) * (1.5 - dy);
        w[4] = 0.75 - (dy - 1) * (dy - 1);
        w[5] = 0.5 * (dy - 0.5) * (dy - 0.5);
        // Производные весов по координате (в клетках) — для градиента плотности
        w[6] = dx - 1.5;
        w[7] = -2 * (dx - 1);
        w[8] = dx - 0.5;
        w[9] = dy - 1.5;
        w[10] = -2 * (dy - 1);
        w[11] = dy - 0.5;
        // Сдвиг на запасной ряд: bx, by не меньше −1
        return (by + 1) * this.flowCols + bx + 1;
    }

    // Вязкость: скорости частиц → средние скорости в узлах → каждая частица подтягивается к течению
    // в своей точке. Поверхностное натяжение (tension): плотность жидкости в узлах — та же сетка; частица,
    // где жидкости меньше нормы (край, трещина, разреженное место), тянется туда, где её больше —
    // трещины затягиваются, масса держится вместе. Сетка крупнее частицы — комков не лепит
    solveFlow(h) {
        const { vx, vy, flowVx, flowVy, flowW, flowCols: cols, flowWeights: w, count: n } = this;
        flowVx.fill(0);
        flowVy.fill(0);
        flowW.fill(0);
        for (let i = 0; i < n; i++) {
            const base = this.flowStencil(i, w);
            const u = vx[i];
            const v = vy[i];
            for (let b = 0; b < 3; b++) {
                const row = base + b * cols;
                const wy = w[3 + b];
                for (let a = 0; a < 3; a++) {
                    const k = row + a;
                    const wk = w[a] * wy;
                    flowVx[k] += u * wk;
                    flowVy[k] += v * wk;
                    flowW[k] += wk;
                }
            }
        }
        const blend = this.viscosity;
        const pull = this.tension * h / (this.restW * this.flowCell);
        for (let i = 0; i < n; i++) {
            const base = this.flowStencil(i, w);
            // Средняя скорость в узле = сумма / вес (узел без жидкости не участвует)
            let u = 0;
            let v = 0;
            let dens = 0;
            let gx = 0;
            let gy = 0;
            for (let b = 0; b < 3; b++) {
                const row = base + b * cols;
                const wy = w[3 + b];
                const dwy = w[9 + b];
                for (let a = 0; a < 3; a++) {
                    const k = row + a;
                    const W = flowW[k];
                    const wk = W > 0 ? w[a] * wy / W : 0;
                    u += flowVx[k] * wk;
                    v += flowVy[k] * wk;
                    dens += W * w[a] * wy;
                    gx += W * w[6 + a] * wy;
                    gy += W * w[a] * dwy;
                }
            }
            vx[i] += (u - vx[i]) * blend;
            vy[i] += (v - vy[i]) * blend;
            if (pull > 0) {
                // Только на краях и в трещинах: при тряске масса разрыхляется (0.65–0.8 нормы), и натяжение
                // по всей массе стягивало бы её в сгустки с дырами между ними
                const deficit = 1 - dens / (this.restW * TENSION_EDGE);
                if (deficit > 0) {
                    const k = pull * Math.min(1, deficit);
                    vx[i] += gx * k;
                    vy[i] += gy * k;
                }
            }
        }
    }

    cellIndex(x, y) {
        let cx = ((x - this.originX) / this.cellSize) | 0;
        let cy = ((y - this.originY) / this.cellSize) | 0;
        if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
        if (cy < 0) cy = 0; else if (cy >= this.rows) cy = this.rows - 1;
        return cy * this.cols + cx;
    }

    buildGrid() {
        this.cellHead.fill(-1);
        for (let i = 0; i < this.count; i++) {
            const c = this.cellIndex(this.x[i], this.y[i]);
            this.next[i] = this.cellHead[c];
            this.cellHead[c] = i;
        }
    }

    solvePairs() {
        const { x, y, next, cellHead, cols, rows } = this;
        const d = this.diameter;
        const dSq = d * d;
        const k = 0.5 * this.stiffness;

        for (let cy = 0; cy < rows; cy++) {
            for (let cx = 0; cx < cols; cx++) {
                for (let i = cellHead[cy * cols + cx]; i !== -1; i = next[i]) {
                    // Только "передние" соседние ячейки — каждая пара обрабатывается один раз
                    for (let oy = 0; oy <= 1; oy++) {
                        const ny = cy + oy;
                        if (ny >= rows) break;
                        for (let ox = -1; ox <= 1; ox++) {
                            if (oy === 0 && ox < 0) continue;
                            const nx = cx + ox;
                            if (nx < 0 || nx >= cols) continue;

                            let j = oy === 0 && ox === 0 ? next[i] : cellHead[ny * cols + nx];
                            for (; j !== -1; j = next[j]) {
                                let dx = x[j] - x[i];
                                let dy = y[j] - y[i];
                                let distSq = dx * dx + dy * dy;
                                if (distSq >= dSq) continue;

                                if (distSq < 1e-6) {
                                    // Совпадающие частицы — разводим в случайную сторону
                                    dx = this.rng() - 0.5;
                                    dy = this.rng() - 0.5;
                                    distSq = dx * dx + dy * dy;
                                }
                                const dist = Math.sqrt(distSq);
                                const push = (d - dist) / dist * k;
                                dx *= push;
                                dy *= push;
                                x[i] -= dx;
                                y[i] -= dy;
                                x[j] += dx;
                                y[j] += dy;
                            }
                        }
                    }
                }
            }
        }
    }

    // Перенос значения (краски) от более окрашенной частицы к менее окрашенной при касании.
    // Скорость растёт с относительной скоростью соседей: спокойная жидкость почти не смешивается, бурлящая — быстро.
    // conserve — доля, которую теряет отдающая частица: 1 — краска сохраняется (разбавление),
    // 0 — частица подкрашивает соседа, не бледнея сама.
    // Использует сетку последнего подшага step(): за подшаг частицы смещаются меньше радиуса.
    spread(values, dt, base, turbulence, noiseSpeed, conserve) {
        const { x, y, vx, vy, next, cellHead, cols, rows } = this;
        const reachSq = this.contactReach * this.contactReach;

        for (let cy = 0; cy < rows; cy++) {
            for (let cx = 0; cx < cols; cx++) {
                for (let i = cellHead[cy * cols + cx]; i !== -1; i = next[i]) {
                    for (let oy = 0; oy <= 1; oy++) {
                        const ny = cy + oy;
                        if (ny >= rows) break;
                        for (let ox = -1; ox <= 1; ox++) {
                            if (oy === 0 && ox < 0) continue;
                            const nx = cx + ox;
                            if (nx < 0 || nx >= cols) continue;

                            let j = oy === 0 && ox === 0 ? next[i] : cellHead[ny * cols + nx];
                            for (; j !== -1; j = next[j]) {
                                const diff = values[j] - values[i];
                                if (diff > -SPREAD_EPS && diff < SPREAD_EPS) continue; // Одинаковый цвет — дальше не считаем

                                const dx = x[j] - x[i];
                                const dy = y[j] - y[i];
                                if (dx * dx + dy * dy >= reachSq) continue;

                                const dvx = vx[j] - vx[i];
                                const dvy = vy[j] - vy[i];
                                // Мелкое дрожание от коррекций позиций — не бурление: вычитаем порог шума
                                const shear = Math.sqrt(dvx * dvx + dvy * dvy) - noiseSpeed;
                                let k = (shear > 0 ? base + turbulence * shear : base) * dt;
                                if (k > 0.5) k = 0.5;

                                const gain = diff * k;
                                if (diff > 0) {
                                    values[i] += gain;
                                    values[j] -= gain * conserve;
                                } else {
                                    values[j] -= gain;
                                    values[i] += gain * conserve;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Отскок от стенок формы и сила ударов — как у прямоугольника, но по направлению стенки в точке:
    // от боковых стенок и потолка (и нависающих скатов) жидкость отскакивает, на дне и пологих скатах
    // снизу — нет (покоящаяся жидкость не должна дрожать). Возвращает силу ударов за подшаг
    bounceShape(invH, bounce, minImpact) {
        const { x, y, prevX, prevY, predX, predY, shape, normalOut: nrm } = this;
        const reach = this.radius + CONTACT_EPS;
        const corrK = this.pbf ? this.correctionDamping : 1;
        let impact = 0;
        for (let i = 0; i < this.count; i++) {
            let vx = ((predX[i] - prevX[i]) + (x[i] - predX[i]) * corrK) * invH;
            let vy = ((predY[i] - prevY[i]) + (y[i] - predY[i]) * corrK) * invH;
            if (shape.distance(x[i], y[i]) <= reach) {
                shape.normal(x[i], y[i], nrm);
                const nx = nrm[0];
                const ny = nrm[1];
                // Скорость до подшага вдоль направления внутрь: < 0 — частица летела в стенку
                const into = this.vx[i] * nx + this.vy[i] * ny;
                if (into < 0) {
                    if (-into > minImpact) impact += -into - minImpact;
                    if (ny > -0.5) {
                        const now = vx * nx + vy * ny;
                        const out = -into * bounce - now;
                        vx += out * nx;
                        vy += out * ny;
                    }
                }
            }
            this.vx[i] = vx;
            this.vy[i] = vy;
        }
        return impact;
    }

    // Частица ближе радиуса к стенке формы выталкивается внутрь по направлению от стенки
    // (с тем же микросдвигом, что у прямоугольника, — без него прижатые частицы встают столбиком)
    solveShape() {
        const { x, y, shape, radius: r, normalOut: nrm } = this;
        for (let i = 0; i < this.count; i++) {
            // Два прохода: у изогнутой стенки направление в новой точке другое — догоняем
            for (let pass = 0; pass < 2; pass++) {
                const d = shape.distance(x[i], y[i]);
                if (d >= r) break;
                shape.normal(x[i], y[i], nrm);
                const push = r - d + this.rng() * WALL_JITTER;
                x[i] += nrm[0] * push;
                y[i] += nrm[1] * push;
            }
        }
    }

    solveWalls() {
        if (this.shape) {
            this.solveShape();
            return;
        }
        const { x, y, minX, maxX, minY, maxY } = this;
        for (let i = 0; i < this.count; i++) {
            // Микросдвиг от боковой стенки: без него прижатые частицы получают одинаковый X
            // и выстраиваются в идеально ровный столбик, который не падает
            if (x[i] < minX) x[i] = minX + this.rng() * WALL_JITTER;
            else if (x[i] > maxX) x[i] = maxX - this.rng() * WALL_JITTER;
            if (y[i] < minY) y[i] = minY; else if (y[i] > maxY) y[i] = maxY;
        }
        if (this.walls.length > 0) this.solvePartitions();
    }

    // Частица, залезшая в перегородку, возвращается на ту сторону, откуда пришла (по положению в начале
    // подшага): сверху — на торец, слева — влево, справа — вправо. По глубине проникновения решать нельзя:
    // под давлением столба жидкости частицу вдавливает глубже середины, и она "просачивается" насквозь
    solvePartitions() {
        const { x, y, prevX, prevY, radius: r } = this;
        for (const wall of this.walls) {
            const left = wall.x - wall.half - r;
            const right = wall.x + wall.half + r;
            const top = wall.top - r;
            for (let i = 0; i < this.count; i++) {
                if (y[i] <= top || x[i] <= left || x[i] >= right) continue;
                if (prevY[i] <= top) y[i] = top;
                else if (prevX[i] < wall.x) x[i] = left;
                else x[i] = right;
            }
        }
    }
}
