// Candado entre pestañas (ADR-9). opfs-sahpool admite UNA conexión por origen, y el modo :memory:+IDB
// crearía libros divergentes si dos pestañas escribieran a la vez. Por eso:
// - navigator.locks.request('cuadra-db') protege la apertura y se mantiene mientras la pestaña use la base;
// - la pestaña sin candado avisa con onBlocked(takeOver) ("Cuadra está abierta en otra pestaña · Usar aquí")
//   y queda en cola: si la otra se cierra, obtiene el candado sola;
// - takeOver() manda 'release-request' por BroadcastChannel; la pestaña dueña ejecuta onReleaseRequested
//   (cerrar la base y pauseVfs) y SOLO después suelta el candado.

export const TAB_LOCK_NAME = 'cuadra-db';

type ChannelMessage = { type: 'release-request'; from: string };

export interface ChannelLike {
  postMessage(message: ChannelMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ChannelMessage>) => void): void;
  close(): void;
}

export interface TabLockOptions {
  name?: string;
  /** Inyectables para pruebas; por defecto navigator.locks y BroadcastChannel. */
  locks?: LockManager | null;
  createChannel?: ((name: string) => ChannelLike) | null;
  /** Otra pestaña tiene la base. Llamar a takeOver() le pide que la ceda. Puede llamarse una vez. */
  onBlocked?: (takeOver: () => void) => void;
  /**
   * Otra pestaña pidió la base. Se espera a que esta promesa termine (cerrar la conexión) antes de
   * soltar el candado. Después la pestaña queda sin base hasta recargar.
   */
  onReleaseRequested?: () => Promise<void> | void;
}

export interface TabLockHandle {
  /** false si el navegador no tiene Web Locks: se abre sin protección entre pestañas. */
  readonly supported: boolean;
  /** true desde que se obtuvo el candado hasta que se suelta. */
  readonly held: boolean;
  /** Suelta el candado y cierra el canal. */
  release(): void;
}

function defaultLocks(): LockManager | null {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
}

function defaultChannel(name: string): ChannelLike | null {
  return typeof BroadcastChannel === 'undefined' ? null : (new BroadcastChannel(name) as unknown as ChannelLike);
}

function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Resuelve cuando esta pestaña tiene el candado (puede tardar indefinidamente si otra no lo cede). */
export function acquireTabLock(options: TabLockOptions = {}): Promise<TabLockHandle> {
  const name = options.name ?? TAB_LOCK_NAME;
  const locks = options.locks === undefined ? defaultLocks() : options.locks;
  if (!locks) {
    return Promise.resolve({ supported: false, held: false, release: () => undefined });
  }

  const tabId = randomId();
  const channel = options.createChannel === undefined ? defaultChannel(name) : options.createChannel?.(name) ?? null;
  let held = false;
  let finished = false;
  let releasing = false;
  let letGo!: () => void;
  const holding = new Promise<void>((resolve) => {
    letGo = resolve;
  });

  const handle: TabLockHandle = {
    supported: true,
    get held() {
      return held;
    },
    release() {
      if (finished) return;
      finished = true;
      held = false;
      letGo();
      channel?.close();
    },
  };

  channel?.addEventListener('message', (event) => {
    const message = event.data;
    if (message?.type !== 'release-request' || message.from === tabId || !held || releasing) return;
    releasing = true;
    void Promise.resolve()
      .then(() => options.onReleaseRequested?.())
      .catch(() => undefined) // aunque cerrar falle, la otra pestaña pidió la base: se cede
      .finally(() => handle.release());
  });

  return new Promise<TabLockHandle>((resolve, reject) => {
    const hold = async (): Promise<void> => {
      if (finished) return; // se soltó antes de llegar a tenerlo
      held = true;
      resolve(handle);
      await holding;
    };

    locks
      .request(name, { ifAvailable: true }, async (lock) => {
        if (lock) return hold();
        // Ocupado: se queda en cola y avisa. Cuando la otra pestaña suelte, entra esta.
        locks.request(name, hold).catch(reject);
        options.onBlocked?.(() => channel?.postMessage({ type: 'release-request', from: tabId }));
        return undefined;
      })
      .catch(reject);
  });
}
