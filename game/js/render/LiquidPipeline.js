// Шейдер сплошной жидкости (метаболы).
// Слой с частицами рисуется в буфер аддитивно: каждая частица — "облачко плотности" с мягким спадом.
// Каналы буфера: G — суммарная плотность, R — плотность × окрашенность частицы.
// Шейдер закрашивает всё, где плотность выше порога: соседние облачка сливаются в одну массу
// с гладкой поверхностью, а цвет точки = R / G — плавная смесь окрасок частиц.
//
// Плотность — это ещё и толщина слоя, и из неё же берётся наклон поверхности. Отсюда три признака,
// по которым глаз узнаёт жидкость: тонкий край и брызги просвечивают (цвет набирается с толщиной),
// фон под поверхностью сдвигается по наклону (преломление), и по поверхности ходит блик.
// В глубине массы наклон нулевой, а толщина полная — там цвет остаётся ровно тем, что считает игра:
// сверка с образцом в «Баре» от этого не страдает.
//
// Клин у стенки. У стакана, расширяющегося кверху (пилснер, бокал, мартини), на уровне поверхности
// между стенкой и частицами остаётся узкий клин, уже диаметра частицы, — частицы в него не влезают,
// и кромка у стенки уходит вниз на 30 px дугой. У настоящей жидкости поверхность — плоскость, и она
// доходит до стенки прямым углом. Поэтому шейдер дорисовывает область под плоскостью поверхности
// в полосе у стенки (render/surfacePlane.js считает плоскость по верхним частицам). Цвет клина берётся
// из жидкости чуть глубже и дальше от стенки; верхняя кромка в центре и всплески не трогаются.
const fragShader = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uMainSampler;
uniform sampler2D uBackdrop;
uniform vec2 uTexel;
uniform vec2 uSize;
uniform vec3 uBase;
uniform vec3 uTarget;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uDual;
uniform float uThreshold;
uniform float uEdge;
uniform float uRimWidth;
uniform float uRim;
uniform float uBody;
uniform float uGrad;
uniform float uTilt;
uniform float uCurve;
uniform float uAbsorb;
uniform float uRefract;
uniform float uSpec;
uniform float uShine;
uniform vec3 uLight;
uniform vec4 uPlane;
uniform vec2 uWalls;
uniform float uFill;

varying vec2 outTexCoord;

float densityAt(vec2 uv) {
    return texture2D(uMainSampler, uv).g;
}

