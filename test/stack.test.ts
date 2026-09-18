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
