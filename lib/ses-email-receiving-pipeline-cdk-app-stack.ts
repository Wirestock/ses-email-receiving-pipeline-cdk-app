import { Stack, StackProps } from 'aws-cdk-lib';
import { Bucket, IBucket } from "aws-cdk-lib/aws-s3";
import { Code, IFunction, Runtime, Function } from "aws-cdk-lib/aws-lambda";
import { IReceiptRuleSet, ReceiptRuleSet, TlsPolicy } from "aws-cdk-lib/aws-ses";
import { S3, Lambda, LambdaInvocationType } from "aws-cdk-lib/aws-ses-actions";
import { Construct } from 'constructs';
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";

export class EmailReceivingPipelineStack extends Stack {
  public mailDeliveryBucket: IBucket;
  public mailReceivedLambda: IFunction;
  public mailReceivedRuleSet: IReceiptRuleSet;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super (scope, id, props);

    this.mailDeliveryBucket = new Bucket (this, "MailDeliveryBucket", {
      bucketName: 'my-delivered-emails',
    });

    const sesPrincipal = new ServicePrincipal ('ses.amazonaws.com');

    this.mailDeliveryBucket.addToResourcePolicy (new PolicyStatement ({
      sid: `AllowSESPuts-${ +new Date () }`,
      effect: Effect.ALLOW,
      principals: [
        sesPrincipal,
      ],
      actions: ["s3:PutObject"],
      resources: ["arn:aws:s3:::my-delivered-emails/*"],
      conditions: {
        "StringEquals": {
          "AWS:SourceAccount": props?.env?.account,
        },
        "StringLike": {
          "AWS:SourceArn": "arn:aws:ses:*"
        }
      },
    }));

    this.mailReceivedLambda = new Function (
        this,
        "SESMailReceivedLambda",
        {
          runtime: Runtime.NODEJS_16_X,
          handler: 'index.handler',
          code: Code.fromInline (`
                   exports.handler = async (event) => {
                     console.log('hello world: ', event)
                   };
                `),
          functionName: 'printHelloWorldOnSesEmailReceive',
        },
    );

    this.mailReceivedLambda.addPermission (`AllowSESInvoke-${ +new Date () }`, {
      principal: sesPrincipal,
      action: "lambda:InvokeFunction",
      sourceAccount: props?.env?.account,
      sourceArn: `arn:aws:ses:${ props?.env?.region }:${ props?.env?.account }:*`,
    });

    this.mailReceivedRuleSet = new ReceiptRuleSet (this, 'MailReceivedRuleSet', {
      dropSpam: false,
      receiptRuleSetName: 'mail-received-rule-set',
    });

    this.mailReceivedRuleSet.addRule ('DeliverToS3AndInvokeLambdaRule', {
      receiptRuleName: 'mail-received-actions-rule',
      recipients: ['inbox@example.com'],
      actions: [
        new S3 ({
          bucket: this.mailDeliveryBucket,
        }),
        new Lambda ({
          function: this.mailReceivedLambda,
          invocationType: LambdaInvocationType.EVENT,
        }),
      ],
      tlsPolicy: TlsPolicy.REQUIRE,
      scanEnabled: false,
      enabled: true,
    });
  }
}
