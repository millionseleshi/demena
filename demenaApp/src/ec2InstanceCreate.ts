import {
  AuthorizeSecurityGroupIngressCommand,
  CreateSecurityGroupCommand,
  CreateSecurityGroupCommandOutput,
  DescribeVpcsCommand,
  EC2Client,
  ImportKeyPairCommand,
  RunInstancesCommand,
} from "@aws-sdk/client-ec2";
import { generateKeyPairSync } from "crypto";
import {
  CreateBucketCommand,
  ListBucketsCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import sshpk = require("sshpk");

export class Ec2InstanceCreate {
  constructor(private ec2Client: EC2Client, private s3client: S3Client) {
    this.ec2Client = new EC2Client({});
    this.s3client = new S3Client({});
  }

  private static async rsaKeyPair() {
    const { publicKey, privateKey } = await generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: "pkcs1",
        format: "pem",
      },
      privateKeyEncoding: {
        type: "pkcs1",
        format: "pem",
      },
    });
    return { publicKey, privateKey };
  }

  async CreatEc2KeyPair(account: string) {
    const encoder = new TextEncoder();
    const { publicKey, privateKey } = await Promise.resolve(
      Ec2InstanceCreate.rsaKeyPair()
    );

    const privateKeyPem = sshpk.parsePrivateKey(privateKey, "pem");
    await this.uploadPrivateKeyToS3(account, encoder.encode(privateKeyPem));

    const pemKey = sshpk.parseKey(publicKey, "pem");
    const importKeyPairCommand = new ImportKeyPairCommand({
      KeyName: `${account}_key_pair`,
      PublicKeyMaterial: encoder.encode(pemKey.toString("ssh")),
    });
    return this.ec2Client.send(importKeyPairCommand);
  }

  async CreatEc2SecurityGroup(account: string) {
    const describeVpcsCommand = await this.ec2Client.send(
      new DescribeVpcsCommand({})
    );
    const paramsSecurityGroup = {
      Description: `${account}_security_group`,
      GroupName: `${account}_SECURITY_GROUP_NAME`,
      VpcId: describeVpcsCommand.Vpcs[0].VpcId,
    };
    const securityGroupCommand = await this.ec2Client.send(
      new CreateSecurityGroupCommand(paramsSecurityGroup)
    );
    await this.defineInBoundTraffic(securityGroupCommand);
    return securityGroupCommand;
  }

  async uploadPrivateKeyToS3(account: string, privateKey: Uint8Array) {
    const bucketParams = {
      Bucket: `account-private-key`,
    };
    await this.checkForBucket().then((buckets) => {
      buckets.Buckets.forEach((bucket) => {
        if (
          bucket.Name.toLocaleLowerCase() ==
          bucketParams.Bucket.toLocaleLowerCase()
        ) {
          this.s3Uploader(account, bucketParams, privateKey);
        } else {
          this.s3client
            .send(new CreateBucketCommand({ Bucket: bucketParams.Bucket }))
            .then(async () => {
              const readOnlyAnonUserPolicy = {
                Version: "2012-10-17",
                Statement: [
                  {
                    Sid: "PublicRead",
                    Effect: "Allow",
                    Principal: "*",
                    Action: ["s3:GetObject", "s3:GetObjectVersion"],
                    Resource: [`arn:aws:s3:::${bucket.Name}/*`],
                  },
                ],
              };
              const bucketPolicyParams = {
                Bucket: bucket.Name,
                Policy: JSON.stringify(readOnlyAnonUserPolicy),
              };
              await this.s3client.send(
                new PutBucketPolicyCommand(bucketPolicyParams)
              );
            })
            .then(async () => {
              await this.s3Uploader(account, bucketParams, privateKey);
            });
        }
      });
    });
  }

  async checkForBucket() {
    const listBucketsCommand = new ListBucketsCommand({});
    return await this.s3client.send(listBucketsCommand);
  }

  async createEc2Instance(
    account: string,
    maxCount: number,
    instanceType: string,
    volumeSize: number,
    amiId: string
  ) {
    const groupId = await this.CreatEc2SecurityGroup(account).then((result) => {
      return result.GroupId;
    });
    const keyPair = await this.CreatEc2KeyPair(account).then((result) => {
      return result.KeyName;
    });

    const runInstancesCommand = new RunInstancesCommand({
      MaxCount: maxCount,
      MinCount: 1,
      ImageId: amiId,
      InstanceType: instanceType,
      AdditionalInfo: `${account}_EC2_Instance`,
      BlockDeviceMappings: [
        {
          Ebs: { VolumeType: "gp2", VolumeSize: volumeSize },
          DeviceName: "/dev/sdh",
        },
      ],
      SecurityGroupIds: [groupId],
      KeyName: keyPair,
    });

    const instancesCommand = await this.ec2Client.send(runInstancesCommand);
    return instancesCommand.Instances;
  }

  private async s3Uploader(
    account: string,
    bucketParams: { Bucket: string },
    privateKey: Uint8Array
  ) {
    const putObjectCommand = new PutObjectCommand({
      Key: `${account}_private_key.pem`,
      Bucket: bucketParams.Bucket,
      Body: privateKey,
    });
    await this.s3client.send(putObjectCommand);
  }

  private async defineInBoundTraffic(
    securityGroupCommand: CreateSecurityGroupCommandOutput
  ) {
    const paramsIngress = {
      GroupId: securityGroupCommand.GroupId,
      IpPermissions: [
        {
          IpProtocol: "tcp",
          FromPort: 80,
          ToPort: 80,
          IpRanges: [{ CidrIp: "0.0.0.0/0" }],
        },
        {
          IpProtocol: "tcp",
          FromPort: 443,
          ToPort: 443,
          IpRanges: [{ CidrIp: "0.0.0.0/0" }],
        },
        {
          IpProtocol: "tcp",
          FromPort: 22,
          ToPort: 22,
          IpRanges: [{ CidrIp: "0.0.0.0/0" }],
        },
      ],
    };
    await this.ec2Client.send(
      new AuthorizeSecurityGroupIngressCommand(paramsIngress)
    );
  }
}
