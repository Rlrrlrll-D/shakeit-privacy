import { LIQUID, COMBO, COLORS, RHYTHM, DRAW_SMOOTH, computeLayout } from '../config.js';
import { LiquidModel } from '../physics/LiquidModel.js';
import { LiquidPipeline } from '../render/LiquidPipeline.js';
import { createDensityBlob, buildDensityLut, DrawPositions } from '../render/metaballs.js';
import { SurfaceWaves } from '../render/SurfaceWaves.js';
import { WallMirrors } from '../render/wallMirrors.js';
import { LEVELS, CHAPTERS, levelParams, levelLiquid, levelLook, levelWaves, starsFor, STAR_ACCURACY, glassFor, levelStroke, levelBeat } from '../game/levels.js';
import { drawGlass, glassShapeFor, glassImages } from '../ui/glass.js';
import { drawGarnish } from '../ui/garnish.js';
import { Combo } from '../game/Combo.js';
import { StrokeMeter, STROKE_PROFILES } from '../game/StrokeProfile.js';
import { Rhythm } from '../game/Rhythm.js';
import { Cocktail } from '../game/Cocktail.js';
import { now } from '../input/ShakeInput.js';
import { loadSetting, saveSetting } from '../util/Settings.js';
import { iconKey, silhouetteKey } from './BootScene.js';
import { t, levelName, chapterSubtitle, formatNumber } from '../i18n.js';
import { Economy } from '../game/Economy.js';
import { platform } from '../platform/platform.js';
import { UI_COLORS, createButton, drawStar, hexColor, uiFont, softShadow, fitWidth, safeTop } from '../ui/widgets.js';
import {
    ensureFxTextures, popText, confetti, ripple, sparkle, splash, ambientBackground, rays, halo, glints, goToScene
} from '../ui/fx.js';

// Вехи окраски: доля → надпись (ключ перевода)
const MILESTONES = [[0.5, 'halfway'], [0.9, 'almost']];

const State = Object.freeze({
    WAITING: 'WAITING',
    DROPPING: 'DROPPING',
    SHAKING: 'SHAKING',
    BETWEEN: 'BETWEEN',      // Коктейль: между ингредиентами (готово нажато, следующий ещё не начат)
    WIN: 'WIN',
    LOSE: 'LOSE'
});

const UI_DEPTH = 10;
// Порядок слоёв стакана: заднее стекло 0, гарнир 1, жидкость 2, переднее стекло 3
const LIQUID_DEPTH = 2;
const INTRO_ICON = 116;  // Заставка рецепта: размер иконок...
const INTRO_STEP = 74;   // ...шаг между иконками и знаками (знаки почти вплотную к иконкам)...
const INTRO_MARGIN = 44; // Заставка: поле между надписью и стенкой стакана
const INTRO_SIGN = 42;   // ...и кегль знаков «+» и «=»
const SAMPLE_SIZE = 150; // Образец в «Баре» — силуэт фрукта в жидкости у дна
const SAMPLE_DEPTH = 2;  // ...под передним стеклом (оно идёт depth 3): стекло приглушает образец
                         // ровно так же, как жидкость под ним, — цвета сравнимы на глаз
const DROP_ICON_SIZE = 96;
const PANEL_DEPTH = 20;

// Уровень-рецепт: фазы игры, ввод, отрисовка и итоги; физика и краска — в LiquidModel.
// Всё состояние уровня хранится в сцене — scene.restart() даёт чистый уровень
export class GameScene extends Phaser.Scene {
    // Ввод, прогресс, звук и вибрация живут дольше сцены — передаются снаружи и переживают перезапуск уровня
    constructor({ shake, progress, economy, sfx, haptics }) {
        super('Game');
        this.shake = shake;
        this.progress = progress;
        this.economy = economy;
        // Не this.sound: это имя Phaser занимает своим звуковым менеджером и перезаписывает при старте сцены
        this.sfx = sfx;
        this.haptics = haptics;
        this.levelIndex = 0;
    }

    // restart() без данных (например, после смены размера экрана) оставляет текущий уровень
    init(data) {
        if (data && Number.isInteger(data.levelIndex)) this.levelIndex = data.levelIndex;
    }

    // Стекло фигурного стакана (картинки из Blender) грузится при первом заходе на уровень с ним
    preload() {
        for (const { key, url } of glassImages(glassFor(LEVELS[this.levelIndex]))) {
            if (!this.textures.exists(key)) this.load.image(key, url);
        }
    }

    create() {
        this.level = LEVELS[this.levelIndex];
        this.params = levelParams(this.level);

        // Раскладка от фактической высоты поля — она зависит от пропорций экрана
        this.layout = computeLayout(this.scale.height, safeTop(this));
        this.glass = this.layout.glass;
        this.look = levelLook(this.level);
        // Фигурный стакан — настоящая форма и для физики, и для рисунка (у уровня с перегородками — прямоугольный)
        this.glassSkin = glassFor(this.level);
        this.shape = this.level.walls ? null : glassShapeFor(this.glassSkin, this.glass);
        // Выход из уровня посреди тряски — громкость жидкости возвращается
        this.events.once('shutdown', () => {
            this.sfx.duck(false);
            platform.gameplayStop();
        });

        this.state = State.WAITING;
        this.elapsed = 0;           // Время заезда: от падения капли до полной окраски
        this.drop = null;
        this.drop2 = null;
        this.secondDropped = false;
        // Объект сцены переживает заход (scene.start его не пересоздаёт), поэтому ссылки на детали прошлого
        // уровня («Бара», зеркала, плоскость) обнуляем: иначе обычный уровень после «Бара» видел чужой образец
        this.sample = null;
        this.readyButton = null;
        this.ingredientText = null;
        this.progressTrack = null;
        this.mirrors = null;
        // Коктейль по образцам (level.cocktail): ингредиенты по очереди, цвет на глаз
        this.cocktail = this.level.cocktail ? new Cocktail(this.level.cocktail, this.level.base) : null;
        this.cocktailStarted = false;
        this.shownTenths = -1;
        this.shownPercent = -1;
        this.shownScore = -1;
        this.shownMultiplier = 0;
        this.displayScore = 0;      // Очки на экране плавно догоняют настоящие
        this.lastStrokeAge = Infinity;
        this.strokeAvg = 0.8;       // Средняя сила последних встряхиваний — для подсказки "ещё ≈ N"
        this.shownRemaining = -1;
        this.nextMilestone = 0;
        this.leaving = false;
        this.combo = new Combo(COMBO);
        // Ритм заводится в момент падения капли — см. onDropImpact
        this.rhythm = null;
        this.rhythmEvents = [];
        this.nextTick = 0;
        this.nextPulse = 0;
        // Все подсказки заезда — одного цвета, чтобы в центре внимания ничего не мелькало: цвет рамок главы,
        // в «Баре» — цвет образца (см. showIngredient)
        this.hintColor = hexColor(CHAPTERS.find((c) => c.id === this.level.chapter).color);

        // Косметика из магазина: оттенок стекла, гарнир, фон и цвет искр (на игру не влияют)
        this.look2 = this.economy.equipment;
        ensureFxTextures(this);
        this.background = ambientBackground(this, this.layout.width, this.layout.height, this.level.result, this.look2.scene);
        this.cameras.main.fadeIn(250, 11, 12, 16);

        // Сплошная жидкость (метаболы) требует WebGL; на Canvas — запасной вид отдельными каплями
        this.metaballs = this.renderer.type === Phaser.WEBGL;
        this.colorLut = this.metaballs
            ? buildDensityLut(COLORS.tintSteps)
            : buildColorLut(this.level.base, this.level.result, COLORS.tintSteps);

        this.createTextures();
        this.drawGlass();
        this.createLiquid();
        this.createBackdrop();
        this.drawWalls();
        this.createUI();
        this.showIntro();

        this.strokeMeter = new StrokeMeter(levelStroke(this.level));
        this.offBeat = STROKE_PROFILES[levelStroke(this.level)]?.offBeat ?? RHYTHM.offBeat;
        this.shake.reset();
        this.time.delayedCall(this.params.dropDelay, this.startDrop, [], this);
    }

