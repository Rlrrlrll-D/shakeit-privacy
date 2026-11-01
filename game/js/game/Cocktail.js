// Коктейль по образцам: несколько ингредиентов, у каждого — две капли и образец цвета.
// Тряска понемногу сгущает цвет; игрок сам решает, что цвет совпал с образцом, и жмёт «готово».
// Правильность выясняется только при соединении: ингредиент, не попавший в допуск, переделывается
// (а время идёт). Без Phaser.
//
// config (level.cocktail): { ingredients: [{ dye, dyeB, result, icons: [иконка dye, иконка dyeB], target }], tolerance }
//  target — насколько сгустить цвет (0..1: доля пути от основы до полного цвета), tolerance — допуск.
export class Cocktail {
    constructor(config, base) {
        this.cfg = config;
        this.base = base;
        this.index = 0;
        this.made = config.ingredients.map(() => null); // Что получилось у игрока (та же шкала, что target)
    }

    get ingredient() {
        return this.cfg.ingredients[this.index];
    }

    get count() {
        return this.cfg.ingredients.length;
    }

    // Игрок нажал «готово». Возвращает true, если остались несделанные ингредиенты (index — следующий)
    finish(shade) {
        this.made[this.index] = shade;
        const next = this.made.indexOf(null);
        if (next === -1) return false;
        this.index = next;
        return true;
    }

    // Ингредиенты, не попавшие в допуск
    wrong() {
        return this.cfg.ingredients
            .map((ing, i) => (Math.abs(this.made[i] - ing.target) > this.cfg.tolerance ? i : -1))
            .filter((i) => i >= 0);
    }

    // Точность попадания в образец, %: 100 — точно; засчитывается от passAccuracy
    accuracy(i) {
        return Math.round(100 * (1 - Math.abs(this.made[i] - this.cfg.ingredients[i].target)));
    }

    // Средняя точность по всем ингредиентам, % — для звёзд
    get averageAccuracy() {
        const sum = this.made.reduce((acc, shade, i) => acc + (shade === null ? 0 : this.accuracy(i)), 0);
        return Math.floor(sum / this.count); // Вниз: 99.5 — ещё не 100
    }

    // Итоговый цвет коктейля. Ингредиенты — красители, они складываются, а не разбавляют друг друга:
    // оттенок — смесь цветов ингредиентов по их долям, густота — сколько всего налито против рецепта.
    // Точная работа даёт полный цвет напитка (тот, что обещан на карточке уровня), недотряс — бледнее:
    // смешивать поровну с основой было неверно, от этого готовый коктейль выходил пастельным
    // (идеально сделанный Негрони — розовый вместо красного).
    // made — по тому, что получилось у игрока; иначе — по рецепту
    finalColor(made) {
        const ings = this.cfg.ingredients;
        const share = (i) => (made ? this.made[i] : ings[i].target) || 0;
        const total = ings.reduce((sum, ing, i) => sum + share(i), 0);
        if (total <= 0) return this.base;
        const recipe = ings.reduce((sum, ing) => sum + ing.target, 0);
        const density = Math.min(1, total / recipe);
        const ch = (shift) => {
            const hue = ings.reduce((sum, ing, i) => sum + ((ing.result >> shift) & 255) * share(i), 0) / total;
            const from = (this.base >> shift) & 255;
            return Math.round(from + (hue - from) * density);
        };
        return (ch(16) << 16) | (ch(8) << 8) | ch(0);
    }

    get passAccuracy() {
        return Math.round(100 * (1 - this.cfg.tolerance));
    }

    redo(i) {
        this.made[i] = null;
        this.index = i;
    }

    // Цвет ингредиента при сгущении shade — прямая от основы к итоговому цвету, как в шейдере жидкости
    // (render/LiquidPipeline.js, mix(uBase, uTarget, level)): любая точка жидкости лежит на этой прямой
    color(i, shade) {
        const to = this.cfg.ingredients[i].result;
        const from = this.base;
        const ch = (shift) => Math.round(((from >> shift) & 255) + (((to >> shift) & 255) - ((from >> shift) & 255)) * shade);
        return (ch(16) << 16) | (ch(8) << 8) | ch(0);
    }
}
