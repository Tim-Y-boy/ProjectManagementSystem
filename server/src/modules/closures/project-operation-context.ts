import { AsyncLocalStorage } from 'node:async_hooks';
import { EntityManager } from 'typeorm';

// A write interceptor may already hold the project advisory lock on this connection.
// Nested service transactions must use that connection rather than waiting on themselves.
export const projectOperationManager = new AsyncLocalStorage<EntityManager>();
