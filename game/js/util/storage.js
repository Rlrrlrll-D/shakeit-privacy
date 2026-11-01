// Хранилище прогресса и монет. По умолчанию — localStorage; на портале (platform/) подменяется на его
// облачное хранилище, чтобы сохранения жили в аккаунте игрока. Хранилище может быть недоступно
// (приватный режим, запрет cookie) — тогда чтение даёт null, запись молча теряется, игра идёт дальше
let backend = null;

function local() {
    try {
        return window.localStorage;
    } catch (e) {
        return null;
    }
}

// backend: { getItem(key) -> string|null, setItem(key, value) }
export function useStorageBackend(next) {
    backend = next;
}

export function readStored(key) {
    try {
        return (backend || local()).getItem(key);
    } catch (e) {
        return null;
    }
}

export function writeStored(key, value) {
    try {
        (backend || local()).setItem(key, value);
    } catch (e) {
        // См. выше
    }
}
