import { GAME_WIDTH, MAP_HEADER } from '../config.js';
import { CHAPTERS, LEVELS } from '../game/levels.js';
import { UI_COLORS, drawStar, drawLock, drawSoundIcon, hexColor, uiFont, safeTop, fitWidth, softShadow } from '../ui/widgets.js';
import { saveSetting } from '../util/Settings.js';
import { ensureFxTextures, ambientBackground, sparkle, ripple, goToScene } from '../ui/fx.js';
import { iconKey } from './BootScene.js';
import { t, levelName, chapterTitle, chapterSubtitle, language, setLanguage, LANGUAGES, LANGUAGE_NAMES } from '../i18n.js';
import { tutorialSeen } from './TutorialScene.js';
import { platform } from '../platform/platform.js';


const COLUMNS = 3;
const CARD = 190;
const GAP = 25;
const NAME_SPACE = 30;       // px: под карточкой — название уровня
const ROW = CARD + NAME_SPACE + GAP;
const DRAG_THRESHOLD = 14;   // px: сдвиг пальца больше — это перелистывание, а не нажатие на карточку
const PAGE = GAME_WIDTH;     // px: страница — глава на всю ширину экрана; между главами — свайп вбок
const FLICK = 450;           // px/с: быстрее — перелистывание, даже если палец прошёл меньше половины страницы
const EDGE_PULL = 0.35;      // доля сдвига пальца за краем (первая и последняя страница «тянутся» с сопротивлением)
const PAGE_TWEEN = 300;      // мс: страница доезжает до своего места
const HEADER = MAP_HEADER;   // px: шапка (логотип и звёзды) закреплена, карточки прокручиваются под ней;
                             // сверху к ней добавляется вырез камеры. На той же высоте — HUD уровня
const LOGO_WIDTH = 640;      // px: логотип-граффити (www/images/logo.png, рисует tools/make_logo.py)
let keepPage = null;         // Страница, на которой остаться при перезапуске сцены (смена языка, награда за задание)
let launched = false;        // Первый показ карты после запуска приложения: он открывается на первой главе
const FOOTER = 96;           // px: планка у нижнего края: точки глав и стрелки
const LOGO_S_LEFT = 0.053;   // Левый край буквы S — доля ширины картинки логотипа (по ней выровнена кнопка языка)
const ICON = 138;            // px: иконка ингредиента — главное в карточке

// Карта уровней: закреплённая шапка, главы, карточки в цвете главы со звёздами, замки на закрытых уровнях
export class LevelSelectScene extends Phaser.Scene {
    constructor({ progress, economy, sfx, haptics }) {
        super('LevelSelect');
        this.progress = progress;
        this.economy = economy;
        this.sfx = sfx;
        this.haptics = haptics;
    }

    create() {
        const progress = this.progress;
        const cx = GAME_WIDTH / 2;
        const height = this.scale.height;
        this.leaving = false;
        this.cards = [];
        // Объект сцены переживает заход (scene.start его не пересоздаёт), поэтому всё, что копится по ходу,
        // обнуляем здесь: иначе набор «показанных» страниц оставался от прошлого раза, и после возврата с
        // уровня карточки соседних глав так и сидели нулевого размера — страницы выглядели пустыми
        this.revealed = new Set();
        this.pageTween = null;
        this.dragged = false;
        this.languageMenu = null;
        const top = 0; // Карта длиннее экрана и прокручивается — отсчёт от верха
        // Шапка опущена под вырез камеры: логотип не прячется за ней
        const inset = safeTop(this);
        this.header = HEADER + inset;

        ensureFxTextures(this);
        // Фон — по одному на главу (цвет главы); при перелистывании они плавно перетекают друг в друга
        this.backgrounds = CHAPTERS.map((chapter) => ambientBackground(this, GAME_WIDTH, height, chapter.color));
        this.cameras.main.fadeIn(250, 11, 12, 16);

        // Только что открытый уровень показывается закрытым и открывается анимацией
        const unlocking = progress.pendingUnlock;
        progress.pendingUnlock = null;

        // Шапка закреплена: не прокручивается; карточки уходят под неё за чёткую линию-границу
        const header = this.add.container(0, 0).setScrollFactor(0).setDepth(20);
        const shade = this.add.graphics();
        shade.fillStyle(0x0b0c10, 1);
        shade.fillRect(0, 0, GAME_WIDTH, this.header);
        shade.fillStyle(UI_COLORS.border, 1);
        shade.fillRect(0, this.header - 8, GAME_WIDTH, 8);
        // Мягкая тень под границей: шапка как будто нависает над прокруткой
        shade.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.55, 0.55, 0, 0);
        shade.fillRect(0, this.header, GAME_WIDTH, 44);
        const title = this.add.image(cx, inset + 108, 'logo');
        title.setDisplaySize(LOGO_WIDTH, LOGO_WIDTH * title.height / title.width);

