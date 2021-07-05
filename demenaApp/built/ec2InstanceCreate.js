"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ec2InstanceCreate = void 0;
const client_ec2_1 = require("@aws-sdk/client-ec2");
const crypto_1 = require("crypto");
const client_s3_1 = require("@aws-sdk/client-s3");
const sshpk = require("sshpk");
class Ec2InstanceCreate {
    constructor(ec2Client, s3client) {
        this.ec2Client = ec2Client;
        this.s3client = s3client;
        this.ec2Client = new client_ec2_1.EC2Client({});
        this.s3client = new client_s3_1.S3Client({});
    }
    static async rsaKeyPair() {
        const { publicKey, privateKey } = await crypto_1.generateKeyPairSync("rsa", {
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
    static async selectInstanceType(vCpu, ram) {
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
        }
        else
            throw Error("instance is not found");
    }
    static importFormattedPublic(publicKey, keyName, encoder) {
        const pemKey = sshpk.parseKey(publicKey, "pem");
        return new client_ec2_1.ImportKeyPairCommand({
            KeyName: keyName,
            PublicKeyMaterial: encoder.encode(pemKey.toString()),
        });
    }
    async CreatEc2KeyPair(account) {
        const keyName = `${account}_key_pair`;
        const describeKeyPairsCommandOutput = await this.ec2Client.send(new client_ec2_1.DescribeKeyPairsCommand({}));
        for (const keypair of describeKeyPairsCommandOutput.KeyPairs) {
            if (keypair.KeyName == keyName) {
                this.instanceKeyName = keypair.KeyName;
            }
            else {
                this.instanceKeyName = await this.createEc2KeyPairAndImport(account, keyName);
            }
        }
        return this.instanceKeyName;
    }
    async CreatEc2SecurityGroup(account) {
        const securityGroupDescription = `${account}_security_group`;
        const securityGroupName = `${account}_SECURITY_GROUP_NAME`;
        const describeSecurityGroupsCommandOutput = await this.ec2Client.send(new client_ec2_1.DescribeSecurityGroupsCommand({}));
        for (const securityGroup of describeSecurityGroupsCommandOutput.SecurityGroups) {
            if (securityGroup.GroupName == securityGroupName) {
                this.securityGroupId = securityGroup.GroupId;
            }
            else {
                this.securityGroupId = await this.createSecurityIfNotFound(securityGroupDescription, securityGroupName);
                await this.defineInBoundTraffic(this.securityGroupId);
            }
        }
        return this.securityGroupId;
    }
    async uploadPrivateKeyToS3(account, privateKey) {
        const bucketParams = {
            Bucket: `account-private-key`,
        };
        await this.checkForBucket().then((buckets) => {
            for (const bucket of buckets.Buckets) {
                if (bucket.Name.toLocaleLowerCase() ==
                    bucketParams.Bucket.toLocaleLowerCase()) {
                    this.s3Uploader(account, bucketParams, privateKey);
                }
                else {
                    this.createBucketAndAttachPolicyAndUpload(bucketParams, bucket, account, privateKey);
                }
            }
        });
    }
    async checkForBucket() {
        const listBucketsCommand = new client_s3_1.ListBucketsCommand({});
        return await this.s3client.send(listBucketsCommand);
    }
    async createEc2Instance(account, maxCount, vCpu, ram, volumeSize, amiId) {
        const groupId = await this.CreatEc2SecurityGroup(account);
        const keyPairName = await this.CreatEc2KeyPair(account);
        const instanceType = await Ec2InstanceCreate.selectInstanceType(vCpu, ram);
        const runInstancesCommand = new client_ec2_1.RunInstancesCommand({
            MaxCount: maxCount,
            MinCount: 1,
            ImageId: amiId,
            InstanceType: instanceType,
            BlockDeviceMappings: [
                {
                    Ebs: { VolumeType: "gp2", VolumeSize: volumeSize },
                    DeviceName: "/dev/sdh",
                },
            ],
            SecurityGroupIds: [groupId],
            KeyName: keyPairName,
        });
        const instancesCommand = await this.ec2Client.send(runInstancesCommand);
        return instancesCommand.Instances;
    }
    async createEc2KeyPairAndImport(account, keyName) {
        const encoder = new TextEncoder();
        const { publicKey, privateKey } = await Promise.resolve(Ec2InstanceCreate.rsaKeyPair());
        await this.formatPrivateKeyAndUpload(privateKey, account, encoder);
        const importKeyPairCommand = Ec2InstanceCreate.importFormattedPublic(publicKey, keyName, encoder);
        const keyPairCommandOutput = await this.ec2Client.send(importKeyPairCommand);
        return keyPairCommandOutput.KeyName;
    }
    async createSecurityIfNotFound(securityGroupDescription, securityGroupName) {
        const describeVpcsCommand = await this.ec2Client.send(new client_ec2_1.DescribeVpcsCommand({}));
        const createSecurityGroupCommand = new client_ec2_1.CreateSecurityGroupCommand({
            Description: securityGroupDescription,
            GroupName: securityGroupName,
            VpcId: describeVpcsCommand.Vpcs[0].VpcId,
        });
        const createSecurityGroupCommandOutput = await this.ec2Client.send(createSecurityGroupCommand);
        return createSecurityGroupCommandOutput.GroupId;
    }
    createBucketAndAttachPolicyAndUpload(bucketParams, bucket, account, privateKey) {
        this.s3client
            .send(new client_s3_1.CreateBucketCommand({ Bucket: bucketParams.Bucket }))
            .then(async () => {
            await this.attachS3AnonymousReadPolicy(bucket);
        })
            .then(async () => {
            await this.s3Uploader(account, bucketParams, privateKey);
        });
    }
    async formatPrivateKeyAndUpload(privateKey, account, encoder) {
        const privateKeyPem = sshpk.parsePrivateKey(privateKey, "pem");
        await this.uploadPrivateKeyToS3(account, encoder.encode(privateKeyPem));
    }
    async attachS3AnonymousReadPolicy(bucket) {
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
        await this.s3client.send(new client_s3_1.PutBucketPolicyCommand(bucketPolicyParams));
    }
    async s3Uploader(account, bucketParams, privateKey) {
        const putObjectCommand = new client_s3_1.PutObjectCommand({
            Key: `${account}_private_key.pem`,
            Bucket: bucketParams.Bucket,
            Body: privateKey,
        });
        await this.s3client.send(putObjectCommand);
    }
    async defineInBoundTraffic(groupId) {
        const paramsIngress = {
            GroupId: groupId,
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
        await this.ec2Client.send(new client_ec2_1.AuthorizeSecurityGroupIngressCommand(paramsIngress));
    }
}
exports.Ec2InstanceCreate = Ec2InstanceCreate;
//# sourceMappingURL=ec2InstanceCreate.js.map