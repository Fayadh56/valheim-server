import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Backups } from './backups';
import { ServerConfig } from './config';
import { ControlPanel } from './control-panel';
import { CostGuard } from './cost-guard';
import { Network } from './network';
import { Schedule } from './schedule';
import { ServerInstance } from './server-instance';
import { ServerSettings } from './server-settings';
import { Transfers } from './transfers';
import { activeWorlds } from './worlds';

export interface ValheimServerStackProps extends cdk.StackProps {
  config: ServerConfig;
}

export class ValheimServerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ValheimServerStackProps) {
    super(scope, id, { ...props, terminationProtection: true });
    const { config } = props;

    const worlds = activeWorlds(config.worlds);
    const network = new Network(this, 'Network', { az: config.az, worlds });
    const settings = new ServerSettings(this, 'Settings', { config });
    const transfers = new Transfers(this, 'Transfers');
    const server = new ServerInstance(this, 'Server', { config, network, settings, transfers });
    new Backups(this, 'Backups', { dataVolume: server.dataVolume });
    const schedule = new Schedule(this, 'Schedule', {
      instance: server.instance,
      schedule: config.schedule,
      timezone: config.timezone,
    });
    new CostGuard(this, 'CostGuard', { budgetUsd: config.budgetUsd, email: config.alertEmail });

    if (config.panel.enabled) {
      const panel = new ControlPanel(this, 'Panel', {
        instance: server.instance,
        publicIp: network.eip.attrPublicIp,
        secret: settings.secret,
        schedule,
        timezone: config.timezone,
        serverName: config.serverName,
        sleepWhenEmpty: config.panel.sleepWhenEmpty,
        worlds,
        playersParameters: server.playersParameters,
        modsParameter: settings.modsParameter,
        profileCodeParameter: settings.profileCodeParameter,
      });
      new cdk.CfnOutput(this, 'PanelUrl', { value: panel.url.url, description: 'Control panel for friends' });
    }

    const ip = network.eip.attrPublicIp;
    const instanceId = server.instance.instanceId;
    new cdk.CfnOutput(this, 'PublicIp', { value: ip });
    const port = config.worlds[0].port;
    new cdk.CfnOutput(this, 'ConnectString', { value: `${ip}:${port}`, description: 'In-game Join IP' });
    new cdk.CfnOutput(this, 'SteamFavoritesString', { value: `${ip}:${port + 1}`, description: 'Steam server browser favorites' });
    new cdk.CfnOutput(this, 'InstanceId', { value: instanceId });
    new cdk.CfnOutput(this, 'DataVolumeId', { value: server.dataVolume.volumeId });
    new cdk.CfnOutput(this, 'SecretArn', { value: settings.secret.secretArn });
    new cdk.CfnOutput(this, 'ComposeParameterName', { value: settings.composeParameter.parameterName });
    new cdk.CfnOutput(this, 'ShellCommand', {
      value: `aws ssm start-session --target ${instanceId} --region ${this.region}`,
    });
    new cdk.CfnOutput(this, 'TransfersBucket', { value: transfers.bucket.bucketName, description: 'Scratch bucket for save file uploads' });
    new cdk.CfnOutput(this, 'WorldPorts', { value: worlds.map((w) => `${w.name}: ${w.port}`).join('; ') });
    new cdk.CfnOutput(this, 'PasswordCommand', {
      value: `aws secretsmanager get-secret-value --secret-id ${settings.secret.secretArn} --region ${this.region} --query SecretString --output text`,
    });
  }
}
