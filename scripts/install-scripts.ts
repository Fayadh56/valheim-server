import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../lib/config';
import { installScripts } from '../lib/instance-scripts';

// The AWS CLI carries the browser login session of the valheim profile, so no SDK credentials plumbing is needed
const env = { ...process.env, AWS_PROFILE: process.env.AWS_PROFILE ?? 'valheim' };
const aws = (...args: string[]) => execFileSync('aws', [...args, '--region', config.region], { encoding: 'utf8', env }).trim();
const output = (key: string) => aws('cloudformation', 'describe-stacks', '--stack-name', 'ValheimServerStack', '--query', `Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue`, '--output', 'text');

const instanceId = output('InstanceId');
const shell = installScripts({ region: config.region, composeParameterName: output('ComposeParameterName'), secretArn: output('SecretArn') });
const parameters = join(mkdtempSync(join(tmpdir(), 'valheim-scripts-')), 'parameters.json');
writeFileSync(parameters, JSON.stringify({ commands: shell.split('\n') }));
const commandId = aws('ssm', 'send-command', '--instance-ids', instanceId, '--document-name', 'AWS-RunShellScript', '--comment', 'install valheim instance scripts', '--parameters', `file://${parameters}`, '--query', 'Command.CommandId', '--output', 'text');
try {
  aws('ssm', 'wait', 'command-executed', '--command-id', commandId, '--instance-id', instanceId);
} catch {
  // the waiter also exits non-zero on Failed; the status below tells the two apart
}
const [status, stdout, stderr] = JSON.parse(aws('ssm', 'get-command-invocation', '--command-id', commandId, '--instance-id', instanceId, '--query', '[Status,StandardOutputContent,StandardErrorContent]', '--output', 'json')) as [string, string, string];
console.log(`${status}\n${stdout}${stderr}`);
if (status !== 'Success') process.exit(1);