    // Блик на стекле поверх жидкости — стакан выглядит стеклянным, а не нарисованной рамкой
    // Заставка рецепта: "основа + капля = результат" выпрыгивает и улетает до падения капли
    showIntro() {
        const L = this.layout;
        const level = this.level;
        const cx = L.width / 2;
        const y = L.statusY;
        const parts = [];

        // Ингредиент: иконка выпрыгивает
        const ingredient = (x, icon, delay) => {
            const item = this.add.image(x, y, iconKey(icon)).setDisplaySize(INTRO_ICON, INTRO_ICON).setDepth(UI_DEPTH);
            const size = item.scale;
            item.setScale(0);
            this.tweens.add({ targets: item, scale: size, delay, duration: 300, ease: 'Back.Out' });
            parts.push(item);
        };
        const sign = (x, text, delay) => {
            const t = this.add.text(x, y, text, {
                font: uiFont(INTRO_SIGN), color: '#ffffff', ...softShadow(8)
            }).setOrigin(0.5).setDepth(UI_DEPTH).setAlpha(0);
            this.tweens.add({ targets: t, alpha: 1, delay, duration: 200 });
            parts.push(t);
        };

        // Рецепт компактно: знаки вплотную к иконкам
        ingredient(cx - INTRO_STEP * 2, level.icons.base, 0);
        sign(cx - INTRO_STEP, '+', 120);
        ingredient(cx, level.icons.dye, 200);
        sign(cx + INTRO_STEP, '=', 320);
        ingredient(cx + INTRO_STEP * 2, level.icons.drink, 400);
        // Надписи заставки не должны упираться в стенки: ширина берётся по внутренности стакана на их высоте
        // (у фигурного — по его профилю) за вычетом поля, и крупное название ужимается, а не вылезает за стекло
        const room = (textY) => {
            const inner = this.shape ? this.shape.halfWidthAt(Phaser.Math.Clamp(textY, this.shape.top + 4, this.shape.bottom - 4)) * 2 : this.glass.width;
            return Math.max(160, inner - INTRO_MARGIN * 2);
        };
        const name = this.add.text(cx, y - 100, levelName(level).toUpperCase(), {
            font: uiFont(44), color: hexColor(level.result), ...softShadow(12)
        }).setOrigin(0.5).setDepth(UI_DEPTH).setAlpha(0);
        const nameScale = Math.min(1, room(y - 100) / name.width);
        name.setScale(nameScale * 0.3);
        this.tweens.add({ targets: name, scale: nameScale, alpha: 1, duration: 350, ease: 'Back.Out' });
        parts.push(name);
        const chapter = CHAPTERS.find((c) => c.id === level.chapter);
        const subtitle = chapterSubtitle(chapter);
        if (subtitle) {
            const hint = this.add.text(cx, y + 95, subtitle.toUpperCase(), {
                font: uiFont(28), color: this.hintColor, ...softShadow()
            }).setOrigin(0.5).setDepth(UI_DEPTH).setAlpha(0);
            fitWidth(hint, room(y + 95));
            this.tweens.add({ targets: hint, alpha: 1, delay: 500, duration: 250 });
            parts.push(hint);
        }
        const tip = levelBeat(level) ? t('beatTip') : '';
        if (tip) {
            const rhythmHint = this.add.text(cx, y + (subtitle ? 140 : 95), tip, {
                font: uiFont(24), color: this.hintColor, ...softShadow()
            }).setOrigin(0.5).setDepth(UI_DEPTH).setAlpha(0);
            fitWidth(rhythmHint, room(y + (subtitle ? 140 : 95)));
            this.tweens.add({ targets: rhythmHint, alpha: 1, delay: 650, duration: 250 });
            parts.push(rhythmHint);
        }

        this.tweens.add({
            targets: parts, alpha: 0, y: '-=60', delay: this.params.dropDelay - 350, duration: 350,
            onComplete: () => parts.forEach((p) => p.destroy())
        });
    }

    // Текстура частицы — своя на каждый размер пятна (у густых жидкостей крупнее)
    createTextures() {
        this.fluidKey = this.metaballs ? `fluid-${this.look.blobScale}` : 'fluid';
        if (this.textures.exists(this.fluidKey)) return;
        if (this.metaballs) {
            createDensityBlob(this, this.fluidKey, LIQUID.particleRadius * this.look.blobScale);
        } else {
            createSoftCircle(this, this.fluidKey, Math.ceil(LIQUID.particleRadius * 2 * LIQUID.visualScale));
        }
    }

    // Все частицы жидкости — в одном слое; в режиме метаболов слой проходит через шейдер жидкости
    createLiquidLayer() {
        this.liquidLayer = this.add.layer().setDepth(LIQUID_DEPTH);
        if (!this.metaballs) return;

        // Чистое сложение (ONE, ONE): плотности частиц суммируются в буфере. Режим регистрируется
        // один раз на рендерер — при перезапуске сцены не плодим новые
        const renderer = this.renderer;
        if (renderer.liquidBlendMode === undefined) {
            const gl = renderer.gl;
            renderer.liquidBlendMode = renderer.addBlendMode([gl.ONE, gl.ONE], gl.FUNC_ADD);
        }
        this.liquidLayer.setPostPipeline(LiquidPipeline);
        const pipeline = this.liquidLayer.getPostPipeline(LiquidPipeline);
        pipeline.setColors(this.level.base, this.level.result);
        if (this.level.dyeB !== undefined) pipeline.setDyes(this.level.dye, this.level.dyeB);
        this.pipeline = pipeline;
        if (this.cocktail) this.applyIngredientColors();
        pipeline.threshold = this.look.threshold;
        pipeline.edge = this.look.edge;
        pipeline.setLook(this.look);
    }

    // Фон под жидкостью (задник уровня и дальняя стенка стакана) — отдельной текстурой: её шейдер
    // и сдвигает по наклону поверхности, отчего сквозь край и брызги видно, как стекло «плывёт».
    // Рисуем один раз: ни задник, ни стекло не двигаются
    createBackdrop() {
        if (!this.metaballs || !this.pipeline) return;
        const key = 'liquid-backdrop';
        if (this.textures.exists(key)) this.textures.remove(key);
        const backdrop = this.textures.addDynamicTexture(key, this.layout.width, this.layout.height);
        if (!backdrop) return;
        const layers = [this.background.sky];
        if (this.glassParts && this.glassParts.back) layers.push(this.glassParts.back);
        backdrop.draw(layers);
        // У динамической текстуры снимок лежит в её источнике — его и отдаём шейдеру
        this.pipeline.backdrop = backdrop.source[0].glTexture;
        this.events.once('shutdown', () => {
            this.pipeline.backdrop = null;
            this.textures.remove(key);
        });
    }

    addLiquidSprite(x, y, tint) {
        const sprite = this.add.image(x, y, this.fluidKey).setTint(tint);
        if (this.metaballs) {
            sprite.setBlendMode(this.renderer.liquidBlendMode).setAlpha(this.look.density);
        }
        this.liquidLayer.add(sprite);
        return sprite;
    }

    // Стакан уровня: стекло — под жидкостью, стенки и блики — поверх (ui/glass.js); сверху — гарнир
    drawGlass() {
        this.glassParts = drawGlass(this, this.glass, this.glassSkin, this.shape, this.look2.glass.tint);
        // Мерки кромки для гарнира (ui/garnish.js): где она, какой ширины. Размер предмета от бокала
        // не зависит — он в настоящих миллиметрах
        const rim = this.shape
            ? { cx: this.shape.cx, top: this.shape.top, half: this.shape.halfWidthAt(this.shape.top + 2), bottom: this.shape.bottom }
            : { cx: this.glass.x + this.glass.width / 2, top: this.glass.y, half: this.glass.width / 2, bottom: this.glass.y + this.glass.height };
        // Глубина 1 — между задним стеклом (0) и жидкостью (LIQUID_DEPTH): гарнир стоит В стакане,
        // жидкость перехлёстывает его при тряске, а передним стеклом он накрыт, как и положено
        this.garnish = drawGarnish(this, this.look2.garnish.id, rim, 1);
    }

