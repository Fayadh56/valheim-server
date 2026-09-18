import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { SleepWhenEmptyConfig } from './config';
import { MODS_PARAMETER_NAME, PROFILE_CODE_PARAMETER_NAME } from './mods';
import { GAME_PORT, QUERY_PORT } from './network';
import { PLAYERS_PARAMETER_NAME } from './players-watcher';
import { Schedule, START_SCHEDULE_NAME, STOP_SCHEDULE_NAME } from './schedule';

export const SLEEP_ENABLED_PARAMETER = '/valheim/panel/sleep-when-empty';
export const EMPTY_SINCE_PARAMETER = '/valheim/panel/empty-since';
export const SLEEP_CHECK_SCHEDULE_NAME = 'valheim-sleep-check';

export interface ControlPanelProps {
  instance: ec2.Instance;
  publicIp: string;
  secret: secretsmanager.ISecret;
  schedule: Schedule;
  timezone: string;
  serverName: string;
  sleepWhenEmpty: SleepWhenEmptyConfig;
  playersParameter: ssm.IStringParameter;
  modsParameter: ssm.IStringParameter;
  profileCodeParameter: ssm.IStringParameter;
}

export class ControlPanel extends Construct {
  readonly url: lambda.FunctionUrl;

  constructor(scope: Construct, id: string, props: ControlPanelProps) {
    super(scope, id);
    const stack = cdk.Stack.of(this);
    const instanceArn = stack.formatArn({ service: 'ec2', resource: 'instance', resourceName: props.instance.instanceId });

    const sleepEnabled = new ssm.StringParameter(this, 'SleepEnabled', {
      parameterName: SLEEP_ENABLED_PARAMETER,
      stringValue: String(props.sleepWhenEmpty.enabledByDefault),
      description: 'Stop the Valheim server after it has been empty for a while',
    });
    // SSM rejects empty values, so the unset timer is the literal word none
    const emptySince = new ssm.StringParameter(this, 'EmptySince', {
      parameterName: EMPTY_SINCE_PARAMETER,
      stringValue: 'none',
      description: 'When the Valheim server was last seen with nobody online',
    });

    const sharedEnv = {
      INSTANCE_ID: props.instance.instanceId,
      SERVER_HOST: props.publicIp,
      QUERY_PORT: String(QUERY_PORT),
      SECRET_ARN: props.secret.secretArn,
      SLEEP_ENABLED_PARAMETER,
      EMPTY_SINCE_PARAMETER,
      SLEEP_IDLE_MINUTES: String(props.sleepWhenEmpty.idleMinutes),
    };
    const bundling = { externalModules: ['@aws-sdk/*'], minify: true, sourceMap: false };
    const logGroup = (name: string) =>
      new logs.LogGroup(this, name, { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: cdk.RemovalPolicy.DESTROY });
    const parameterAccess = new iam.PolicyStatement({
      actions: ['ssm:GetParameter', 'ssm:PutParameter'],
      resources: [sleepEnabled.parameterArn, emptySince.parameterArn],
    });
    // DescribeInstances does not support resource level permissions
    const describeInstances = new iam.PolicyStatement({ actions: ['ec2:DescribeInstances'], resources: ['*'] });

    const panel = new nodejs.NodejsFunction(this, 'Function', {
      entry: path.join(__dirname, '..', 'lambda', 'panel', 'handler.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      bundling,
      logGroup: logGroup('Logs'),
      environment: {
        ...sharedEnv,
        GAME_PORT: String(GAME_PORT),
        STOP_SCHEDULE_NAME,
        START_SCHEDULE_NAME,
        TIMEZONE: props.timezone,
        SERVER_NAME: props.serverName,
        PLAYERS_PARAMETER: PLAYERS_PARAMETER_NAME,
        MODS_PARAMETER: MODS_PARAMETER_NAME,
        PROFILE_CODE_PARAMETER: PROFILE_CODE_PARAMETER_NAME,
      },
    });
    panel.addToRolePolicy(describeInstances);
    panel.addToRolePolicy(new iam.PolicyStatement({ actions: ['ec2:StartInstances', 'ec2:StopInstances'], resources: [instanceArn] }));
    panel.addToRolePolicy(new iam.PolicyStatement({
      actions: ['scheduler:GetSchedule', 'scheduler:UpdateSchedule'],
      resources: [props.schedule.stopScheduleArn, props.schedule.startScheduleArn],
    }));
    // UpdateSchedule passes the target role back to Scheduler
    panel.addToRolePolicy(new iam.PolicyStatement({ actions: ['iam:PassRole'], resources: [props.schedule.targetRole.roleArn] }));
    panel.addToRolePolicy(parameterAccess);
    props.secret.grantRead(panel);
    props.playersParameter.grantRead(panel);
    props.modsParameter.grantRead(panel);
    props.profileCodeParameter.grantRead(panel);
    this.url = panel.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    const sleeper = new nodejs.NodejsFunction(this, 'Sleeper', {
      entry: path.join(__dirname, '..', 'lambda', 'panel', 'sleeper-handler.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      bundling,
      logGroup: logGroup('SleeperLogs'),
      environment: sharedEnv,
    });
    sleeper.addToRolePolicy(describeInstances);
    sleeper.addToRolePolicy(new iam.PolicyStatement({ actions: ['ec2:StopInstances'], resources: [instanceArn] }));
    sleeper.addToRolePolicy(parameterAccess);
    props.secret.grantRead(sleeper);

    new scheduler.Schedule(this, 'SleepCheck', {
      scheduleName: SLEEP_CHECK_SCHEDULE_NAME,
      schedule: scheduler.ScheduleExpression.rate(cdk.Duration.minutes(props.sleepWhenEmpty.checkEveryMinutes)),
      target: new targets.LambdaInvoke(sleeper, {}),
      description: 'Stop the Valheim server when nobody has been online for a while',
    });
  }
}
