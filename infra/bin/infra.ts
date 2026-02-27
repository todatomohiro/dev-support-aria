#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { ButlerStack } from '../lib/butler-stack'

const app = new cdk.App()

new ButlerStack(app, 'ButlerAssistantStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
  },
  description: 'Butler Assistant App - Cognito + DynamoDB + API Gateway',
})