void main() {
    vec4 s = texture2D(uMainSampler, outTexCoord);
    float density = s.g;
    float alpha = smoothstep(uThreshold - uEdge, uThreshold + uEdge, density);

    if (alpha <= 0.0) {
        gl_FragColor = vec4(0.0);
        return;
    }

    float level = clamp(s.r / max(s.g, 0.001), 0.0, 1.0);
    vec3 color = mix(uBase, uTarget, level);
    if (uDual > 0.5) {
        // Два красителя: R — первый, B — второй; где оба — их смесь (целевой цвет)
        float a = level;
        float b = clamp(s.b / max(s.g, 0.001), 0.0, 1.0);
        color = uBase * (1.0 - a) * (1.0 - b) + uColorA * a * (1.0 - b) + uColorB * b * (1.0 - a) + uTarget * a * b;
    }

    // Куда повёрнута поверхность — направление градиента плотности; крутизну берём своей (uTilt),
    // иначе наклон вышел бы мизерным: градиент размазан по ширине облачка частицы, и блик не зажигался.
    // Разность берём не у соседнего пикселя, а через uGrad пикселей: буфер плотности 8-битный,
    // и у соседей разница тонет в ступеньке квантования (1/255) — поле наклонов превращалось в шум
    vec2 d = uTexel * uGrad;
    // Буфер постэффекта перевёрнут по вертикали относительно экрана, поэтому у наклона по y
    // меняем знак: дальше считаем в экранных осях (x вправо, y вниз), как задан и свет
    vec2 grad = vec2(
        densityAt(outTexCoord + vec2(d.x, 0.0)) - densityAt(outTexCoord - vec2(d.x, 0.0)),
        densityAt(outTexCoord - vec2(0.0, d.y)) - densityAt(outTexCoord + vec2(0.0, d.y))
    );
    float steep = length(grad);
    vec2 dir = steep > 0.00001 ? grad / steep : vec2(0.0);
    vec3 normal = normalize(vec3(-dir * uTilt, 1.0));

    // Толщина слоя: плёнка и брызги просвечивают, в глубине цвет полный
    float thickness = clamp((density - uThreshold) / uBody, 0.0, 1.0);
    float opacity = thickness * (2.0 - thickness);

    // Поверхность — там, где плотность заметно меняется на длине uGrad: внутри массы она ровная.
    // Дополнительно гасим по толщине, чтобы редкие пустоты в глубине не зажигали блик
    float shell = smoothstep(uCurve * 0.35, uCurve, steep) * (1.0 - smoothstep(0.85, 1.6, thickness));

    // Сквозь жидкость виден фон — дальняя стенка стакана и задник, окрашенные самой жидкостью,
    // как фильтром, и сдвинутые по наклону поверхности (преломление)
    vec2 bend = -dir * shell * uRefract * uTexel;
    // Фон нарисован в обычной ориентации — берём его зеркально по вертикали (и сдвиг тоже)
    vec2 backUV = vec2(outTexCoord.x + bend.x, 1.0 - outTexCoord.y - bend.y);
    vec3 behind = texture2D(uBackdrop, backUV).rgb;
    vec3 tinted = behind * mix(vec3(1.0), color, uAbsorb);
    color = mix(tinted, color, opacity);

    // Блик — только на изгибе поверхности; в ровной толще его нет, и цвет там остаётся расчётным
    color += uSpec * shell * pow(max(dot(normal, normalize(uLight)), 0.0), uShine);

    // Светлая кромка у самой поверхности: колебания плотности между частицами внутри массы
    // не должны проступать "сотами"
    float rim = 1.0 - smoothstep(uThreshold, uThreshold + uRimWidth, density);
    color *= 1.0 + uRim * rim;

    gl_FragColor = vec4(color * alpha, alpha);
}
`;

// Размытие поля по одной оси: пять выборок с линейной фильтрацией заменяют девять по Гауссу
const blurShader = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uMainSampler;
uniform vec2 uStep;

varying vec2 outTexCoord;

void main() {
    vec2 a = uStep * 1.3846153846;
    vec2 b = uStep * 3.2307692308;
    gl_FragColor = texture2D(uMainSampler, outTexCoord) * 0.2270270270
        + (texture2D(uMainSampler, outTexCoord + a) + texture2D(uMainSampler, outTexCoord - a)) * 0.3162162162
        + (texture2D(uMainSampler, outTexCoord + b) + texture2D(uMainSampler, outTexCoord - b)) * 0.0702702703;
}
`;

// Сплошная масса с чётким контуром. Поле сглажено заранее (blurShader), поэтому его изолиния — ровная
// кривая без бугорков отдельных частиц. Расстояние до контура считается в пикселях: значение поля
// минус порог, делённое на крутизну. На нём и держится чёткость: край одной ширины по всей массе,
// как бы ни был размазан перепад плотности, и линия поверхности постоянной толщины
const surfaceShader = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uMainSampler;
uniform sampler2D uRaw;
uniform sampler2D uBackdrop;
uniform vec2 uTexel;
uniform vec2 uPixel;
uniform float uCell;
uniform float uKeep;
uniform vec3 uBase;
uniform vec3 uTarget;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uDual;
uniform float uThreshold;
uniform float uEdge;
uniform float uBody;
uniform float uFilm;
uniform float uShell;
uniform float uTilt;
uniform float uAbsorb;
uniform float uRefract;
uniform float uSpec;
uniform float uShine;
uniform vec3 uLight;
uniform float uLine;
uniform float uLineAlpha;
uniform float uLineTint;
uniform float uLineLow;

varying vec2 outTexCoord;

