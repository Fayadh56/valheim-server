import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { GAME_PORT, QUERY_PORT } from './network';
import { Schedule, START_SCHEDULE_NAME, STOP_SCHEDULE_NAME } from './schedule';

export interface ControlPanelProps {
  instance: ec2.Instance;
  publicIp: string;
  secret: secretsmanager.ISecret;
  schedule: Schedule;
  timezone: string;
  serverName: string;
}

export class ControlPanel extends Construct {
  readonly url: lambda.FunctionUrl;

  constructor(scope: Construct, id: string, props: ControlPanelProps) {
    super(scope, id);
    const stack = cdk.Stack.of(this);

    const fn = new nodejs.NodejsFunction(this, 'Function', {
      entry: path.join(__dirname, '..', 'lambda', 'panel', 'handler.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      bundling: { externalModules: ['@aws-sdk/*'], minify: true, sourceMap: false },
      logGroup: new logs.LogGroup(this, 'Logs', {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: {
        INSTANCE_ID: props.instance.instanceId,
        SERVER_HOST: props.publicIp,
        GAME_PORT: String(GAME_PORT),
        QUERY_PORT: String(QUERY_PORT),
        SECRET_ARN: props.secret.secretArn,
        STOP_SCHEDULE_NAME,
        START_SCHEDULE_NAME,
        TIMEZONE: props.timezone,
        SERVER_NAME: props.serverName,
      },
    });

    const instanceArn = stack.formatArn({
      service: 'ec2',
      resource: 'instance',
      resourceName: props.instance.instanceId,
    });
    // DescribeInstances does not support resource level permissions
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['ec2:DescribeInstances'], resources: ['*'] }));
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['ec2:StartInstances', 'ec2:StopInstances'], resources: [instanceArn] }));
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['scheduler:GetSchedule', 'scheduler:UpdateSchedule'],
      resources: [props.schedule.stopScheduleArn, props.schedule.startScheduleArn],
    }));
    // UpdateSchedule passes the target role back to Scheduler
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['iam:PassRole'], resources: [props.schedule.targetRole.roleArn] }));
    props.secret.grantRead(fn);

    this.url = fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
  }
}
