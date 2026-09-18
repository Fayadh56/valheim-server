import { queryInfo } from './a2s';
import { createAws } from './aws';
import { createHandler, readEnv } from './index';

export const handler = createHandler({
  aws: createAws(),
  env: readEnv(),
  queryPlayers: (host, port) => queryInfo(host, port),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
});
