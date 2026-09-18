import { Match } from 'aws-cdk-lib/assertions';
import { synth } from './helpers';

describe('network', () => {
  const template = synth();

  test('one public subnet, no NAT, no default-SG lambda', () => {
    template.resourceCountIs('AWS::EC2::Subnet', 1);
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
    template.resourceCountIs('AWS::Lambda::Function', 0);
    template.hasResourceProperties('AWS::EC2::Subnet', { AvailabilityZone: 'us-east-1a', MapPublicIpOnLaunch: true });
  });

  test('security group allows only udp 2456-2457 from anywhere', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: [
        Match.objectLike({ IpProtocol: 'udp', FromPort: 2456, ToPort: 2457, CidrIp: '0.0.0.0/0' }),
      ],
    });
    template.resourceCountIs('AWS::EC2::SecurityGroupIngress', 0);
    expect(JSON.stringify(template.toJSON())).not.toMatch(/"FromPort":22/);
  });

  test('elastic ip is retained', () => {
    template.hasResource('AWS::EC2::EIP', { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
  });
});

describe('server settings', () => {
  const template = synth();

  test('generates a 12 character alphanumeric password inside a json secret', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      GenerateSecretString: Match.objectLike({
        SecretStringTemplate: '{"discordWebhook":""}',
        GenerateStringKey: 'password',
        PasswordLength: 12,
        ExcludePunctuation: true,
      }),
    });
  });

  test('stores the compose file in an ssm parameter without secrets or extra ports', () => {
    const params = template.findResources('AWS::SSM::Parameter');
    const values = Object.values(params).map((p) => p.Properties.Value as string);
    expect(values).toHaveLength(1);
    expect(values[0]).toContain('valheim-server:1.3.0');
    expect(values[0]).not.toMatch(/SERVER_PASS|2458|9001/);
  });
});

describe('server instance', () => {
  const template = synth();
  const json = JSON.stringify(template.toJSON());

  test('is an m7a.large in the pinned az with imdsv2 and no launch template', () => {
    template.hasResourceProperties('AWS::EC2::Instance', Match.objectLike({
      InstanceType: 'm7a.large',
      AvailabilityZone: 'us-east-1a',
      MetadataOptions: Match.objectLike({ HttpTokens: 'required', HttpPutResponseHopLimit: 1 }),
      BlockDeviceMappings: [
        Match.objectLike({ DeviceName: '/dev/sda1', Ebs: Match.objectLike({ VolumeSize: 16, VolumeType: 'gp3', Encrypted: true }) }),
      ],
    }));
    template.resourceCountIs('AWS::EC2::LaunchTemplate', 0);
    template.resourceCountIs('AWS::EC2::KeyPair', 0);
  });

  test('has a retained encrypted 30 GiB data volume attached at /dev/sdf', () => {
    template.hasResource('AWS::EC2::Volume', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
      Properties: Match.objectLike({ Size: 30, VolumeType: 'gp3', Encrypted: true, AvailabilityZone: 'us-east-1a' }),
    });
    template.hasResourceProperties('AWS::EC2::VolumeAttachment', { Device: '/dev/sdf' });
  });

  test('associates the elastic ip', () => {
    template.resourceCountIs('AWS::EC2::EIPAssociation', 1);
  });

  test('role has ssm core access and read on the secret', () => {
    expect(json).toContain('AmazonSSMManagedInstanceCore');
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'] }),
        ]),
      }),
    });
  });

  test('user data is the bootstrapper, not a config bake', () => {
    expect(json).toContain('valheim.service');
    expect(json).toContain('valheim-fetch-config');
    // the fetch script writes SERVER_PASS=%s at runtime; a literal 12-char value would mean a baked password
    expect(json).not.toMatch(/SERVER_PASS=[A-Za-z0-9]{12}/);
    expect(json).not.toMatch(/set -[a-z]*x/);
  });
});

describe('backups', () => {
  const template = synth();

  test('tags the data volume for dlm', () => {
    template.hasResourceProperties('AWS::EC2::Volume', {
      Tags: Match.arrayWith([{ Key: 'Backup', Value: 'daily' }]),
    });
  });

  test('daily snapshot policy at 10:00 utc keeping 7', () => {
    template.hasResourceProperties('AWS::DLM::LifecyclePolicy', {
      State: 'ENABLED',
      PolicyDetails: Match.objectLike({
        PolicyType: 'EBS_SNAPSHOT_MANAGEMENT',
        ResourceTypes: ['VOLUME'],
        TargetTags: [{ Key: 'Backup', Value: 'daily' }],
        Schedules: [
          Match.objectLike({
            CreateRule: { Interval: 24, IntervalUnit: 'HOURS', Times: ['10:00'] },
            RetainRule: { Count: 7 },
            CopyTags: true,
          }),
        ],
      }),
    });
    expect(JSON.stringify(template.toJSON())).toContain('service-role/AWSDataLifecycleManagerServiceRole');
  });
});

describe('schedule', () => {
  test('creates nothing when disabled', () => {
    synth().resourceCountIs('AWS::Scheduler::Schedule', 0);
  });

  test('creates stop and start schedules in toronto time when enabled', () => {
    const template = synth({ schedule: { enabled: true, stopAt: '03:00', startAt: '16:00' } });
    template.resourceCountIs('AWS::Scheduler::Schedule', 2);
    template.hasResourceProperties('AWS::Scheduler::Schedule', Match.objectLike({
      ScheduleExpression: 'cron(0 3 * * ? *)',
      ScheduleExpressionTimezone: 'America/Toronto',
      FlexibleTimeWindow: { Mode: 'OFF' },
    }));
    template.hasResourceProperties('AWS::Scheduler::Schedule', Match.objectLike({
      ScheduleExpression: 'cron(0 16 * * ? *)',
    }));
    const json = JSON.stringify(template.toJSON());
    expect(json).toContain('aws-sdk:ec2:stopInstances');
    expect(json).toContain('aws-sdk:ec2:startInstances');
    expect(json).not.toContain('"Resource":"*"');
  });
});

describe('cost guard and outputs', () => {
  const template = synth();

  test('monthly budget with actual 80% and forecast 100% email alerts', () => {
    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({
        BudgetType: 'COST',
        TimeUnit: 'MONTHLY',
        BudgetLimit: { Amount: 115, Unit: 'USD' },
      }),
      NotificationsWithSubscribers: [
        Match.objectLike({
          Notification: Match.objectLike({ NotificationType: 'ACTUAL', Threshold: 80, ThresholdType: 'PERCENTAGE' }),
          Subscribers: [{ SubscriptionType: 'EMAIL', Address: 'fayadh56@gmail.com' }],
        }),
        Match.objectLike({
          Notification: Match.objectLike({ NotificationType: 'FORECASTED', Threshold: 100 }),
        }),
      ],
    });
  });

  test('exposes the operator outputs', () => {
    const outputs = Object.keys(template.findOutputs('*'));
    expect(outputs.sort()).toEqual([
      'ComposeParameterName', 'ConnectString', 'DataVolumeId', 'InstanceId',
      'PasswordCommand', 'PublicIp', 'SecretArn', 'ShellCommand', 'SteamFavoritesString',
    ]);
  });

  test('template snapshot', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
