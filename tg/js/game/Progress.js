// Прогресс игрока по уровням: звёзды, лучшее время и лучшие очки. Хранится в localStorage WebView.
// Версия в ключе: после изменения баланса старые результаты несопоставимы — сбрасываются сменой версии.
// Хранилище может быть недоступно — тогда прогресс живёт до закрытия игры
import { readStored, writeStored } from '../util/storage.js';

const KEY = 'shakeit.progress.v1';

export class Progress {
    constructor(levels, chapters) {
        this.levels = levels;
        this.chapters = chapters;
        this.data = {};
        this.pendingUnlock = null; // Только что открытый уровень — карта покажет анимацию открытия (не сохраняется)
        try {
            const raw = JSON.parse(readStored(KEY));
            if (raw && typeof raw === 'object') this.data = raw;
        } catch (e) {
            // Нет хранилища или испорченные данные — начинаем с чистого листа
        }
    }

    get(levelId) {
        return this.data[levelId] || { stars: 0, bestTime: null, bestScore: 0 };
    }

    // Первый уровень открыт всегда, следующий — после прохождения предыдущего хотя бы на звезду.
    // Первый уровень главы с requiredStars открывается за звёзды, а не за предыдущий уровень
    isUnlocked(index) {
        if (index === 0) return true;
        // Пройденный уровень открыт всегда — даже если предыдущий ещё не пройден (порядок уровней менялся)
        if (this.get(this.levels[index].id).stars > 0) return true;
        const chapter = this.chapterOf(index);
        const firstInChapter = this.levels[index - 1].chapter !== this.levels[index].chapter;
        if (firstInChapter && chapter.requiredStars) return this.totalStars >= chapter.requiredStars;
        return this.get(this.levels[index - 1].id).stars > 0;
    }

    chapterOf(index) {
        return this.chapters.find((chapter) => chapter.id === this.levels[index].chapter);
    }

    get totalStars() {
        return this.levels.reduce((sum, level) => sum + this.get(level.id).stars, 0);
    }

    // Первый открытый и ещё не пройденный уровень — с него удобно продолжать
    get nextIndex() {
        const index = this.levels.findIndex((level, i) => this.isUnlocked(i) && this.get(level.id).stars === 0);
        return index === -1 ? 0 : index;
    }

    // Результат прохождения; возвращает, что из него стало рекордом
    submit(levelId, { time, score, stars }) {
        const previous = this.get(levelId);
        const result = {
            firstClear: previous.stars === 0, // Первое прохождение — открывает следующий уровень
            previousBestTime: previous.bestTime,
            timeRecord: previous.bestTime === null || time < previous.bestTime,
            scoreRecord: score > previous.bestScore,
            starsGained: Math.max(0, stars - previous.stars)
        };
        this.data[levelId] = {
            stars: Math.max(previous.stars, stars),
            bestTime: result.timeRecord ? time : previous.bestTime,
            bestScore: Math.max(previous.bestScore, score)
        };
        writeStored(KEY, JSON.stringify(this.data));
        return result;
    }
}
