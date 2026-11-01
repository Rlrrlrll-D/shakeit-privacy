// Лаборатория жидкости: стакан и ползунки, которые крутятся на живой жидкости прямо в руке.
// Экран служебный — в него попадают долгим нажатием на «?» на карте уровней.
//
// Ползунки названы по физике, а не по алгоритму: «густота», «целостность», «успокоение».
// Что под ними лежит на самом деле — написано в config.js рядом с каждой величиной.
// Кнопка «ЗАБРАТЬ» кладёт подобранный набор в хранилище (ключ shakeit.lab.preset), откуда его
// переносят в LIQUID_STATES. Проверять набор — приёмочным тестом tools/liquid_check.mjs.
import { LEVEL, LIQUID, LIQUID_RENDER, LIQUID_STATES, COLORS, DRAW_SMOOTH, computeLayout } from '../config.js';
import { LiquidModel } from '../physics/LiquidModel.js';
import { LiquidPipeline } from '../render/LiquidPipeline.js';
import { createDensityBlob, buildDensityLut, DrawPositions } from '../render/metaballs.js';
import { WallMirrors } from '../render/wallMirrors.js';
import { createButton, uiFont, safeTop, UI_COLORS } from '../ui/widgets.js';
import { goToScene } from '../ui/fx.js';

const PRESET_KEY = 'shakeit.lab.preset';
const ROW = 42;          // Высота строки ползунка
const TRACK = 360;       // Длина дорожки

// Ползунки: подпись, диапазон, где лежит величина. Порядок — от самого заметного к тонкому
const CONTROLS = [
    { key: 'viscosity', label: 'густота', min: 0, max: 0.8, where: 'sim' },
    { key: 'xsph', label: 'целостность', min: 0, max: 0.8, where: 'sim' },
    { key: 'surface', label: 'натяжение', min: 0, max: 0.35, where: 'sim' },
    { key: 'cfm', label: 'несжимаемость', min: 0.005, max: 0.3, where: 'sim', invert: true },
    { key: 'tolerance', label: 'равновесие', min: 0, max: 0.12, where: 'sim' },
    { key: 'damping', label: 'успокоение', min: 0.3, max: 0.98, where: 'sim', invert: true },
    { key: 'inertiaGain', label: 'отзывчивость', min: 500, max: 2400, where: 'model' },
    { key: 'body', label: 'густота цвета', min: 0.06, max: 0.4, where: 'look' },
    { key: 'absorb', label: 'прозрачность', min: 0.4, max: 1, where: 'look', invert: true },
    { key: 'spec', label: 'блик', min: 0, max: 1, where: 'look' },
    { key: 'refract', label: 'преломление', min: 0, max: 60, where: 'look' }
];

export class LiquidLabScene extends Phaser.Scene {
    constructor({ shake }) {
        super('LiquidLab');
        this.shake = shake;
    }

    create() {
        const layout = computeLayout(this.scale.height, safeTop(this));
        const top = safeTop(this) + 26;
        this.cameras.main.setBackgroundColor(0x0b0c10);

        this.add.text(360, top, 'ЛАБОРАТОРИЯ ЖИДКОСТИ', { font: uiFont(26), color: UI_COLORS.light }).setOrigin(0.5);
        createButton(this, { x: 100, y: top, width: 120, height: 46, label: 'НАЗАД', fontSize: 20, onClick: () => goToScene(this, 'LevelSelect') });
        this.hint = this.add.text(360, top + 30, 'трясите телефон — жидкость живая', { font: uiFont(16), color: UI_COLORS.muted }).setOrigin(0.5);

        // Стакан прямоугольный: у прямой стенки сразу видно, прямая ли поверхность
        const glass = this.glass = { x: 60, y: top + 52, width: 600, height: 560, radius: 18 };
        const wall = this.add.graphics();
        wall.fillStyle(0x1f2335, 0.4);
        wall.fillRoundedRect(glass.x, glass.y, glass.width, glass.height, glass.radius);
        wall.lineStyle(4, 0x9fb4d8, 0.5);
        wall.strokeRoundedRect(glass.x, glass.y, glass.width, glass.height, glass.radius);
        // Метка уровня жидкости: по ней видно, насколько поверхность ушла от прямой
        this.ruler = this.add.graphics().setDepth(5);

        this.tune = { ...LIQUID };
        this.look = { ...LIQUID_RENDER };
        this.createLiquid();
        this.createPresets(glass.y + glass.height + 30);
        this.createSliders(glass.y + glass.height + 68);
        this.createExport(layout.height - 44);
    }

