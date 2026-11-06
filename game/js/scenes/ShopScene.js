import { GAME_WIDTH } from '../config.js';
import { UI_COLORS, createButton, uiFont, softShadow, safeTop, fitWidth, hexColor } from '../ui/widgets.js';
import { ensureFxTextures, ambientBackground, sparkle, goToScene } from '../ui/fx.js';
import { drawGarnish, FRAMES } from '../ui/garnish.js';
import { COSMETICS, SLOTS } from '../game/cosmetics.js';
import { t } from '../i18n.js';

// Магазин косметики: вкладки по слотам (стекло, гарнир, фон, искры), в каждой — плитки с образцом,
// ценой и состоянием (куплено / надето). Косметика ни на что в игре не влияет — рекорды сравнимы.
const COLUMNS = 3;
const TILE = 190;
const GAP = 22;
const HEADER = 190;
// Окно образца гарнира: что из кромки стакана и предмета попадает в плитку (px поля при ободке
// 600, кромка на y = 0). Подобрано по предмету, а не по стакану — на плитке видно именно его
const PREVIEW_W = 160;
const PREVIEW_H = 112;
const PREVIEW_WINDOW = {
    slice: [-70, -40, 330, 210],
    cherry: [-150, -80, 250, 230],
    umbrella: [-200, -60, 280, 400],
    mint: [-60, -320, 340, 120],
    straw: [-120, -210, 190, 200],
    rim: [-110, -34, 110, 40]
};

export class ShopScene extends Phaser.Scene {
    constructor({ progress, economy, sfx, haptics }) {
        super('Shop');
        this.progress = progress;
        this.economy = economy;
        this.sfx = sfx;
        this.haptics = haptics;
    }

    init(data) {
        this.slot = (data && data.slot) || SLOTS[0];
    }

    create() {
        const cx = GAME_WIDTH / 2;
        this.leaving = false;
        // Любой выход из магазина (и «назад», и смена вкладки со сцены) гасит пульсацию кошелька на карте
        this.events.once('shutdown', () => this.economy.markShopSeen());
        const inset = safeTop(this);
        this.header = HEADER + inset;

        ensureFxTextures(this);
        ambientBackground(this, GAME_WIDTH, this.scale.height, 0x8338ec);
        this.cameras.main.fadeIn(250, 11, 12, 16);

        // Шапка: «назад», название, кошелёк
        const head = this.add.graphics().setScrollFactor(0).setDepth(20);
        head.fillStyle(0x0b0c10, 1);
        head.fillRect(0, 0, GAME_WIDTH, this.header);
        head.fillStyle(UI_COLORS.border, 1);
        head.fillRect(0, this.header - 8, GAME_WIDTH, 8);
        head.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.55, 0.55, 0, 0);
        head.fillRect(0, this.header, GAME_WIDTH, 44);

        this.createBackButton(44, inset + 46);
        this.add.text(cx, inset + 46, t('shop'), { font: uiFont(38), color: UI_COLORS.goldText, ...softShadow(10) })
            .setOrigin(0.5).setScrollFactor(0).setDepth(21);
        this.coinsText = this.add.text(GAME_WIDTH - 40, inset + 46, '', { font: uiFont(30), color: UI_COLORS.light })
            .setOrigin(1, 0.5).setScrollFactor(0).setDepth(21);
        this.drawCoins();

        // Вкладки слотов
        const tabW = (GAME_WIDTH - 60) / SLOTS.length;
        SLOTS.forEach((slot, i) => {
            const x = 30 + tabW * (i + 0.5);
            const active = slot === this.slot;
            const g = this.add.graphics().setScrollFactor(0).setDepth(21);
            g.fillStyle(active ? UI_COLORS.button : 0x161a2b, 1);
            g.fillRoundedRect(x - tabW / 2 + 4, inset + 106, tabW - 8, 56, 14);
            g.lineStyle(3, active ? UI_COLORS.gold : UI_COLORS.border, 1);
            g.strokeRoundedRect(x - tabW / 2 + 4, inset + 106, tabW - 8, 56, 14);
            const label = this.add.text(x, inset + 134, t('slot_' + slot), {
                font: uiFont(22), color: active ? UI_COLORS.text : UI_COLORS.muted
            }).setOrigin(0.5).setScrollFactor(0).setDepth(22);
            fitWidth(label, tabW - 20);
            const hit = this.add.zone(x, inset + 134, tabW - 8, 56).setScrollFactor(0).setDepth(22).setInteractive({ useHandCursor: true });
            hit.on('pointerup', () => {
                if (slot === this.slot) return;
                this.sfx.chime(1);
                this.scene.restart({ slot });
            });
        });

