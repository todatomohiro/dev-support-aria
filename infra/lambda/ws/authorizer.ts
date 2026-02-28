import { CognitoJwtVerifier } from 'aws-jwt-verify'

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID!,
  clientId: process.env.COGNITO_CLIENT_ID!,
  tokenUse: 'id',
})

/**
 * WebSocket $connect 用 Cognito JWT オーソライザー
 * クエリパラメータ ?token=<JWT> でトークンを受け取り検証する
 */
export const handler = async (event: any) => {
  const token = event.queryStringParameters?.token
  if (!token) {
    return generatePolicy('unauthorized', 'Deny', event.methodArn)
  }
  try {
    const payload = await verifier.verify(token)
    return generatePolicy(payload.sub, 'Allow', event.methodArn, { userId: payload.sub })
  } catch (err) {
    console.error('JWT verification failed:', err)
    return generatePolicy('unauthorized', 'Deny', event.methodArn)
  }
}

function generatePolicy(principalId: string, effect: string, resource: string, context?: Record<string, string>) {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{ Action: 'execute-api:Invoke', Effect: effect, Resource: resource }],
    },
    ...(context ? { context } : {}),
  }
}
