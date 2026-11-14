// Каталог косметики: что продаётся за монеты. Только внешний вид — на скорость перемешивания, звёзды
// и рекорды ничего из этого не влияет (рекорды остаются сравнимыми).
//
// Наборы стекла — это оттенок, которым подкрашиваются готовые картинки стаканов (www/images/glass):
// новых файлов не нужно, размер приложения не растёт. Гарнир рисуется графикой на ободке, фоны —
// градиентом и пузырьками, брызги — цветом частиц.
//
// id хранится в сохранении, поэтому не меняется; name — ключ перевода (i18n.js).

// Бесплатное снаряжение по умолчанию — у всех с самого начала
export const DEFAULT_EQUIP = { glass: 'clear', garnish: 'none', scene: 'bar', sparks: 'gold' };

export const COSMETICS = {
    // Оттенок стекла: tint — умножается на картинку стакана
    glass: [
        { id: 'clear', name: 'glassClear', price: 0, tint: 0xffffff },
        { id: 'smoke', name: 'glassSmoke', price: 120, tint: 0x8d93a8 },
        { id: 'amber', name: 'glassAmber', price: 200, tint: 0xffb46b },
        { id: 'cobalt', name: 'glassCobalt', price: 200, tint: 0x6f9bff },
        { id: 'emerald', name: 'glassEmerald', price: 260, tint: 0x6fd6a0 },
        { id: 'rose', name: 'glassRose', price: 260, tint: 0xff9ec4 },
        { id: 'copper', name: 'glassCopper', price: 400, tint: 0xd98b53 }
    ],
    // Гарнир на ободке: art — как рисовать (ui/garnish.js)
    garnish: [
        { id: 'none', name: 'garnishNone', price: 0 },
        { id: 'straw', name: 'garnishStraw', price: 80 },
        { id: 'slice', name: 'garnishSlice', price: 150 },
        { id: 'cherry', name: 'garnishCherry', price: 150 },
        { id: 'umbrella', name: 'garnishUmbrella', price: 300 },
        { id: 'mint', name: 'garnishMint', price: 220 },
        { id: 'rim', name: 'garnishRim', price: 180 }
    ],
    // Фон заезда: верх и низ градиента, цвет пузырьков (null — в цвет напитка, как сейчас)
    scene: [
        { id: 'bar', name: 'sceneBar', price: 0, top: 0x0b0c10, bottom: null, bubbles: null },
        { id: 'neon', name: 'sceneNeon', price: 180, top: 0x12001f, bottom: 0x3d0a52, bubbles: 0xff5ed2 },
        { id: 'beach', name: 'sceneBeach', price: 240, top: 0x1b1033, bottom: 0xa8452b, bubbles: 0xffd166 },
        { id: 'jungle', name: 'sceneJungle', price: 240, top: 0x04140c, bottom: 0x1d5c33, bubbles: 0x9be15d },
        { id: 'ice', name: 'sceneIce', price: 300, top: 0x061522, bottom: 0x2a6f8f, bubbles: 0xcfe3ff }
    ],
    // Цвет искр и брызг при комбо и победе
    sparks: [
        { id: 'gold', name: 'sparksGold', price: 0, color: 0xf1c40f },
        { id: 'neon', name: 'sparksNeon', price: 120, color: 0x5ef2ff },
        { id: 'rose', name: 'sparksRose', price: 120, color: 0xff6ec7 },
        { id: 'lime', name: 'sparksLime', price: 160, color: 0xaaff4d }
    ]
};

export const SLOTS = Object.keys(COSMETICS);

export function item(slot, id) {
    const list = COSMETICS[slot];
    return list.find((i) => i.id === id) || list[0];
}
