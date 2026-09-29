import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { WorldConfig } from './config';
import { activeWorlds } from './worlds';

export interface NetworkProps {
  az: string;
  worlds: WorldConfig[];
}

export class Network extends Construct {
  readonly vpc: ec2.Vpc;
  readonly securityGroup: ec2.SecurityGroup;
  readonly eip: ec2.CfnEIP;

  constructor(scope: Construct, id: string, props: NetworkProps) {
    super(scope, id);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/24'),
      availabilityZones: [props.az],
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 26 }],
      restrictDefaultSecurityGroup: false,
    });

    this.securityGroup = new ec2.SecurityGroup(this, 'ServerSecurityGroup', {
      vpc: this.vpc,
      description: 'Valheim server: game and query ports only',
      allowAllOutbound: true,
    });
    for (const world of activeWorlds(props.worlds)) {
      this.securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.udpRange(world.port, world.port + 1), `Valheim ${world.name}`);
    }

    this.eip = new ec2.CfnEIP(this, 'Eip', { domain: 'vpc' });
    this.eip.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
  }
}