    // Перегородки — поверх жидкости: прячут шов, где пятна частиц по разные стороны сливаются.
    // Пробка — отдельная деталь сверху стенки: вылетает, когда свой отсек прокрашен
    drawWalls() {
        const walls = this.liquid.walls;
        if (walls.length === 0) return;
        const g = this.add.graphics().setDepth(UI_DEPTH - 2);
        const bottom = this.glass.y + this.glass.height;
        this.gateViews = [];
        for (const wall of walls) {
            const width = wall.half * 2 + 6;
            g.fillStyle(0x414868, 1);
            g.fillRoundedRect(wall.x - width / 2, wall.openTop, width, bottom - wall.openTop, { tl: width / 2, tr: width / 2, bl: 0, br: 0 });
            g.fillStyle(0x7aa2f7, 0.35);
            g.fillRect(wall.x - width / 2 + 2, wall.openTop + width / 2, 3, bottom - wall.openTop - width / 2);
            if (wall.gate) {
                const height = wall.openTop - this.glass.y;
                const plug = this.add.rectangle(wall.x, this.glass.y + height / 2, width + 6, height, 0xe0af68)
                    .setStrokeStyle(3, 0x8a5a1c).setDepth(UI_DEPTH - 2);
                this.gateViews.push(plug);
            }
        }
    }

    // Пробка вылетает: подскок и отлёт в сторону, хлопок, затем подсказка перелить
    popGates() {
        for (const plug of this.gateViews) {
            this.tweens.add({ targets: plug, y: plug.y - 140, x: plug.x + 90, angle: 200, alpha: 0, duration: 650, ease: 'Quad.Out', onComplete: () => plug.destroy() });
            sparkle(this, plug.x, plug.y, 0xe0af68, { count: 18 });
        }
        this.gateViews = [];
        this.cameras.main.shake(120, 0.004);
        popText(this, this.layout.width / 2, this.glass.y + 120, t('corkOut'), { color: this.hintColor, size: 46 });
        this.sfx.chime(4);
        this.haptics.pulse(0.7, true);
    }

    createLiquid() {
        this.liquid = new LiquidModel(this.glass, levelLiquid(this.level), this.params, this.shape);
        this.createLiquidLayer();

        const { x, y, count } = this.liquid.sim;
        this.tintStep = new Int16Array(count);
        this.sprites = new Array(count);
        for (let i = 0; i < count; i++) {
            this.sprites[i] = this.addLiquidSprite(x[i], y[i], this.colorLut[0]);
        }
        this.draw = new DrawPositions(count, DRAW_SMOOTH);
        // Волна по поверхности (render/SurfaceWaves.js): только для картинки, физику не трогает
        const waves = levelWaves(this.level);
        this.waves = waves.on ? new SurfaceWaves(this.glass, this.shape, count, waves) : null;

        // Отражения ближних к стенкам частиц: без них поле плотности у стенки проседает
        // и нарисованная кромка жидкости загибается внутрь — у стекла появляется скругление.
        // Слой при этом обрезается по внутренности стакана: за стенкой плотность теперь высокая,
        // и без обрезки масса выползала бы наружу
        if (this.metaballs) {
            const clip = this.make.graphics();
            clip.fillStyle(0xffffff, 1);
            if (this.shape) clip.fillPoints(this.shape.points, true);
            else clip.fillRoundedRect(this.glass.x, this.glass.y, this.glass.width, this.glass.height, this.glass.radius);
            this.liquidLayer.setMask(clip.createGeometryMask());
            this.mirrors = new WallMirrors(this, this.liquidLayer, {
                texture: this.fluidKey, tint: this.colorLut[0], alpha: this.look.density,
                blendMode: this.renderer.liquidBlendMode, range: LIQUID.particleRadius * this.look.blobScale
            });
        }
    }

    createUI() {
        const L = this.layout;
        const level = this.level;
        const left = this.glass.x;
        const right = this.glass.x + this.glass.width;
        const resultColor = hexColor(level.result);

        // Строка 1: «назад» к карте, уровень и цели звёзд
        this.createBackButton(left + 24, L.hudTitleY);
        this.add.image(left + 76, L.hudTitleY, iconKey(level.icons.dye)).setDisplaySize(44, 44);
        // Цели справа налево: "★★★ 30с", перед ней "★★ 50с"; название — в оставшееся слева место
        const goals = this.add.graphics();
        const goal = (x, count, seconds) => {
            const accuracy = level.cocktail ? ` ${STAR_ACCURACY[3 - count]}%` : '';
            const text = this.add.text(x, L.hudTitleY, `${t('sec', { v: seconds })}${accuracy}`, { font: uiFont(22), color: UI_COLORS.light }).setOrigin(1, 0.5);
            const starsRight = x - text.width - 16;
            for (let s = 0; s < count; s++) drawStar(goals, starsRight - s * 22, L.hudTitleY, 11, true);
            return starsRight - count * 22 - 18;
        };
        const goalsLeft = goal(goal(right, 3, level.stars[0]), 2, level.stars[1]);
        fitWidth(this.add.text(left + 106, L.hudTitleY, `${this.levelIndex + 1}. ${levelName(level).toUpperCase()}`, {
            font: uiFont(26), color: resultColor
        }).setOrigin(0, 0.5), goalsLeft - left - 106);

        // Строка 2: время, очки, процент
        this.timerText = this.add.text(left, L.hudTimerY, '', { font: uiFont(40), color: UI_COLORS.text }).setOrigin(0, 0.5);
        this.scoreText = this.add.text(L.width / 2, L.hudTimerY, '', { font: uiFont(34), color: UI_COLORS.light }).setOrigin(0.5);
        this.percentText = this.add.text(right, L.hudTimerY, '', { font: uiFont(40), color: resultColor }).setOrigin(1, 0.5);

        // Полосы — прямоугольники с scaleX: без перерисовки Graphics каждый кадр
        this.progressTrack = this.add.rectangle(left, L.hudProgressY, this.glass.width, 22, 0x1f2335).setOrigin(0, 0.5);
        this.progressBar = this.add.rectangle(left, L.hudProgressY, this.glass.width, 22, level.result).setOrigin(0, 0.5);
        this.progressBar.scaleX = 0;
        // Сколько ещё встряхиваний — прямо на полосе: видно, сколько осталось, можно рассчитать силы
        this.remainingText = this.add.text(left + this.glass.width / 2, L.hudProgressY, '', {
            font: uiFont(17), color: UI_COLORS.text, ...softShadow(5)
        }).setOrigin(0.5);

        // Строка 3: сила тряски и комбо-множитель. Полоса золотая, пока встряхивания засчитываются
        // Надпись яркая и насыщенная (золото, как у самой полосы) и покрупнее: прежняя тусклая сине-серая
        // терялась на тёмном фоне. Полоса начинается от конца надписи — при другом языке она иной ширины
        const shakeLabel = this.add.text(left, L.hudShakeY, t('shakeLabel'), { font: uiFont(26), color: UI_COLORS.goldText, ...softShadow(5) }).setOrigin(0, 0.5);
        const shakeLeft = left + Math.ceil(shakeLabel.width) + 18;
        const shakeWidth = right - 110 - shakeLeft;
        this.add.rectangle(shakeLeft, L.hudShakeY, shakeWidth, 14, 0x1f2335).setOrigin(0, 0.5);
        this.shakeBar = this.add.rectangle(shakeLeft, L.hudShakeY, shakeWidth, 14, UI_COLORS.gold).setOrigin(0, 0.5);
        this.shakeBar.scaleX = 0;
        this.comboText = this.add.text(right, L.hudShakeY, '', {
            font: uiFont(34), color: this.hintColor, ...softShadow(8)
        }).setOrigin(1, 0.5);

        // Сообщения поверх жидкости, с мягкой тёмной тенью — читаются на любом цвете
        this.statusText = this.add.text(L.width / 2, L.statusY, '', {
            font: uiFont(44), color: this.hintColor, align: 'center', ...softShadow(14)
        }).setOrigin(0.5).setDepth(UI_DEPTH);

        this.createRhythmUI();
        if (this.cocktail) this.createCocktailUI();
        // Прогресс упёрся в перегородку — подсказка, что делать
        this.pourText = this.add.text(L.width / 2, this.glass.y + 48, t('tiltPour'), {
            font: uiFont(34), color: this.hintColor, ...softShadow()
        }).setOrigin(0.5).setDepth(UI_DEPTH).setAlpha(0);
        this.blockedTime = 0;
        this.pourShown = false;
        this.refreshHud();
    }

