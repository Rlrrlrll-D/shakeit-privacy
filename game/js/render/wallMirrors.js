// Зеркальные пятна за стенками стакана.
//
// Поле плотности метаболов складывается только из частиц жидкости, а за стенкой частиц нет —
// плотность там проседает, и нарисованная кромка загибается внутрь: у стенок и в углах появляется
// скругление, которого у жидкости в стакане не бывает. Лечится тем же приёмом, что и граница в SPH:
// у стенки ставится зеркальное отражение ближних частиц, и поле за стенкой перестаёт проседать.
// Зеркала только рисуются — в физике их нет, двигать и считать их не нужно.
export class WallMirrors {
    // range — на какой глубине от стенки частица получает отражение (обычно радиус пятна)
    constructor(scene, layer, { texture, tint, alpha, blendMode, range, limit = 600 }) {
        this.range = range;
        this.normal = new Float32Array(2);
        this.sprites = new Array(limit);
        for (let i = 0; i < limit; i++) {
            const sprite = scene.add.image(0, 0, texture).setTint(tint).setVisible(false);
            if (blendMode !== undefined) sprite.setBlendMode(blendMode).setAlpha(alpha);
            layer.add(sprite);
            this.sprites[i] = sprite;
        }
    }

    setTexture(key) {
        for (const s of this.sprites) s.setTexture(key);
    }

    setAlpha(alpha) {
        for (const s of this.sprites) s.setAlpha(alpha);
    }

    place(slot, x, y, source, i) {
        const sprite = this.sprites[slot];
        sprite.setPosition(x, y).setVisible(true);
        if (source) sprite.setTint(source[i].tintTopLeft);
    }

    // Раскладывает отражения на этот кадр. bounds — прямоугольная внутренность, shape — фигурный стакан,
    // source — спрайты частиц: у отражения должна быть окраска своего оригинала, иначе цвет жидкости
    // у стенки поедет (в «Баре» по нему сверяют образец)
    update(draw, bounds, shape, source = null, count = 0) {
        const x = draw.x, y = draw.y;
        const range = this.range;
        const sprites = this.sprites;
        const limit = sprites.length;
        const n = this.normal;
        let used = 0;

        if (shape) {
            // Фигурный стакан: отражаем относительно самой стенки — по расстоянию до неё и нормали внутрь
            // (physics/GlassShape.js). Отражение по горизонтали годится только для вертикальной стенки:
            // у наклонной (мартини) и выпуклой (бокал, ураган) оно ложится не туда, и у стекла остаётся
            // скругление, а круглое дно и вовсе не отражалось
            for (let i = 0; i < count && used < limit; i++) {
                const px = x[i];
                const py = y[i];
                const d = shape.distance(px, py);
                if (d >= range) continue;
                shape.normal(px, py, n);
                const k = 2 * Math.max(d, 0);
                this.place(used++, px - k * n[0], py - k * n[1], source, i);
            }
        } else {
            const bottom = bounds.y + bounds.height;
            const left = bounds.x;
            const right = bounds.x + bounds.width;
            for (let i = 0; i < count && used < limit; i++) {
                const px = x[i];
                const py = y[i];
                if (py > bottom - range) this.place(used++, px, 2 * bottom - py, source, i);
                if (used >= limit) break;
                if (px - left < range) this.place(used++, 2 * left - px, py, source, i);
                else if (right - px < range) this.place(used++, 2 * right - px, py, source, i);
            }
        }

        for (let i = used; i < limit; i++) {
            if (!sprites[i].visible) break; // Дальше идут уже скрытые с прошлого кадра
            sprites[i].setVisible(false);
        }
        this.used = used;
    }
}
