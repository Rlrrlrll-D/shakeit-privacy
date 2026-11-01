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

export class LiquidPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
    constructor(game) {
        super({ game, name: 'LiquidPipeline', fragShader });
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
        this.bindAndDraw(renderTarget);
    }
}

function hexToVec3(hex) {
    return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}
