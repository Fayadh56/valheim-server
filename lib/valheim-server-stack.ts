import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Backups } from './backups';
import { ServerConfig } from './config';
import { Network } from './network';
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

    new cdk.CfnOutput(this, 'PublicIp', { value: network.eip.attrPublicIp });
    new cdk.CfnOutput(this, 'InstanceId', { value: server.instance.instanceId });
  }
}
