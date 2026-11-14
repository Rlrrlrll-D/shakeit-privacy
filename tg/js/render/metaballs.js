// Текстуры для сплошной жидкости (метаболы). Общие для уровня и лаборатории жидкости.

// Облачко плотности: яркость = плотность со спадом (1 - r²)², альфа непрозрачная —
// плотность кодируется в цвете, поэтому не зависит от предумножения альфы при загрузке текстуры
export function createDensityBlob(scene, key, radius) {
    const size = Math.ceil(radius * 2);
    const texture = scene.textures.createCanvas(key, size, size);
    const ctx = texture.getContext();
    const image = ctx.createImageData(size, size);
    const c = size / 2;
    for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
            const dx = (px + 0.5 - c) / c;
            const dy = (py + 0.5 - c) / c;
            const q = Math.max(0, 1 - (dx * dx + dy * dy));
            const v = Math.round(q * q * 255);
            const o = (py * size + px) * 4;
            image.data[o] = v;
            image.data[o + 1] = v;
            image.data[o + 2] = v;
            image.data[o + 3] = 255;
        }
    }
    ctx.putImageData(image, 0, 0);
    texture.refresh();
}

// Оттенки для шейдера жидкости: R — окрашенность частицы, G — плотность (всегда полная)
export function buildDensityLut(steps) {
    const lut = new Array(steps);
    for (let i = 0; i < steps; i++) {
        lut[i] = (Math.round(i / (steps - 1) * 255) << 16) | 0x00ff00;
    }
    return lut;
}

// Сглаженные по времени положения частиц для отрисовки (config.js, DRAW_SMOOTH).
// Дрожь стоячей жидкости на доли пикселя видна глазом как рябь по кромке; физика при этом честная,
// поэтому гасим дрожь только в картинке
export class DrawPositions {
    constructor(count, { slow, fastSpeed }) {
        this.x = new Float32Array(count);
        this.y = new Float32Array(count);
        this.slow = slow;
        this.fastSq = fastSpeed * fastSpeed;
        this.ready = false;
    }

    update(sim) {
        const { x, y, vx, vy, count } = sim;
        const dx = this.x, dy = this.y;
        if (!this.ready) {
            dx.set(x.subarray(0, count));
            dy.set(y.subarray(0, count));
            this.ready = true;
            return;
        }
        const slow = this.slow;
        const fastSq = this.fastSq;
        for (let i = 0; i < count; i++) {
            const speedSq = vx[i] * vx[i] + vy[i] * vy[i];
            const k = speedSq >= fastSq ? 1 : slow + (1 - slow) * (speedSq / fastSq);
            dx[i] += (x[i] - dx[i]) * k;
            dy[i] += (y[i] - dy[i]) * k;
        }
    }
}
