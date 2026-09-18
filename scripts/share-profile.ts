import { execFileSync } from 'node:child_process';
import { config } from '../lib/config';
import { PROFILE_CODE_PARAMETER_NAME } from '../lib/mods';
import { buildProfileUpload, joinInstructions, modDisplayNames, PROFILE_UPLOAD_URL } from '../lib/profile';

const env = { ...process.env, AWS_PROFILE: process.env.AWS_PROFILE ?? 'valheim' };
const aws = (...args: string[]) => execFileSync('aws', [...args, '--region', config.region], { encoding: 'utf8', env }).trim();
const output = (key: string) => aws('cloudformation', 'describe-stacks', '--stack-name', 'ValheimServerStack', '--query', `Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue`, '--output', 'text');
const headers = { 'User-Agent': 'valheim-server/1.0' };

async function main() {
  if (!config.mods.enabled) throw new Error('mods are disabled in lib/config.ts');
  const upload = await fetch(PROFILE_UPLOAD_URL, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: buildProfileUpload(config.mods) });
  if (upload.status === 429) throw new Error('Thunderstore is rate limiting profile uploads; try again in a few minutes');
  if (!upload.ok) throw new Error(`profile upload failed: ${upload.status} ${await upload.text()}`);
  const { key } = (await upload.json()) as { key: string };

  aws('ssm', 'put-parameter', '--name', PROFILE_CODE_PARAMETER_NAME, '--type', 'String', '--overwrite', '--value', key);
  const names = modDisplayNames(config.mods.packages.filter((p) => !p.clientOnly));
  const message = joinInstructions(key, output('PanelUrl'), names);

  if (!process.argv.includes('--no-discord')) {
    const secret = JSON.parse(aws('secretsmanager', 'get-secret-value', '--secret-id', output('SecretArn'), '--query', 'SecretString', '--output', 'text')) as { discordWebhook?: string };
    if (secret.discordWebhook) {
      const post = await fetch(secret.discordWebhook, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: message }) });
      if (!post.ok) throw new Error(`Discord post failed: ${post.status}`);
      console.log('Posted to Discord.');
    } else {
      console.log('No Discord webhook set; skipping the post.');
    }
  }
  console.log(`Profile code: ${key}\n\n${message}`);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
