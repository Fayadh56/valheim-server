import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';
import { Construct } from 'constructs';
import { ScheduleConfig } from './config';

export interface ScheduleProps {
  instance: ec2.Instance;
  schedule: ScheduleConfig;
  timezone: string;
}

export class Schedule extends Construct {
  constructor(scope: Construct, id: string, props: ScheduleProps) {
    super(scope, id);
    const stack = cdk.Stack.of(this);
    const tz = cdk.TimeZone.of(props.timezone);
    const instanceArn = stack.formatArn({
      service: 'ec2',
      resource: 'instance',
      resourceName: props.instance.instanceId,
    });
    const input = scheduler.ScheduleTargetInput.fromObject({ InstanceIds: [props.instance.instanceId] });

    const ec2Call = (action: 'stopInstances' | 'startInstances', iamAction: string) =>
      new targets.Universal({
        service: 'ec2',
        action,
        input,
        policyStatements: [new iam.PolicyStatement({ actions: [iamAction], resources: [instanceArn] })],
      });

    new scheduler.Schedule(this, 'Stop', {
      schedule: cronAt(props.schedule.stopAt, tz),
      target: ec2Call('stopInstances', 'ec2:StopInstances'),
      description: 'Stop the Valheim server for the night',
    });

    new scheduler.Schedule(this, 'Start', {
      schedule: cronAt(props.schedule.startAt, tz),
      target: ec2Call('startInstances', 'ec2:StartInstances'),
      description: 'Start the Valheim server for the evening',
    });
  }
}

function cronAt(hhmm: string, timeZone: cdk.TimeZone): scheduler.ScheduleExpression {
  const [hour, minute] = hhmm.split(':').map(Number);
  return scheduler.ScheduleExpression.cron({ minute: String(minute), hour: String(hour), timeZone });
}
