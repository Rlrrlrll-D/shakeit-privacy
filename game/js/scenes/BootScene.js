import { ICONS } from '../game/levels.js';
import { FONT_FAMILY } from '../ui/widgets.js';
import { platform } from '../platform/platform.js';

// Загрузка ресурсов один раз при старте игры, затем — карта уровней
export class BootScene extends Phaser.Scene {
    constructor() {
        super('Boot');
    }

    preload() {
        for (const key of ICONS) this.load.image(iconKey(key), `icons/${key}.png`);
        this.load.image('logo', 'images/logo.png');
    }

    create() {
        for (const key of ICONS) {
            saturate(this, iconKey(key), ICON_SATURATION);
            makeSilhouette(this, key);
        }
        // Шрифт — до первых надписей: текст Phaser рисуется в текстуру один раз и сам не перерисуется.
        // Обе части шрифта (латиница и кириллица); если что-то пошло не так — не ждём дольше 2 с
        const font = Promise.all(['Aa', 'Аа'].map((text) => document.fonts.load(`40px ${FONT_FAMILY}`, text)));
        const timeout = new Promise((resolve) => setTimeout(resolve, 2000));
        Promise.race([font, timeout]).catch(() => {}).then(() => {
            platform.loadingStop();
            this.scene.start('LevelSelect');
        });
    }
}

const ICON_SATURATION = 1.3; // Иконки сочнее исходных на 30%

// Насыщенность текстуры: каждый цвет удаляется от своей серой яркости в k раз (яркость сохраняется)
function saturate(scene, key, k) {
    const source = scene.textures.get(key).getSourceImage();
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = image.data;
    for (let i = 0; i < px.length; i += 4) {
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        px[i] = lum + (px[i] - lum) * k;
        px[i + 1] = lum + (px[i + 1] - lum) * k;
        px[i + 2] = lum + (px[i + 2] - lum) * k;
    }
    ctx.putImageData(image, 0, 0);
    scene.textures.remove(key);
    scene.textures.addCanvas(key, canvas);
}

export function iconKey(name) {
    return `icon-${name}`;
}

// Силуэт иконки — для образцов «Бара» и строк итогов: однотонная заливка нужного цвета
export function silhouetteKey(name) {
    return `icon-${name}-sil`;
}

// Силуэт: белая картинка с альфой иконки. Раскрашивается умножением (setTint), и на полупрозрачном краю
// получается ровно цвет × альфа. Режим «залить цветом» (setTintFill) на краю подмешивал собственные цвета
// иконки — вокруг образца шла светлая кайма на +20 по каждому каналу, и образец, совпавший с жидкостью
// по цвету, всё равно был виден обводкой
function makeSilhouette(scene, name) {
    const source = scene.textures.get(iconKey(name)).getSourceImage();
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const key = silhouetteKey(name);
    if (scene.textures.exists(key)) scene.textures.remove(key);
    scene.textures.addCanvas(key, canvas);
}
