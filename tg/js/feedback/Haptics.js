// Вибрация — отдача от ударов жидкости о стенки.
// В приложении — через свой нативный плагин Haptic (HapticPlugin.java): плавная сила 1..255
// и без задержек WebView. В браузере — navigator.vibrate, где он есть (только длительность).
export class Haptics {
    constructor(params) {
        this.p = params;
        this.lastPulse = -Infinity;
        this.native = null;

        // JS-часть Capacitor (registerPlugin) в проект не подключена — вызываем нативный мост напрямую.
        // toNative — вызов без ожидания ответа, как раз для метода с RETURN_NONE
        const cap = window.Capacitor;
        if (cap?.isNativePlatform?.() && cap.isPluginAvailable?.('Haptic') && typeof cap.toNative === 'function') {
            this.native = (options) => cap.toNative('Haptic', 'pulse', options);
        }
        this.web = !this.native && typeof navigator.vibrate === 'function';
    }

    get available() {
        return Boolean(this.native) || this.web;
    }

    // strength 0..1. Частые удары прореживаются: мотор не успевает отыграть импульсы чаще ~14 раз в секунду
    pulse(strength, force = false) {
        const now = performance.now() / 1000;
        if (!force && now - this.lastPulse < this.p.hapticMinInterval) return;
        this.lastPulse = now;

        const p = this.p;
        const s = Math.min(1, Math.max(0, strength));
        const duration = Math.round(p.hapticMinMs + (p.hapticMaxMs - p.hapticMinMs) * s);
        const amplitude = Math.round(p.hapticMinAmp + (255 - p.hapticMinAmp) * s);

        if (this.native) {
            this.native({ duration, amplitude });
        } else if (this.web) {
            navigator.vibrate(duration);
        }
    }

    // Вызывается раз в кадр с силой ударов жидкости
    update(impact) {
        const p = this.p;
        if (impact > p.impactMin) this.pulse((impact - p.impactMin) / p.impactRef);
    }
}
