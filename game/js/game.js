import { GAME_WIDTH, SHAKE, FEEDBACK, gameHeightFor } from './config.js';
import { ShakeInput, requestMotionPermission } from './input/ShakeInput.js';
import { GameScene } from './scenes/GameScene.js';
import { LevelSelectScene } from './scenes/LevelSelectScene.js';
import { BootScene } from './scenes/BootScene.js';
import { TutorialScene } from './scenes/TutorialScene.js';
import { ShopScene } from './scenes/ShopScene.js';
import { LiquidLabScene } from './scenes/LiquidLabScene.js';
import { Progress } from './game/Progress.js';
import { Economy } from './game/Economy.js';
import { LEVELS, CHAPTERS } from './game/levels.js';
import { LiquidPipeline } from './render/LiquidPipeline.js';
import { SoundEngine } from './feedback/SoundEngine.js';
import { Haptics } from './feedback/Haptics.js';
import { loadSetting } from './util/Settings.js';
import { platform } from './platform/platform.js';

// В нативном приложении Capacitor сам внедряет window.Capacitor до загрузки страницы
const isNative = Boolean(window.Capacitor?.isNativePlatform?.());

// Ввод живёт дольше сцены: при перезапуске уровня слушатели датчика не пересоздаются.
// В браузере без датчика трясут мышью или пальцем (pointer); адрес ?debug включает синусоиду по зажатию
const debugInput = new URLSearchParams(window.location.search).has('debug');
const shake = new ShakeInput(SHAKE, { debug: !isNative && debugInput, pointer: !isNative });
const sound = new SoundEngine(FEEDBACK);
// Портал может попросить выключить звук — это приоритетнее выбора игрока
sound.setMuted(loadSetting('muted', false) || platform.muted);
platform.onMuteChange((muted) => sound.setMuted(muted || loadSetting('muted', false)));
sound.loadSamples(FEEDBACK.files);
const haptics = new Haptics(FEEDBACK);
// Всё, что живёт дольше сцен (переживает переходы между картой и уровнями)
const deps = { shake, progress: new Progress(LEVELS, CHAPTERS), economy: new Economy(), sfx: sound, haptics };

// Разрешения на датчик (iOS) и запуск звука (браузеры) требуют жеста пользователя
window.addEventListener('pointerdown', () => requestMotionPermission(), { once: true });
// Звук — на каждом касании: iOS глушит его, когда игру свернули или позвонили, и вернуть можно только по жесту
window.addEventListener('pointerdown', () => sound.resume());

const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: GAME_WIDTH,
    height: gameHeightFor(window.innerWidth, window.innerHeight),
    parent: 'game-container',
    backgroundColor: '#0f111a', // Совпадает с фоном страницы — на нестандартных экранах края незаметны
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    render: {
        powerPreference: 'high-performance'
    },
    pipeline: { LiquidPipeline },
    // Первая сцена в списке стартует автоматически: загрузка ресурсов, затем карта уровней
    scene: [new BootScene(), new LevelSelectScene(deps), new GameScene(deps), new TutorialScene(deps), new ShopScene(deps), new LiquidLabScene(deps)]
});
window.__game = game; // Отладка с компьютера через DevTools (CDP): состояние сцен, снимки кадра

// Пропорции экрана могут смениться после старта (скрылись системные панели, окно браузера изменили) —
// пересчитываем высоту поля и перезапускаем уровень с новой раскладкой
let resizeTimer = 0;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        const height = gameHeightFor(window.innerWidth, window.innerHeight);
        if (Math.abs(height - game.scale.height) < 4) return;
        game.scale.setGameSize(GAME_WIDTH, height);
        for (const scene of game.scene.getScenes(true)) scene.scene.restart();
    }, 150);
});

// Доступ из консоли браузера для отладки (в нативной сборке не нужен)
if (!isNative) window.game = game;
