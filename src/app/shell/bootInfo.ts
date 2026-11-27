// El contexto del arranque es público y vive en app/data; el shell lo reexporta por compatibilidad.
export { BootInfoContext, useBootInfo, type BootInfo } from '../data/bootInfo';
