import {
    AuthorizeSecurityGroupIngressCommand,
    CreateSecurityGroupCommand,
    DescribeKeyPairsCommand,
    DescribeSecurityGroupsCommand,
    DescribeVpcsCommand,
    EC2Client,
    ImportKeyPairCommand,
    RunInstancesCommand,
} from "@aws-sdk/client-ec2";
import {generateKeyPairSync} from "crypto";
import {
    Bucket,
    CreateBucketCommand,
    ListBucketsCommand,
    PutBucketPolicyCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import sshpk = require("sshpk");

export class Ec2InstanceCreate {
    private securityGroupId: string;
    private instanceKeyName: string;
    constructor(private ec2Client: EC2Client, private s3client: S3Client) {
        this.ec2Client = new EC2Client({});
        this.s3client = new S3Client({});
    }

    private static async rsaKeyPair() {
        const {publicKey, privateKey} = await generateKeyPairSync("rsa", {
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
        return {publicKey, privateKey};
    }

    private static async selectInstanceType(vCpu: number, ram: number) {
        if (vCpu == 1 && ram == 0.5) {
            return "t2.nano";
        }
        if (vCpu == 1 && ram == 1) {
            return "t2.micro";
        }
        if (vCpu == 1 && ram == 2) {
            return "t2.small";
        }
        if (vCpu == 2 && ram == 4) {
            return "t2.medium";
        }
        if (vCpu == 2 && ram == 8) {
            return "t2.large";
        }
        if (vCpu == 4 && ram == 16) {
            return "t2.xlarge";
        }
        if (vCpu == 8 && ram == 32) {
            return "t2.2xlarge";
        } else throw Error("instance is not found");
    }

    private static importFormattedPublic(
        publicKey,
        keyName: string,
        encoder: TextEncoder
    ) {
        const pemKey = sshpk.parseKey(publicKey, "pem");
        return new ImportKeyPairCommand({
            KeyName: keyName,
            PublicKeyMaterial: encoder.encode(pemKey.toString()),
        });
    }

    async CreatEc2KeyPair(account: string) {
        const keyName = `${account}_key_pair`;
        const describeKeyPairsCommandOutput = await this.ec2Client.send(
            new DescribeKeyPairsCommand({})
        );
        for (const keypair of describeKeyPairsCommandOutput.KeyPairs) {
            if (keypair.KeyName == keyName) {
                this.instanceKeyName = keypair.KeyName;
            } else {
                this.instanceKeyName = await this.createEc2KeyPairAndImport(
                    account,
                    keyName
                );
            }
        }
        return this.instanceKeyName;
    }

    async CreatEc2SecurityGroup(account: string) {
        const securityGroupDescription = `${account}_security_group`;
        const securityGroupName = `${account}_SECURITY_GROUP_NAME`;
        const describeSecurityGroupsCommandOutput = await this.ec2Client.send(
            new DescribeSecurityGroupsCommand({})
        );
        for (const securityGroup of describeSecurityGroupsCommandOutput.SecurityGroups) {
            if (securityGroup.GroupName == securityGroupName) {
                this.securityGroupId = securityGroup.GroupId;
            } else {
                this.securityGroupId = await this.createSecurityIfNotFound(
                    securityGroupDescription,
                    securityGroupName
                );
                await this.defineInBoundTraffic(this.securityGroupId);
            }
        }
        return this.securityGroupId;
    }

    async uploadPrivateKeyToS3(account: string, privateKey: Uint8Array) {
        const bucketParams = {
            Bucket: `account-private-key`,
        };
        await this.checkForBucket().then((buckets) => {
            for (const bucket of buckets.Buckets) {
                if (
                    bucket.Name.toLocaleLowerCase() ==
                    bucketParams.Bucket.toLocaleLowerCase()
                ) {
                    this.s3Uploader(account, bucketParams, privateKey);
                } else {
                    this.createBucketAndAttachPolicyAndUpload(
                        bucketParams,
                        bucket,
                        account,
                        privateKey
                    );
                }
            }
        });
    }

    async checkForBucket() {
        const listBucketsCommand = new ListBucketsCommand({});
        return await this.s3client.send(listBucketsCommand);
    }

    async createEc2Instance(
        account: string,
        maxCount: number,
        vCpu: number,
        ram: number,
        volumeSize: number,
        amiId: string
    ) {
        const groupId = await this.CreatEc2SecurityGroup(account);
        const keyPairName = await this.CreatEc2KeyPair(account);

        const instanceType = await Ec2InstanceCreate.selectInstanceType(vCpu, ram);

        const runInstancesCommand = new RunInstancesCommand({
            MaxCount: maxCount,
            MinCount: 1,
            ImageId: amiId,
            InstanceType: instanceType,
            BlockDeviceMappings: [
                {
                    Ebs: {VolumeType: "gp2", VolumeSize: volumeSize},
                    DeviceName: "/dev/sdh",
                },
            ],
            SecurityGroupIds: [groupId],
            KeyName: keyPairName,
        });

        const instancesCommand = await this.ec2Client.send(runInstancesCommand);
        return instancesCommand.Instances;
    }

    private async createEc2KeyPairAndImport(account: string, keyName: string) {
        const encoder = new TextEncoder();
        const {publicKey, privateKey} = await Promise.resolve(
            Ec2InstanceCreate.rsaKeyPair()
        );
        await this.formatPrivateKeyAndUpload(privateKey, account, encoder);
        const importKeyPairCommand = Ec2InstanceCreate.importFormattedPublic(
            publicKey,
            keyName,
            encoder
        );
        const keyPairCommandOutput = await this.ec2Client.send(
            importKeyPairCommand
        );
        return keyPairCommandOutput.KeyName;
    }

    private async createSecurityIfNotFound(
        securityGroupDescription: string,
        securityGroupName: string
    ) {
        const describeVpcsCommand = await this.ec2Client.send(
            new DescribeVpcsCommand({})
        );
        const createSecurityGroupCommand = new CreateSecurityGroupCommand({
            Description: securityGroupDescription,
            GroupName: securityGroupName,
            VpcId: describeVpcsCommand.Vpcs[0].VpcId,
        });
        const createSecurityGroupCommandOutput = await this.ec2Client.send(
            createSecurityGroupCommand
        );
        return createSecurityGroupCommandOutput.GroupId;
    }

    private createBucketAndAttachPolicyAndUpload(
        bucketParams: { Bucket: string },
        bucket: Bucket,
        account: string,
        privateKey: Uint8Array
    ) {
        this.s3client
            .send(new CreateBucketCommand({Bucket: bucketParams.Bucket}))
            .then(async () => {
                await this.attachS3AnonymousReadPolicy(bucket);
            })
            .then(async () => {
                await this.s3Uploader(account, bucketParams, privateKey);
            });
    }

    private async formatPrivateKeyAndUpload(
        privateKey,
        account: string,
        encoder: TextEncoder
    ) {
        const privateKeyPem = sshpk.parsePrivateKey(privateKey, "pem");
        await this.uploadPrivateKeyToS3(account, encoder.encode(privateKeyPem));
    }

    private async attachS3AnonymousReadPolicy(bucket: Bucket) {
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
        await this.s3client.send(new PutBucketPolicyCommand(bucketPolicyParams));
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

    private async defineInBoundTraffic(groupId: string) {
        const paramsIngress = {
            GroupId: groupId,
            IpPermissions: [
                {
                    IpProtocol: "tcp",
                    FromPort: 80,
                    ToPort: 80,
                    IpRanges: [{CidrIp: "0.0.0.0/0"}],
                },
                {
                    IpProtocol: "tcp",
                    FromPort: 443,
                    ToPort: 443,
                    IpRanges: [{CidrIp: "0.0.0.0/0"}],
                },
                {
                    IpProtocol: "tcp",
                    FromPort: 22,
                    ToPort: 22,
                    IpRanges: [{CidrIp: "0.0.0.0/0"}],
                },
            ],
        };
        await this.ec2Client.send(
            new AuthorizeSecurityGroupIngressCommand(paramsIngress)
        );
    }
}
