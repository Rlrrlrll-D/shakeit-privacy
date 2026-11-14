// Гарнир на стакане — косметика из магазина (game/cosmetics.js): соломинка, долька, вишенка, зонтик,
// мята, сахарная кайма. Ни на что в игре не влияет.
//
// Это картинки, отрисованные в Blender (tools/blender_garnish.py) той же камерой и тем же светом,
// что и стаканы. Раньше гарнир рисовался плоскими заливками Graphics — рядом со стеклом, которое
// само рендер с бликами и преломлением, он читался наклейкой поверх экрана, а не предметом в кадре.
//
// Масштаб — настоящий. Стакан в игре всегда занимает одну ширину поля (640 px на чашу ~90 мм),
// отсюда 7 px поля в миллиметре, и размеры в FRAMES уже посчитаны в этих пикселях: лайм Ø44 мм,
// вишня Ø19 на шпажке 100 мм, зонтик Ø62, соломинка Ø7×190, лист мяты 34, кайма 4 мм. Поэтому
// гарнир ОДИНАКОВ на всех бокалах — лайм не растёт оттого, что его положили на широкий бокал.
// От бокала зависит только то, куда он садится.
//
// Посадка. У каждой картинки есть якорь — точка предмета, которая обязана лечь на кромку (срез
// дольки, шпажка, место, где соломинка входит в стакан). Якорь ставится в (cx + at·half, top),
// остальное встаёт от него само. Над кромкой предметам нужен воздух — его даёт RIM_HEADROOM
// в config.js: стакан опущен, и строка «ТРЯСКА» гарниру больше не мешает.
import { RIM_HEADROOM } from '../config.js';

// Кадры и якоря — те же числа, что в tools/blender_garnish.py (ITEMS). Размер кадра в пикселях поля,
// якорь — долей кадра, at — где по ободку стоит якорь (доля полуширины)
// from: 'bottom' — предмет стоит на дне стакана, а не висит на кромке; его длина подгоняется под
// глубину этого бокала (бармен и берёт соломинку по стакану), но не длиннее настоящей
export const FRAMES = {
    slice:    { w: 340, h: 200, ax: 0.50, ay: 0.08, at: 0.44 },
    cherry:   { w: 760, h: 300, ax: 0.50, ay: 0.17, at: 0.14 },
    // at подобран так, чтобы купол (Ø62 мм ≈ 434 px) целиком лежал над стаканом: центр купола
    // не правее half − 217 даже у самого узкого бокала, иначе он уезжает за стенку и за экран
    umbrella: { w: 520, h: 820, ax: 0.40, ay: 0.06, at: 0.12 },
    mint:     { w: 380, h: 420, ax: 0.44, ay: 0.72, at: 0.40 },
    straw:    { w: 230, h: 1100, ax: 0.114, ay: 0.973, at: -0.22, from: 'bottom', span: 0.946 },
    rim:      { w: 240, h: 70, ax: 0.50, ay: 0.50, at: 0 }
};

export const GARNISH_IDS = Object.keys(FRAMES);

export function garnishKey(id) {
    return `garnish-${id}`;
}

export function garnishFile(id) {
    return `images/garnish/${id}.webp`;
}

// rim: { cx, top, half } — центр кромки, её высота и полуширина (px поля).
// Возвращает контейнер (или null, если у предмета нет картинки)
// Обрезка по окну view = {x0, y0, x1, y1} (те же координаты, что у rim): показывает только часть
// предмета. Нужна плитке магазина — предмет настоящего размера в неё целиком не лезет, а в
// уменьшенном виде соломинка превращалась в нитку
function cropTo(img, left, top, w, h, view) {
    if (!view) return true;
    const x0 = Math.max(view.x0, left), x1 = Math.min(view.x1, left + w);
    const y0 = Math.max(view.y0, top), y1 = Math.min(view.y1, top + h);
    if (x1 <= x0 || y1 <= y0) return false;
    img.setCrop(((x0 - left) / w) * img.width, ((y0 - top) / h) * img.height,
        ((x1 - x0) / w) * img.width, ((y1 - y0) / h) * img.height);
    return true;
}

export function drawGarnish(scene, id, rim, depth, scale = 1, view = null) {
    const f = FRAMES[id];
    if (!f || !scene.textures.exists(garnishKey(id))) return null;
    const box = scene.add.container(0, 0).setDepth(depth);
    if (id === 'rim') {
        // Кайма — единственный предмет во всю кромку: кусок полосы растягивается по ширине.
        // Высота остаётся настоящей (4 мм), растягивается только длина
        const w = f.w * scale;
        const count = Math.ceil((rim.half * 2) / w) + 1;
        const total = count * w;
        for (let k = 0; k < count; k++) {
            const img = scene.add.image(rim.cx - total / 2 + (k + 0.5) * w, rim.top, garnishKey(id));
            img.setDisplaySize(w, f.h * scale);
            if (cropTo(img, img.x - w / 2, img.y - (f.h * scale) / 2, w, f.h * scale, view)) box.add(img);
            else img.destroy();
        }
        // Геометрическая маска считается в координатах мира, а образец в магазине стоит в
        // сдвинутом и ужатом контейнере — там маска вырезала всё. Окно view уже обрезает как надо
        if (!view) {
            const mask = scene.make.graphics();
            mask.fillStyle(0xffffff, 1);
            mask.fillRect(rim.cx - rim.half, rim.top - f.h * scale, rim.half * 2, f.h * scale * 2);
            box.setMask(mask.createGeometryMask());
        }
        return box;
    }
    let k = scale;
    if (f.from === 'bottom') {
        // Упирается в дно и не пробивает его: длину подгоняем под глубину бокала плюс воздух
        // над кромкой. Длиннее настоящей не делаем — только короче
        const depth = (rim.bottom ?? rim.top) - rim.top;
        // Над кромкой — не больше 0.95 от запаса: выше начинается строка «ТРЯСКА»
        const room = depth + RIM_HEADROOM * 0.95;
        k = Math.min(scale, room / (f.h * f.span));
    }
    const img = scene.add.image(0, 0, garnishKey(id));
    img.setDisplaySize(f.w * k, f.h * k);
    // Origin — это и есть якорь: точка картинки, которая встаёт на кромку (или на дно)
    img.setOrigin(f.ax, f.ay);
    const y = f.from === 'bottom' ? (rim.bottom ?? rim.top) : rim.top;
    img.setPosition(rim.cx + rim.half * f.at, y);
    if (cropTo(img, img.x - f.ax * f.w * k, img.y - f.ay * f.h * k, f.w * k, f.h * k, view)) box.add(img);
    else img.destroy();
    return box;
}

// Сколько воздуха над кромкой у этой раскладки — чтобы сцена не считала сама
export function rimHeadroom() {
    return RIM_HEADROOM;
}
