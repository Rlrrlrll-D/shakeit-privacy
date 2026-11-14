// Визуальные эффекты интерфейса: всплывающие надписи, конфетти, кольца, искры, фон.
// Всё короткоживущее уничтожается само; текстуры создаются один раз на игру
import { uiFont, softShadow } from './widgets.js';

export function ensureFxTextures(scene) {
    if (scene.textures.exists('fx-dot')) return;

    const dot = scene.textures.createCanvas('fx-dot', 32, 32);
    const ctx = dot.getContext();
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    dot.refresh();

    // Блик-звёздочка: чёткие тонкие лучи крестом, короткие — по диагонали, маленькое яркое ядро.
    // Без широкого ореола — на тёмном фоне он выглядел мутным пятном
    const twinkle = scene.textures.createCanvas('fx-twinkle', 64, 64);
    const tc = twinkle.getContext();
    const core = tc.createRadialGradient(32, 32, 0, 32, 32, 9);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(1, 'rgba(255,255,255,0)');
    tc.fillStyle = core;
    tc.fillRect(0, 0, 64, 64);
    tc.fillStyle = 'rgba(255,255,255,1)';
    tc.translate(32, 32);
    for (const [w, h, turn] of [[1.8, 31, 0], [1.8, 31, 90], [1.2, 13, 45], [1.2, 13, 135]]) {
        tc.save();
        tc.rotate(turn * Math.PI / 180);
        tc.beginPath();
        tc.moveTo(0, -h);
        tc.lineTo(w, 0);
        tc.lineTo(0, h);
        tc.lineTo(-w, 0);
        tc.closePath();
        tc.fill();
        tc.restore();
    }
    twinkle.refresh();

    // Ореол: яркое маленькое ядро и быстрый спад — лёгкое свечение без мутного диска
    const halo = scene.textures.createCanvas('fx-halo', 128, 128);
    const hc = halo.getContext();
    const light = hc.createRadialGradient(64, 64, 0, 64, 64, 64);
    light.addColorStop(0, 'rgba(255,255,255,0.9)');
    light.addColorStop(0.12, 'rgba(255,255,255,0.45)');
    light.addColorStop(0.35, 'rgba(255,255,255,0.12)');
    light.addColorStop(1, 'rgba(255,255,255,0)');
    hc.fillStyle = light;
    hc.fillRect(0, 0, 128, 128);
    halo.refresh();

    const g = scene.make.graphics({ add: false });
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 12, 18);
    g.generateTexture('fx-confetti', 12, 18);
    g.clear();
    g.lineStyle(6, 0xffffff, 1);
    g.strokeCircle(64, 64, 58);
    g.generateTexture('fx-ring', 128, 128);
    g.destroy();
}

// Надпись выпрыгивает, держится и уплывает вверх. Без чёрной обводки — мягкая тёмная тень
export function popText(scene, x, y, text, { color = '#ffffff', size = 48, depth = 15, rise = 90, hold = 500 } = {}) {
    const label = scene.add.text(x, y, text, {
        font: uiFont(size), color, align: 'center', ...softShadow(Math.round(size / 4))
    }).setOrigin(0.5).setDepth(depth).setScale(0.2);
    scene.tweens.add({ targets: label, scale: 1, duration: 220, ease: 'Back.Out' });
    scene.tweens.add({
        targets: label, y: y - rise, alpha: 0, delay: 220 + hold, duration: 450, ease: 'Cubic.In',
        onComplete: () => label.destroy()
    });
    return label;
}

export function confetti(scene, x, y, colors, { count = 60, angle = { min: 200, max: 340 }, depth = 25 } = {}) {
    const emitter = scene.add.particles(x, y, 'fx-confetti', {
        speed: { min: 350, max: 950 },
        angle,
        gravityY: 1300,
        rotate: { start: 0, end: 720 },
        scale: { min: 0.6, max: 1.2 },
        lifespan: 1800,
        tint: colors,
        emitting: false
    }).setDepth(depth);
    emitter.explode(count);
    scene.time.delayedCall(2000, () => emitter.destroy());
}

