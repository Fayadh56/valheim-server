import * as cdk from 'aws-cdk-lib';
import * as dlm from 'aws-cdk-lib/aws-dlm';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export const BACKUP_TAG = { key: 'Backup', value: 'daily' };
// 10:00 UTC is 05:00 EST / 06:00 EDT, inside the stopped window when the schedule is on
export const SNAPSHOT_TIME_UTC = '10:00';
export const SNAPSHOTS_TO_KEEP = 7;

export interface BackupsProps {
  dataVolume: ec2.Volume;
}

export class Backups extends Construct {
  constructor(scope: Construct, id: string, props: BackupsProps) {
    super(scope, id);

    cdk.Tags.of(props.dataVolume).add(BACKUP_TAG.key, BACKUP_TAG.value);

    // Fresh accounts have no AWSDataLifecycleManagerDefaultRole, so make our own
    const role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('dlm.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSDataLifecycleManagerServiceRole'),
      ],
    });

    new dlm.CfnLifecyclePolicy(this, 'DailySnapshots', {
      description: 'Daily snapshots of the Valheim data volume',
      state: 'ENABLED',
      executionRoleArn: role.roleArn,
      policyDetails: {
        policyType: 'EBS_SNAPSHOT_MANAGEMENT',
        resourceTypes: ['VOLUME'],
        targetTags: [BACKUP_TAG],
        schedules: [
          {
            name: 'Daily',
            createRule: { interval: 24, intervalUnit: 'HOURS', times: [SNAPSHOT_TIME_UTC] },
            retainRule: { count: SNAPSHOTS_TO_KEEP },
            copyTags: true,
          },
        ],
      },
    });
  }
}
