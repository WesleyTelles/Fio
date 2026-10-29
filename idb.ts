// IndexedDB mínimo (sem dependências). Só guarda CACHE de leitura e a FILA de sincronização.
// Nunca guarda senha nem token. Tudo é amarrado ao user_id e apagado no logout/troca de conta.
const DB = 'fio', VER = 1;
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('ops')) db.createObjectStore('ops', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbp = null; reject(r.error); };
  });
  return dbp;
}
const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function store(name: 'kv' | 'ops', mode: IDBTransactionMode) { return (await open()).transaction(name, mode).objectStore(name); }

export const kv = {
  get: async <T>(k: string): Promise<T | undefined> => req((await store('kv', 'readonly')).get(k)) as Promise<T | undefined>,
  set: async (k: string, v: unknown) => { await req((await store('kv', 'readwrite')).put(v, k)); },
  del: async (k: string) => { await req((await store('kv', 'readwrite')).delete(k)); },
  keys: async () => (await req((await store('kv', 'readonly')).getAllKeys())) as string[],
};
export const opsDb = {
  all: async <T>() => (await req((await store('ops', 'readonly')).getAll())) as T[],
  put: async (o: unknown) => { await req((await store('ops', 'readwrite')).put(o)); },
  del: async (id: string) => { await req((await store('ops', 'readwrite')).delete(id)); },
};
export function resetIdbConnectionForTests() { dbp = null; }