        // Счётчик звёзд накручивается от нуля
        const stars = this.add.graphics();
        drawStar(stars, cx - 70, inset + 186, 18, true);
        const total = progress.totalStars;
        const counter = this.add.text(cx - 44, inset + 186, `0 / ${LEVELS.length * 3}`, {
            font: uiFont(32), color: UI_COLORS.light
        }).setOrigin(0, 0.5);
        header.add([shade, title, stars, counter]);
        // Планка у нижнего края: как шапка, но ниже. Карточки уходят под неё за такую же линию,
        // сверху — короткая тень
        const footTop = height - FOOTER;
        const foot = this.add.graphics().setScrollFactor(0).setDepth(20);
        foot.fillStyle(0x0b0c10, 1);
        foot.fillRect(0, footTop, GAME_WIDTH, FOOTER);
        foot.fillStyle(UI_COLORS.border, 1);
        foot.fillRect(0, footTop, GAME_WIDTH, 8);
        foot.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.55, 0.55);
        foot.fillRect(0, footTop - 26, GAME_WIDTH, 26);
        // Нажатие на планку не должно попадать в карточку под ней
        this.add.zone(0, footTop, GAME_WIDTH, FOOTER).setOrigin(0).setScrollFactor(0).setDepth(21).setInteractive();
        // Нажатие на шапку не должно попадать в карточку, уехавшую под неё
        this.add.zone(0, 0, GAME_WIDTH, this.header).setOrigin(0).setScrollFactor(0).setDepth(21).setInteractive();
        // Кнопка языка — по левому краю буквы S логотипа, кнопка звука — по правому краю «!»; ниже счётчика
        // Ряд кнопок — у нижней границы шапки, чтобы не наезжать на счётчик звёзд
        const buttonsY = this.header - 48;
        const buttonsLeft = cx - LOGO_WIDTH / 2 + LOGO_WIDTH * LOGO_S_LEFT;
        const buttonsRight = cx + LOGO_WIDTH / 2 - LOGO_WIDTH * LOGO_S_LEFT;
        this.createLanguageButton(buttonsLeft, buttonsY);
        this.createSoundButton(buttonsRight, buttonsY);
        this.createHelpButton(buttonsRight - 76, buttonsY);
        this.createWallet(buttonsLeft + 76, buttonsY);
        this.tweens.addCounter({
            from: 0, to: total, duration: 300 + total * 30, delay: 200,
            onUpdate: (t) => counter.setText(`${Math.round(t.getValue())} / ${LEVELS.length * 3}`)
        });

        const nextIndex = progress.nextIndex;
        this.pageCount = CHAPTERS.length;
        // Задание дня закреплено под шапкой: видно на любой странице, и ни от какой прокрутки не зависит
        const dailyBottom = this.addDailyBar(cx, this.header + 18);
        // Какая страница открывается: у открывающегося уровня — его глава, иначе — глава следующего уровня
        const focusIndex = unlocking != null ? unlocking : nextIndex;
        const focusLevel = LEVELS[Math.min(LEVELS.length - 1, focusIndex)];
        const focusPage = Math.max(0, CHAPTERS.findIndex((c) => c.id === focusLevel.chapter));
        // При запуске приложения — первая глава, как бы далеко игрок ни ушёл; после уровня — глава следующего
        const firstShow = !launched && unlocking == null;
        launched = true;
        const startPage = keepPage !== null ? Math.min(keepPage, CHAPTERS.length - 1) : (firstShow ? 0 : focusPage);
        keepPage = null;
        CHAPTERS.forEach((chapter, pageIndex) => {
            this.buildPage(chapter, pageIndex, { top: dailyBottom, bottom: footTop - 20, nextIndex, unlocking, startPage });
        });
        this.createPager(startPage, footTop);
    }

    // Язык: маленькая кнопка слева в шапке (глобус и стрелка) — по нажатию выпадает список языков.
    // Всё поверх зоны шапки (иначе та перехватит нажатие) и не прокручивается вместе с картой
    createLanguageButton(left, y) {
        const depth = 22;
        const w = 62;
        const h = 36;
        const x = left + w / 2;
        const g = this.add.graphics({ x, y }).setScrollFactor(0).setDepth(depth);
        g.fillStyle(UI_COLORS.button, 1);
        g.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
        g.lineStyle(2, UI_COLORS.border, 1);
        g.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
        g.lineStyle(2, 0xc0caf5, 1);
        g.strokeCircle(-9, 0, 10);
        g.strokeEllipse(-9, 0, 9, 20);
        g.lineBetween(-19, 0, 1, 0);
        g.fillStyle(0xc0caf5, 1);
        g.fillTriangle(11, -3, 21, -3, 16, 3);
        const hit = this.add.zone(x, y, w, h).setScrollFactor(0).setDepth(depth).setInteractive({ useHandCursor: true });
        hit.on('pointerup', () => this.toggleLanguageMenu(left, y + h / 2 + 6));
    }

    // Звук: маленькая кнопка справа в шапке — включает и выключает звук всей игры (на уровне кнопки нет:
    // в уровнях с метрономом ритм держится на звуке)
    createSoundButton(right, y) {
        const depth = 22;
        const w = 62;
        const h = 36;
        const x = right - w / 2;
        const bg = this.add.graphics({ x, y }).setScrollFactor(0).setDepth(depth);
        bg.fillStyle(UI_COLORS.button, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
        bg.lineStyle(2, UI_COLORS.border, 1);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
        const icon = this.add.graphics({ x: x + 1, y }).setScrollFactor(0).setDepth(depth).setScale(0.7);
        drawSoundIcon(icon, this.sfx.muted);
        const hit = this.add.zone(x, y, w, h).setScrollFactor(0).setDepth(depth).setInteractive({ useHandCursor: true });
        hit.on('pointerup', () => {
            const muted = !this.sfx.muted;
            if (!muted && platform.muted) return;   // Портал просил тишину — кнопка звук не включит
            this.sfx.setMuted(muted);
            this.sfx.resume();
            saveSetting('muted', muted);
            drawSoundIcon(icon, muted);
            if (!muted) this.sfx.chime(2);
        });
    }

    // Кошелёк: монеты и вход в магазин
    createWallet(left, y) {
        const depth = 22;
        const h = 36;
        // Ширина по числу монет: сначала надпись, потом подложка под неё
        const label = this.add.text(left + 40, y, String(this.economy.coins), { font: uiFont(21), color: UI_COLORS.light })
            .setOrigin(0, 0.5).setScrollFactor(0).setDepth(depth);
        const w = Math.max(74, 52 + label.width);
        const x = left + w / 2;
        const g = this.add.graphics({ x, y }).setScrollFactor(0).setDepth(depth - 0.1);
        g.fillStyle(UI_COLORS.button, 1);
        g.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
        g.lineStyle(2, UI_COLORS.border, 1);
        g.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
        g.fillStyle(UI_COLORS.gold, 1);
        g.fillCircle(-w / 2 + 20, 0, 11);
        g.fillStyle(0xb8860b, 1);
        g.fillCircle(-w / 2 + 20, 0, 6);
        // Золотое кольцо расходится от кошелька, пока в магазине есть что купить на эти монеты
        if (this.economy.shopHasNews) {
            const ring = this.add.graphics({ x, y }).setScrollFactor(0).setDepth(depth - 0.2);
            ring.lineStyle(3, UI_COLORS.gold, 1);
            ring.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
            this.tweens.add({ targets: ring, scaleX: 1.22, scaleY: 1.5, alpha: 0, duration: 1100, ease: 'Sine.Out', repeat: -1, repeatDelay: 500 });
        }
        const hit = this.add.zone(x, y, w, h + 8).setScrollFactor(0).setDepth(depth).setInteractive({ useHandCursor: true });
        hit.on('pointerup', () => goToScene(this, 'Shop'));
    }

    // Задание дня: полоса под шапкой с прогрессом; когда выполнено — нажать и забрать монеты
    addDailyBar(cx, y) {
        const task = this.economy.daily;
        if (task.claimed) return y;
        const w = COLUMNS * CARD + (COLUMNS - 1) * GAP;   // вровень с рядом карточек
        const h = 64;
        const g = this.add.graphics().setScrollFactor(0).setDepth(3);
        const done = task.done;
        g.fillStyle(UI_COLORS.card, 0.95);
        g.fillRoundedRect(cx - w / 2, y, w, h, 16);
        g.lineStyle(3, done ? UI_COLORS.gold : UI_COLORS.border, 1);
        g.strokeRoundedRect(cx - w / 2, y, w, h, 16);
        // Полоска прогресса. Скругление не больше половины ширины, и при нулевом прогрессе не рисуем
        // вовсе: узкий прямоугольник со скруглением 13 превращается в мусор на левом краю
        const share = Math.min(1, task.progress / task.goal);
        const fill = (w - 8) * share;
        if (fill > 2) {
            g.fillStyle(done ? UI_COLORS.gold : 0x2ec4b6, done ? 0.4 : 0.32);
            g.fillRoundedRect(cx - w / 2 + 4, y + 4, fill, h - 8, Math.min(13, fill / 2));
        }
        this.add.text(cx - w / 2 + 18, y + h / 2 - 11, t('daily_' + task.id, { n: task.goal }), {
            font: uiFont(20), color: UI_COLORS.text
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(3);
        this.add.text(cx - w / 2 + 18, y + h / 2 + 14, done ? t('dailyClaim', { n: task.coins }) : `${task.progress} / ${task.goal}`, {
            font: uiFont(18), color: done ? UI_COLORS.goldText : UI_COLORS.muted
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(3);
        if (done) {
            const hit = this.add.zone(cx, y + h / 2, w, h).setScrollFactor(0).setDepth(3).setInteractive({ useHandCursor: true });
            hit.on('pointerup', () => {
                if (this.dragged) return;
                const coins = this.economy.claimDaily();
                if (!coins) return;
                this.sfx.chime(5);
                this.haptics.pulse(0.7, true);
                sparkle(this, cx, y + h / 2, UI_COLORS.gold, { count: 26 });
                keepPage = this.page;
                this.time.delayedCall(450, () => this.scene.restart());
            });
        }
        return y + h + 22;
    }

    // «?» — показать «Как играть» ещё раз
    createHelpButton(right, y) {
        const depth = 22;
        const size = 36;
        const x = right - size / 2;
        const g = this.add.graphics({ x, y }).setScrollFactor(0).setDepth(depth);
        g.fillStyle(UI_COLORS.button, 1);
        g.fillRoundedRect(-size / 2, -size / 2, size, size, 12);
        g.lineStyle(2, UI_COLORS.border, 1);
        g.strokeRoundedRect(-size / 2, -size / 2, size, size, 12);
        this.add.text(x, y + 1, '?', { font: uiFont(22), color: UI_COLORS.light })
            .setOrigin(0.5).setScrollFactor(0).setDepth(depth);
        const hit = this.add.zone(x, y, size + 8, size + 8).setScrollFactor(0).setDepth(depth).setInteractive({ useHandCursor: true });
        // Короткое нажатие — «Как играть»; долгое (1.2 с) открывает служебную лабораторию жидкости
        let hold = null;
        hit.on('pointerdown', () => {
            hold = this.time.delayedCall(1200, () => { hold = null; goToScene(this, 'LiquidLab'); });
        });
        hit.on('pointerup', () => {
            if (!hold) return;
            hold.remove();
            hold = null;
            goToScene(this, 'Tutorial');
        });
        hit.on('pointerout', () => { if (hold) { hold.remove(); hold = null; } });
    }

    // Выпадающий список языков под кнопкой; текущий отмечен золотом и галочкой. Нажатие мимо закрывает
    // список — по отпусканию пальца, чтобы карточка под ним не получила нажатие
    toggleLanguageMenu(left, top) {
        if (this.languageMenu) {
            this.languageMenu.forEach((o) => o.destroy());
            this.languageMenu = null;
            return;
        }
        const depth = 23;
        const w = 170;
        const item = 46;
        const pad = 6;
        const x = left;
        const h = LANGUAGES.length * item + pad * 2;
        const blocker = this.add.zone(0, 0, GAME_WIDTH, this.scale.height).setOrigin(0).setScrollFactor(0).setDepth(depth).setInteractive();
        blocker.on('pointerup', () => this.toggleLanguageMenu());
        const panel = this.add.graphics().setScrollFactor(0).setDepth(depth);
        panel.fillStyle(UI_COLORS.panel, 0.98);
        panel.fillRoundedRect(x, top, w, h, 12);
        panel.lineStyle(2, UI_COLORS.border, 1);
        panel.strokeRoundedRect(x, top, w, h, 12);
        const parts = [blocker, panel];
        LANGUAGES.forEach((code, i) => {
            const cy = top + pad + item * i + item / 2;
            const current = code === language();
            const color = current ? UI_COLORS.goldText : UI_COLORS.light;
            const name = this.add.text(x + 18, cy, LANGUAGE_NAMES[code], { font: uiFont(20), color }).setOrigin(0, 0.5);
            parts.push(name);
            if (current) parts.push(this.add.text(x + w - 16, cy, '✓', { font: uiFont(22), color }).setOrigin(1, 0.5));
            const hit = this.add.zone(x + w / 2, cy, w, item).setInteractive({ useHandCursor: true });
            hit.on('pointerup', () => {
                if (current) {
                    this.toggleLanguageMenu();
                    return;
                }
                setLanguage(code);
                this.sfx.chime(2);
                keepPage = this.page;
                this.scene.restart();
            });
            parts.push(hit);
        });
        parts.slice(2).forEach((o) => o.setScrollFactor(0).setDepth(depth + 0.1));
        parts.slice(1).forEach((o) => {
            o.setAlpha(0);
            this.tweens.add({ targets: o, alpha: 1, duration: 120 });
        });
        this.languageMenu = parts;
    }

    // Заголовок главы: название, звёзды главы и условие открытия (или подзаголовок). Возвращает y под ним
    addChapterHeader(chapter, cx, y, levels = []) {
        this.add.text(cx, y, chapterTitle(chapter), { font: uiFont(34), color: hexColor(chapter.color), ...softShadow(10) }).setOrigin(0.5);
        y += 40;
        // Звёзды главы: сколько собрано из возможных (у закрытой — только условие открытия, оно ниже)
        const locked = chapter.requiredStars && this.progress.totalStars < chapter.requiredStars;
        if (levels.length && !locked) {
            const have = levels.reduce((sum, { level }) => sum + (this.progress.get(level.id).stars || 0), 0);
            const g = this.add.graphics();
            drawStar(g, cx - 52, y, 12, true);
            this.add.text(cx - 34, y, `${have} / ${levels.length * 3}`, { font: uiFont(22), color: UI_COLORS.light }).setOrigin(0, 0.5);
            y += 34;
        }
        if (locked) {
            const g = this.add.graphics();
            drawStar(g, cx - 92, y, 12, true);
            this.add.text(cx - 74, y, t('unlocksAt', { n: chapter.requiredStars }), { font: uiFont(22), color: UI_COLORS.goldText }).setOrigin(0, 0.5);
            y += 34;
        } else if (chapter.subtitle) {
            this.add.text(cx, y, chapterSubtitle(chapter), { font: uiFont(22), color: UI_COLORS.goldText }).setOrigin(0.5);
            y += 34;
        }
        return y + 14;
    }

    // Страница главы: заголовок и карточки, посаженные по высоте свободного места. Страницы стоят рядом
    // по горизонтали; камера сдвигается на ширину экрана (createPager). Всё, что должно стоять на месте
    // (шапка, планка, задание дня), закреплено scrollFactor(0)
    buildPage(chapter, pageIndex, { top, bottom, nextIndex, unlocking, startPage }) {
        const cx = pageIndex * PAGE + PAGE / 2;
        const levels = LEVELS.map((level, index) => ({ level, index })).filter(({ level }) => level.chapter === chapter.id);
        const rows = Math.ceil(levels.length / COLUMNS);
        // Заголовок главы: название, звёзды главы и условие открытия или подзаголовок
        const headerTop = top + 22;
        const y = this.addChapterHeader(chapter, cx, headerTop + 18, levels);
        // Свободное место делим: карточки не жмутся к заголовку и не сползают к планке
        const gridHeight = rows * ROW - GAP;
        const free = Math.max(0, bottom - y - gridHeight);
        const rowStep = ROW + Math.min(46, free * 0.18 / Math.max(1, rows));
        const gridTop = y + free * 0.32;
        const visible = pageIndex === startPage;
        levels.forEach(({ level, index }, i) => {
            const col = i % COLUMNS;
            const row = Math.floor(i / COLUMNS);
            // Последний неполный ряд — по центру, а не прижат к левому краю
            const inRow = row === rows - 1 ? levels.length - row * COLUMNS : COLUMNS;
            const x = cx + (col - (inRow - 1) / 2) * (CARD + GAP);
            const cardY = gridTop + CARD / 2 + row * rowStep;
            const card = this.createCard(x, cardY, level, index, index === nextIndex, index === unlocking);
            this.cards[index] = card;
            card.setData('page', pageIndex);
            // Карточки появляются волной: на открытой странице — сразу, на остальных — когда до них долистают
            card.setScale(0);
            if (visible) this.tweens.add({ targets: card, scale: 1, delay: 80 + i * 45, duration: 320, ease: 'Back.Out' });
            if (index === unlocking) this.time.delayedCall(700 + i * 45, () => this.playUnlock(card, level, index));
        });
        if (visible) this.revealed.add(pageIndex);
    }

    // Страница показывается впервые — карточки выезжают волной
    revealPage(pageIndex) {
        if (this.revealed.has(pageIndex)) return;
        this.revealed.add(pageIndex);
        let i = 0;
        for (const card of this.cards) {
            if (!card || card.getData('page') !== pageIndex) continue;
            this.tweens.add({ targets: card, scale: 1, delay: 120 + i * 45, duration: 320, ease: 'Back.Out' });
            i++;
        }
    }

    // Листание: палец тянет страницы по горизонтали, на отпускании они доезжают до ближней (или до соседней,
    // если движение быстрое). Точки в планке показывают, где ты, и нажимаются. Вертикальной прокрутки нет
    createPager(startPage, footTop) {
        const camera = this.cameras.main;
        const last = this.pageCount - 1;
        this.page = startPage;
        this.dragged = false;
        camera.scrollX = startPage * PAGE;
        this.pageTween = null;

        let startX = 0;
        let startScroll = 0;
        let lastX = 0;
        let lastTime = 0;
        let velocity = 0;
        let tracking = false;
        this.input.on('pointerdown', (pointer) => {
            this.dragged = false;
            // Нажатия в шапке и в планке страницы не листают — там свои кнопки
            tracking = pointer.y > this.header && pointer.y < footTop;
            if (!tracking) return;
            if (this.pageTween) this.pageTween.stop();
            startX = lastX = pointer.x;
            startScroll = camera.scrollX;
            lastTime = pointer.time;
            velocity = 0;
        });
        this.input.on('pointermove', (pointer) => {
            if (!pointer.isDown || !tracking) return;
            if (Math.abs(pointer.x - startX) > DRAG_THRESHOLD) this.dragged = true;
            if (!this.dragged) return;
            let target = startScroll - (pointer.x - startX);
            // За краем — с сопротивлением: дальше последней страницы тянется неохотно
            if (target < 0) target *= EDGE_PULL;
            else if (target > last * PAGE) target = last * PAGE + (target - last * PAGE) * EDGE_PULL;
            camera.scrollX = target;
            const dt = Math.max(1, pointer.time - lastTime);
            velocity = (lastX - pointer.x) / dt * 1000;
            lastX = pointer.x;
            lastTime = pointer.time;
        });
        this.input.on('pointerup', () => {
            if (!tracking || !this.dragged) return;
            tracking = false;
            let page = Math.round(camera.scrollX / PAGE);
            // Быстрый взмах листает на соседнюю страницу, даже если палец прошёл мало
            if (Math.abs(velocity) > FLICK) page = this.page + (velocity > 0 ? 1 : -1);
            this.goToPage(Phaser.Math.Clamp(page, 0, last));
        });

        this.createPagerFooter(footTop);
        this.refreshPager(true);
    }

    goToPage(page, instant = false) {
        const camera = this.cameras.main;
        const changed = page !== this.page;
        this.page = page;
        if (this.pageTween) this.pageTween.stop();
        if (instant) {
            camera.scrollX = page * PAGE;
        } else {
            this.pageTween = this.tweens.add({ targets: camera, scrollX: page * PAGE, duration: PAGE_TWEEN, ease: 'Cubic.Out' });
        }
        if (changed) {
            this.revealPage(page);
            this.sfx.chime(1);
        }
    }

    // Планка у нижнего края: по точке на главу (нажимаются) и стрелки по краям
    createPagerFooter(footTop) {
        const cy = footTop + 52;
        const gap = 64;
        this.dots = this.add.graphics().setScrollFactor(0).setDepth(22);
        this.dotCenters = CHAPTERS.map((chapter, i) => ({ x: GAME_WIDTH / 2 + (i - (this.pageCount - 1) / 2) * gap, y: cy, color: chapter.color }));
        this.dotCenters.forEach((dot, i) => {
            const hit = this.add.zone(dot.x, dot.y, gap, 64).setScrollFactor(0).setDepth(23).setInteractive({ useHandCursor: true });
            hit.on('pointerup', () => { if (!this.dragged) this.goToPage(i); });
        });
        // Стрелки: тот же жест, но кнопкой — для тех, кто не любит свайпы
        this.arrows = [-1, 1].map((dir) => {
            const x = GAME_WIDTH / 2 + dir * 250;
            const arrow = this.add.graphics().setScrollFactor(0).setDepth(22);
            const hit = this.add.zone(x, cy, 96, 80).setScrollFactor(0).setDepth(23).setInteractive({ useHandCursor: true });
            hit.on('pointerup', () => { if (!this.dragged) this.goToPage(Phaser.Math.Clamp(this.page + dir, 0, this.pageCount - 1)); });
            return { arrow, x, y: cy, dir };
        });
        this.pagerState = '';
    }

    // Точки и стрелки следуют за пальцем: размер точки зависит от того, насколько страница сейчас на экране
    refreshPager(force = false) {
        const position = this.cameras.main.scrollX / PAGE;
        const key = position.toFixed(2);
        if (!force && key === this.pagerState) return;
        this.pagerState = key;
        const g = this.dots;
        g.clear();
        this.dotCenters.forEach((dot, i) => {
            const near = Math.max(0, 1 - Math.abs(position - i));
            g.fillStyle(dot.color, 0.35 + near * 0.65);
            g.fillCircle(dot.x, dot.y, 8 + near * 7);
            if (near > 0.6) {
                g.lineStyle(3, dot.color, (near - 0.6) / 0.4 * 0.7);
                g.strokeCircle(dot.x, dot.y, 20);
            }
        });
        for (const { arrow, x, y, dir } of this.arrows) {
            arrow.clear();
            const can = dir < 0 ? position > 0.05 : position < this.pageCount - 1.05;
            arrow.lineStyle(7, 0xc0caf5, can ? 0.9 : 0.18);
            arrow.beginPath();
            arrow.moveTo(x - dir * 9, y - 18);
            arrow.lineTo(x + dir * 9, y);
            arrow.lineTo(x - dir * 9, y + 18);
            arrow.strokePath();
        }
        // Фоны глав перетекают: чем ближе страница, тем виднее её фон
        this.backgrounds.forEach((bg, i) => {
            const alpha = Phaser.Math.Clamp(1 - Math.abs(position - i), 0, 1);
            bg.sky.setAlpha(alpha);
            bg.bubbles.setAlpha(alpha);
        });
    }

    update() {
        this.refreshPager();
    }

    // Карточка — контейнер, все координаты внутри — относительно её центра
    createCard(x, y, level, index, isNext, showLocked) {
        const unlocked = this.progress.isUnlocked(index) && !showLocked;
        const result = this.progress.get(level.id);
        const color = chapterColor(level);
        const card = this.add.container(x, y);

        const frame = this.add.graphics();
        drawFrame(frame, unlocked ? color : UI_COLORS.border, isNext ? 9 : 7, unlocked ? 1 : 0.6, unlocked);
        card.add(frame);

        const content = this.add.container(0, 0);
        // Закрытый уровень: тёмный силуэт ингредиента под замком — видно, что впереди
        const lock = this.add.container(0, 0);
        if (unlocked) {
            this.fillCardContent(content, level, index, result.stars);
        } else {
            const silhouette = this.add.image(0, ICON_Y, iconKey(level.icons.dye)).setDisplaySize(ICON, ICON).setTintFill(0x2a2f4a);
            const padlock = this.add.graphics();
            drawLock(padlock, 0, ICON_Y + 8, 42);
            lock.add([silhouette, padlock]);
        }
        card.add([content, lock]);

        // Название — под карточкой: внутри остаётся место крупной иконке
        const name = this.add.text(0, CARD / 2 + NAME_SPACE / 2 + 2, levelName(level), {
            font: uiFont(19), color: unlocked ? UI_COLORS.light : UI_COLORS.muted, align: 'center'
        }).setOrigin(0.5);
        fitWidth(name, CARD + GAP - 6);
        card.add(name);

        if (isNext && unlocked) this.addNextRing(card, level);

        card.setData({ frame, content, lock, name });
        if (unlocked) this.makeClickable(card, index);
        return card;
    }

    fillCardContent(content, level, index, stars) {
        // Ингредиент уровня — крупно; звёзды — компактной строкой внизу
        const g = this.add.graphics();
        for (let s = 0; s < 3; s++) drawStar(g, (s - 1) * 34, 68, 14, s < stars);

        const icon = this.add.image(0, ICON_Y, iconKey(level.icons.dye)).setDisplaySize(ICON, ICON);
        content.add([g, icon]);
    }

    addNextRing(card, level) {
        const ring = this.add.graphics();
        ring.lineStyle(5, chapterColor(level), 1);
        ring.strokeRoundedRect(-CARD / 2 - 6, -CARD / 2 - 6, CARD + 12, CARD + 12, 26);
        card.add(ring);
        this.tweens.add({ targets: ring, alpha: 0.2, duration: 700, yoyo: true, repeat: -1 });
    }

    makeClickable(card, index) {
        const zone = this.add.zone(0, 0, CARD, CARD).setInteractive({ useHandCursor: true });
        card.add(zone);
        zone.on('pointerdown', () => card.setScale(0.94));
        zone.on('pointerout', () => card.setScale(1));
        zone.on('pointerup', () => {
            card.setScale(1);
            if (this.dragged) return; // Палец прокручивал карту, а не нажимал
            // Самый первый заезд — сначала «Как играть»
            if (!tutorialSeen()) goToScene(this, 'Tutorial', { levelIndex: index });
            else goToScene(this, 'Game', { levelIndex: index });
        });
    }

    // Открытие уровня: замок трясётся и улетает, карточка вспыхивает цветом рецепта
    playUnlock(card, level, index) {
        const { frame, content, lock, name } = card.data.values;
        this.tweens.add({
            targets: lock, angle: { from: -15, to: 15 }, duration: 70, yoyo: true, repeat: 4,
            onComplete: () => {
                this.tweens.add({ targets: lock, y: -60, alpha: 0, scale: 1.6, duration: 300, onComplete: () => lock.destroy() });
                drawFrame(frame, chapterColor(level), 9, 1, true);
                name.setColor(UI_COLORS.light);
                this.fillCardContent(content, level, index, 0);
                content.setScale(0);
                this.tweens.add({ targets: content, scale: 1, duration: 350, ease: 'Back.Out' });
                this.tweens.add({ targets: card, scale: 1.12, duration: 160, yoyo: true });
                ripple(this, card.x, card.y, chapterColor(level), { depth: 5 });
                sparkle(this, card.x, card.y, chapterColor(level), { count: 26 });
                this.addNextRing(card, level);
                this.makeClickable(card, index);
                this.sfx.chime(4);
                this.haptics.pulse(0.7, true);
            }
        });
    }
}

const ICON_Y = -18; // Центр иконки в карточке (выше середины: снизу — звёзды)

function chapterColor(level) {
    return CHAPTERS.find((chapter) => chapter.id === level.chapter).color;
}

// Рамка карточки: у открытой — мягкий ореол цвета главы снаружи и толстая чёткая линия
function drawFrame(g, color, width, alpha, glowing) {
    const half = CARD / 2;
    g.clear();
    if (glowing) {
        g.lineStyle(width + 10, color, 0.16);
        g.strokeRoundedRect(-half, -half, CARD, CARD, 22);
    }
    g.fillStyle(UI_COLORS.card, 1);
    g.fillRoundedRect(-half, -half, CARD, CARD, 22);
    g.lineStyle(width, color, alpha);
    g.strokeRoundedRect(-half, -half, CARD, CARD, 22);
}