    createLiquid() {
        // Параметры уровня берём общие: красителя в лаборатории нет, нужна только физика
        this.liquid = new LiquidModel(this.glass, this.tune, { ...LEVEL, dyeFraction: 0, dyes: 1, shade: false, walls: undefined, portion: 0 });
        this.metaballs = this.renderer.type === Phaser.WEBGL;
        this.fluidKey = 'lab-fluid';
        this.rebuildBlob();

        this.layer = this.add.layer();
        if (this.metaballs) {
            const renderer = this.renderer;
            if (renderer.liquidBlendMode === undefined) {
                const gl = renderer.gl;
                renderer.liquidBlendMode = renderer.addBlendMode([gl.ONE, gl.ONE], gl.FUNC_ADD);
            }
            this.layer.setPostPipeline(LiquidPipeline);
            this.pipeline = this.layer.getPostPipeline(LiquidPipeline);
            this.pipeline.setColors(0xbfe3ff, 0x2b6cff);
            this.pipeline.setLook(this.look);
            this.pipeline.threshold = this.look.threshold;
            this.pipeline.edge = this.look.edge;
            this.pipeline.rim = 0;
        }

        const lut = buildDensityLut(COLORS.tintSteps);
        const tint = lut[Math.round(0.45 * (COLORS.tintSteps - 1))];
        const { x, y, count } = this.liquid.sim;
        this.sprites = new Array(count);
        for (let i = 0; i < count; i++) {
            const sprite = this.add.image(x[i], y[i], this.fluidKey).setTint(tint);
            if (this.metaballs) sprite.setBlendMode(this.renderer.liquidBlendMode).setAlpha(this.look.density);
            this.layer.add(sprite);
            this.sprites[i] = sprite;
        }
        this.draw = new DrawPositions(count, DRAW_SMOOTH);
        if (this.metaballs) {
            // Обрезка по стакану: отражения за стенкой нарочно плотные, иначе масса вылезет наружу
            const clip = this.make.graphics();
            clip.fillStyle(0xffffff, 1);
            clip.fillRoundedRect(this.glass.x, this.glass.y, this.glass.width, this.glass.height, this.glass.radius);
            this.layer.setMask(clip.createGeometryMask());
            this.mirrors = new WallMirrors(this, this.layer, {
                texture: this.fluidKey, tint, alpha: this.look.density,
                blendMode: this.renderer.liquidBlendMode, range: LIQUID.particleRadius * this.look.blobScale
            });
        }
    }

    // Крупность пятна меняет текстуру — пересоздаём её и переставляем спрайтам
    rebuildBlob() {
        const key = `${this.fluidKey}-${this.look.blobScale.toFixed(2)}`;
        if (!this.textures.exists(key)) createDensityBlob(this, key, LIQUID.particleRadius * this.look.blobScale);
        this.fluidKey = key;
        if (this.sprites) for (const s of this.sprites) s.setTexture(key);
        if (this.mirrors) {
            this.mirrors.setTexture(key);
            this.mirrors.range = LIQUID.particleRadius * this.look.blobScale;
        }
    }

    createPresets(y) {
        const names = Object.keys(LIQUID_STATES);
        const width = Math.floor(640 / names.length) - 8;
        names.forEach((name, i) => {
            createButton(this, {
                x: 40 + width / 2 + i * (width + 8), y, width, height: 40, label: name.toUpperCase(), fontSize: 16,
                onClick: () => this.applyPreset(name)
            });
        });
    }

    applyPreset(name) {
        const preset = LIQUID_STATES[name];
        Object.assign(this.tune, LIQUID, preset.liquid);
        Object.assign(this.look, LIQUID_RENDER, preset.look);
        this.rebuildBlob();
        this.applyAll();
        this.sliders.forEach((s) => s.refresh());
        this.hint.setText(`набор «${name}» — крутите и трясите`);
    }

    // Значение ползунка кладём туда, где оно живёт: решатель, модель или шейдер
    applyAll() {
        const sim = this.liquid.sim;
        sim.setTuning({
            viscosity: this.tune.viscosity, xsph: this.tune.xsph, surface: this.tune.surface,
            cfm: this.tune.cfm, tolerance: this.tune.tolerance, damping: this.tune.damping,
            cohesion: this.tune.cohesion, smoothing: this.tune.smoothing, tension: this.tune.tension
        }, this.glass);
        this.liquid.cfg.inertiaGain = this.tune.inertiaGain;
        if (this.pipeline) {
            this.pipeline.setLook(this.look);
            this.pipeline.threshold = this.look.threshold;
            this.pipeline.edge = this.look.edge;
        }
        for (const s of this.sprites) s.setAlpha(this.look.density);
        if (this.mirrors) this.mirrors.setAlpha(this.look.density);
    }

