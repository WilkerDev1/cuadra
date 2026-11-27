/// <reference lib="webworker" />
// Worker dedicado de SQLite: @sqlite.org/sqlite-wasm con VFS opfs-sahpool, o ':memory:' + IndexedDB.
// Toda la lógica está en workerHost.ts; aquí solo se conecta con `self`.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { openIdbStore, MEMORY_DB_KEY } from './idbStore';
import type { WorkerRequest } from './protocol';
import { createWorkerHost } from './workerHost';

declare const self: DedicatedWorkerGlobalScope;

const host = createWorkerHost({
  loadSqlite: () => sqlite3InitModule(),
  openByteStore: () => openIdbStore(),
  memoryKey: MEMORY_DB_KEY,
  post: (message, transfer) => self.postMessage(message, transfer ?? []),
});

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  void host.handle(event.data);
});
