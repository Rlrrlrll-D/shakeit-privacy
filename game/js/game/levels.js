import { LEVEL, LIQUID, LIQUID_RENDER, LIQUID_STATES, SURFACE_WAVES } from '../config.js';

// Уровни-рецепты: основа + капля → цвет результата.
// Сложность — сколько встряхиваний нужно (strokes: полноценных, силой 1; обычное сильное ≈ 0.8)
// и сколько жидкости капля окрашивает сразу (dyeFraction). Время рассчитано на живого человека:
// максимальной серией — от ~3.5 с на первом уровне до ~10.5 с на последнем (★★★), ровной сильной тряской —
// примерно вдвое дольше (★★). Лимит 60 с: пройти можно и в спокойном темпе с передышками.
// stars: [время на ★★★, время на ★★] в секундах — считаются инструментом tools/calibrate.mjs
// по записям реальной тряски (★★ — ровная сильная, ★★★ — максимальная серия), руками не подбираются.
// beat — темп метронома, ударов в секунду (game/Rhythm.js): удар в такт засчитывается вдвое. Нет — без метронома.
// maxTime — лимит уровня, если отличается от общего (LEVEL.maxTime).
// cocktail — коктейль по образцам (game/Cocktail.js): ингредиенты из двух капель, цвет подгоняется
// на глаз под образец, кнопка «готово»; проверка — при соединении (допуск tolerance).
// Уровни с двумя каплями (Лаймовый, Голубая лагуна, Текила санрайз): dye — промежуточный цвет, в который
// первая капля красит всё (середина пути от основы к итогу), dyeB — итоговый.
// dyeB — вторая капля (её иконка — icons.dyeB): когда первая окрасила всё, падает вторая, и цвета
// смешиваются в result; strokes — на каждую из капель.
// walls — перегородки от дна: x — где (доля ширины стакана), height — высота (доля высоты стакана),
// gate — с пробкой: глухая до потолка, пока свой отсек не прокрашен, потом окошко над height;
// dropX — куда падает капля (доля ширины, по умолчанию середина).
// state — состояние жидкости (config.js, LIQUID_STATES): water, juice, syrup, glycerin, alcohol — сразу
// и физика, и вид. Поштучно их можно перебить полями liquid и look ниже.
// liquid — особая жидкость (поверх LIQUID из config.js): viscosity — вязкость (масса течёт единым полем,
// см. physics/LiquidSim.js).
// look — особая отрисовка (поверх LIQUID_RENDER): у густой жидкости пятна частиц крупнее, чтобы
// растянутая масса не рвалась на ряды и край был гладким.
//
// color — цвет рамок карточек главы на карте уровней; glasses — стаканы уровней по очереди (ui/glass.js;
// в «Баре» — без декора внизу, он лёг бы поверх образца)
// requiredStars — глава открывается за звёзды (иначе — после прохождения последнего уровня предыдущей)
export const CHAPTERS = [
    { id: 'lemonades', title: 'ЛИМОНАДЫ', color: 0xffd23f, glasses: ['jar', 'faceted', 'pilsner', 'goblet', 'barrel', 'collins'] },
    { id: 'cocktails', title: 'КОКТЕЙЛИ', color: 0x2ec4b6, glasses: ['hurricane', 'rocks', 'martini', 'collins', 'tulip', 'absinthe'] },
    { id: 'bar', title: 'БАР', subtitle: 'подгони цвет под образец', requiredStars: 24, color: 0xa98bff, glasses: ['collins', 'snifter', 'martini', 'goblet', 'barrel', 'tulip', 'rocks', 'hurricane'] }
];