        this.buildTiles();
    }

    drawCoins() {
        this.coinsText.setText(`${this.economy.coins} ${t('coinsShort')}`);
    }

    buildTiles() {
        const cx = GAME_WIDTH / 2;
        const items = COSMETICS[this.slot];
        this.tiles = [];
        let y = this.header + 40;
        items.forEach((it, i) => {
            const col = i % COLUMNS;
            const row = Math.floor(i / COLUMNS);
            const x = cx + (col - (COLUMNS - 1) / 2) * (TILE + GAP);
            this.tiles.push(this.createTile(x, y + TILE / 2 + row * (TILE + 46), it));
        });
        const rows = Math.ceil(items.length / COLUMNS);
        const bottom = y + rows * (TILE + 46) + 40;
        this.setupScroll(bottom);
    }

    createTile(x, y, it) {
        const owned = this.economy.owns(this.slot, it.id);
        const equipped = this.economy.equipped(this.slot).id === it.id;
        const card = this.add.container(x, y);
        const frame = this.add.graphics();
        card.add(frame);
        const paint = () => {
            const eq = this.economy.equipped(this.slot).id === it.id;
            const own = this.economy.owns(this.slot, it.id);
            frame.clear();
            frame.fillStyle(UI_COLORS.card, 1);
            frame.fillRoundedRect(-TILE / 2, -TILE / 2, TILE, TILE, 22);
            frame.lineStyle(eq ? 7 : 4, eq ? UI_COLORS.gold : (own ? UI_COLORS.border : 0x2a2f4a), 1);
            frame.strokeRoundedRect(-TILE / 2, -TILE / 2, TILE, TILE, 22);
        };
        paint();
        card.add(this.preview(it));

        const name = this.add.text(0, TILE / 2 + 16, t(it.name), {
            font: uiFont(19), color: UI_COLORS.light, align: 'center'
        }).setOrigin(0.5);
        fitWidth(name, TILE + GAP - 6);
        card.add(name);

        const price = this.add.text(0, TILE / 2 - 24, '', { font: uiFont(20), color: UI_COLORS.goldText }).setOrigin(0.5);
        card.add(price);
        const refresh = () => {
            const eq = this.economy.equipped(this.slot).id === it.id;
            const own = this.economy.owns(this.slot, it.id);
            price.setText(eq ? t('equipped') : own ? t('equip') : `${it.price} ${t('coinsShort')}`);
            price.setColor(eq ? UI_COLORS.goldText : own ? UI_COLORS.light : (this.economy.coins >= it.price ? UI_COLORS.goldText : UI_COLORS.muted));
            paint();
        };
        refresh();

        const hit = this.add.zone(0, 0, TILE, TILE).setInteractive({ useHandCursor: true });
        card.add(hit);
        hit.on('pointerdown', () => card.setScale(0.95));
        hit.on('pointerout', () => card.setScale(1));
        hit.on('pointerup', () => {
            card.setScale(1);
            if (this.dragged) return;
            if (this.economy.owns(this.slot, it.id)) {
                this.economy.equip(this.slot, it.id);
                this.sfx.chime(2);
            } else if (this.economy.buy(this.slot, it.id)) {
                this.sfx.chime(5);
                this.haptics.pulse(0.6, true);
                sparkle(this, card.x, card.y, UI_COLORS.gold, { count: 22 });
                this.drawCoins();
            } else {
                this.sfx.lose();
                this.tweens.add({ targets: card, x: card.x + 10, duration: 50, yoyo: true, repeat: 3 });
                return;
            }
            this.tiles.forEach((tile) => tile.refresh());
        });

        card.refresh = refresh;
        return card;
    }

    // Образец предмета внутри плитки
    preview(it) {
        const box = this.add.container(0, -10);
        if (this.slot === 'glass') {
            const g = this.add.graphics();
            g.fillStyle(it.tint, 0.5);
            g.fillRoundedRect(-34, -52, 68, 104, { tl: 8, tr: 8, bl: 20, br: 20 });
            g.lineStyle(6, it.tint, 1);
            g.strokeRoundedRect(-34, -52, 68, 104, { tl: 8, tr: 8, bl: 20, br: 20 });
            box.add(g);
        } else if (this.slot === 'garnish') {
            // Образец — крупный план: окно в мерках игры вокруг самого предмета, по нему и обрезка,
            // и масштаб. Целиком предмет настоящего размера в плитку не лезет, а в одном масштабе
            // на всех соломинка была ниткой, а кайма — невидимой полоской
            const half = 300;
            const depth = 560;
            const win = PREVIEW_WINDOW[it.id];
            if (win) {
                const [x0, y0, x1, y1] = win;
                const k = Math.min(PREVIEW_W / (x1 - x0), PREVIEW_H / (y1 - y0));
                const shelf = this.add.container(-((x0 + x1) / 2) * k, -((y0 + y1) / 2) * k).setScale(k);
                const g = this.add.graphics();
                // Кусок стакана в пределах окна: тело ниже кромки и сама кромка
                const gx0 = Math.max(x0, -half), gx1 = Math.min(x1, half);
                g.fillStyle(0x2a2f4a, 1);
                g.fillRect(gx0, 0, gx1 - gx0, Math.max(0, Math.min(y1, depth)));
                g.fillStyle(0x4a5578, 1);
                g.fillRect(gx0, -8, gx1 - gx0, 16);
                shelf.add(g);
                const art = drawGarnish(this, it.id, { cx: 0, top: 0, half, bottom: depth }, 0, 1,
                    { x0, y0, x1, y1 });
                if (art) shelf.add(art);
                box.add(shelf);
            }
        } else if (this.slot === 'scene') {
            const g = this.add.graphics();
            const bottom = it.bottom === null ? 0x2a2f4a : it.bottom;
            g.fillGradientStyle(it.top, it.top, bottom, bottom, 1);
            g.fillRoundedRect(-58, -48, 116, 96, 14);
            g.fillStyle(it.bubbles === null ? 0xc0caf5 : it.bubbles, 0.8);
            for (let k = 0; k < 7; k++) g.fillCircle(-44 + ((k * 53) % 92), 36 - ((k * 31) % 76), 3 + (k % 3));
            box.add(g);
        } else {
            const g = this.add.graphics();
            g.fillStyle(it.color, 1);
            for (let k = 0; k < 7; k++) {
                const a = (Math.PI * 2 * k) / 7;
                g.fillCircle(Math.cos(a) * 36, Math.sin(a) * 36, 7 - (k % 3) * 2);
            }
            g.fillCircle(0, 0, 13);
            box.add(g);
        }
        return box;
    }

    createBackButton(x, y) {
        const w = 48;
        const h = 44;
        const g = this.add.graphics({ x, y }).setScrollFactor(0).setDepth(21);
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
        const hit = this.add.zone(x, y, w + 16, h + 16).setScrollFactor(0).setDepth(22).setInteractive({ useHandCursor: true });
        hit.on('pointerup', () => goToScene(this, 'LevelSelect'));
    }

    // Прокрутка пальцем, как на карте уровней
    setupScroll(contentBottom) {
        const camera = this.cameras.main;
        this.maxScroll = Math.max(0, contentBottom - this.scale.height);
        this.scrollVelocity = 0;
        this.dragged = false;
        if (this.maxScroll === 0) return;
        let startY = 0;
        let startScroll = 0;
        this.input.on('pointerdown', (p) => {
            startY = p.y;
            startScroll = camera.scrollY;
            this.dragged = false;
        });
        this.input.on('pointermove', (p) => {
            if (!p.isDown) return;
            if (Math.abs(p.y - startY) > 12) this.dragged = true;
            if (this.dragged) camera.scrollY = Phaser.Math.Clamp(startScroll - (p.y - startY), 0, this.maxScroll);
        });
    }
}