export function ripple(scene, x, y, color, { depth = 6, delay = 0, scale = 2.4 } = {}) {
    const ring = scene.add.image(x, y, 'fx-ring').setTint(color).setScale(0.15).setDepth(depth).setAlpha(0.9);
    scene.tweens.add({
        targets: ring, scale, alpha: 0, delay, duration: 650, ease: 'Cubic.Out',
        onComplete: () => ring.destroy()
    });
}

// Искры разлетаются во все стороны и гаснут
export function sparkle(scene, x, y, color, { count = 16, depth = 16, speed = 380 } = {}) {
    const emitter = scene.add.particles(x, y, 'fx-twinkle', {
        speed: { min: speed * 0.4, max: speed },
        scale: { start: 0.75, end: 0 },
        alpha: { start: 1, end: 0 },
        rotate: { min: 0, max: 90 },
        lifespan: 650,
        tint: color,
        blendMode: 'ADD',
        emitting: false
    }).setDepth(depth);
    emitter.explode(count);
    scene.time.delayedCall(800, () => emitter.destroy());
}

// Брызги вверх с гравитацией — для удара капли
export function splash(scene, x, y, color, { count = 22, depth = 7 } = {}) {
    const emitter = scene.add.particles(x, y, 'fx-dot', {
        speed: { min: 250, max: 750 },
        angle: { min: 215, max: 325 },
        gravityY: 1600,
        scale: { start: 0.8, end: 0.2 },
        lifespan: 700,
        tint: color,
        emitting: false
    }).setDepth(depth);
    emitter.explode(count);
    scene.time.delayedCall(900, () => emitter.destroy());
}

// Фон: вертикальный градиент в цвет рецепта и медленно всплывающие пузырьки
// scene (косметика, game/cosmetics.js) задаёт свои цвета; без неё — в цвет напитка, как было
export function ambientBackground(scene, width, height, color, look = null) {
    // Фон неподвижен при прокрутке камеры (карта уровней)
    const g = scene.add.graphics().setDepth(-10).setScrollFactor(0);
    const top = look ? look.top : 0x0b0c10;
    const bottom = look && look.bottom !== null ? look.bottom : mixColor(0x0f111a, color, 0.22);
    if (look && look.bubbles !== null) color = look.bubbles;
    g.fillGradientStyle(top, top, bottom, bottom, 1);
    g.fillRect(0, 0, width, height);

    const bubbles = scene.add.particles(0, height + 20, 'fx-dot', {
        x: { min: 0, max: width },
        speedY: { min: -90, max: -35 },
        speedX: { min: -12, max: 12 },
        scale: { min: 0.25, max: 0.9 },
        alpha: { start: 0.22, end: 0 },
        lifespan: 14000,
        frequency: 350,
        tint: color
    }).setDepth(-9).setScrollFactor(0);

    // Возвращаем слои фона: уровень рисует их отдельно в текстуру, сквозь которую преломляет жидкость
    return { sky: g, bubbles };
}

