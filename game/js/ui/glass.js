// Стаканы. У простых внутренность прямоугольная, меняется вид — оттенок стекла, толщина стенок, блики
// и декор. У фигурных (shape) — настоящая форма: та же, о стенки которой бьётся жидкость
// (physics/GlassShape.js), стекло рисуется по её контуру. Задняя часть — под жидкостью, стенки и декор —
// поверх неё полупрозрачно, как настоящее стекло. Углы скругляются не сильнее физического стакана,
// иначе жидкость в углах вылезала бы за контур.
import { glassShape } from '../physics/GlassShape.js';

// Вид стакана: tint/fill — стекло за жидкостью, edge — стенки, decor — блики и рисунок поверх жидкости.
// Фигурные стаканы (shape) рисуются картинками из Blender; графика по контуру — запасной вид
const SKINS = {
    // Хайбол: прямоугольный стакан — для уровней с перегородками
    highball: {
        tint: 0x1f2335, fill: 0.4, edge: 6, edgeColor: 0x9fb4d8, edgeAlpha: 0.55,
        decor(g, x, y, w, h) {
            highlights(g, x, y, w, h);
            g.fillStyle(0xffffff, 0.05);
            g.fillRoundedRect(x + w - 34, y + 40, 8, h * 0.4, 4);
        }
    },
    rocks: shaped('rocks', baseDecor, 0xa8b8d8, 14),
    hurricane: shaped('hurricane', stemmedDecor, 0xb8d4ff),
    tulip: shaped('tulip', stemmedDecor, 0xd6c8ff),
    jar: shaped('jar', baseDecor, 0x8fd3c7, 9),
    faceted: shaped('faceted', baseDecor, 0xb8c4e0, 10),
    pilsner: shaped('pilsner', stemmedDecor, 0xe0d6b8),
    goblet: shaped('goblet', stemmedDecor, 0xd6c8ff),
    barrel: shaped('barrel', baseDecor, 0xb8c4e0, 10),
    collins: shaped('collins', baseDecor, 0x9fb4d8, 8),
    martini: shaped('martini', stemmedDecor, 0xb8d4ff),
    absinthe: shaped('absinthe', stemmedDecor, 0xa8e0b8),
    snifter: shaped('snifter', stemmedDecor, 0xe8d0b0)
};

function shaped(shape, decor, edgeColor, edge = 7) {
    return { shape, decor, tint: 0x1f2335, fill: 0.4, edge, edgeColor, edgeAlpha: 0.6 };
}

// Толстое дно — сплошное стекло под внутренностью
function baseDecor(g, shape) {
    const { rect } = shape;
    // Ширина дна — над скруглением углов (в самой нижней точке профиля она сходится к нулю)
    const half = shape.halfWidthAt(shape.top + (shape.bottom - shape.top) * 0.95) + 7;
    g.fillStyle(0xffffff, 0.12);
    g.fillRoundedRect(shape.cx - half, shape.bottom, half * 2, rect.y + rect.height - shape.bottom, { tl: 0, tr: 0, bl: 26, br: 26 });
    g.lineStyle(3, 0xffffff, 0.35);
    g.lineBetween(shape.cx - half + 10, shape.bottom + 2, shape.cx + half - 10, shape.bottom + 2);
    shapeHighlights(g, shape, 0.06, 0.8);
}

// Стекло на ножке: ножка от дна чаши, плоская подставка, блики вдоль стенки
function stemmedDecor(g, shape) {
    const { rect } = shape;
    const foot = rect.y + rect.height;
    g.fillStyle(0xffffff, 0.14);
    g.fillRoundedRect(shape.cx - 14, shape.bottom, 28, foot - shape.bottom - 10, 6);
    g.fillEllipse(shape.cx, foot - 8, shape.halfMax * 1.1, 18);
    g.lineStyle(3, 0xb8d4ff, 0.5);
    g.strokeEllipse(shape.cx, foot - 8, shape.halfMax * 1.1, 18);
    shapeHighlights(g, shape, 0.05, 0.92);
}

