import { BeforeAll, AfterAll, Before, setDefaultTimeout } from '@cucumber/cucumber';
import { startDb, teardownDb, truncateAll, type DbFixture } from './db.js';

// Testcontainers pode demorar até 60 s na primeira execução (pull de imagem).
setDefaultTimeout(120_000);

let fixture: DbFixture;

BeforeAll(async () => {
  fixture = await startDb();
});

AfterAll(async () => {
  if (fixture) await teardownDb(fixture);
});

/** Limpa todas as tabelas entre cenários para isolamento completo. */
Before(async () => {
  if (fixture) await truncateAll(fixture.pool);
});

export function getFixture(): DbFixture {
  if (!fixture) throw new Error('DB fixture não inicializada — BeforeAll não executou?');
  return fixture;
}
