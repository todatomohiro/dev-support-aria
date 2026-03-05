#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { ButlerStack } from '../lib/butler-stack'
import { CertificateStack } from '../lib/certificate-stack'

const app = new cdk.App()

const account = process.env.CDK_DEFAULT_ACCOUNT

// ACM 証明書は us-east-1 に作成（CloudFront の要件）
const certStack = new CertificateStack(app, 'ButlerCertificateStack', {
  env: { account, region: 'us-east-1' },
  crossRegionReferences: true,
})

new ButlerStack(app, 'ButlerAssistantStack', {
  env: {
    account,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
  },
  crossRegionReferences: true,
  description: 'Butler Assistant App - Cognito + DynamoDB + API Gateway',
  adminCertificate: certStack.certificate,
})
