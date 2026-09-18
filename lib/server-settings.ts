import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { renderCompose } from './compose';
import { ServerConfig } from './config';

export interface ServerSettingsProps {
  config: ServerConfig;
}

export class ServerSettings extends Construct {
  readonly secret: secretsmanager.Secret;
  readonly composeParameter: ssm.StringParameter;

  constructor(scope: Construct, id: string, props: ServerSettingsProps) {
    super(scope, id);

    this.secret = new secretsmanager.Secret(this, 'Secret', {
      description: 'Valheim server password and optional Discord webhook',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ discordWebhook: '' }),
        generateStringKey: 'password',
        passwordLength: 12,
        excludePunctuation: true,
        includeSpace: false,
      },
    });

    this.composeParameter = new ssm.StringParameter(this, 'ComposeParameter', {
      description: 'docker compose file for the Valheim server',
      stringValue: renderCompose(props.config),
    });
  }
}