    createSliders(top) {
        this.sliders = CONTROLS.map((c, i) => this.addSlider(c, top + i * ROW));
    }

    // Ползунок: дорожка, бегунок и значение. Тянется пальцем, применяется сразу
    addSlider(control, y) {
        const x = 230;
        const store = () => (control.where === 'look' ? this.look : this.tune);
        const g = this.add.graphics();
        const label = this.add.text(x - 16, y, control.label, { font: uiFont(18), color: UI_COLORS.light }).setOrigin(1, 0.5);
        const value = this.add.text(x + TRACK + 16, y, '', { font: uiFont(16), color: UI_COLORS.muted }).setOrigin(0, 0.5);
        const toBar = (v) => {
            const t = Math.min(1, Math.max(0, (v - control.min) / (control.max - control.min)));
            return control.invert ? 1 - t : t;
        };
        const fromBar = (t) => {
            const k = control.invert ? 1 - t : t;
            return control.min + k * (control.max - control.min);
        };
        const draw = () => {
            const v = store()[control.key] ?? control.min;
            const t = toBar(v);
            g.clear();
            g.fillStyle(0x2a2f44, 1);
            g.fillRoundedRect(x, y - 4, TRACK, 8, 4);
            g.fillStyle(UI_COLORS.gold, 1);
            g.fillRoundedRect(x, y - 4, TRACK * t, 8, 4);
            g.fillStyle(0xe8ecff, 1);
            g.fillCircle(x + TRACK * t, y, 13);
            value.setText(control.max > 10 ? v.toFixed(0) : v.toFixed(3));
        };
        const set = (px) => {
            const t = Math.min(1, Math.max(0, (px - x) / TRACK));
            store()[control.key] = fromBar(t);
            if (control.key === 'blobScale') this.rebuildBlob();
            this.applyAll();
            draw();
        };
        const zone = this.add.zone(x + TRACK / 2, y, TRACK + 60, ROW - 6).setInteractive({ useHandCursor: true });
        zone.on('pointerdown', (p) => set(p.x));
        zone.on('pointermove', (p) => { if (p.isDown) set(p.x); });
        draw();
        return { refresh: draw, label, value };
    }

    createExport(y) {
        createButton(this, {
            x: 200, y, width: 300, height: 48, label: 'ЗАБРАТЬ НАБОР', fontSize: 20,
            onClick: () => {
                const picked = {
                    liquid: { viscosity: this.tune.viscosity, xsph: this.tune.xsph, surface: this.tune.surface, cfm: this.tune.cfm, tolerance: this.tune.tolerance, damping: this.tune.damping, inertiaGain: this.tune.inertiaGain },
                    look: { body: this.look.body, absorb: this.look.absorb, spec: this.look.spec, refract: this.look.refract, blobScale: this.look.blobScale }
                };
                try { localStorage.setItem(PRESET_KEY, JSON.stringify(picked)); } catch (e) { /* приватный режим */ }
                this.hint.setText('набор сохранён — заберу его из хранилища');
            }
        });
        createButton(this, {
            x: 520, y, width: 240, height: 48, label: 'СБРОС', fontSize: 20, color: 0x414868,
            onClick: () => this.applyPreset('water')
        });
    }

    update(time, deltaMs) {
        const dt = Math.min(deltaMs, 50) / 1000;
        const input = this.shake.update(dt);
        const liquid = this.liquid;
        liquid.applyShake(input, dt);
        liquid.step(dt);
        const count = liquid.sim.count;
        this.draw.update(liquid.sim);
        const x = this.draw.x, y = this.draw.y;
        for (let i = 0; i < count; i++) this.sprites[i].setPosition(x[i], y[i]);
        if (this.mirrors) this.mirrors.update(this.draw, this.glass, null, this.sprites, count);

        // Линия по средней высоте поверхности: по ней видно, прямая она или с буграми
        let top = Infinity, sum = 0, n = 0;
        for (let i = 0; i < count; i++) {
            if (y[i] < top) top = y[i];
            sum += y[i];
            n++;
        }
        const mean = sum / n;
        this.ruler.clear();
        this.ruler.lineStyle(1, 0xffffff, 0.25);
        this.ruler.lineBetween(this.glass.x, top, this.glass.x + this.glass.width, top);
        this.ruler.lineStyle(1, 0xffd23f, 0.2);
        this.ruler.lineBetween(this.glass.x, mean, this.glass.x + this.glass.width, mean);
    }
}
