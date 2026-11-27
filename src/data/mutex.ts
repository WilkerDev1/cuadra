// Serializa trabajo asíncrono sobre una sola conexión: cada tarea empieza cuando la anterior
// terminó (bien o mal). Lo usan todos los adaptadores para que una transacción no se mezcle
// con llamadas sueltas de otra parte de la app.

export class Mutex {
  #tail: Promise<unknown> = Promise.resolve();
  #pending = 0;

  /** Número de tareas en curso o esperando. */
  get pending(): number {
    return this.#pending;
  }

  run<T>(task: () => Promise<T> | T): Promise<T> {
    this.#pending++;
    const result = this.#tail.then(task);
    // La cola sigue aunque la tarea falle; el error lo recibe solo quien la encoló.
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.#pending--;
    });
  }
}
