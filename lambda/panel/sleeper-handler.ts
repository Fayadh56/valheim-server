import { queryInfo } from './a2s';
import { createAws } from './aws';
import { createSleeper, readSleeperEnv } from './sleeper';

export const handler = createSleeper({
  aws: createAws(),
  env: readSleeperEnv(),
  queryPlayers: (host, port) => queryInfo(host, port),
  now: () => Date.now(),
});
