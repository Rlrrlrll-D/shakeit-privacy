// Языки интерфейса: русский и английский. Язык — выбор игрока (кнопка на карте), иначе язык телефона:
// русский для ru/uk/be/kk, остальным — английский. Названия уровней и глав по-русски живут в
// game/levels.js, здесь — только перевод
import { loadSetting, saveSetting } from './util/Settings.js';

export const LANGUAGES = ['ru', 'en'];
// Названия языков — каждый на самом себе: так их ищут в списке
export const LANGUAGE_NAMES = { ru: 'Русский', en: 'English' };

// Русское склонение по числу: 1 встряхивание, 2 встряхивания, 5 встряхиваний
function pluralRu(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

// Строка — шаблон с {параметрами}; функция — когда нужны склонения
const STRINGS = {
    ru: {
        sec: '{v}с',
        unlocksAt: 'откроется за {n}',
        shakeLabel: 'ТРЯСКА',
        levels: 'УРОВНИ',
        retry: 'ЕЩЁ',
        next: 'ДАЛЬШЕ',
        ready: 'ГОТОВО',
        beatTip: 'ТРЯСИ В ТАКТ — ВДВОЕ БЫСТРЕЕ',
        shake: 'ТРЯСИ!',
        shakeNow: 'ТЕПЕРЬ ТРЯСИ!',
        corkOut: 'ПРОБКА ОТКРЫТА!',
        tiltPour: 'НАКЛОНИ — ПЕРЕЛЕЙ!',
        onBeat: 'В ТАКТ ×{n}',
        perfectRhythm: 'ИДЕАЛЬНЫЙ РИТМ!',
        combo: 'СЕРИЯ ×{n}!',
        comboLost: 'серия сгорела',
        halfway: 'ПОЛОВИНА!',
        almost: 'ЕЩЁ ЧУТЬ-ЧУТЬ!',
        remaining: ({ n }) => `ещё ≈ ${n} ${pluralRu(n, 'встряхивание', 'встряхивания', 'встряхиваний')}`,
        sample: 'ОБРАЗЕЦ',
        ingredient: 'ИНГРЕДИЕНТ {i}/{n}',
        ingredientReady: 'ИНГРЕДИЕНТ ГОТОВ',
        mixing: 'СОЕДИНЯЕМ…',
        combineHeader: 'нужно  ·  получилось  ·  точность',
        spotOn: 'в точку',
        over: 'перетряс',
        under: 'недотряс',
        cocktail: 'коктейль',
        averageAccuracy: 'средняя точность {a}% · засчитывается от {p}%',
        cocktailReady: 'КОКТЕЙЛЬ ГОТОВ!',
        wrongColor: 'ЦВЕТ НЕ ТОТ! ПЕРЕДЕЛАЙ',
        newRecord: 'НОВЫЙ РЕКОРД!',
        done: 'ГОТОВО!',
        timeUp: 'НЕ УСПЕЛ',
        time: 'Время: {t}с',
        was: '  (было {t}с)',
        best: '  (рекорд {t}с)',
        score: 'Очки: {s}',
        bestScore: '  — лучший!',
        scoreParts: 'тряска {shake} + скорость {speed}',
        accuracy: 'точность: {a}%  (★★★ от {three}%, ★★ от {two}%)',
        beatShare: 'в такт: {share}% долей, лучшая серия {streak}',
        nextStar: 'Следующая звезда — быстрее {t}с',
        nextStarAccuracy: 'Следующая звезда — точнее {a}% и быстрее {t}с',
        lost: 'Не уложился в {t}с.\nТряси резче и без пауз!',
        howToPlay: 'КАК ИГРАТЬ',
        gotIt: 'ПОНЯТНО',
        tipShakeTitle: 'Телефон — это шейкер',
        tipShakeText: 'Тряси его из стороны в сторону: краска расходится по напитку. Чем резче рывки, тем быстрее.',
        tipGripTitle: 'Держи крепче',
        tipGripText: 'Хват покрепче, движения от локтя. Экран во время тряски читать не нужно — всё слышно и чувствуется.',
        tipShakePointerTitle: 'Шейкер у тебя в руке',
        tipShakePointerText: 'Зажми мышь (или палец) и води из стороны в сторону: краска расходится по напитку. Чем резче рывки, тем быстрее.',
        tipGripPointerTitle: 'Рывки короткие',
        tipGripPointerText: 'Короткие резкие движения туда-сюда лучше длинных и медленных. Следи за жидкостью и слушай звук.',
        tipBeatTitle: 'Попадай в такт',
        tipBeatText: 'Где звучит метроном, удар в долю засчитывается вдвое. Серия подряд — ещё больше очков.',
        tipStarsTitle: 'Три звезды',
        tipStarsText: 'Звёзды — за время. В «Баре» ещё за точность цвета: сравни напиток с образцом и жми «Готово».',
        shop: 'МАГАЗИН',
        coinsShort: 'м',
        coinsEarned: '+{n} монет',
        equip: 'надеть',
        equipped: 'надето',
        slot_glass: 'Стекло',
        slot_garnish: 'Гарнир',
        slot_scene: 'Фон',
        slot_sparks: 'Искры',
        glassClear: 'Прозрачное',
        glassSmoke: 'Дымчатое',
        glassAmber: 'Янтарное',
        glassCobalt: 'Кобальт',
        glassEmerald: 'Изумруд',
        glassRose: 'Розовое',
        glassCopper: 'Медь',
        garnishNone: 'Без гарнира',
        garnishStraw: 'Соломинка',
        garnishSlice: 'Долька лайма',
        garnishCherry: 'Вишенка',
        garnishUmbrella: 'Зонтик',
        garnishMint: 'Мята',
        garnishRim: 'Сахарная кайма',
        sceneBar: 'Бар',
        sceneNeon: 'Неон',
        sceneBeach: 'Пляж',
        sceneJungle: 'Джунгли',
        sceneIce: 'Лёд',
        sparksGold: 'Золотые',
        sparksNeon: 'Неоновые',
        sparksRose: 'Розовые',
        sparksLime: 'Лаймовые',
        daily_runs: 'Задание дня: пройди {n} уровня',
        daily_stars: 'Задание дня: заработай {n} звезды',
        daily_records: 'Задание дня: побей рекорд',
        daily_beat: 'Задание дня: {n} ударов в такт подряд',
        daily_perfect: 'Задание дня: заезд на три звезды',
        dailyClaim: 'Готово! Забрать {n} монет'
    },
    en: {
        sec: '{v}s',
        unlocksAt: 'unlocks at {n}',
        shakeLabel: 'SHAKE',
        levels: 'LEVELS',
        retry: 'RETRY',
        next: 'NEXT',
        ready: 'DONE',
        beatTip: 'SHAKE TO THE BEAT — TWICE AS FAST',
        shake: 'SHAKE!',
        shakeNow: 'NOW SHAKE!',
        corkOut: 'CORK POPPED!',
        tiltPour: 'TILT TO POUR!',
        onBeat: 'ON BEAT ×{n}',
        perfectRhythm: 'PERFECT RHYTHM!',
        combo: 'COMBO ×{n}!',
        comboLost: 'combo lost',
        halfway: 'HALFWAY!',
        almost: 'ALMOST THERE!',
        remaining: ({ n }) => `≈ ${n} more ${n === 1 ? 'shake' : 'shakes'}`,
        sample: 'SAMPLE',
        ingredient: 'INGREDIENT {i}/{n}',
        ingredientReady: 'INGREDIENT READY',
        mixing: 'MIXING…',
        combineHeader: 'target  ·  yours  ·  accuracy',
        spotOn: 'spot on',
        over: 'overshaken',
        under: 'undershaken',
        cocktail: 'cocktail',
        averageAccuracy: 'average accuracy {a}% · passes from {p}%',
        cocktailReady: 'COCKTAIL READY!',
        wrongColor: 'WRONG COLOR! REDO IT',
        newRecord: 'NEW RECORD!',
        done: 'DONE!',
        timeUp: "TIME'S UP",
        time: 'Time: {t}s',
        was: '  (was {t}s)',
        best: '  (best {t}s)',
        score: 'Score: {s}',
        bestScore: '  — best!',
        scoreParts: 'shaking {shake} + speed {speed}',
        accuracy: 'accuracy: {a}%  (★★★ from {three}%, ★★ from {two}%)',
        beatShare: 'on beat: {share}% of beats, best streak {streak}',
        nextStar: 'Next star — faster than {t}s',
        nextStarAccuracy: 'Next star — {a}% accuracy and faster than {t}s',
        lost: "Didn't make it in {t}s.\nShake harder, no pauses!",
        howToPlay: 'HOW TO PLAY',
        gotIt: 'GOT IT',
        tipShakeTitle: 'Your phone is the shaker',
        tipShakeText: 'Shake it side to side: the color spreads through the drink. Sharper moves, faster mixing.',
        tipGripTitle: 'Hold it tight',
        tipGripText: 'Firm grip, move from the elbow. No need to watch the screen while shaking — you hear and feel it.',
        tipShakePointerTitle: 'The shaker is in your hand',
        tipShakePointerText: 'Hold the mouse (or finger) and drag side to side: the color spreads through the drink. Sharper moves, faster mixing.',
        tipGripPointerTitle: 'Short, quick strokes',
        tipGripPointerText: 'Short sharp strokes back and forth beat long slow ones. Watch the liquid and listen to the sound.',
        tipBeatTitle: 'Hit the beat',
        tipBeatText: 'Where the metronome plays, an on-beat hit counts double. A streak in a row scores even more.',
        tipStarsTitle: 'Three stars',
        tipStarsText: 'Stars are for speed. In the Bar also for color accuracy: match the sample and press Done.',
        shop: 'SHOP',
        coinsShort: 'c',
        coinsEarned: '+{n} coins',
        equip: 'equip',
        equipped: 'equipped',
        slot_glass: 'Glass',
        slot_garnish: 'Garnish',
        slot_scene: 'Scene',
        slot_sparks: 'Sparks',
        glassClear: 'Clear',
        glassSmoke: 'Smoke',
        glassAmber: 'Amber',
        glassCobalt: 'Cobalt',
        glassEmerald: 'Emerald',
        glassRose: 'Rose',
        glassCopper: 'Copper',
        garnishNone: 'No garnish',
        garnishStraw: 'Straw',
        garnishSlice: 'Lime wheel',
        garnishCherry: 'Cherry',
        garnishUmbrella: 'Umbrella',
        garnishMint: 'Mint sprig',
        garnishRim: 'Sugar rim',
        sceneBar: 'Bar',
        sceneNeon: 'Neon',
        sceneBeach: 'Beach',
        sceneJungle: 'Jungle',
        sceneIce: 'Ice',
        sparksGold: 'Gold',
        sparksNeon: 'Neon',
        sparksRose: 'Rose',
        sparksLime: 'Lime',
        daily_runs: 'Daily task: finish {n} levels',
        daily_stars: 'Daily task: earn {n} stars',
        daily_records: 'Daily task: beat a record',
        daily_beat: 'Daily task: {n} on-beat hits in a row',
        daily_perfect: 'Daily task: a three-star run',
        dailyClaim: 'Done! Claim {n} coins',
        chapters: {
            lemonades: { title: 'LEMONADES' },
            cocktails: { title: 'COCKTAILS' },
            bar: { title: 'BAR', subtitle: 'match the color to the sample' }
        },
        levelNames: {
            mint: 'Mint', raspberry: 'Strawberry', orange: 'Orange', lime: 'Lime', cherry: 'Cherry', blackberry: 'Blueberry',
            lagoon: 'Blue Lagoon', mojito: 'Mojito', cosmopolitan: 'Cosmopolitan', sunrise: 'Tequila Sunrise',
            pinacolada: 'Piña Colada', absinthe: 'Green Fairy',
            'mojito-bar': 'Mint Julep', 'sample-cocktail': 'Sunset', 'cosmo-bar': 'Cosmo', 'lagoon-bar': 'Lagoon',
            'tropic-bar': 'Tropic', 'pina-bar': 'Coconut Breeze', 'negroni-bar': 'Negroni', 'hurricane-bar': 'Hurricane'
        }
    }
};

// Безалкогольный вариант для площадок с возрастом 12+ (CrazyGames — PEGI 12): коктейли с алкоголем в названии
// становятся безалкогольными напитками, «Бар» — сок-баром. Уровни, цвета и физика те же — меняются только слова.
// Включает сборка для портала (scripts/build-web.mjs кладёт в страницу window.__SHAKEIT_BUILD.family),
// а не SDK площадки: если SDK не загрузится, названия всё равно должны остаться безалкогольными
const FAMILY = {
    ru: {
        cocktail: 'напиток',
        cocktailReady: 'НАПИТОК ГОТОВ!',
        sceneBar: 'Сок-бар',
        tipStarsText: 'Звёзды — за время. В «Сок-баре» ещё за точность цвета: сравни напиток с образцом и жми «Готово».',
        chapters: {
            cocktails: { title: 'МОКТЕЙЛИ' },
            bar: { title: 'СОК-БАР', subtitle: 'подгони цвет под образец' }
        },
        levelNames: {
            lagoon: 'Голубая волна', mojito: 'Лайм с мятой', cosmopolitan: 'Клюквенный морс', sunrise: 'Апельсиновый рассвет',
            pinacolada: 'Ананас и кокос', absinthe: 'Виноград с мятой',
            'mojito-bar': 'Мятный фреш', 'cosmo-bar': 'Клюква', 'negroni-bar': 'Красный апельсин'
        }
    },
    en: {
        cocktail: 'drink',
        cocktailReady: 'DRINK READY!',
        sceneBar: 'Juice bar',
        tipStarsText: 'Stars are for speed. In the Juice Bar also for color accuracy: match the sample and press Done.',
        chapters: {
            cocktails: { title: 'MOCKTAILS' },
            bar: { title: 'JUICE BAR', subtitle: 'match the color to the sample' }
        },
        levelNames: {
            lagoon: 'Blue Wave', mojito: 'Lime Mint Fizz', cosmopolitan: 'Cranberry Spritz', sunrise: 'Orange Sunrise',
            pinacolada: 'Pineapple Coconut', absinthe: 'Grape Mint',
            'mojito-bar': 'Mint Fresh', 'cosmo-bar': 'Cranberry', 'negroni-bar': 'Blood Orange'
        }
    }
};

function applyFamily() {
    for (const [lang, over] of Object.entries(FAMILY)) {
        const strings = STRINGS[lang];
        const { chapters, levelNames, ...rest } = over;
        Object.assign(strings, rest);
        strings.chapters = { ...strings.chapters };
        for (const [id, value] of Object.entries(chapters)) strings.chapters[id] = { ...strings.chapters[id], ...value };
        strings.levelNames = { ...strings.levelNames, ...levelNames };
    }
}

if (window.__SHAKEIT_BUILD && window.__SHAKEIT_BUILD.family) applyFamily();

// Язык окружения: на портале его сообщает площадка (CrazyGames требует брать локаль у SDK), иначе берём
// язык браузера. Всё, кроме ru/uk/be/kk, получает английский — он и есть запасной вариант
function detect() {
    const code = (buildLocale() || platformLocale() || navigator.language || 'en').toLowerCase();
    return /^(ru|uk|be|kk)/.test(code) ? 'ru' : 'en';
}

// Сборка для площадки может задать язык по умолчанию: Пикабу требует русский интерфейс
function buildLocale() {
    const build = window.__SHAKEIT_BUILD;
    return build && build.lang ? build.lang : null;
}

function platformLocale() {
    try {
        const sdk = window.CrazyGames && window.CrazyGames.SDK;
        if (sdk && sdk.environment !== 'disabled') return sdk.user.systemInfo.locale;
    } catch (e) {
        // SDK ещё не поднялся или модуль недоступен — язык возьмём у браузера
    }
    return null;
}

let current = LANGUAGES.includes(loadSetting('language', null)) ? loadSetting('language', null) : detect();
document.documentElement.lang = current;

export function language() {
    return current;
}

export function setLanguage(code) {
    current = code;
    saveSetting('language', code);
    document.documentElement.lang = code;
}

export function t(key, params = {}) {
    const value = STRINGS[current][key] ?? STRINGS.ru[key] ?? key;
    if (typeof value === 'function') return value(params);
    return value.replace(/\{(\w+)\}/g, (_, name) => params[name]);
}

export function levelName(level) {
    return STRINGS[current].levelNames?.[level.id] ?? level.name;
}

export function chapterTitle(chapter) {
    return STRINGS[current].chapters?.[chapter.id]?.title ?? chapter.title;
}

export function chapterSubtitle(chapter) {
    return chapter.subtitle && (STRINGS[current].chapters?.[chapter.id]?.subtitle ?? chapter.subtitle);
}

// Числа с разделением разрядов: 6 900 по-русски, 6,900 по-английски
export function formatNumber(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, current === 'ru' ? ' ' : ',');
}