// Блики фигурного стакана: полосы вдоль левой стенки, повторяют её изгибы, и ободок сверху
function shapeHighlights(g, shape, from, to) {
    const strip = (inset, width, alpha, t0, t1) => {
        const points = [];
        for (let t = t0; t <= t1; t += 0.02) {
            const y = shape.top + t * (shape.bottom - shape.top);
            points.push({ x: shape.cx - shape.halfWidthAt(y) + inset, y });
        }
        g.lineStyle(width, 0xffffff, alpha);
        g.strokePoints(points);
    };
    strip(26, 18, 0.07, from + 0.04, to - 0.08);
    strip(52, 6, 0.05, from + 0.08, (from + to) / 2);
    const rim = shape.halfWidthAt(shape.top + 1);
    g.lineStyle(4, 0xffffff, 0.25);
    g.strokeEllipse(shape.cx, shape.top + 6, rim * 2 - 10, 18);
}

// Общие блики: широкая полоса у левой стенки и тонкая рядом
function highlights(g, x, y, w, h) {
    g.fillStyle(0xffffff, 0.06);
    g.fillRoundedRect(x + 18, y + 24, 22, h - 48, 11);
    g.fillStyle(0xffffff, 0.035);
    g.fillRoundedRect(x + 50, y + 24, 8, h * 0.55, 4);
}

// Стекло фигурных стаканов отрисовано в Blender (tools/blender_glasses.py): задняя половина — под
// жидкостью, передняя — поверх. Картинка покрывает прямоугольник стакана с полями GLASS_MARGIN
// (толщина стенок, крышка, подставка). Пока картинок нет — стекло рисуется графикой по контуру
const GLASS_MARGIN = 40;

export function glassImages(skin) {
    const s = SKINS[skin];
    if (!s || !s.shape) return [];
    return ['back', 'front'].map((half) => ({ key: `glass-${s.shape}-${half}`, url: `images/glass/${s.shape}-${half}.webp` }));
}

// Форма фигурного стакана для физики и рисования; null — у стакана прямоугольная внутренность
export function glassShapeFor(skin, glass) {
    const s = SKINS[skin];
    return s && s.shape ? glassShape(s.shape, glass) : null;
}

// Рисует стакан: стекло — под жидкостью (порядок создания), стенки и декор — поверх неё (depth 3).
// shape — форма из glassShapeFor (у фигурного стакана стекло идёт по её контуру)
// tint — оттенок стекла из магазина (game/cosmetics.js); 0xffffff — обычное прозрачное
export function drawGlass(scene, glass, skin, shape = null, tint = 0xffffff) {
    const { x, y, width: w, height: h, radius: r } = glass;
    const s = SKINS[skin] || SKINS.highball;
    const images = glassImages(skin);
    if (shape && images.length && images.every((img) => scene.textures.exists(img.key))) {
        const { rect } = shape;
        const place = (img) => img.setOrigin(0).setPosition(rect.x - GLASS_MARGIN, rect.y - GLASS_MARGIN)
            .setDisplaySize(rect.width + GLASS_MARGIN * 2, rect.height + GLASS_MARGIN * 2);
        const back = place(scene.add.image(0, 0, images[0].key)).setTint(tint);
        const front = place(scene.add.image(0, 0, images[1].key)).setDepth(3).setTint(tint);
        return { back, front };
    }
    if (shape) {
        const back = scene.add.graphics();
        back.fillStyle(s.tint, s.fill);
        back.fillPoints(shape.points, true);
        const front = scene.add.graphics().setDepth(3);
        s.decor(front, shape);
        front.lineStyle(s.edge, s.edgeColor, s.edgeAlpha);
        front.strokePoints(shape.points, true);
        return { back, front };
    }
    const back = scene.add.graphics();
    back.fillStyle(s.tint, s.fill);
    back.fillRoundedRect(x, y, w, h, r);
    const front = scene.add.graphics().setDepth(3);
    s.decor(front, x, y, w, h, r);
    front.lineStyle(s.edge, s.edgeColor, s.edgeAlpha);
    front.strokeRoundedRect(x, y, w, h, r);
    return { back, front };
}
