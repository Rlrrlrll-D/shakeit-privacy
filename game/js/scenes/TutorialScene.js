import { GAME_WIDTH } from '../config.js';
import { UI_COLORS, createButton, drawStar, uiFont, softShadow, safeTop, fitWidth, BUTTON_RADIUS } from '../ui/widgets.js';
import { ensureFxTextures, ambientBackground, goToScene } from '../ui/fx.js';
import { iconKey } from './BootScene.js';
import { t } from '../i18n.js';
import { loadSetting, saveSetting } from '../util/Settings.js';

// Как играть: показывается один раз перед первым заездом, дальше — по кнопке «?» на карте.
// Четыре карточки: что делать, как трясти, ритм, звёзды. Рисунки — графикой и иконками игры,
// чтобы не тянуть картинки
const SEEN = 'tutorialSeen';
const CARD_H = 196;

export function tutorialSeen() {
    return loadSetting(SEEN, false);
}

export class TutorialScene extends Phaser.Scene {
    constructor({ shake, progress, economy, sfx, haptics }) {
        super('Tutorial');
        this.shake = shake;
        this.progress = progress;
        this.economy = economy;
        this.sfx = sfx;
        this.haptics = haptics;
    }

    // from — куда вернуться по кнопке: 'LevelSelect' или сразу на уровень { levelIndex }
    init(data) {
        this.from = data || {};
    }

    create() {
        const cx = GAME_WIDTH / 2;
        const height = this.scale.height;
        this.leaving = false;
        const inset = safeTop(this);

        ensureFxTextures(this);
        ambientBackground(this, GAME_WIDTH, height, 0x8338ec);
        this.cameras.main.fadeIn(250, 11, 12, 16);

        const title = this.add.text(cx, inset + 70, t('howToPlay'), {
            font: uiFont(46), color: UI_COLORS.goldText, ...softShadow(12)
        }).setOrigin(0.5);
        fitWidth(title, GAME_WIDTH - 80);

        // Карточки объяснений: рисунок слева, текст справа
        // Без датчика (браузер на компьютере) шейкер водят мышью или пальцем — подсказки про это
        const pointer = this.shake.pointerActive();
        const cards = [
            ['shake', t(pointer ? 'tipShakePointerTitle' : 'tipShakeTitle'), t(pointer ? 'tipShakePointerText' : 'tipShakeText')],
            ['grip', t(pointer ? 'tipGripPointerTitle' : 'tipGripTitle'), t(pointer ? 'tipGripPointerText' : 'tipGripText')],
            ['beat', t('tipBeatTitle'), t('tipBeatText')],
            ['stars', t('tipStarsTitle'), t('tipStarsText')]
        ];
        const top = inset + 130;
        cards.forEach(([art, head, body], i) => {
            this.addCard(cx, top + i * (CARD_H + 16) + CARD_H / 2, art, head, body);
        });

        const buttonY = Math.min(top + cards.length * (CARD_H + 16) + 60, height - 60);
        createButton(this, {
            x: cx, y: buttonY, width: 300, height: 76, label: t('gotIt'), color: 0x2e8b57, fontSize: 30,
            onClick: () => {
                saveSetting(SEEN, true);
                this.sfx.chime(3);
                if (Number.isInteger(this.from.levelIndex)) goToScene(this, 'Game', { levelIndex: this.from.levelIndex });
                else goToScene(this, 'LevelSelect');
            }
        });
    }