    // Ритм виден и без звука: контур стакана вспыхивает на каждую долю (сильнее — на каждую четвёртую),
    // зелёным — когда встряхивание попало в такт; над жидкостью — серия долей в такт подряд
    createRhythmUI() {
        const { x, y, width, height, radius } = this.glass;
        const ring = (color) => {
            const g = this.add.graphics().setDepth(UI_DEPTH - 1).setAlpha(0);
            g.lineStyle(10, color, 1);
            if (this.shape) g.strokePoints(this.shape.points, true);
            else g.strokeRoundedRect(x - 4, y - 4, width + 8, height + 8, radius + 4);
            return g;
        };
        this.beatRing = ring(0xffffff);
        this.hitRing = ring(0x2ecc71);
        this.streakText = this.add.text(this.layout.width / 2, y + 48, '', {
            font: uiFont(34), color: this.hintColor, ...softShadow()
        }).setOrigin(0.5).setDepth(UI_DEPTH).setAlpha(0);
    }

    pulseBeat(accent) {
        this.tweens.killTweensOf(this.beatRing);
        this.beatRing.setAlpha(accent ? 0.55 : 0.3);
        this.tweens.add({ targets: this.beatRing, alpha: 0, duration: 150 });
    }

    // Щелчки планируются заранее (звук точен до миллисекунд), вспышки — когда щелчок слышен
    scheduleBeats() {
        const rhythm = this.rhythm;
        const t = now();
        while (rhythm.beatTime(this.nextTick) < t + RHYTHM.lookahead) {
            this.sfx.tick(rhythm.beatTime(this.nextTick), this.nextTick % 4 === 0);
            this.nextTick++;
        }
        const heard = this.sfx.outputLatency;
        while (rhythm.beatTime(this.nextPulse) + heard <= t) {
            this.pulseBeat(this.nextPulse % 4 === 0);
            this.nextPulse++;
        }
    }

    updateRhythm(input) {
        const rhythm = this.rhythm;
        for (let k = 0; k < input.strokes; k++) rhythm.addStroke(input.strokeTimes[k], input.strokePowers[k]);
        const events = this.rhythmEvents;
        events.length = 0;
        rhythm.update(now(), events);
        for (const e of events) {
            if (e.type === 'hit') this.onRhythmHit(e);
            else this.onRhythmBreak();
        }
        this.scheduleBeats();
    }

    onRhythmHit({ bonus, power, streak }) {
        // Удар в такт: остаток его прогресса (мимо такта даёт только долю offBeat) и бонус за серию
        this.liquid.addStrokes(power * (1 - this.offBeat) + bonus);
        this.combo.addBonus(bonus);

        this.tweens.killTweensOf(this.hitRing);
        this.hitRing.setAlpha(0.5);
        this.tweens.add({ targets: this.hitRing, alpha: 0, duration: 180 });

        if (streak >= 3) {
            this.tweens.killTweensOf(this.streakText);
            this.streakText.setText(t('onBeat', { n: streak })).setColor(this.hintColor).setAlpha(1).setScale(1.15);
            this.tweens.add({ targets: this.streakText, scale: 1, duration: 120 });
        }
        if (streak % RHYTHM.streakCall === 0) {
            popText(this, this.layout.width / 2, this.glass.y + 110, t('perfectRhythm'), { color: this.hintColor, size: 44 });
            this.sfx.chime(5);
            this.haptics.pulse(0.4, true);
        }
    }

    onRhythmBreak() {
        this.tweens.killTweensOf(this.streakText);
        this.tweens.add({ targets: this.streakText, alpha: 0, duration: 300 });
    }

