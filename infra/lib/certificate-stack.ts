import * as cdk from 'aws-cdk-lib'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import type { Construct } from 'constructs'

/**
 * CloudFront 用 ACM 証明書スタック（us-east-1）
 *
 * CloudFront はカスタムドメイン利用時に us-east-1 の ACM 証明書を要求するため、
 * メインスタック（ap-northeast-1）とは別スタックで作成する。
 * DNS 検証の CNAME レコードは手動で設定が必要。
 */
export class CertificateStack extends cdk.Stack {
  public readonly certificate: acm.ICertificate

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props)

    this.certificate = new acm.Certificate(this, 'AdminAppCertificate', {
      domainName: 'aiadmin.aria.develop.blue',
      validation: acm.CertificateValidation.fromDns(),
    })
  }
}