// icons — иконки из www/icons: base — основа, dye — падающий ингредиент (он же значок уровня на карте),
// drink — готовый напиток. Цвета жидкостей подобраны под иконки.
// id не менять: по нему хранится прогресс игрока
export const LEVELS = [
    // Лимонады: учат механике, к шестому — нынешняя "взрослая" сложность.
    // Первые два — показ разницы жидкостей: «Мятный» на воде (берёт частая лёгкая тряска),
    // «Клубничный» на сиропе (нужны медленные сильные размахи, дробь даёт четверть)
    { id: 'mint', chapter: 'lemonades', name: 'Мятный', state: 'water', icons: { base: 'droplet', dye: 'herb', drink: 'cup' }, base: 0x4fc3f7, dye: 0x7ed957, result: 0x6ee7b7, dyeFraction: 0.20, strokes: 84, maxTime: 35, stars: [11, 18] },
    { id: 'raspberry', chapter: 'lemonades', name: 'Клубничный', state: 'syrup', icons: { base: 'droplet', dye: 'strawberry', drink: 'cup' }, base: 0x9ad0ff, dye: 0xff4d6d, result: 0xff8fab, dyeFraction: 0.18, strokes: 42, maxTime: 40, stars: [16, 22] },
    { id: 'orange', chapter: 'lemonades', name: 'Апельсиновый', icons: { base: 'lemon', dye: 'tangerine', drink: 'cup' }, base: 0xffe066, dye: 0xff7b00, result: 0xffa62b, dyeFraction: 0.16, strokes: 87, maxTime: 55, beat: 4.5, stars: [11, 28] },
    { id: 'lime', state: 'water', chapter: 'lemonades', name: 'Лаймовый', icons: { base: 'droplet', dye: 'lemon', dyeB: 'lime', drink: 'cup' }, base: 0x3498db, dye: 0x31b2a6, dyeB: 0x2ecc71, result: 0x2ecc71, dyeFraction: 0.14, strokes: 57, maxTime: 45, stars: [14, 24] },
    { id: 'cherry', state: 'glycerin', chapter: 'lemonades', name: 'Вишнёвый', icons: { base: 'lemon', dye: 'cherries', drink: 'cup' }, base: 0xffd166, dye: 0xd90429, result: 0xef476f, dyeFraction: 0.12, strokes: 40, maxTime: 45, stars: [17, 24] },
    { id: 'blackberry', chapter: 'lemonades', name: 'Черничный', icons: { base: 'strawberry', dye: 'blueberries', drink: 'cup' }, base: 0xff8fab, dye: 0x5a4fcf, result: 0x8338ec, dyeFraction: 0.10, strokes: 114, maxTime: 70, beat: 5, stars: [14, 37] },
    // Коктейли: больше встряхиваний, меньше краски в капле
    { id: 'lagoon', state: 'alcohol', chapter: 'cocktails', name: 'Голубая лагуна', icons: { base: 'lemon', dye: 'droplet', dyeB: 'blueberries', drink: 'tropical' }, base: 0xfff3b0, dye: 0xa3dfca, dyeB: 0x48cae4, result: 0x48cae4, dyeFraction: 0.10, strokes: 75, maxTime: 75, stars: [16, 41] },
    { id: 'mojito', state: 'syrup', chapter: 'cocktails', name: 'Мохито', icons: { base: 'ice', dye: 'lime', drink: 'tumbler' }, base: 0xf1faee, dye: 0x7ac74f, result: 0x52b788, dyeFraction: 0.09, strokes: 50, maxTime: 50, stars: [20, 26] },
    { id: 'cosmopolitan', state: 'water', chapter: 'cocktails', name: 'Космополитен', icons: { base: 'ice', dye: 'cherries', drink: 'cocktail' }, base: 0xffe5ec, dye: 0xc9184a, result: 0xff4d6d, dyeFraction: 0.08, strokes: 141, maxTime: 55, stars: [17, 28] },
    { id: 'sunrise', chapter: 'cocktails', name: 'Текила санрайз', icons: { base: 'tangerine', dye: 'strawberry', dyeB: 'cherries', drink: 'tropical' }, base: 0xffd60a, dye: 0xffa805, dyeB: 0xff7b00, result: 0xff7b00, dyeFraction: 0.07, strokes: 84, maxTime: 100, beat: 5.5, stars: [17, 54] },
    { id: 'pinacolada', state: 'glycerin', chapter: 'cocktails', name: 'Пина колада', icons: { base: 'pineapple', dye: 'coconut', drink: 'tropical' }, base: 0xf7c948, dye: 0xfffaf0, result: 0xfff3d6, dyeFraction: 0.06, strokes: 63, maxTime: 65, stars: [25, 36] },
    { id: 'absinthe', state: 'alcohol', chapter: 'cocktails', name: 'Зелёная фея', icons: { base: 'grapes', dye: 'herb', drink: 'tumbler' }, base: 0x7b2cbf, dye: 0xaacc00, result: 0x80b918, dyeFraction: 0.05, strokes: 165, maxTime: 85, stars: [17, 46] },
    // Бар: коктейли по образцам (game/Cocktail.js) — цвет каждого ингредиента подгоняется на глаз под образец;
    // от одного ингредиента к четырём, допуск уже, образцы бледнее и ближе по оттенку. Ингредиенты одного
    // коктейля — родственных оттенков: смесь (итоговый цвет) красивая, а не серая.
    // result у коктейля — цвет готового напитка при точной работе, то есть смесь цветов ингредиентов
    // по их долям (Cocktail.finalColor). Меняете ингредиент — пересчитайте его: карточка, фон и поданный
    // коктейль должны быть одного цвета, иначе напиток «не тот, что обещали».
    // stars и maxTime — tools/calibrate.mjs (по ровной тряске); ★ ещё и за точность (Cocktail.STAR_ACCURACY)
    { id: 'mojito-bar', chapter: 'bar', name: 'Мятный джулеп', icons: { base: 'ice', dye: 'lime', drink: 'tumbler' }, base: 0xf1f1ee, dye: 0x72f63a, result: 0x22dc51, dyeFraction: 0.04, strokes: 140, maxTime: 80, cocktail: { tolerance: 0.08, ingredients: [
        { dye: 0x72f63a, dyeB: 0x16b734, result: 0x22dc51, icons: ['herb', 'lime'], target: 0.6 }
    ] }, stars: [25, 37] },
    { id: 'sample-cocktail', chapter: 'bar', name: 'Закат', icons: { base: 'droplet', dye: 'strawberry', drink: 'cocktail' }, base: 0xf1f1ee, dye: 0xffd23f, result: 0xff8120, dyeFraction: 0.04, strokes: 140, maxTime: 160, cocktail: { tolerance: 0.07, ingredients: [
        { dye: 0xffd23f, dyeB: 0xff9f1c, result: 0xffb703, icons: ['lemon', 'tangerine'], target: 0.55 },
        { dye: 0xff3b5c, dyeB: 0xff9f1c, result: 0xff5a36, icons: ['strawberry', 'tangerine'], target: 0.75 }
    ] }, stars: [52, 78] },
    { id: 'cosmo-bar', chapter: 'bar', name: 'Космо', icons: { base: 'ice', dye: 'cherries', drink: 'cocktail' }, base: 0xf1f1ee, dye: 0xdd0026, result: 0xfd5887, dyeFraction: 0.04, strokes: 140, maxTime: 130, cocktail: { tolerance: 0.06, ingredients: [
        { dye: 0xdd0026, dyeB: 0x99ff3f, result: 0xfb0e61, icons: ['cherries', 'lime'], target: 0.45 },
        { dye: 0xff4d6d, dyeB: 0xffd23f, result: 0xff8fa3, icons: ['strawberry', 'lemon'], target: 0.6 }
    ] }, stars: [44, 65] },
    { id: 'lagoon-bar', chapter: 'bar', name: 'Лагуна', icons: { base: 'droplet', dye: 'blueberries', drink: 'tropical' }, base: 0xf1f1ee, dye: 0x2b6cff, result: 0x495eff, dyeFraction: 0.04, strokes: 140, maxTime: 130, cocktail: { tolerance: 0.06, ingredients: [
        { dye: 0x2b6cff, dyeB: 0x47c6ff, result: 0x3280ff, icons: ['blueberries', 'droplet'], target: 0.45 },
        { dye: 0x7d0be0, dyeB: 0x47c6ff, result: 0x5a44ff, icons: ['grapes', 'droplet'], target: 0.6 }
    ] }, stars: [44, 65] },
    { id: 'tropic-bar', chapter: 'bar', name: 'Тропик', icons: { base: 'droplet', dye: 'pineapple', drink: 'tropical' }, base: 0xf1f1ee, dye: 0xffcd40, result: 0xddb04f, dyeFraction: 0.04, strokes: 140, maxTime: 190, cocktail: { tolerance: 0.06, ingredients: [
        { dye: 0xffcd40, dyeB: 0xffe066, result: 0xffc53d, icons: ['pineapple', 'lemon'], target: 0.5 },
        { dye: 0xff7b00, dyeB: 0xff4d6d, result: 0xff7b39, icons: ['tangerine', 'strawberry'], target: 0.6 },
        { dye: 0xfffaf0, dyeB: 0x99ff3f, result: 0x7fe686, icons: ['coconut', 'lime'], target: 0.4 }
    ] }, stars: [63, 94] },
    { id: 'pina-bar', chapter: 'bar', name: 'Кокосовый бриз', icons: { base: 'ice', dye: 'coconut', drink: 'tropical' }, base: 0xf1f1ee, dye: 0xfffaf0, result: 0xe4d8ae, dyeFraction: 0.04, strokes: 140, maxTime: 160, cocktail: { tolerance: 0.05, ingredients: [
        { dye: 0xfffaf0, dyeB: 0xffcd40, result: 0xffd98a, icons: ['coconut', 'pineapple'], target: 0.35 },
        { dye: 0xffcd40, dyeB: 0xffe066, result: 0xffcf5c, icons: ['pineapple', 'lemon'], target: 0.3 },
        { dye: 0xfffaf0, dyeB: 0x9ad0ff, result: 0xc0dcf8, icons: ['coconut', 'ice'], target: 0.5 }
    ] }, stars: [51, 76] },
    { id: 'negroni-bar', chapter: 'bar', name: 'Негрони', icons: { base: 'ice', dye: 'tangerine', drink: 'tumbler' }, base: 0xf1f1ee, dye: 0xdd0026, result: 0xf62135, dyeFraction: 0.04, strokes: 140, maxTime: 210, cocktail: { tolerance: 0.05, ingredients: [
        { dye: 0xdd0026, dyeB: 0xff7b00, result: 0xfd0021, icons: ['cherries', 'tangerine'], target: 0.55 },
        { dye: 0xff4d6d, dyeB: 0xdd0026, result: 0xe50057, icons: ['strawberry', 'cherries'], target: 0.5 },
        { dye: 0xff7b00, dyeB: 0xffe066, result: 0xff5a2b, icons: ['tangerine', 'lemon'], target: 0.6 }
    ] }, stars: [68, 101] },
    { id: 'hurricane-bar', chapter: 'bar', name: 'Ураган', icons: { base: 'droplet', dye: 'cherries', drink: 'tropical' }, base: 0xf1f1ee, dye: 0xff4d6d, result: 0xf95c4f, dyeFraction: 0.04, strokes: 140, maxTime: 260, cocktail: { tolerance: 0.04, ingredients: [
        { dye: 0xff4d6d, dyeB: 0xdd0026, result: 0xff3767, icons: ['strawberry', 'cherries'], target: 0.5 },
        { dye: 0xff7b00, dyeB: 0xffe066, result: 0xff8c42, icons: ['tangerine', 'lemon'], target: 0.55 },
        { dye: 0xffcd40, dyeB: 0xffe066, result: 0xffc43d, icons: ['pineapple', 'lemon'], target: 0.45 },
        { dye: 0xdd0026, dyeB: 0x7d0be0, result: 0xe90054, icons: ['cherries', 'grapes'], target: 0.6 }
    ] }, stars: [87, 130] }
];