    // «Назад» к карте уровней: маленькая кнопка со стрелкой в начале HUD (нижней полосы кнопок нет —
    // стакан занимает экран до самого низа)
    createBackButton(x, y) {
        const w = 48;
        const h = 44;
        const g = this.add.graphics({ x, y });
        g.fillStyle(UI_COLORS.button, 1);
        g.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
        g.lineStyle(2, UI_COLORS.border, 1);
        g.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
        g.lineStyle(4, 0xc0caf5, 1);
        g.beginPath();
        g.moveTo(5, -10);
        g.lineTo(-5, 0);
        g.lineTo(5, 10);
        g.strokePath();
        const hit = this.add.zone(x, y, w + 16, h + 16).setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => g.setScale(0.9));
        hit.on('pointerout', () => g.setScale(1));
        hit.on('pointerup', () => {
            g.setScale(1);
            goToScene(this, 'LevelSelect');
        });
    }

    startDrop() {
        this.state = State.DROPPING;
        if (this.cocktail) {
            // Ингредиент коктейля — две капли с разных сторон
            const ing = this.cocktail.ingredient;
            this.drop = this.createDrop(0.3, ing.icons[0], ing.dye, false);
            this.drop2 = this.createDrop(0.7, ing.icons[1], ing.dyeB, true);
            return;
        }
        this.drop = this.createDrop(this.level.dropX ?? 0.5, this.level.icons.dye, this.level.dye, false);
    }

    // Падает сам ингредиент — иконка, вращаясь; second — второй краситель
    createDrop(at, icon, color, second) {
        const dropX = this.glass.x + this.glass.width * at;
        const image = this.add.image(dropX, this.glass.y + this.params.dropRadius, iconKey(icon))
            .setDisplaySize(DROP_ICON_SIZE, DROP_ICON_SIZE).setDepth(4);
        this.tweens.add({ targets: image, angle: 200, duration: 900 });
        // След за падающей каплей
        const trail = this.add.particles(0, 0, 'fx-dot', {
            speed: { min: 5, max: 30 },
            scale: { start: 0.9, end: 0 },
            alpha: { start: 0.7, end: 0 },
            lifespan: 320,
            frequency: 16,
            tint: color
        }).setDepth(4);
        trail.startFollow(image);
        return { image, trail, vy: 0, color, second };
    }

    // Капля — не часть симуляции: падает сама и проверяет касание поверхности жидкости
    updateDrop(drop, dt) {
        drop.vy += LIQUID.gravity * dt;
        drop.image.y += drop.vy * dt;

        const { x, y } = drop.image;
        const sim = this.liquid.sim;
        const dropRadius = this.params.dropRadius;
        const hitDist = dropRadius + LIQUID.particleRadius;
        const hitDistSq = hitDist * hitDist;

        const floor = this.shape ? this.shape.bottom : this.glass.y + this.glass.height;
        let hit = y + dropRadius >= floor;
        for (let i = 0; !hit && i < sim.count; i++) {
            const dx = sim.x[i] - x;
            const dy = sim.y[i] - y;
            hit = dx * dx + dy * dy < hitDistSq;
        }
        if (hit) this.onDropImpact(drop, x, y);
    }

    onDropImpact(drop, x, y) {
        const { image, trail } = drop;
        // Ингредиент тонет: сжимается и растворяется в жидкости
        this.tweens.killTweensOf(image);
        this.tweens.add({ targets: image, scale: 0, alpha: 0, angle: image.angle + 90, duration: 220, onComplete: () => image.destroy() });
        trail.stop();
        this.time.delayedCall(400, () => trail.destroy());
        if (drop === this.drop) this.drop = null;
        else this.drop2 = null;

        this.liquid.addDye(x, y, drop.second);
        this.cameras.main.shake(150, 0.006);
        ripple(this, x, y, drop.color);
        ripple(this, x, y, this.level.result, { delay: 120, scale: 3.2 });
        splash(this, x, y, drop.color);
        this.sfx.plop();
        this.haptics.pulse(0.8, true);
        if (this.state === State.SHAKING) return; // Вторая капля — игра уже идёт
        this.state = State.SHAKING;
        platform.gameplayStart();
        if (this.cocktail) {
            this.cocktailStarted = true;
            this.readyButton.setVisible(true);
        }
        const beat = levelBeat(this.level);
        if (beat) {
            // Начальная задержка — сохранённая с прошлых уровней или оценка по звуку телефона
            const offset = loadSetting('rhythmOffset', this.sfx.outputLatency + RHYTHM.inputLatency);
            this.rhythm = new Rhythm(beat, RHYTHM, now() + RHYTHM.startDelay, offset);
            this.sfx.duck(true);
        }

        this.statusText.setText(t('shake')).setColor(this.hintColor).setScale(0.3).setAlpha(1);
        this.tweens.add({ targets: this.statusText, scale: 1, duration: 260, ease: 'Back.Out' });
        this.tweens.add({ targets: this.statusText, alpha: 0, scale: 1.4, delay: 900, duration: 400 });
    }

    update(time, deltaMs) {
        const dt = Math.min(deltaMs, 50) / 1000;
        this.lastDt = dt;

        // Жидкость реагирует на телефон во всех фазах — её можно поплескать и до капли
        const input = this.shake.update(dt);
        const mixing = this.state === State.SHAKING;
        this.shakeBar.scaleX = input.intensity;
        if (input.strokes > 0) {
            this.lastStrokeAge = 0;
            this.strokeAvg += (input.strokePower / input.strokes - this.strokeAvg) * 0.2;
            if (mixing) this.onStroke();
        } else {
            this.lastStrokeAge += dt;
        }
        this.shakeBar.fillColor = this.lastStrokeAge < 0.35 ? UI_COLORS.gold : 0x5a6390;

        if (this.drop) this.updateDrop(this.drop, dt);
        if (this.drop2) this.updateDrop(this.drop2, dt);

        const liquid = this.liquid;
        liquid.applyShake(input, dt);
        // Окраска — порциями за встряхивания; физика решает только, какие частицы окрасятся следующими.
        // Пока звучит метроном, сразу засчитывается только часть — остальное за попадание в такт
        // Каждое встряхивание взвешивается профилем удара этой жидкости: густой нужны медленные
        // сильные размахи, лёгкой хватает частой мелкой тряски (game/StrokeProfile.js)
        const portion = this.strokeMeter.consume(input);
        if (mixing) liquid.addStrokes(portion * (this.rhythm ? this.offBeat : 1));
        liquid.step(dt);
        this.syncSprites();

        this.sfx.update(liquid.impact);
        this.haptics.update(liquid.impact);

        if (!mixing) {
            if (this.cocktailStarted && this.state !== State.WIN && this.state !== State.LOSE) {
                this.elapsed += dt;
                this.refreshHud();
                if (this.elapsed >= this.params.maxTime) this.endLevel(false);
            }
            return;
        }

        this.elapsed += dt;
        const comboChange = this.combo.update(dt, input.strokes, input.strokePower);
        if (comboChange > 0) this.onComboUp();
        else if (comboChange < 0) this.onComboLost();
        if (this.rhythm) this.updateRhythm(input);
        this.updatePourHint(dt);
        if (liquid.dual) this.updateSecondDrop();
        this.checkMilestones();
        this.displayScore += (this.combo.points - this.displayScore) * Math.min(1, dt * 8);
        this.refreshHud();

        if (liquid.allColored) {
            this.endLevel(true);
        } else if (this.elapsed >= this.params.maxTime) {
            this.endLevel(false);
        }
    }

    // Каждое засчитанное встряхивание — короткая вспышка полосы прогресса: видно, что оно сработало
    onStroke() {
        const bar = this.progressBar;
        this.tweens.killTweensOf(bar);
        bar.scaleY = 1.6;
        bar.setAlpha(1);
        this.tweens.add({ targets: bar, scaleY: 1, duration: 140, ease: 'Quad.Out' });
    }

    onComboUp() {
        const m = this.combo.multiplier;
        this.tweens.add({ targets: this.comboText, scale: 1.5, duration: 120, yoyo: true });
        sparkle(this, this.comboText.x - this.comboText.width / 2, this.comboText.y, this.look2.sparks.color);
        popText(this, this.layout.width / 2, this.glass.y + 120, t('combo', { n: m }), { color: this.hintColor, size: 56 + m * 4 });
        this.sfx.chime(m);
        this.haptics.pulse(0.5, true);

        // На максимальном множителе он пульсирует, пока серия жива
        if (m === COMBO.max && !this.comboPulse) {
            this.comboPulse = this.tweens.add({ targets: this.comboText, scale: 1.18, duration: 260, yoyo: true, repeat: -1 });
        }
    }

    onComboLost() {
        if (this.comboPulse) {
            this.comboPulse.remove();
            this.comboPulse = null;
            this.comboText.setScale(1);
        }
        popText(this, this.comboText.x - 110, this.comboText.y + 40, t('comboLost'), { color: this.hintColor, size: 24, rise: 40, hold: 300 });
    }

    // Цвета ингредиента в шейдере: основа → две капли → их смесь
    applyIngredientColors() {
        const ing = this.cocktail.ingredient;
        this.pipeline.setColors(this.level.base, ing.result);
        // Без светлой кромки: жидкость — ровно того цвета, что и образец при том же сгущении
        this.pipeline.rim = 0;
    }

    // Образец — силуэт фрукта цвета образца прямо в жидкости у дна: когда цвет совпал, фрукт растворяется
    // в жидкости. Он лежит ПОД передним стеклом, как и жидкость: стекло подмешивало свой цвет только
    // к жидкости, и совпавшие на глаз цвета расходились на деле (на «Урагане» — вдвое больше допуска).
    // «Готово» — кнопка внизу (жмётся, когда телефон неподвижен).
    // Процент и полоса прогресса спрятаны: цвет подгоняют глазами
    createCocktailUI() {
        const L = this.layout;
        const g = this.glass;
        let cx = g.x + g.width - SAMPLE_SIZE / 2 - 30;
        let cy = g.y + g.height - SAMPLE_SIZE / 2 - 40;
        if (this.shape) [cx, cy] = this.samplePlace(SAMPLE_SIZE / 2 + 26);
        this.add.text(cx, cy - SAMPLE_SIZE / 2 - 18, t('sample'), { font: uiFont(20), color: UI_COLORS.text, stroke: '#0b0c10', strokeThickness: 5 })
            .setOrigin(0.5).setDepth(UI_DEPTH);
        this.sample = this.addSilhouette(cx, cy, this.cocktail.ingredient.icons[0], SAMPLE_SIZE, 0xffffff, SAMPLE_DEPTH);
        // «Ингредиент N/M» стоит в строке полосы прогресса, которой в «Баре» нет: так он не лезет на стекло
        // и не слипается с полосой тряски
        this.ingredientText = this.add.text(g.x, L.hudProgressY, '', { font: uiFont(26), color: UI_COLORS.text, ...softShadow(6) })
            .setOrigin(0, 0.5).setDepth(UI_DEPTH);
        // «Готово» — у донышка стакана: до него легко дотянуться большим пальцем, и он не закрывает жидкость
        const floor = this.shape ? this.shape.bottom : g.y + g.height;
        this.readyButton = createButton(this, {
            x: L.width / 2, y: Math.min(floor + 54, L.height - 48), width: 230, height: 64, label: t('ready'), color: 0x2e8b57,
            onClick: () => this.onReady()
        }).setDepth(UI_DEPTH).setVisible(false);
        this.percentText.setVisible(false);
        this.remainingText.setVisible(false);
        this.progressBar.setVisible(false);
        this.progressTrack.setVisible(false);
        this.showIngredient();
    }

    // Место образца в фигурном стакане: самое нижнее, где он целиком помещается справа от середины
    samplePlace(radius) {
        const s = this.shape;
        for (let y = s.bottom - radius; y > s.top + radius; y -= 4) {
            const half = Math.min(s.halfWidthAt(y - radius), s.halfWidthAt(y), s.halfWidthAt(y + radius * 0.8));
            if (half >= radius * 2.2) return [s.cx + half - radius, y];
        }
        return [s.cx, (s.top + s.bottom) / 2];
    }

    // Силуэт иконки, залитый цветом; setColor и setIcon — смена образца.
    // Без контура и без каймы: силуэтная текстура раскрашивается умножением, на краю — цвет × альфа
    addSilhouette(x, y, icon, size, color, depth) {
        const fill = this.add.image(0, 0, silhouetteKey(icon)).setDisplaySize(size, size).setTint(color);
        const box = this.add.container(x, y, [fill]).setDepth(depth);
        box.setColor = (c) => fill.setTint(c);
        box.setIcon = (name) => fill.setTexture(silhouetteKey(name)).setDisplaySize(size, size);
        return box;
    }

    showIngredient() {
        const c = this.cocktail;
        const sampleColor = c.color(c.index, c.ingredient.target);
        this.sample.setIcon(c.ingredient.icons[0]);
        this.sample.setColor(sampleColor);
        this.ingredientText.setText(t('ingredient', { i: c.index + 1, n: c.count }));
        // Подсказки — цвета образца: что сейчас подгоняешь, тем цветом и подсказывают
        this.hintColor = hexColor(sampleColor);
        this.comboText.setColor(this.hintColor);
    }

    // Игрок решил, что цвет совпал с образцом
    onReady() {
        if (this.state !== State.SHAKING) return;
        this.state = State.BETWEEN;
        this.readyButton.setVisible(false);
        platform.gameplayStop();
        this.sfx.chime(3);
        this.haptics.pulse(0.5, true);
        const c = this.cocktail;
        const more = c.finish(this.liquid.progress);
        popText(this, this.layout.width / 2, this.glass.y + 200, t(more ? 'ingredientReady' : 'mixing'), { color: this.hintColor, size: 46 });
        this.time.delayedCall(1100, () => (more ? this.nextIngredient() : this.combine()));
    }

    // Следующий ингредиент: жидкость снова чистая, новые цвета и образец, падают две капли
    nextIngredient() {
        this.liquid.resetDye();
        this.applyIngredientColors();
        this.showIngredient();
        this.startDrop();
    }

    // Соединение: сравниваем каждый ингредиент с образцом; не попавший — переделать (время идёт)
    combine() {
        const c = this.cocktail;
        const wrong = c.wrong();
        const L = this.layout;
        const parts = [];
        // Строка ингредиента: образец · что получилось · точность попадания (и в какую сторону промах);
        // внизу — итоговый коктейль (смесь ингредиентов): недотряс одного виден и в нём
        const row = c.count > 3 ? 100 : 120;
        const top = this.glass.y + (c.count > 2 ? 120 : 220);
        const depth = UI_DEPTH + 3;
        const rows = c.count + 1;
        const panelH = rows * row + 190;
        const combinePanel = this.add.graphics().setDepth(UI_DEPTH + 2);
        combinePanel.fillStyle(0x0b0c10, 0.9);
        combinePanel.fillRoundedRect(L.width / 2 - 310, top - 40, 620, panelH, 24);
        combinePanel.lineStyle(4, 0x414868, 1);
        combinePanel.strokeRoundedRect(L.width / 2 - 310, top - 40, 620, panelH, 24);
        parts.push(combinePanel);
        parts.push(this.add.text(L.width / 2 - 30, top, t('combineHeader'), { font: uiFont(22), color: UI_COLORS.light }).setOrigin(0.5).setDepth(depth));
        const swatch = row - 30;
        c.cfg.ingredients.forEach((ing, i) => {
            const y = top + 70 + i * row;
            const ok = !wrong.includes(i);
            const accuracy = c.accuracy(i);
            const miss = t(accuracy === 100 ? 'spotOn' : c.made[i] > ing.target ? 'over' : 'under');
            parts.push(this.addSilhouette(L.width / 2 - 190, y, ing.icons[0], swatch, c.color(i, ing.target), depth));
            parts.push(this.addSilhouette(L.width / 2 - 70, y, ing.icons[0], swatch, c.color(i, c.made[i]), depth));
            parts.push(this.add.text(L.width / 2 + 75, y - 14, `${accuracy}%`, { font: uiFont(44), color: ok ? '#2ecc71' : UI_COLORS.red }).setOrigin(0.5).setDepth(depth));
            parts.push(this.add.text(L.width / 2 + 75, y + 26, miss, { font: uiFont(20), color: UI_COLORS.light }).setOrigin(0.5).setDepth(depth));
            parts.push(this.add.text(L.width / 2 + 200, y, ok ? '✓' : '✗', { font: uiFont(60), color: ok ? '#2ecc71' : UI_COLORS.red }).setOrigin(0.5).setDepth(depth));
        });
        // Итоговый коктейль
        const fy = top + 70 + c.count * row;
        parts.push(this.add.text(L.width / 2 - 250, fy, t('cocktail'), { font: uiFont(22), color: UI_COLORS.goldText }).setOrigin(0, 0.5).setDepth(depth));
        parts.push(this.addSilhouette(L.width / 2 - 20, fy, this.level.icons.drink, swatch * 1.15, c.finalColor(false), depth));
        parts.push(this.addSilhouette(L.width / 2 + 110, fy, this.level.icons.drink, swatch * 1.15, c.finalColor(true), depth));
        parts.push(fitWidth(this.add.text(L.width / 2, fy + row * 0.62, t('averageAccuracy', { a: c.averageAccuracy, p: c.passAccuracy }), { font: uiFont(21), color: UI_COLORS.muted }).setOrigin(0.5).setDepth(depth), 580));
        const verdict = t(wrong.length === 0 ? 'cocktailReady' : 'wrongColor');
        parts.push(this.add.text(L.width / 2, fy + row * 0.62 + 52, verdict, {
            font: uiFont(34), color: wrong.length === 0 ? '#2ecc71' : UI_COLORS.red, ...softShadow(8)
        }).setOrigin(0.5).setDepth(UI_DEPTH + 3));
        if (wrong.length === 0) {
            this.serveCocktail();
            this.time.delayedCall(2800, () => { parts.forEach((p) => p.destroy()); this.endLevel(true); });
            return;
        }
        this.sfx.lose();
        this.haptics.pulse(0.9, true);
        this.time.delayedCall(3200, () => {
            parts.forEach((p) => p.destroy());
            c.redo(wrong[0]);
            this.nextIngredient();
        });
    }

    // Подача: жидкость в стакане становится цветом готового коктейля
    serveCocktail() {
        const liquid = this.liquid;
        this.pipeline.setColors(this.level.base, this.cocktail.finalColor(true));
        liquid.unevenness = 0;
        liquid.progress = 1;
        liquid.dyed = true;
    }

    // Первый краситель окрасил всё — сигнал, который слышно и чувствуется не глядя на экран
    // (во время тряски его не прочитать), и вторая капля падает сама
    updateSecondDrop() {
        if (this.secondDropped || !this.liquid.firstColored) return;
        this.secondDropped = true;
        this.sfx.win(false);
        this.haptics.pulse(1, true);
        this.time.delayedCall(180, () => this.haptics.pulse(1, true));
        this.drop2 = this.createDrop(0.5, this.level.icons.dyeB, this.level.dyeB, true);
    }

    // Этапы стакана с перегородкой: пробка вылетела → «НАКЛОНИ — ПЕРЕЛЕЙ!», пока прогресс стоит
    // у перегородки; соседний отсек открылся → «ТЕПЕРЬ ТРЯСИ!»
    updatePourHint(dt) {
        const liquid = this.liquid;
        if (liquid.gateOpened) this.popGates();
        this.blockedTime = liquid.blocked ? this.blockedTime + dt : 0;
        if (liquid.chamberOpened) {
            popText(this, this.layout.width / 2, this.glass.y + 120, t('shakeNow'), { color: this.hintColor, size: 48 });
            this.sfx.chime(5);
            this.haptics.pulse(0.5, true);
        }
        const show = this.blockedTime > 0.6;
        if (show === this.pourShown) return;
        this.pourShown = show;
        this.tweens.killTweensOf(this.pourText);
        if (show) {
            this.pourText.setAlpha(1).setScale(1);
            this.tweens.add({ targets: this.pourText, scale: 1.1, duration: 300, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
        } else {
            this.tweens.add({ targets: this.pourText, alpha: 0, duration: 200 });
        }
    }

    checkMilestones() {
        if (this.cocktail) return; // Вехи выдали бы, насколько сгущён цвет — подгонять нужно на глаз
        const milestone = MILESTONES[this.nextMilestone];
        if (!milestone || this.liquid.progress < milestone[0]) return;
        this.nextMilestone++;
        popText(this, this.layout.width / 2, this.layout.statusY + 60, t(milestone[1]), { color: this.hintColor, size: 52 });
        this.tweens.add({ targets: this.percentText, scale: 1.35, duration: 140, yoyo: true });
    }

    // Позиции и цвет из модели; setTint — только при смене ступени оттенка
    syncSprites() {
        const liquid = this.liquid;
        const { count } = liquid.sim;
        // Рисуем сглаженные по времени положения: дрожь стоячей жидкости не должна рябить кромкой
        this.draw.update(liquid.sim);
        // ...и ведём верх массы волной мелкой воды — поверхность идёт единым фронтом, а не зерном частиц
        const src = this.waves ? this.waves.update(this.draw, liquid.sim, this.lastDt || 1 / 60) : this.draw;
        const x = src.x;
        const y = src.y;
        const sprites = this.sprites;
        const tintStep = this.tintStep;
        const maxStep = COLORS.tintSteps - 1;

        for (let i = 0; i < count; i++) {
            const sprite = sprites[i];
            sprite.setPosition(x[i], y[i]);

            if (liquid.dual) {
                const a = (liquid.colorLevel(i) * maxStep + 0.5) | 0;
                const b = (liquid.colorLevel2(i) * maxStep + 0.5) | 0;
                const step = a * COLORS.tintSteps + b;
                if (step !== tintStep[i]) {
                    tintStep[i] = step;
                    sprite.setTint((Math.round(a / maxStep * 255) << 16) | 0x00ff00 | Math.round(b / maxStep * 255));
                }
                continue;
            }
            const step = (liquid.colorLevel(i) * maxStep + 0.5) | 0;
            if (step !== tintStep[i]) {
                tintStep[i] = step;
                sprite.setTint(this.colorLut[step]);
            }
        }
        if (this.mirrors) this.mirrors.update(src, this.glass, this.shape, sprites, count);
    }

    // Тексты перерисовываются только при смене значения — пересоздание текстуры текста дорогое
    refreshHud() {
        const tenths = Math.floor(this.elapsed * 10);
        if (tenths !== this.shownTenths) {
            this.shownTenths = tenths;
            this.timerText.setText(t('sec', { v: (tenths / 10).toFixed(1) }));
        }

        // floor: 100% появляется только когда окрашены все частицы
        // Две капли: полоса и процент — по обоим этапам
        const liquid = this.liquid;
        const progress = liquid.dual ? (liquid.stage === 1 ? 1 + liquid.progress2 : liquid.progress) / 2 : liquid.progress;
        const percent = liquid.allColored ? 100 : Math.min(99, Math.floor(progress * 100));
        if (percent !== this.shownPercent) {
            this.shownPercent = percent;
            this.percentText.setText(`${percent}%`);
        }
        this.progressBar.scaleX = progress;

        const left = liquid.dual ? 2 - (liquid.stage === 1 ? 1 + liquid.progress2 : liquid.progress) : 1 - progress;
        const remaining = liquid.allColored ? 0 : Math.ceil(left / (this.params.portion * Math.max(0.3, this.strokeAvg)));
        if (remaining !== this.shownRemaining) {
            this.shownRemaining = remaining;
            this.remainingText.setText(remaining > 0 ? t('remaining', { n: remaining }) : '');
        }

        const score = Math.floor(this.displayScore / 10) * 10;
        if (score !== this.shownScore) {
            this.shownScore = score;
            this.scoreText.setText(formatNumber(score));
        }

        const multiplier = this.combo.multiplier;
        if (multiplier !== this.shownMultiplier) {
            this.shownMultiplier = multiplier;
            this.comboText.setText(`×${multiplier}`);
        }
        // Серия затухает на паузе — множитель тускнеет, пока не сгорит
        this.comboText.setAlpha(0.35 + 0.65 * this.combo.heat);
    }

    endLevel(isWin) {
        this.state = isWin ? State.WIN : State.LOSE;
        platform.gameplayStop();
        this.statusText.setVisible(false);
        this.streakText.setAlpha(0);
        this.tweens.killTweensOf(this.pourText);
        this.pourText.setAlpha(0);
        this.sfx.duck(false);
        // Задержку ритма запоминаем, только если игрок держал темп — иначе оценка "уплыла" за случайной тряской
        if (this.rhythm && this.rhythm.beats > 0 && this.rhythm.hits / this.rhythm.beats >= 0.5) {
            saveSetting('rhythmOffset', this.rhythm.offset);
        }

        if (!isWin) {
            this.sfx.lose();
            this.time.delayedCall(500, () => this.showResults({ isWin: false }));
            return;
        }

        const time = this.elapsed;
        const accuracy = this.cocktail ? this.cocktail.averageAccuracy : 100;
        const stars = starsFor(this.level, time, accuracy);
        const shakePoints = Math.round(this.combo.shakePoints);
        const timeBonus = this.combo.timeBonus(time, this.params.maxTime);
        const score = shakePoints + timeBonus;
        const record = this.progress.submit(this.level.id, { time, score, stars });
        if (record.firstClear && this.levelIndex + 1 < LEVELS.length) this.progress.pendingUnlock = this.levelIndex + 1;

        // Монеты за заезд и продвижение задания дня (экономика — только косметика, на баланс не влияет)
        this.coinsEarned = this.economy.finishRun({ record, stars, bestStreak: this.rhythm ? this.rhythm.bestStreak : 0 });
        this.sfx.win(record.timeRecord);
        this.haptics.pulse(1, true);
        // Залп конфетти в цветах рецепта: снизу из-за краёв стакана и сверху по центру
        const colors = [this.level.base, this.level.dye, this.level.result, this.look2.sparks.color];
        const L = this.layout;
        confetti(this, this.glass.x, L.height * 0.75, colors, { angle: { min: 280, max: 330 } });
        confetti(this, this.glass.x + this.glass.width, L.height * 0.75, colors, { angle: { min: 210, max: 260 } });
        confetti(this, L.width / 2, this.glass.y, colors, { count: 40, angle: { min: 200, max: 340 } });
        this.time.delayedCall(500, () => this.showResults({ isWin: true, time, stars, shakePoints, timeBonus, score, record, accuracy, coins: this.coinsEarned }));
    }

    showResults({ isWin, time, stars, shakePoints, timeBonus, score, record, accuracy, coins = 0 }) {
        const L = this.layout;
        const cx = L.width / 2;
        const cy = L.height / 2;
        const width = 600;
        const height = isWin ? 700 : 402;
        const top = cy - height / 2;
        const items = [];
        const add = (obj) => {
            items.push(obj.setDepth(PANEL_DEPTH));
            return obj;
        };

        // Затемнение перехватывает касания: кнопки уровня под панелью не нажимаются
        const overlay = add(this.add.rectangle(cx, cy, L.width, L.height, 0x0b0c10).setInteractive());
        const panel = add(this.add.graphics());
        panel.fillStyle(UI_COLORS.panel, 0.97);
        panel.fillRoundedRect(cx - width / 2, top, width, height, 28);
        panel.lineStyle(4, isWin ? this.level.result : 0xff4a4a, 1);
        panel.strokeRoundedRect(cx - width / 2, top, width, height, 28);

        // Над панелью — готовый напиток (при проигрыше — серый ингредиент, который не размешали)
        const badge = add(this.add.image(cx, top - 6, iconKey(isWin ? this.level.icons.drink : this.level.icons.dye)).setDisplaySize(120, 120));
        if (isWin) {
            // Готовый напиток светится цветом коктейля
            const light = add(halo(this, cx, top - 6, this.level.result, { size: 210, alpha: 0.6 }));
            badge.setDepth(PANEL_DEPTH + 0.1);
            this.tweens.add({ targets: [badge, light], y: top - 18, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
        }
        else badge.setTint(0x777777);

        const isRecord = isWin && record.timeRecord && record.previousBestTime !== null;
        if (isRecord) rays(this, cx, top + 84, UI_COLORS.gold).setDepth(PANEL_DEPTH);
        const title = t(isWin ? (isRecord ? 'newRecord' : 'done') : 'timeUp');
        // Надпись над лучами и свечением оставлена с обводкой — на вспышках без неё сливается
        const titleText = add(this.add.text(cx, top + 84, title, {
            font: uiFont(50), color: isWin ? UI_COLORS.goldText : UI_COLORS.red,
            stroke: '#0b0c10', strokeThickness: 8
        }).setOrigin(0.5));
        if (isRecord) this.tweens.add({ targets: titleText, scale: 1.1, duration: 420, yoyo: true, repeat: -1 });
        // Надпись победы светится золотом (тень с размытием рисуется вместе с текстом — бесплатно в кадре)
        // Запас по краям — иначе свечение обрезается прямоугольником текстуры текста
        if (isWin) titleText.setPadding(26).setShadow(0, 0, '#f1c40f', 22, true, true);
        // Вокруг звёзд и напитка коротко вспыхивают блики-звёздочки
        if (isWin) glints(this, cx, top + 120, width - 80, 260, { color: UI_COLORS.gold, depth: PANEL_DEPTH + 1 });

        let y = top + 142;
        if (isWin) {
            // Звёзды появляются по одной — каждая со звоном (всё выше), искрами и щелчком вибрации
            for (let s = 0; s < 3; s++) {
                const star = add(this.add.graphics({ x: cx + (s - 1) * 120, y: y + 60 }));
                drawStar(star, 0, 0, 48, false);
                if (s < stars) {
                    this.time.delayedCall(350 + s * 320, () => {
                        star.clear();
                        drawStar(star, 0, 0, 48, true);
                        add(halo(this, star.x, star.y, UI_COLORS.gold, { size: 190, alpha: 0.7 }));
                        star.setDepth(PANEL_DEPTH + 0.1);
                        star.setScale(0.3).setAngle(-30);
                        this.tweens.add({ targets: star, scale: 1, angle: 0, duration: 300, ease: 'Back.Out' });
                        sparkle(this, star.x, star.y, this.look2.sparks.color, { count: 20, depth: PANEL_DEPTH + 1 });
                        this.sfx.chime(s * 2);
                        this.haptics.pulse(0.6, true);
                    });
                }
            }
            y += 150;

            let timeLine = t('time', { t: time.toFixed(2) });
            if (record.timeRecord && record.previousBestTime !== null) {
                timeLine += t('was', { t: record.previousBestTime.toFixed(2) });
            } else if (!record.timeRecord) {
                timeLine += t('best', { t: this.progress.get(this.level.id).bestTime.toFixed(2) });
            }
            add(fitWidth(this.add.text(cx, y, timeLine, { font: uiFont(30), color: UI_COLORS.text }).setOrigin(0.5), width - 40));
            y += 56;
            add(fitWidth(this.add.text(cx, y, t('score', { s: formatNumber(score) }) + (record.scoreRecord ? t('bestScore') : ''), {
                font: uiFont(30), color: record.scoreRecord ? UI_COLORS.goldText : UI_COLORS.text
            }).setOrigin(0.5), width - 40));
            y += 40;
            add(fitWidth(this.add.text(cx, y, t('scoreParts', { shake: formatNumber(shakePoints), speed: formatNumber(timeBonus) }), {
                font: uiFont(22), color: UI_COLORS.muted
            }).setOrigin(0.5), width - 40));
            y += 38;
            const r = this.rhythm;
            if (this.cocktail) {
                add(fitWidth(this.add.text(cx, y, t('accuracy', { a: accuracy, three: STAR_ACCURACY[0], two: STAR_ACCURACY[1] }), {
                    font: uiFont(22), color: accuracy >= STAR_ACCURACY[0] ? '#2ecc71' : UI_COLORS.light
                }).setOrigin(0.5), width - 40));
            } else if (r) {
                const share = r.beats > 0 ? Math.round(r.hits / r.beats * 100) : 0;
                add(fitWidth(this.add.text(cx, y, t('beatShare', { share, streak: r.bestStreak }), {
                    font: uiFont(22), color: share >= 50 ? '#2ecc71' : UI_COLORS.light
                }).setOrigin(0.5), width - 40));
            }
            if (coins > 0) {
                y += 44;
                add(fitWidth(this.add.text(cx, y, t('coinsEarned', { n: coins }), {
                    font: uiFont(26), color: UI_COLORS.goldText
                }).setOrigin(0.5), width - 40));
            }
            y += 50;
            if (stars < 3) {
                const goal = stars === 1 ? this.level.stars[1] : this.level.stars[0];
                const line = this.cocktail
                    ? t('nextStarAccuracy', { a: STAR_ACCURACY[stars === 1 ? 1 : 0], t: goal })
                    : t('nextStar', { t: goal });
                add(fitWidth(this.add.text(cx, y, line, {
                    font: uiFont(24), color: UI_COLORS.light
                }).setOrigin(0.5), width - 40));
            }
        } else {
            add(fitWidth(this.add.text(cx, y + 30, t('lost', { t: this.params.maxTime }), {
                font: uiFont(28), color: UI_COLORS.light, align: 'center'
            }).setOrigin(0.5), width - 40));
        }

        // Кнопки внизу панели
        const buttonsY = top + height - 70;
        const hasNext = isWin && this.levelIndex + 1 < LEVELS.length;
        const buttons = [
            { label: t('levels'), onClick: () => goToScene(this, 'LevelSelect') },
            { label: t('retry'), onClick: () => goToScene(this, 'Game', { levelIndex: this.levelIndex }) }
        ];
        if (hasNext) buttons.push({ label: t('next'), onClick: () => goToScene(this, 'Game', { levelIndex: this.levelIndex + 1 }) });
        const buttonWidth = 170;
        const buttonObjects = buttons.map((b, i) => {
            const x = cx + (i - (buttons.length - 1) / 2) * (buttonWidth + 16);
            return add(createButton(this, { x, y: buttonsY, width: buttonWidth, height: 80, label: b.label, onClick: b.onClick }));
        });

        // Панель проявляется, кнопки выпрыгивают снизу по очереди
        for (const obj of items) {
            if (buttonObjects.includes(obj)) continue;
            obj.setAlpha(0);
            this.tweens.add({ targets: obj, alpha: obj === overlay ? 0.6 : 1, duration: 250 });
        }
        buttonObjects.forEach((button, i) => {
            button.setScale(0).setAlpha(1);
            this.tweens.add({ targets: button, scale: 1, delay: (isWin ? 300 + stars * 320 : 250) + i * 90, duration: 280, ease: 'Back.Out' });
        });
        // Проигрыш — панель вздрагивает
        if (!isWin) this.tweens.add({ targets: [panel, titleText], x: '+=12', duration: 50, yoyo: true, repeat: 3, delay: 250 });
    }
}

// Мягкий круг с радиальным градиентом — капли с размытыми краями сливаются в сплошную массу
function createSoftCircle(scene, key, size) {
    const texture = scene.textures.createCanvas(key, size, size);
    const ctx = texture.getContext();
    const r = size / 2;
    const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    texture.refresh();
}

// Таблица оттенков считается один раз — в кадре нет интерполяции цвета и создания объектов
function buildColorLut(from, to, steps) {
    const fr = (from >> 16) & 255, fg = (from >> 8) & 255, fb = from & 255;
    const tr = (to >> 16) & 255, tg = (to >> 8) & 255, tb = to & 255;
    const lut = new Array(steps);
    for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const r = Math.round(fr + (tr - fr) * t);
        const g = Math.round(fg + (tg - fg) * t);
        const b = Math.round(fb + (tb - fb) * t);
        lut[i] = (r << 16) | (g << 8) | b;
    }
    return lut;
}
