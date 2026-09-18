import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { ServerConfig } from './config';
import { Network } from './network';
import { ServerSettings } from './server-settings';
import { buildUserData } from './user-data';

export const UBUNTU_AMI_PARAMETER =
  '/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id';
export const DATA_DEVICE = '/dev/sdf';

export interface ServerInstanceProps {
  config: ServerConfig;
  network: Network;
  settings: ServerSettings;
}

export class ServerInstance extends Construct {
  readonly instance: ec2.Instance;
  readonly dataVolume: ec2.Volume;
  readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: ServerInstanceProps) {
    super(scope, id);
    const { config, network, settings } = props;
    const stack = cdk.Stack.of(this);

    this.role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });
    settings.secret.grantRead(this.role);
    settings.composeParameter.grantRead(this.role);

    this.dataVolume = new ec2.Volume(this, 'DataVolume', {
      availabilityZone: config.az,
      size: cdk.Size.gibibytes(30),
      volumeType: ec2.EbsDeviceVolumeType.GP3,
      encrypted: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userData = ec2.UserData.custom(
      buildUserData({
        region: stack.region,
        dataVolumeId: this.dataVolume.volumeId,
        composeParameterName: settings.composeParameter.parameterName,
        secretArn: settings.secret.secretArn,
      }),
    );

    this.instance = new ec2.Instance(this, 'Instance', {
      vpc: network.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      availabilityZone: config.az,
      instanceType: new ec2.InstanceType(config.instanceType),
      // cachedInContext pins the AMI in cdk.context.json so a routine deploy never replaces the instance
      machineImage: ec2.MachineImage.fromSsmParameter(UBUNTU_AMI_PARAMETER, {
        os: ec2.OperatingSystemType.LINUX,
        cachedInContext: true,
      }),
      securityGroup: network.securityGroup,
      role: this.role,
      userData,
      // The Elastic IP is the only public address; the boot script waits for it
      associatePublicIpAddress: false,
      blockDevices: [
        {
          deviceName: '/dev/sda1',
          volume: ec2.BlockDeviceVolume.ebs(16, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
      httpTokens: ec2.HttpTokens.REQUIRED,
      httpPutResponseHopLimit: 1,
      detailedMonitoring: false,
      userDataCausesReplacement: false,
    });
    cdk.Tags.of(this.instance).add('Name', 'valheim-server');

    new ec2.CfnVolumeAttachment(this, 'DataVolumeAttachment', {
      volumeId: this.dataVolume.volumeId,
      instanceId: this.instance.instanceId,
      device: DATA_DEVICE,
    });

    new ec2.CfnEIPAssociation(this, 'EipAssociation', {
      allocationId: network.eip.attrAllocationId,
      instanceId: this.instance.instanceId,
    });
  }
}
