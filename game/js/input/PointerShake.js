// Тряска мышью и пальцем — запасной ввод там, где нет акселерометра (компьютер, телефон с закрытыми датчиками).
// Игрок «берёт шейкер»: зажимает кнопку и водит курсором — шейкер следует за курсором, как за рукой.
//
// Шейкер — пружинное следование за курсором (критическое демпфирование): ускорение, которое при этом
// испытывает «телефон», — сила пружины. Её не нужно получать вторым дифференцированием шумного курсора:
// формула даёт её гладкой, а пружина заодно срезает дрожь руки быстрее частоты среза. Дальше замеры идут
// в тот же ShakeDetector, что и с настоящего датчика: развороты, темп и сила считаются теми же формулами.
//
// Оси — как у телефона стоймя: x вправо, y вверх, поэтому экранная ось y перевёрнута, а гравитация
// (9.81 вверх по y) добавлена к замеру, как у акселерометра с гравитацией.
export class PointerShake {
    constructor(params) {
        this.span = params.pointerSpan;                       // м шейкера на меньшую сторону окна
        this.omega = 2 * Math.PI * params.pointerCutoff;      // рад/с: частота среза пружины
        this.maxSpeed = params.pointerMaxSpeed;               // м/с: выше курсор не разгоняем (рывок через экран)
        this.x = this.y = 0;                                  // Где шейкер, м
        this.vx = this.vy = 0;
        this.goalX = this.goalY = 0;                          // Где курсор по последнему событию, м
        this.targetX = this.targetY = 0;                      // Куда тянется пружина: курсор, сглаженный между событиями
        this.pre = params.pointerPreSmooth;                   // с: постоянная сглаживания курсора
        this.held = false;
        this.ax = 0;                                          // Последний замер: ускорение с гравитацией, оси телефона
        this.ay = 9.81;
    }

    // Курсор (px) → метры шейкера; размер окна берём в момент события — окно можно менять на лету
    toMeters(px) {
        return px / Math.max(1, Math.min(window.innerWidth, window.innerHeight)) * this.span;
    }

    press(px, py) {
        this.goalX = this.targetX = this.x = this.toMeters(px);
        this.goalY = this.targetY = this.y = this.toMeters(py);
        this.vx = this.vy = 0;
        this.held = true;
    }

    move(px, py) {
        if (!this.held) return;
        this.goalX = this.toMeters(px);
        this.goalY = this.toMeters(py);
    }

    release() {
        // Отпустил — шейкер плавно доезжает до того места, где был курсор. Резкая остановка на месте дала бы
        // всплеск торможения, и детектор принял бы его за последнюю встряску
        this.held = false;
    }

    // Один шаг h секунд; после него this.ax / this.ay — замер акселерометра
    step(h) {
        const w = this.omega;
        // События курсора приходят раз в кадр ступеньками; сила пружины на ступеньке даёт ложные рывки,
        // поэтому цель плавно подтягивается к курсору, а не прыгает
        const k = 1 - Math.exp(-h / this.pre);
        this.targetX += (this.goalX - this.targetX) * k;
        this.targetY += (this.goalY - this.targetY) * k;
        // Критическое демпфирование: a = w²(цель − x) − 2w·v
        const ax = w * w * (this.targetX - this.x) - 2 * w * this.vx;
        const ay = w * w * (this.targetY - this.y) - 2 * w * this.vy;
        this.vx += ax * h;
        this.vy += ay * h;
        const speed = Math.hypot(this.vx, this.vy);
        if (speed > this.maxSpeed) {
            const cap = this.maxSpeed / speed;
            this.vx *= cap;
            this.vy *= cap;
        }
        this.x += this.vx * h;
        this.y += this.vy * h;
        this.ax = ax;
        this.ay = 9.81 - ay;     // Экранная ось y смотрит вниз, у телефона — вверх
    }
}
