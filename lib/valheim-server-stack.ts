import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ServerConfig } from './config';
import { Network } from './network';

export interface ValheimServerStackProps extends cdk.StackProps {
  config: ServerConfig;
}

export class ValheimServerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ValheimServerStackProps) {
    super(scope, id, { ...props, terminationProtection: true });
    const { config } = props;

    const network = new Network(this, 'Network', { az: config.az });

    new cdk.CfnOutput(this, 'PublicIp', { value: network.eip.attrPublicIp });
  }
}