// Все иконки, которые нужны уровням, — загружаются один раз при старте игры
export const ICONS = [...new Set(LEVELS.flatMap((level) => [
    ...Object.values(level.icons),
    ...(level.cocktail ? level.cocktail.ingredients.flatMap((ing) => ing.icons) : [])
]))];

// Физика жидкости уровня: общая LIQUID + особая жидкость рецепта (густые фреши)
export function levelLiquid(level) {
    const state = LIQUID_STATES[level.state] || LIQUID_STATES.juice;
    return { ...LIQUID, ...state.liquid, ...(level.liquid || {}) };
}

// Отрисовка жидкости уровня: общая LIQUID_RENDER + особенности густой жидкости
// Темп метронома уровня: у жидкости свой (густую мешают медленно), уровень может перебить
export function levelBeat(level) {
    const state = LIQUID_STATES[level.state] || LIQUID_STATES.juice;
    return level.beat ?? state.beat;
}

// Профиль удара уровня (game/StrokeProfile.js): задаётся состоянием жидкости, уровень может перебить
export function levelStroke(level) {
    const state = LIQUID_STATES[level.state] || LIQUID_STATES.juice;
    return level.stroke || state.stroke || 'even';
}

export function levelLook(level) {
    const state = LIQUID_STATES[level.state] || LIQUID_STATES.juice;
    return { ...LIQUID_RENDER, ...state.look, ...(level.look || {}) };
}
// Волна по поверхности (render/SurfaceWaves.js): вода качается дольше, глицерин почти не качается
export function levelWaves(level) {
    const state = LIQUID_STATES[level.state] || LIQUID_STATES.juice;
    return { ...SURFACE_WAVES, ...state.waves, ...(level.waves || {}) };
}

