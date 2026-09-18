import { DescribeInstancesCommand, EC2Client, StartInstancesCommand, StopInstancesCommand } from '@aws-sdk/client-ec2';
import { GetScheduleCommand, SchedulerClient, ScheduleState, UpdateScheduleCommand } from '@aws-sdk/client-scheduler';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

export interface InstanceStatus {
  state: string;
  launchTime?: Date;
}

export interface ScheduleSettings {
  enabled: boolean;
  stopCron: string;
  startCron: string;
}

export interface Aws {
  describeInstance(id: string): Promise<InstanceStatus>;
  startInstance(id: string): Promise<void>;
  stopInstance(id: string): Promise<void>;
  getSchedules(stopName: string, startName: string): Promise<ScheduleSettings>;
  updateSchedules(stopName: string, startName: string, settings: ScheduleSettings): Promise<void>;
  getServerPassword(secretArn: string): Promise<string>;
  getWebhook(secretArn: string): Promise<string>;
  getParameter(name: string): Promise<string>;
  putParameter(name: string, value: string): Promise<void>;
  postDiscord(webhook: string, content: string): Promise<void>;
}

interface SecretShape {
  password?: string;
  discordWebhook?: string;
}

export function createAws(): Aws {
  const ec2 = new EC2Client({});
  const scheduler = new SchedulerClient({});
  const secrets = new SecretsManagerClient({});
  const ssm = new SSMClient({});

  const getSchedule = (name: string) => scheduler.send(new GetScheduleCommand({ Name: name, GroupName: 'default' }));

  const putSchedule = async (name: string, cron: string, enabled: boolean) => {
    const current = await getSchedule(name);
    await scheduler.send(new UpdateScheduleCommand({
      Name: name,
      GroupName: 'default',
      ScheduleExpression: cron,
      ScheduleExpressionTimezone: current.ScheduleExpressionTimezone,
      FlexibleTimeWindow: current.FlexibleTimeWindow ?? { Mode: 'OFF' },
      Target: current.Target,
      Description: current.Description,
      State: enabled ? ScheduleState.ENABLED : ScheduleState.DISABLED,
    }));
  };

  const readSecret = async (secretArn: string): Promise<SecretShape> => {
    const out = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
    return JSON.parse(out.SecretString ?? '{}') as SecretShape;
  };

  return {
    async describeInstance(id) {
      const out = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [id] }));
      const instance = out.Reservations?.[0]?.Instances?.[0];
      return { state: instance?.State?.Name ?? 'unknown', launchTime: instance?.LaunchTime };
    },
    async startInstance(id) {
      await ec2.send(new StartInstancesCommand({ InstanceIds: [id] }));
    },
    async stopInstance(id) {
      await ec2.send(new StopInstancesCommand({ InstanceIds: [id] }));
    },
    async getSchedules(stopName, startName) {
      const [stop, start] = await Promise.all([getSchedule(stopName), getSchedule(startName)]);
      return {
        enabled: stop.State === ScheduleState.ENABLED,
        stopCron: stop.ScheduleExpression ?? '',
        startCron: start.ScheduleExpression ?? '',
      };
    },
    async updateSchedules(stopName, startName, settings) {
      await putSchedule(stopName, settings.stopCron, settings.enabled);
      await putSchedule(startName, settings.startCron, settings.enabled);
    },
    async getServerPassword(secretArn) {
      const { password } = await readSecret(secretArn);
      if (!password) throw new Error('secret has no password field');
      return password;
    },
    async getWebhook(secretArn) {
      return (await readSecret(secretArn)).discordWebhook ?? '';
    },
    async getParameter(name) {
      const out = await ssm.send(new GetParameterCommand({ Name: name }));
      return out.Parameter?.Value ?? '';
    },
    async putParameter(name, value) {
      await ssm.send(new PutParameterCommand({ Name: name, Value: value, Type: 'String', Overwrite: true }));
    },
    async postDiscord(webhook, content) {
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'valheim-panel/1.0' },
        body: JSON.stringify({ username: 'Valheim', content }),
      });
      if (!response.ok) throw new Error(`discord responded ${response.status}`);
    },
  };
}
