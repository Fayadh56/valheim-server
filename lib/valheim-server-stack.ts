import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Backups } from './backups';
import { ServerConfig } from './config';
import { CostGuard } from './cost-guard';
import { GAME_PORT, Network, QUERY_PORT } from './network';
import { Schedule } from './schedule';
import { ServerInstance } from './server-instance';
import { ServerSettings } from './server-settings';

export interface ValheimServerStackProps extends cdk.StackProps {
  config: ServerConfig;
}

export class ValheimServerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ValheimServerStackProps) {
    super(scope, id, { ...props, terminationProtection: true });
    const { config } = props;

    const network = new Network(this, 'Network', { az: config.az });
    const settings = new ServerSettings(this, 'Settings', { config });
    const server = new ServerInstance(this, 'Server', { config, network, settings });
    new Backups(this, 'Backups', { dataVolume: server.dataVolume });
    if (config.schedule.enabled) {
      new Schedule(this, 'Schedule', {
        instance: server.instance,
        schedule: config.schedule,
        timezone: config.timezone,
      });
    }
    new CostGuard(this, 'CostGuard', { budgetUsd: config.budgetUsd, email: config.alertEmail });

    const ip = network.eip.attrPublicIp;
    const instanceId = server.instance.instanceId;
    new cdk.CfnOutput(this, 'PublicIp', { value: ip });
    new cdk.CfnOutput(this, 'ConnectString', { value: `${ip}:${GAME_PORT}`, description: 'In-game Join IP' });
    new cdk.CfnOutput(this, 'SteamFavoritesString', { value: `${ip}:${QUERY_PORT}`, description: 'Steam server browser favorites' });
    new cdk.CfnOutput(this, 'InstanceId', { value: instanceId });
    new cdk.CfnOutput(this, 'DataVolumeId', { value: server.dataVolume.volumeId });
    new cdk.CfnOutput(this, 'SecretArn', { value: settings.secret.secretArn });
    new cdk.CfnOutput(this, 'ComposeParameterName', { value: settings.composeParameter.parameterName });
    new cdk.CfnOutput(this, 'ShellCommand', {
      value: `aws ssm start-session --target ${instanceId} --region ${this.region}`,
    });
    new cdk.CfnOutput(this, 'PasswordCommand', {
      value: `aws secretsmanager get-secret-value --secret-id ${settings.secret.secretArn} --region ${this.region} --query SecretString --output text`,
    });
  }
}
