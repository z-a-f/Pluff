import type { LocalAccount } from "@pluff/client";

const DB_NAME = "pluff-web";
const DB_VERSION = 1;
const ACCOUNTS = "accounts";

export async function saveAccount(account: LocalAccount): Promise<void> {
  const db = await openDb();
  await tx(db, ACCOUNTS, "readwrite", (store) => {
    store.put(account, account.identity.did);
  });
  db.close();
}

export async function listAccounts(): Promise<LocalAccount[]> {
  const db = await openDb();
  const accounts = await tx<LocalAccount[]>(db, ACCOUNTS, "readonly", (store) =>
    requestToPromise(store.getAll()),
  );
  db.close();
  return accounts;
}

export async function getAccount(did: string): Promise<LocalAccount | undefined> {
  const db = await openDb();
  const account = await tx<LocalAccount | undefined>(db, ACCOUNTS, "readonly", (store) =>
    requestToPromise(store.get(did)),
  );
  db.close();
  return account;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ACCOUNTS)) {
        db.createObjectStore(ACCOUNTS);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => T | Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result: T;
    Promise.resolve(run(store))
      .then((value) => {
        result = value;
      })
      .catch(reject);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

