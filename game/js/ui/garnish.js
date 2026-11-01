// Гарнир на ободке стакана — косметика из магазина (game/cosmetics.js). Рисуется графикой поверх
// стекла: соломинка, долька, вишенка, зонтик, мята, сахарная кайма. Ни на что в игре не влияет.
//
// Привязка к стакану: ободок — верх внутренности, его полуширина известна и у фигурного стакана
// (physics/GlassShape.js), и у прямоугольного. Над ободком гарнир поднимается не выше RISE —
// иначе он залезает в шапку уровня.

// rim: { cx, top, half } — центр, высота ободка и его полуширина в px
const RISE = 46; // px: насколько гарнир торчит над ободком

export function drawGarnish(scene, id, rim, depth) {
    const draw = ART[id];
    if (!draw) return null;
    const g = scene.add.graphics().setDepth(depth);
    draw(g, rim);
    return g;
}

const ART = {
    // Соломинка: наклонная полосатая трубочка из стакана
    straw(g, { cx, top, half }) {
        const x0 = cx + half * 0.42;
        const y0 = top + 60;
        const x1 = cx + half * 0.92;
        const y1 = top - RISE;
        const w = 13;
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy);
        const nx = -dy / len * w / 2;
        const ny = dx / len * w / 2;
        g.fillStyle(0xff4d6d, 1);
        g.fillPoints([
            { x: x0 - nx, y: y0 - ny }, { x: x1 - nx, y: y1 - ny },
            { x: x1 + nx, y: y1 + ny }, { x: x0 + nx, y: y0 + ny }
        ], true);
        // Полоски поперёк
        g.fillStyle(0xfff5f7, 1);
        for (let t = 0.08; t < 1; t += 0.17) {
            const px = x0 + dx * t;
            const py = y0 + dy * t;
            const sx = dx / len * 5;
            const sy = dy / len * 5;
            g.fillPoints([
                { x: px - nx, y: py - ny }, { x: px + sx - nx, y: py + sy - ny },
                { x: px + sx + nx, y: py + sy + ny }, { x: px + nx, y: py + ny }
            ], true);
        }
    },

    // Долька лайма на ободке: полукруг с дольками и коркой
    slice(g, { cx, top, half }) {
        const x = cx + half * 0.72;
        const y = top + 4;
        const r = 46;
        g.fillStyle(0x9be15d, 1);
        g.slice(x, y, r, Math.PI, 0, false);
        g.fillPath();
        g.fillStyle(0xd7f9a9, 1);
        g.slice(x, y, r - 7, Math.PI, 0, false);
        g.fillPath();
        g.lineStyle(3, 0x7ac74f, 1);
        for (let k = 1; k < 5; k++) {
            const a = Math.PI + (Math.PI * k) / 5;
            g.lineBetween(x, y, x + Math.cos(a) * (r - 9), y + Math.sin(a) * (r - 9));
        }
    },

    // Вишенка на шпажке
    cherry(g, { cx, top, half }) {
        const x = cx + half * 0.55;
        const y = top - RISE + 10;
        g.lineStyle(5, 0xe8d8b0, 1);
        g.lineBetween(x - 18, y + 92, x + 10, y - 26);
        g.lineStyle(4, 0x4caf50, 1);
        g.beginPath();
        g.arc(x + 4, y + 16, 26, -2.4, -0.9);
        g.strokePath();
        g.fillStyle(0xd90429, 1);
        g.fillCircle(x, y + 30, 20);
        g.fillStyle(0xff6b8a, 0.8);
        g.fillCircle(x - 7, y + 23, 6);
    },

    // Бумажный зонтик: купол из цветных секторов на палочке
    umbrella(g, { cx, top, half }) {
        const x = cx + half * 0.5;
        const y = top - RISE;
        const r = 44;
        g.lineStyle(5, 0xe8d8b0, 1);
        g.lineBetween(x, y, x - 14, y + 150);
        const colors = [0xff4d6d, 0xffd23f, 0x4cc9f0, 0x9be15d, 0xff8fab, 0xb388ff];
        for (let k = 0; k < 6; k++) {
            g.fillStyle(colors[k], 1);
            g.slice(x, y, r, Math.PI + (Math.PI * k) / 6, Math.PI + (Math.PI * (k + 1)) / 6, false);
            g.fillPath();
        }
        g.fillStyle(0xe8d8b0, 1);
        g.fillCircle(x, y, 7);
    },

    // Веточка мяты за ободком
    mint(g, { cx, top, half }) {
        const x = cx + half * 0.58;
        const y = top - 4;
        g.lineStyle(4, 0x4caf50, 1);
        g.lineBetween(x, y + 40, x + 6, y - 64);
        for (let k = 0; k < 3; k++) {
            const ly = y - 6 - k * 20;
            const dir = k % 2 ? 1 : -1;
            g.fillStyle(k % 2 ? 0x7ed957 : 0x4caf50, 1);
            g.fillEllipse(x + dir * 24, ly, 46, 26);
        }
    },

    // Сахарная кайма: шапочка кристаллов по всему ободку
    rim(g, { cx, top, half }) {
        g.fillStyle(0xffffff, 0.9);
        g.fillRoundedRect(cx - half - 6, top - 12, half * 2 + 12, 20, 10);
        g.fillStyle(0xffffff, 1);
        for (let k = 0; k < 40; k++) {
            const px = cx - half + ((k * 83) % (half * 2));
            const py = top - 14 + ((k * 37) % 18);
            g.fillCircle(px, py, 2 + (k % 3));
        }
    }
};
