import { config } from '../lib/config';

// Compares every pinned package with Thunderstore's latest release; exits 1 when something is behind
const headers = { 'User-Agent': 'valheim-server/1.0' };

async function main() {
  let behind = 0;
  for (const p of config.mods.packages) {
    const full = `${p.namespace}-${p.name}`;
    const res = await fetch(`https://thunderstore.io/api/experimental/package/${p.namespace}/${p.name}/`, { headers });
    if (!res.ok) {
      console.log(`${full.padEnd(48)} ${p.version.padEnd(10)} lookup failed (${res.status})`);
      continue;
    }
    const { latest } = (await res.json()) as { latest: { version_number: string; date_created: string } };
    const same = latest.version_number === p.version;
    if (!same) behind += 1;
    console.log(`${full.padEnd(48)} ${p.version.padEnd(10)} ${same ? 'current' : `${latest.version_number} available (${latest.date_created.slice(0, 10)})`}`);
  }
  console.log(behind ? `\n${behind} behind. Bump the versions in lib/config.ts, then deploy, restart when the hall is empty, and share-profile.` : '\nEverything is current.');
  process.exit(behind ? 1 : 0);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