// Лучи света за надписью — для рекордов: шейдер, 12 лучей-конусов (вершина в центре, к краю шире —
// как у прежних плоских треугольников) с пушистыми краями (к краю круга растушёвка шире); длинные чередуются с короткими, каждый
// слегка мерцает. Вращение по часовой стрелке: у текстурных координат шейдера y смотрит вверх,
// поэтому угол растёт против часовой и время прибавляется. Вывод с premultiplied alpha
const RAYS_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float uTime;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 outTexCoord;
const float SEG = 6.2831853 / 12.0;
void main() {
    vec2 p = outTexCoord - 0.5;
    float r = length(p) * 2.0;
    float turn = (atan(p.y, p.x) + uTime * 0.7) / SEG;
    float t = fract(turn);
    float idx = mod(floor(turn), 12.0);
    float wedge = 1.0 - smoothstep(0.14, 0.32 + 0.08 * r, abs(t - 0.5));
    float len = mod(idx, 2.0) < 0.5 ? 1.0 : 0.72;
    float fall = 1.0 - smoothstep(len * 0.35, len, r);
    float shimmer = 0.8 + 0.2 * sin(uTime * 3.0 + idx * 1.7);
    float core = exp(-r * r * 40.0);
    float v = clamp((wedge * fall * shimmer * 0.55 + core * 0.6) * uAlpha, 0.0, 1.0);
    gl_FragColor = vec4(uColor * v, v);
}
`;

export function rays(scene, x, y, color, { depth = 21, radius = 350 } = {}) {
    if (!scene.cache.shader.has('fx-rays')) {
        scene.cache.shader.add('fx-rays', new Phaser.Display.BaseShader('fx-rays', RAYS_SHADER, undefined, {
            uTime: { type: '1f', value: 0 },
            uAlpha: { type: '1f', value: 0 },
            uColor: { type: '3f', value: { x: 1, y: 1, z: 1 } }
        }));
    }
    const shader = scene.add.shader('fx-rays', x, y, radius * 2, radius * 2).setDepth(depth);
    shader.setUniform('uColor.value', { x: ((color >> 16) & 255) / 255, y: ((color >> 8) & 255) / 255, z: (color & 255) / 255 });
    const fade = { alpha: 0 };
    scene.tweens.add({ targets: fade, alpha: 1, duration: 400, onUpdate: () => shader.setUniform('uAlpha.value', fade.alpha) });
    // Время — от появления лучей: малые числа не теряют точность в шейдере
    const start = scene.time.now;
    const tick = (time) => shader.active && shader.setUniform('uTime.value', (time - start) / 1000);
    scene.events.on('update', tick);
    shader.once('destroy', () => scene.events.off('update', tick));
    return shader;
}

// Ореол: лёгкое свечение (сложение цветов) под объектом — вспыхивает при появлении и дальше живо
// мерцает. Дешевле пост-эффектов свечения и одинаково выглядит на всех телефонах
export function halo(scene, x, y, color, { size = 170, depth = 16, alpha = 0.75 } = {}) {
    const light = scene.add.image(x, y, 'fx-halo').setTint(color).setBlendMode('ADD')
        .setDisplaySize(size, size).setAlpha(0).setDepth(depth);
    const scale = light.scale;
    light.setScale(scale * 1.5);
    scene.tweens.add({ targets: light, alpha, scale, duration: 300, ease: 'Quad.Out' });
    scene.tweens.add({ targets: light, scale: scale * 1.08, alpha: alpha * 0.55, delay: 300, duration: 480, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    return light;
}

// Блики-вспышки: в случайных точках области звёздочки коротко вспыхивают с поворотом и гаснут.
// Таймер сцены — останавливается сам при выходе из неё
export function glints(scene, x, y, width, height, { color = 0xffffff, depth = 22, every = 180 } = {}) {
    return scene.time.addEvent({
        delay: every, loop: true, callback: () => {
            const spark = scene.add.image(x + (Math.random() - 0.5) * width, y + (Math.random() - 0.5) * height, 'fx-twinkle')
                .setTint(color).setBlendMode('ADD').setDepth(depth).setScale(0).setAngle(Math.random() * 90);
            scene.tweens.add({
                targets: spark, scale: 0.35 + Math.random() * 0.45, angle: spark.angle + 60,
                duration: 170, hold: 40, yoyo: true, ease: 'Quad.Out', onComplete: () => spark.destroy()
            });
        }
    });
}

// Переход между экранами: затемнение, затем старт сцены
export function goToScene(scene, key, data) {
    const camera = scene.cameras.main;
    if (scene.leaving) return;
    scene.leaving = true;
    camera.fadeOut(180, 11, 12, 16);
    camera.once('camerafadeoutcomplete', () => scene.scene.start(key, data));
}

export function mixColor(a, b, t) {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
