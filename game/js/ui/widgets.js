// Общие элементы интерфейса. Значки рисуются графикой: эмодзи и спецсимволы на разных телефонах
// выглядят по-разному (или не отображаются вовсе)

// Шрифт интерфейса — граффити-баллончик Rubik Spray Paint (www/fonts, лицензия OFL): кириллица и латиница.
// Начертание одно, жирность не указываем — иначе браузер дорисует «ложный жирный». Значков вроде ★ и ✓
// в шрифте нет — их браузер берёт из запасного Arial
export const FONT_FAMILY = '"Rubik Spray Paint", Arial, sans-serif';

// Объектом, не строкой: строку шрифта Phaser режет по пробелам, и название из трёх слов разваливается
export function uiFont(size) {
    return { fontFamily: FONT_FAMILY, fontSize: `${size}px` };
}

// Мягкая тёмная тень вместо чёрной обводки: надпись отделяется от жидкости и вспышек, но без жёсткого
// контура. padding — тень с размытием не обрезается краем текстуры текста
export function softShadow(blur = 10) {
    return {
        shadow: { offsetX: 0, offsetY: 3, color: 'rgba(5,6,10,0.9)', blur, fill: true },
        padding: { x: blur, y: blur }
    };
}

// Надпись шире места — ужимается целиком (шрифт-граффити шире обычного, а названия бывают длинными)
export function fitWidth(text, maxWidth) {
    if (text.width > maxWidth) text.setScale(maxWidth / text.width);
    return text;
}

// Отступ сверху под вырез камеры, в пикселях игры. Игра рисуется и в области выреза (MainActivity),
// браузер сообщает его высоту в CSS env(safe-area-inset-top) — переводим в масштаб поля. Без выреза — 0
export function safeTop(scene) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;padding-top:env(safe-area-inset-top)';
    document.body.appendChild(probe);
    const inset = parseFloat(getComputedStyle(probe).paddingTop) || 0;
    probe.remove();
    return inset * scene.scale.width / scene.scale.displaySize.width;
}

export const UI_COLORS = {
    panel: 0x161a2b,
    card: 0x1f2335,
    button: 0x2a2f4a,
    border: 0x414868,
    text: '#ffffff',
    muted: '#717cb4',
    light: '#c0caf5',
    gold: 0xf1c40f,
    goldText: '#f1c40f',
    red: '#ff4a4a'
};

export const BUTTON_RADIUS = 16; // px: скругление углов кнопок

// Кнопка срабатывает на отпускание над ней — случайное касание во время тряски не нажмёт её
export function createButton(scene, { x, y, width, height, label, onClick, color = UI_COLORS.button, fontSize = 28 }) {
    const bg = scene.add.graphics();
    bg.fillStyle(color, 1);
    bg.fillRoundedRect(-width / 2, -height / 2, width, height, BUTTON_RADIUS);
    bg.lineStyle(3, UI_COLORS.border, 1);
    bg.strokeRoundedRect(-width / 2, -height / 2, width, height, BUTTON_RADIUS);
    const text = scene.add.text(0, 0, label, { font: uiFont(fontSize), color: UI_COLORS.text }).setOrigin(0.5);
    const button = scene.add.container(x, y, [bg, text]);

    const hit = scene.add.zone(0, 0, width, height).setInteractive({ useHandCursor: true });
    button.add(hit);
    hit.on('pointerdown', () => button.setScale(0.94));
    hit.on('pointerout', () => button.setScale(1));
    hit.on('pointerup', () => {
        button.setScale(1);
        onClick();
    });
    return button;
}

export function drawStar(g, x, y, radius, filled) {
    const points = [];
    for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? radius : radius * 0.45;
        const a = -Math.PI / 2 + i * Math.PI / 5;
        points.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
    }
    g.fillStyle(filled ? UI_COLORS.gold : UI_COLORS.button, 1);
    g.fillPoints(points, true);
    if (!filled) {
        g.lineStyle(Math.max(2, radius * 0.12), UI_COLORS.border, 1);
        g.strokePoints(points, true);
    }
}

export function drawLock(g, x, y, size, color = 0x717cb4) {
    const w = size;
    const h = size * 0.75;
    g.lineStyle(size * 0.14, color, 1);
    g.beginPath();
    g.arc(x, y - h * 0.15, w * 0.3, Math.PI, 0);
    g.strokePath();
    g.fillStyle(color, 1);
    g.fillRect(x - w / 2, y - h * 0.15, w, h);
}

// Значок звука: динамик и волны (выключен — серый с красным крестом)
export function drawSoundIcon(g, muted) {
    const color = muted ? 0x717cb4 : 0xc0caf5;
    g.clear();
    g.fillStyle(color, 1);
    g.fillPoints([
        { x: -20, y: -7 }, { x: -11, y: -7 }, { x: 0, y: -17 },
        { x: 0, y: 17 }, { x: -11, y: 7 }, { x: -20, y: 7 }
    ], true);
    g.lineStyle(4, muted ? 0xff4a4a : color, 1);
    if (muted) {
        g.lineBetween(6, -9, 20, 9);
        g.lineBetween(6, 9, 20, -9);
    } else {
        g.beginPath();
        g.arc(2, 0, 9, -0.9, 0.9);
        g.strokePath();
        g.beginPath();
        g.arc(2, 0, 17, -0.9, 0.9);
        g.strokePath();
    }
}

export function hexColor(value) {
    return `#${value.toString(16).padStart(6, '0')}`;
}
