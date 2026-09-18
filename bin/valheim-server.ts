#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { config } from '../lib/config';
import { ValheimServerStack } from '../lib/valheim-server-stack';

const app = new cdk.App();
new ValheimServerStack(app, 'ValheimServerStack', {
  config,
  env: { account: config.account, region: config.region },
  description: 'Valheim dedicated server',
});
