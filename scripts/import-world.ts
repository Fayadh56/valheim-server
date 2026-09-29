import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { config } from '../lib/config';
import { containerName, worldPaths } from '../lib/worlds';

const env = { ...process.env, AWS_PROFILE: process.env.AWS_PROFILE ?? 'valheim' };
const aws = (...args: string[]) => execFileSync('aws', [...args, '--region', config.region], { encoding: 'utf8', env }).trim();
const output = (key: string) => aws('cloudformation', 'describe-stacks', '--stack-name', 'ValheimServerStack', '--query', `Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue`, '--output', 'text');

const [name, ...files] = process.argv.slice(2);
const index = config.worlds.findIndex((w) => w.name === name);
if (index < 0 || files.length === 0) {
  console.error(`usage: npm run import-world -- "<world name>" <file.db> <file.fwl>\nworlds: ${config.worlds.map((w) => w.name).join(', ')}`);
  process.exit(1);
}
const world = config.worlds[index];
const bucket = output('TransfersBucket');
const instanceId = output('InstanceId');
const container = containerName(index, world);
const prefix = `worlds/${container}/`;
const names = files.map((file) => basename(file));
for (const file of files) aws('s3', 'cp', file, `s3://${bucket}/${prefix}${basename(file)}`);

const target = `${worldPaths(index, world).config}/worlds_local`;
const commands = [
  `running=$(docker ps -q -f name=^${container}$)`,
  `[ -n "$running" ] && docker stop -t 120 ${container}`,
  `mkdir -p ${target}`,
  // only this import's files, so leftovers from an earlier upload never overwrite a live save
  ...names.map((name) => `aws s3 cp "s3://${bucket}/${prefix}${name}" "${target}/${name}" --region ${config.region}`),
  `chown -R 1000:1000 ${target}`,
  `ls -la ${target}`,
  `[ -n "$running" ] && docker start ${container} || true`,
];
const parameters = JSON.stringify({ commands });
const commandId = aws('ssm', 'send-command', '--instance-ids', instanceId, '--document-name', 'AWS-RunShellScript', '--comment', `import world ${world.name}`, '--parameters', parameters, '--query', 'Command.CommandId', '--output', 'text');
try {
  aws('ssm', 'wait', 'command-executed', '--command-id', commandId, '--instance-id', instanceId);
} catch {
  // the waiter also exits non-zero on Failed; the status below tells the two apart
}
const [status, stdout, stderr] = JSON.parse(aws('ssm', 'get-command-invocation', '--command-id', commandId, '--instance-id', instanceId, '--query', '[Status,StandardOutputContent,StandardErrorContent]', '--output', 'json')) as [string, string, string];
console.log(`${status}\n${stdout}${stderr}`);
if (status !== 'Success') process.exit(1);
