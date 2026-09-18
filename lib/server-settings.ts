import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { renderCompose } from './compose';
import { ServerConfig } from './config';
import { MODS_CONFIG_DIR, MODS_CONFIG_PATH, MODS_PARAMETER_NAME, packagesJson, PROFILE_CODE_PARAMETER_NAME, readConfigOverrides } from './mods';

export interface ServerSettingsProps {
  config: ServerConfig;
}

export class ServerSettings extends Construct {
  readonly secret: secretsmanager.Secret;
  readonly composeParameter: ssm.StringParameter;
  readonly modsParameter: ssm.StringParameter;
  readonly modConfigParameters: ssm.StringParameter[];
  readonly profileCodeParameter: ssm.StringParameter;

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

    this.modsParameter = new ssm.StringParameter(this, 'ModsParameter', {
      parameterName: MODS_PARAMETER_NAME,
      stringValue: packagesJson(props.config.mods),
      description: 'Thunderstore packages the Valheim server installs at every start',
    });
    this.modConfigParameters = Object.entries(readConfigOverrides(MODS_CONFIG_DIR)).map(([file, body]) =>
      new ssm.StringParameter(this, `ModConfig-${file.replace(/[^A-Za-z0-9]/g, '')}`, {
        parameterName: `${MODS_CONFIG_PATH}/${file}`,
        stringValue: body,
        description: `BepInEx config override ${file}`,
      }));
    this.profileCodeParameter = new ssm.StringParameter(this, 'ProfileCodeParameter', {
      parameterName: PROFILE_CODE_PARAMETER_NAME,
      stringValue: 'none',
      description: 'r2modman profile code shown on the panel, written by npm run share-profile',
    });
  }
}