// Параметры уровня для модели жидкости: общие значения LEVEL + особенности рецепта
export function levelParams(level) {
    return {
        ...LEVEL,
        dyeFraction: level.dyeFraction,
        dyes: level.dyeB === undefined ? 1 : 2,
        shade: !!level.cocktail,
        walls: level.walls,
        maxTime: level.maxTime ?? LEVEL.maxTime,
        // Порция прогресса на одно полноценное встряхивание: остаток после капли делится на strokes
        portion: (1 - level.dyeFraction) / level.strokes
    };
}

// ★ — уложился в лимит, ★★ и ★★★ — быстрее порогов уровня
// Стакан уровня: свой у уровня (glass) или по очереди из стаканов главы
export function glassFor(level) {
    if (level.glass) return level.glass;
    const chapter = CHAPTERS.find((c) => c.id === level.chapter);
    const index = LEVELS.filter((l) => l.chapter === level.chapter).indexOf(level);
    return chapter.glasses[index % chapter.glasses.length];
}

// Звёзды: по времени; у коктейля по образцам — ещё и по средней точности (меньшее из двух)
export function starsFor(level, time, accuracy = 100) {
    const byTime = time <= level.stars[0] ? 3 : time <= level.stars[1] ? 2 : 1;
    if (!level.cocktail) return byTime;
    const byAccuracy = accuracy >= STAR_ACCURACY[0] ? 3 : accuracy >= STAR_ACCURACY[1] ? 2 : 1;
    return Math.min(byTime, byAccuracy);
}

// Средняя точность попадания в образцы (%) для ★★★ и ★★
export const STAR_ACCURACY = [98, 95];