    addCard(cx, cy, art, head, body) {
        const w = GAME_WIDTH - 60;
        const g = this.add.graphics();
        g.fillStyle(UI_COLORS.card, 0.9);
        g.fillRoundedRect(cx - w / 2, cy - CARD_H / 2, w, CARD_H, 22);
        g.lineStyle(3, UI_COLORS.border, 1);
        g.strokeRoundedRect(cx - w / 2, cy - CARD_H / 2, w, CARD_H, 22);

        const artX = cx - w / 2 + 92;
        this[art + 'Art'](artX, cy);

        const textX = artX + 76;
        const textW = w / 2 + 146;
        this.add.text(textX, cy - 54, head, { font: uiFont(26), color: UI_COLORS.goldText }).setOrigin(0, 0.5);
        this.add.text(textX, cy + 16, body, {
            font: uiFont(21), color: UI_COLORS.light, wordWrap: { width: textW }, lineSpacing: 6
        }).setOrigin(0, 0.5);
    }

    // Рисунок «тряси»: телефон со стаканом внутри и дуги движения по бокам
    shakeArt(x, y) {
        const g = this.add.graphics();
        g.fillStyle(UI_COLORS.button, 1);
        g.fillRoundedRect(x - 26, y - 46, 52, 92, 10);
        g.lineStyle(3, 0xc0caf5, 1);
        g.strokeRoundedRect(x - 26, y - 46, 52, 92, 10);
        g.fillStyle(0xffd23f, 1);
        g.fillRoundedRect(x - 16, y - 4, 32, 40, 6);
        g.lineStyle(5, 0x2ec4b6, 1);
        for (const dir of [-1, 1]) {
            g.beginPath();
            g.arc(x, y, 50, dir > 0 ? -0.5 : Math.PI - 0.5, dir > 0 ? 0.5 : Math.PI + 0.5);
            g.strokePath();
            g.fillStyle(0x2ec4b6, 1);
            g.fillTriangle(x + dir * 62, y, x + dir * 44, y - 12, x + dir * 44, y + 12);
        }
    }

    // Рисунок «держи крепче»: рука-ладонь, обхватившая телефон
    gripArt(x, y) {
        const g = this.add.graphics();
        g.fillStyle(UI_COLORS.button, 1);
        g.fillRoundedRect(x - 22, y - 48, 44, 96, 9);
        g.lineStyle(3, 0xc0caf5, 1);
        g.strokeRoundedRect(x - 22, y - 48, 44, 96, 9);
        g.fillStyle(0xffb703, 1);
        g.fillRoundedRect(x - 44, y - 10, 46, 52, 14);     // ладонь
        for (let k = 0; k < 3; k++) g.fillRoundedRect(x - 6, y - 4 + k * 17, 34, 13, 6); // пальцы
        g.fillRoundedRect(x - 50, y - 26, 20, 34, 9);      // большой палец
    }

    // Рисунок «в такт»: метроном-маятник и доли
    beatArt(x, y) {
        const g = this.add.graphics();
        g.fillStyle(UI_COLORS.button, 1);
        g.fillTriangle(x, y - 46, x - 34, y + 42, x + 34, y + 42);
        g.lineStyle(3, 0xc0caf5, 1);
        g.strokeTriangle(x, y - 46, x - 34, y + 42, x + 34, y + 42);
        g.lineStyle(5, 0x2ecc71, 1);
        g.lineBetween(x, y + 36, x + 18, y - 30);
        g.fillStyle(0x2ecc71, 1);
        g.fillCircle(x + 14, y - 14, 9);
        for (let k = 0; k < 3; k++) {
            g.fillStyle(0xffffff, 0.9 - k * 0.25);
            g.fillCircle(x + 46 + k * 16, y - 34, 5 - k);
        }
    }

    // Рисунок «звёзды»: три звезды и секундомер
    starsArt(x, y) {
        const g = this.add.graphics();
        for (let s = 0; s < 3; s++) drawStar(g, x + (s - 1) * 36, y - 16, 17, true);
        g.lineStyle(4, 0xc0caf5, 1);
        g.strokeCircle(x, y + 34, 20);
        g.lineBetween(x, y + 34, x, y + 22);
        g.lineBetween(x, y + 34, x + 11, y + 38);
        g.lineBetween(x - 7, y + 10, x + 7, y + 10);
    }
}
