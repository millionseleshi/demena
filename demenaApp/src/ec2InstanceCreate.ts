import {
    AuthorizeSecurityGroupIngressCommand,
    CreateSecurityGroupCommand,
    CreateTagsCommand,
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

interface SecurityGroupIfNotFound {
    securityGroupDescription: string;
    securityGroupName: string;
}

interface BucketWithPolicyAndUpload {
    bucketParams: { Bucket: string };
    bucket: Bucket;
    account: string;
    privateKey: Uint8Array;
}

interface FormatPrivateKeyAndUploadParams {
    privateKey: any;
    account: string;
    encoder: TextEncoder;
}

interface UploadPrivateKeyToS3Params {
    account: string;
    privateKey: Uint8Array;
}

interface Ec2Instance {
    account: string;
    maxCount: number;
    vCpu: number;
    ram: number;
    volumeSize: number;
    amiId: string;
}

export class Ec2InstanceCreate {
    private SecurityGroupId: string;
    private instanceKeyName: string;
    private Ec2InstanceType: string;
    private Ec2InstanceId: string[] = [];
    private VolumeInstanceId: string[] = [];
    private KeyPairId: string;

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

    private static formatDate(dateIn) {
        const yyyy = dateIn.getFullYear();
        const mm = dateIn.getMonth() + 1;
        const dd = dateIn.getDate();
        return String(10000 * yyyy + 100 * mm + dd);
    }

    async selectInstanceType(vCpu: number, ram: number) {
        if (vCpu == 1 && ram == 0.5) {
            this.Ec2InstanceType = "t2.nano";
        } else if (vCpu == 1 && ram == 1) {
            this.Ec2InstanceType = "t2.micro";
        } else if (vCpu == 1 && ram == 2) {
            this.Ec2InstanceType = "t2.small";
        } else if (vCpu == 2 && ram == 4) {
            this.Ec2InstanceType = "t2.medium";
        } else if (vCpu == 2 && ram == 8) {
            this.Ec2InstanceType = "t2.large";
        } else if (vCpu == 4 && ram == 16) {
            this.Ec2InstanceType = "t2.xlarge";
        } else if (vCpu == 8 && ram == 32) {
            this.Ec2InstanceType = "t2.2xlarge";
        } else {
            throw Error("instance is not found");
        }
    }

    async CreatEc2KeyPair(account: string) {
        const random = (length = 5) => {
            return Math.random().toString(16).substr(2, length);
        };
        const keyName = `${account}_key_pair_${random()}`;
        this.instanceKeyName = await this.createEc2KeyPairAndImport(
            account,
            keyName
        );
    }

    async CreatEc2SecurityGroup(account: string) {
        const random = (length = 5) => {
            return Math.random().toString(16).substr(2, length);
        };
        const securityGroupDescription = `${random()}_security_group_for_${account}`;
        const securityGroupName = `${account}_SECURITY_GROUP_${random(5)}`;
        this.SecurityGroupId = await this.createSecurityGroupIfNotFound({
            securityGroupName,
            securityGroupDescription,
        });
        await this.defineInBoundTraffic(this.SecurityGroupId);
    }

    async uploadPrivateKeyToS3({
                                   account,
                                   privateKey,
                               }: UploadPrivateKeyToS3Params) {
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
                    this.createBucketWithPolicyAndUpload({
                        bucketParams: bucketParams,
                        bucket: bucket,
                        account: account,
                        privateKey: privateKey,
                    });
                }
            }
        });
    }

    async checkForBucket() {
        const listBucketsCommand = new ListBucketsCommand({});
        return await this.s3client.send(listBucketsCommand);
    }

    async createEc2Instance({
                                account,
                                maxCount,
                                vCpu,
                                ram,
                                volumeSize,
                                amiId,
                            }: Ec2Instance) {
        await this.prepareEc2InstanceEnv(account, vCpu, ram);

        const runInstancesCommand = new RunInstancesCommand({
            MaxCount: maxCount,
            MinCount: 1,
            ImageId: amiId,
            InstanceType: this.Ec2InstanceType,
            BlockDeviceMappings: [
                {
                    Ebs: {VolumeType: "gp2", VolumeSize: volumeSize},
                    DeviceName: "/dev/sdh",
                },
            ],
            SecurityGroupIds: [this.SecurityGroupId],
            KeyName: this.instanceKeyName,
        });

        const instancesCommand = await this.ec2Client.send(runInstancesCommand);

        for (const instance of instancesCommand.Instances) {
            for (const blockMapping of instance.BlockDeviceMappings) {
                if (blockMapping.Ebs.Status == "attached") {
                    await this.VolumeInstanceId.push(blockMapping.Ebs.VolumeId);
                }
            }
        }

        instancesCommand.Instances.forEach((instance) => {
            this.Ec2InstanceId.push(instance.InstanceId);
        });
        await this.createTag(account);

        return instancesCommand.Instances;
    }

    private async createTag(account: string) {
        const today = new Date();
        const timeStamp = Ec2InstanceCreate.formatDate(today);

        await this.createInstanceIdTag(account, timeStamp);
        await this.createSecurityGroupTag(account, timeStamp);
        await this.createKeyPairTag(account, timeStamp);

        for (const volumeId in this.VolumeInstanceId) {
            const createVolumeTagCommand = new CreateTagsCommand({
                Tags: [
                    {
                        Key: `${account}_volume_id`,
                        Value: `${account}_${volumeId}_${timeStamp}`,
                    },
                ],
                Resources: [volumeId],
            });
            await this.ec2Client.send(createVolumeTagCommand);
        }
    }

    private async createKeyPairTag(account: string, timeStamp: string) {
        const createKeyPairTagsCommand = new CreateTagsCommand({
            Tags: [
                {
                    Key: `${account}_key_pair`,
                    Value: `${account}_${this.KeyPairId}_${timeStamp}`,
                },
            ],
            Resources: [this.KeyPairId],
        });
        await this.ec2Client.send(createKeyPairTagsCommand);
    }

    private async createSecurityGroupTag(account: string, timeStamp: string) {
        const createSecurityGroupTagsCommand = new CreateTagsCommand({
            Tags: [
                {
                    Key: `${account}_security_group`,
                    Value: `${account}_${this.SecurityGroupId}_${timeStamp}`,
                },
            ],
            Resources: [this.SecurityGroupId],
        });
        await this.ec2Client.send(createSecurityGroupTagsCommand);
    }

    private async createInstanceIdTag(account: string, timeStamp: string) {
        for (const instanceId of this.Ec2InstanceId) {
            const createInstanceTagsCommand = new CreateTagsCommand({
                Tags: [
                    {
                        Key: `${account}_instance_id`,
                        Value: `${account}_${instanceId}_${timeStamp}`,
                    },
                ],
                Resources: [instanceId],
            });
            await this.ec2Client.send(createInstanceTagsCommand);
        }
    }

    private async prepareEc2InstanceEnv(
        account: string,
        vCpu: number,
        ram: number
    ) {
        await this.CreatEc2SecurityGroup(account);

        await this.CreatEc2KeyPair(account);

        await this.selectInstanceType(vCpu, ram);
    }

    private async createEc2KeyPairAndImport(account: string, keyName: string) {
        const encoder = new TextEncoder();
        const {publicKey, privateKey} = await Promise.resolve(
            Ec2InstanceCreate.rsaKeyPair()
        );
        await this.formatPrivateKeyAndUpload({
            privateKey: privateKey,
            account: account,
            encoder: encoder,
        });
        const importKeyPairCommand = Ec2InstanceCreate.importFormattedPublic(
            publicKey,
            keyName,
            encoder
        );
        const keyPairCommandOutput = await this.ec2Client.send(
            importKeyPairCommand
        );
        this.KeyPairId = keyPairCommandOutput.KeyPairId;
        return keyPairCommandOutput.KeyName;
    }

    private async createSecurityGroupIfNotFound({
                                                    securityGroupName: securityGroupName,
                                                    securityGroupDescription: securityGroupDescription,
                                                }: SecurityGroupIfNotFound) {
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

    private createBucketWithPolicyAndUpload({
                                                bucketParams,
                                                bucket,
                                                account,
                                                privateKey,
                                            }: BucketWithPolicyAndUpload) {
        this.s3client
            .send(new CreateBucketCommand({Bucket: bucketParams.Bucket}))
            .then(async () => {
                await this.attachS3AnonymousReadPolicy(bucket);
            })
            .then(async () => {
                await this.s3Uploader(account, bucketParams, privateKey);
            });
    }

    private async formatPrivateKeyAndUpload({
                                                privateKey,
                                                account,
                                                encoder,
                                            }: FormatPrivateKeyAndUploadParams) {
        const privateKeyPem = sshpk.parsePrivateKey(privateKey, "pem");
        await this.uploadPrivateKeyToS3({
            account: account,
            privateKey: encoder.encode(privateKeyPem),
        });
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
