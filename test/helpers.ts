import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { config, ServerConfig, validateConfig } from '../lib/config';
import { ValheimServerStack } from '../lib/valheim-server-stack';

export function synth(overrides: Partial<ServerConfig> = {}): Template {
  const merged = validateConfig({ ...config, ...overrides });
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const stack = new ValheimServerStack(app, 'TestStack', {
    config: merged,
    env: { account: merged.account, region: merged.region },
  });
  return Template.fromStack(stack);
}