void main() {
    vec4 s = texture2D(uMainSampler, outTexCoord);
    // Поле сглажено в буфере вчетверо меньше экрана, и тонкие плёнки в нём пропадают: размытие
    // сохраняет среднее, но срезает пики у всего мельче своего радиуса. В сильной тряске масса
    // как раз растягивается в плёнки — и они исчезали целыми кадрами. Поэтому берём максимум
    // сглаженного и исходного поля: толстая масса идёт по сглаженному (ровный контур),
    // тонкая держится исходным и никуда не девается
    vec4 raw = texture2D(uRaw, outTexCoord);
    float density = max(s.g, raw.g * uKeep);
    if (density < uThreshold * 0.4) {
        gl_FragColor = vec4(0.0);
        return;
    }
    // Цвет берём из исходного буфера: сглаженный размазывает границу красок
    s = raw.g > 0.0001 ? raw : s;

    // Наклон поля на пиксель игры. Буфер перевёрнут по вертикали относительно экрана — у y меняем знак:
    // дальше считаем в экранных осях (x вправо, y вниз), как задан и свет
    vec2 d = uTexel;
    vec2 grad = vec2(
        texture2D(uMainSampler, outTexCoord + vec2(d.x, 0.0)).g - texture2D(uMainSampler, outTexCoord - vec2(d.x, 0.0)).g,
        texture2D(uMainSampler, outTexCoord - vec2(0.0, d.y)).g - texture2D(uMainSampler, outTexCoord + vec2(0.0, d.y)).g
    ) / (2.0 * uCell);
    float steep = length(grad);
    vec2 dir = steep > 0.00001 ? grad / steep : vec2(0.0);

    // Расстояние до контура, px: внутри массы положительное. Крутизна снизу ограничена, иначе
    // в ровной толще деление даёт бесконечность, а на плёнке — дрожащий край
    float dist = (density - uThreshold) / max(steep, 0.0015);
    float alpha = smoothstep(-uEdge, uEdge, dist);
    if (alpha <= 0.0) {
        gl_FragColor = vec4(0.0);
        return;
    }

    float level = clamp(s.r / max(s.g, 0.001), 0.0, 1.0);
    vec3 color = mix(uBase, uTarget, level);
    if (uDual > 0.5) {
        float a = level;
        float b = clamp(s.b / max(s.g, 0.001), 0.0, 1.0);
        color = uBase * (1.0 - a) * (1.0 - b) + uColorA * a * (1.0 - b) + uColorB * b * (1.0 - a) + uTarget * a * b;
    }

    // Краевая полоса: у самой поверхности сквозь жидкость виден фон, глубже цвет полный.
    // В толще массы всё это выключено — там цвет ровно тот, что считает игра
    float band = clamp(dist / max(uBody, 0.001), 0.0, 1.0);
    float opacity = mix(uFilm, 1.0, band * (2.0 - band));
    float shell = 1.0 - smoothstep(0.0, max(uShell, 0.001), dist);

    vec2 bend = -dir * shell * uRefract * uPixel;
    vec2 backUV = vec2(outTexCoord.x + bend.x, 1.0 - outTexCoord.y - bend.y);
    vec3 behind = texture2D(uBackdrop, backUV).rgb;
    vec3 tinted = behind * mix(vec3(1.0), color, uAbsorb);
    color = mix(tinted, color, opacity);

    vec3 normal = normalize(vec3(-dir * uTilt, 1.0));
    color += uSpec * shell * pow(max(dot(normal, normalize(uLight)), 0.0), uShine);

    // Линия поверхности: свет падает сверху, поэтому верх массы светлее низа
    float facing = dot(-dir, normalize(uLight.xy));
    float lit = mix(uLineLow, 1.0, smoothstep(-0.2, 0.6, facing));
    float line = 1.0 - smoothstep(uLine - uEdge, uLine + uEdge, dist);
    color = mix(color, mix(color, vec3(1.0), uLineTint), line * lit * uLineAlpha);

    gl_FragColor = vec4(color * alpha, alpha);
}
`;

const FIELD_SCALE = 0.25; // Поле сглаживается в уменьшенном буфере: четверть стороны — шестнадцатая часть пикселей

export class LiquidPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
    constructor(game) {
        // Размер — явно: опцию scale рендер-таргет Phaser при создании игнорирует
        const field = {
            width: Math.max(1, Math.round(game.renderer.width * FIELD_SCALE)),
            height: Math.max(1, Math.round(game.renderer.height * FIELD_SCALE))
        };
        super({
            game,
            name: 'LiquidPipeline',
            renderTarget: [{ scale: 1 }, field, field],
            shaders: [
                { name: 'LiquidBlur', fragShader: blurShader },
                { name: 'LiquidSurface', fragShader: surfaceShader },
                { name: 'LiquidLegacy', fragShader }
            ]
        });
        this.legacy = false;    // Старый вид — только на время сравнения вариантов
        // Контур (surfaceShader): уровень поля, размытие, край и линия поверхности
        this.soften = 1;        // Шаг размытия в клетках поля: больше — ровнее контур, но тоньше детали
        this.contour = 0.14;    // Значение сглаженного поля, по которому проходит контур
        this.aa = 1.1;          // Полуширина края, px
        this.bodyPx = 0;        // Ширина полосы, в которой цвет набирает густоту, px
        this.film = 1;          // Непрозрачность у самой кромки
        this.shellPx = 26;      // Ширина полосы блика и преломления, px
        this.line = 3;          // Толщина линии поверхности, px
        this.lineAlpha = 0.85;
        this.lineTint = 0.7;    // Насколько линия светлее самой жидкости
        this.lineLow = 0.25;    // Яркость линии снизу массы относительно верха
        this.keep = 0.92;       // Доля исходного поля, которой держатся тонкие плёнки и брызги
        this.base = [0, 0, 1];
        this.target = [0, 1, 0];
        this.threshold = 0.11;
        this.edge = 0.02;
        this.rimWidth = 0.08;
        this.rim = 0.22;       // Яркость кромки; 0 — цвет ровно тот, что считает игра (коктейль по образцам)
        this.dual = false;
        this.colorA = [1, 0, 0];
        this.colorB = [0, 0, 1];
        // Вид жидкости (config.js, LIQUID_RENDER; у густых жидкостей — свой)
        this.body = 0.22;
        this.tilt = 0.85;
        this.grad = 4;
        this.curve = 0.12;
        this.absorb = 0.85;
        this.refract = 26;
        this.spec = 0.5;
        this.shine = 8;
        this.light = [-0.55, -0.6, 0.58];
        // Клин у стенки (render/surfacePlane.js): плоскость поверхности и стенки на её уровне, px игры
        this.plane = [0, 0, 0, 150];  // y в центре, наклон, x центра, ширина полосы у стенки
        this.walls = [0, 0];
        this.fill = 0;                // 0 — выключено; плавно растёт, пока жидкость спокойна
        // Фон под жидкостью для преломления (сцена рисует его в отдельную текстуру); без него
        // преломлять нечего — край просто не просвечивает
        this.backdrop = null;
    }

    setColors(base, target) {
        this.base = hexToVec3(base);
        this.target = hexToVec3(target);
        return this;
    }

    // Два красителя: цвет каждого по отдельности; где смешались — target
    setDyes(colorA, colorB) {
        this.dual = true;
        this.colorA = hexToVec3(colorA);
        this.colorB = hexToVec3(colorB);
        return this;
    }

    // Вид жидкости: толщина набора цвета, крутизна поверхности, преломление и блик
    setLook(look) {
        if (look.body !== undefined) this.body = look.body;
        if (look.tilt !== undefined) this.tilt = look.tilt;
        if (look.curve !== undefined) this.curve = look.curve;
        if (look.grad !== undefined) this.grad = look.grad;
        if (look.absorb !== undefined) this.absorb = look.absorb;
        if (look.refract !== undefined) this.refract = look.refract;
        if (look.spec !== undefined) this.spec = look.spec;
        if (look.shine !== undefined) this.shine = look.shine;
        if (look.light !== undefined) this.light = look.light;
        for (const key of ['soften', 'contour', 'aa', 'bodyPx', 'film', 'shellPx', 'line', 'lineAlpha', 'lineTint', 'lineLow', 'keep']) {
            if (look[key] !== undefined) this[key] = look[key];
        }
        return this;
    }

    // Плоскость поверхности от SurfacePlane: y в центре, наклон, x центра, ширина полосы, стенки, сила
    setPlane(plane) {
        this.plane = [plane.y, plane.slope, plane.cx, plane.band];
        this.walls = [plane.wallL, plane.wallR];
        this.fill = plane.fill;
        return this;
    }

    onDraw(renderTarget) {
        if (this.legacy) {
            this.drawLegacy(renderTarget);
            return;
        }
        const gl = this.gl;
        const [blur, surface] = this.shaders;
        const [, a, b] = this.renderTargets;

        // Сглаживание поля: по проходу на ось в уменьшенном буфере. Итог — в b.
        // Проходов ровно два: каждый — это отдельный кадровый буфер, а их переключение на телефоне
        // стоит дороже самих выборок (замер: четыре прохода добавляли 4 мс к девяностой доле кадра).
        // Текущий кадровый буфер запоминаем и возвращаем сами: copySprite его переключает и за собой
        // не убирает, а дальше bindAndDraw снимает буфер со стека рендерера — без возврата стек
        // и настоящая привязка расходятся, и кадр уходит не туда (так же делает Blur у самого Phaser)
        const currentFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        this.bind(blur);
        this.set1i('uMainSampler', 0, blur);
        gl.viewport(0, 0, a.width, a.height);
        this.set2f('uStep', this.soften / a.width, 0, blur);
        this.copySprite(renderTarget, a);
        this.set2f('uStep', 0, this.soften / a.height, blur);
        this.copySprite(a, b);
        gl.bindFramebuffer(gl.FRAMEBUFFER, currentFBO);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.viewport(0, 0, renderTarget.width, renderTarget.height);

        this.bind(surface);
        this.set3f('uBase', this.base[0], this.base[1], this.base[2], surface);
        this.set3f('uTarget', this.target[0], this.target[1], this.target[2], surface);
        this.set3f('uColorA', this.colorA[0], this.colorA[1], this.colorA[2], surface);
        this.set3f('uColorB', this.colorB[0], this.colorB[1], this.colorB[2], surface);
        this.set1f('uDual', this.dual ? 1 : 0, surface);
        this.set1f('uThreshold', this.contour, surface);
        this.set1f('uEdge', this.aa, surface);
        this.set1f('uBody', this.bodyPx, surface);
        this.set1f('uFilm', this.film, surface);
        this.set1f('uShell', this.shellPx, surface);
        this.set1f('uTilt', this.tilt, surface);
        this.set1f('uAbsorb', this.absorb, surface);
        this.set1f('uRefract', this.refract, surface);
        this.set1f('uSpec', this.spec, surface);
        this.set1f('uShine', this.shine, surface);
        this.set3f('uLight', this.light[0], this.light[1], this.light[2], surface);
        this.set1f('uLine', this.line, surface);
        this.set1f('uLineAlpha', this.lineAlpha, surface);
        this.set1f('uLineTint', this.lineTint, surface);
        this.set1f('uLineLow', this.lineLow, surface);
        this.set2f('uTexel', 1 / b.width, 1 / b.height, surface);
        this.set2f('uPixel', 1 / renderTarget.width, 1 / renderTarget.height, surface);
        this.set1f('uCell', renderTarget.width / b.width, surface);
        this.set1f('uKeep', this.keep, surface);
        this.set1i('uBackdrop', 1, surface);
        if (this.backdrop) this.bindTexture(this.backdrop, 1);
        // Несглаженное поле во второй слот: из него берётся цвет и спасаются тонкие плёнки
        this.set1i('uRaw', 2, surface);
        this.bindTexture(renderTarget.texture, 2);
        this.renderer.setBlendMode(Phaser.BlendModes.NORMAL, true);
        this.bindAndDraw(b, null, true, true, surface);
    }

    drawLegacy(renderTarget) {
        this.bind(this.shaders[2]);
        this.set3f('uBase', this.base[0], this.base[1], this.base[2]);
        this.set3f('uTarget', this.target[0], this.target[1], this.target[2]);
        this.set1f('uThreshold', this.threshold);
        this.set1f('uEdge', this.edge);
        this.set1f('uRimWidth', this.rimWidth);
        this.set1f('uRim', this.rim);
        this.set3f('uColorA', this.colorA[0], this.colorA[1], this.colorA[2]);
        this.set3f('uColorB', this.colorB[0], this.colorB[1], this.colorB[2]);
        this.set1f('uDual', this.dual ? 1 : 0);
        this.set1f('uBody', this.body);
        this.set1f('uTilt', this.tilt);
        this.set1f('uGrad', this.grad);
        this.set1f('uCurve', this.curve);
        this.set1f('uAbsorb', this.absorb);
        this.set1f('uRefract', this.refract);
        this.set1f('uSpec', this.spec);
        this.set1f('uShine', this.shine);
        this.set3f('uLight', this.light[0], this.light[1], this.light[2]);
        this.set4f('uPlane', this.plane[0], this.plane[1], this.plane[2], this.plane[3]);
        this.set2f('uWalls', this.walls[0], this.walls[1]);
        this.set1f('uFill', this.fill);
        this.set2f('uSize', this.game.scale.width, this.game.scale.height);
        this.set2f('uTexel', 1 / renderTarget.width, 1 / renderTarget.height);
        // Фон кладём во второй слот: первый при отрисовке занимает сам буфер плотности
        this.set1i('uBackdrop', 1);
        if (this.backdrop) this.bindTexture(this.backdrop, 1);
        // Частицы складывались в буфер режимом сложения (ONE, ONE) — готовую жидкость выводим обычным
        // наложением, иначе к её цвету прибавляется фон под ней (жидкость светлее и «светится»)
        this.renderer.setBlendMode(Phaser.BlendModes.NORMAL, true);
        this.bindAndDraw(renderTarget, null, true, true, this.shaders[2]);
    }
}

function hexToVec3(hex) {
    return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}
