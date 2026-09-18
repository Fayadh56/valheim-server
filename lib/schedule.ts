import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';
import { Construct } from 'constructs';
import { ScheduleConfig } from './config';

export const STOP_SCHEDULE_NAME = 'valheim-stop';
export const START_SCHEDULE_NAME = 'valheim-start';

export interface ScheduleProps {
  instance: ec2.Instance;
  schedule: ScheduleConfig;
  timezone: string;
}

export class Schedule extends Construct {
  readonly targetRole: iam.Role;
  readonly stopScheduleArn: string;
  readonly startScheduleArn: string;

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

    // One role for both targets so the control panel can PassRole a single ARN on UpdateSchedule
    this.targetRole = new iam.Role(this, 'TargetRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });

    const ec2Call = (action: 'stopInstances' | 'startInstances', iamAction: string) =>
      new targets.Universal({
        service: 'ec2',
        action,
        input,
        role: this.targetRole,
        policyStatements: [new iam.PolicyStatement({ actions: [iamAction], resources: [instanceArn] })],
      });

    new scheduler.Schedule(this, 'Stop', {
      scheduleName: STOP_SCHEDULE_NAME,
      enabled: props.schedule.enabled,
      schedule: cronAt(props.schedule.stopAt, tz),
      target: ec2Call('stopInstances', 'ec2:StopInstances'),
      description: 'Stop the Valheim server for the night',
    });

    new scheduler.Schedule(this, 'Start', {
      scheduleName: START_SCHEDULE_NAME,
      enabled: props.schedule.enabled,
      schedule: cronAt(props.schedule.startAt, tz),
      target: ec2Call('startInstances', 'ec2:StartInstances'),
      description: 'Start the Valheim server for the evening',
    });

    this.stopScheduleArn = scheduleArn(stack, STOP_SCHEDULE_NAME);
    this.startScheduleArn = scheduleArn(stack, START_SCHEDULE_NAME);
  }
}

function scheduleArn(stack: cdk.Stack, name: string): string {
  return stack.formatArn({ service: 'scheduler', resource: 'schedule', resourceName: `default/${name}` });
}

function cronAt(hhmm: string, timeZone: cdk.TimeZone): scheduler.ScheduleExpression {
  const [hour, minute] = hhmm.split(':').map(Number);
  return scheduler.ScheduleExpression.cron({ minute: String(minute), hour: String(hour), timeZone });
}
