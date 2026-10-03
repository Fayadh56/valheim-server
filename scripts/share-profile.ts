import { execFileSync } from 'node:child_process';
import { config } from '../lib/config';
import { PROFILE_CODE_PARAMETER_NAME, PROFILE_MESSAGE_PARAMETER_NAME } from '../lib/mods';
import { buildProfileUpload, codeAnnouncement, joinInstructions, modDisplayNames, PROFILE_UPLOAD_URL, webhookMessageUrl } from '../lib/profile';

const env = { ...process.env, AWS_PROFILE: process.env.AWS_PROFILE ?? 'valheim' };
const aws = (...args: string[]) => execFileSync('aws', [...args, '--region', config.region], { encoding: 'utf8', env }).trim();
const output = (key: string) => aws('cloudformation', 'describe-stacks', '--stack-name', 'ValheimServerStack', '--query', `Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue`, '--output', 'text');
const parameter = (name: string) => aws('ssm', 'get-parameter', '--name', name, '--query', 'Parameter.Value', '--output', 'text');
const putParameter = (name: string, value: string) => aws('ssm', 'put-parameter', '--name', name, '--type', 'String', '--overwrite', '--value', value);
const headers = { 'User-Agent': 'valheim-server/1.0', 'Content-Type': 'application/json' };

async function uploadProfile(): Promise<string> {
  const upload = await fetch(PROFILE_UPLOAD_URL, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: buildProfileUpload(config.mods) });
  if (upload.status === 429) throw new Error('Thunderstore is rate limiting profile uploads; try again in a few minutes');
  if (!upload.ok) throw new Error(`profile upload failed: ${upload.status} ${await upload.text()}`);
  return ((await upload.json()) as { key: string }).key;
}

// Keeps one pinned post current: edits it when its id is known, otherwise posts it and asks for the one-time pin
async function updateDiscord(webhook: string, message: string, announcement: string): Promise<void> {
  const messageId = parameter(PROFILE_MESSAGE_PARAMETER_NAME);
  if (messageId !== 'none') {
    const edit = await fetch(webhookMessageUrl(webhook, messageId), { method: 'PATCH', headers, body: JSON.stringify({ content: message }) });
    if (edit.ok) {
      const post = await fetch(webhook, { method: 'POST', headers, body: JSON.stringify({ content: announcement }) });
      if (!post.ok) throw new Error(`Discord post failed: ${post.status}`);
      console.log('Updated the pinned post and announced the new code.');
      return;
    }
    if (edit.status !== 404) throw new Error(`Discord edit failed: ${edit.status}`);
    console.log('The pinned post is gone; posting a new one.');
  }
  const post = await fetch(`${webhook}?wait=true`, { method: 'POST', headers, body: JSON.stringify({ content: message }) });
  if (!post.ok) throw new Error(`Discord post failed: ${post.status}`);
  const { id } = (await post.json()) as { id: string };
  putParameter(PROFILE_MESSAGE_PARAMETER_NAME, id);
  console.log('Posted the join instructions to Discord. Pin that message once; future codes edit it in place.');
}

async function main() {
  if (!config.mods.enabled) throw new Error('mods are disabled in lib/config.ts');
  const key = process.argv.includes('--no-upload') ? parameter(PROFILE_CODE_PARAMETER_NAME) : await uploadProfile();
  if (key === 'none') throw new Error('no profile code yet; run without --no-upload first');
  putParameter(PROFILE_CODE_PARAMETER_NAME, key);
  const names = modDisplayNames(config.mods.packages.filter((p) => !p.clientOnly && !p.serverOnly));
  const message = joinInstructions(key, output('PanelUrl'), names);

  if (!process.argv.includes('--no-discord')) {
    const secret = JSON.parse(aws('secretsmanager', 'get-secret-value', '--secret-id', output('SecretArn'), '--query', 'SecretString', '--output', 'text')) as { discordWebhook?: string };
    if (secret.discordWebhook) await updateDiscord(secret.discordWebhook, message, codeAnnouncement(key));
    else console.log('No Discord webhook set; skipping the post.');
  }
  console.log(`Profile code: ${key}\n\n${message}`);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
