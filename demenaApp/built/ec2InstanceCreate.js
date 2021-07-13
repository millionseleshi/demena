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
    static importFormattedPublic(publicKey, keyName, encoder) {
        const pemKey = sshpk.parseKey(publicKey, "pem");
        return new client_ec2_1.ImportKeyPairCommand({
            KeyName: keyName,
            PublicKeyMaterial: encoder.encode(pemKey.toString()),
        });
    }
    async selectInstanceType(vCpu, ram) {
        if (vCpu == 1 && ram == 0.5) {
            this.Ec2InstanceType = 't2.nano';
        }
        else if (vCpu == 1 && ram == 1) {
            this.Ec2InstanceType = 't2.micro';
        }
        else if (vCpu == 1 && ram == 2) {
            this.Ec2InstanceType = 't2.small';
        }
        else if (vCpu == 2 && ram == 4) {
            this.Ec2InstanceType = 't2.medium';
        }
        else if (vCpu == 2 && ram == 8) {
            this.Ec2InstanceType = 't2.large';
        }
        else if (vCpu == 4 && ram == 16) {
            this.Ec2InstanceType = 't2.xlarge';
        }
        else if (vCpu == 8 && ram == 32) {
            this.Ec2InstanceType = 't2.2xlarge';
        }
        else {
            throw Error("instance is not found");
        }
    }
    async CreatEc2KeyPair(account) {
        const random = (length = 5) => {
            return Math.random().toString(16).substr(2, length);
        };
        const keyName = `${account}_key_pair_${random()}`;
        this.instanceKeyName = await this.createEc2KeyPairAndImport(account, keyName);
    }
    async CreatEc2SecurityGroup(account) {
        const random = (length = 5) => {
            return Math.random().toString(16).substr(2, length);
        };
        const securityGroupDescription = `${random()}_security_group_for_${account}`;
        const securityGroupName = `${account}_SECURITY_GROUP_${random(5)}`;
        this.securityGroupId = await this.createSecurityGroupIfNotFound({
            securityGroupName,
            securityGroupDescription,
        });
        await this.defineInBoundTraffic(this.securityGroupId);
    }
    async uploadPrivateKeyToS3({ account, privateKey, }) {
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
        const listBucketsCommand = new client_s3_1.ListBucketsCommand({});
        return await this.s3client.send(listBucketsCommand);
    }
    async createEc2Instance({ account, maxCount, vCpu, ram, volumeSize, amiId, }) {
        await this.prepareEc2InstanceEnv(account, vCpu, ram);
        const runInstancesCommand = new client_ec2_1.RunInstancesCommand({
            MaxCount: maxCount,
            MinCount: 1,
            ImageId: amiId,
            InstanceType: this.Ec2InstanceType,
            BlockDeviceMappings: [
                {
                    Ebs: { VolumeType: "gp2", VolumeSize: volumeSize },
                    DeviceName: "/dev/sdh",
                },
            ],
            SecurityGroupIds: [this.securityGroupId],
            KeyName: this.instanceKeyName,
        });
        const instancesCommand = await this.ec2Client.send(runInstancesCommand);
        return instancesCommand.Instances;
    }
    async prepareEc2InstanceEnv(account, vCpu, ram) {
        await this.CreatEc2SecurityGroup(account);
        await this.CreatEc2KeyPair(account);
        await this.selectInstanceType(vCpu, ram);
    }
    async createEc2KeyPairAndImport(account, keyName) {
        const encoder = new TextEncoder();
        const { publicKey, privateKey } = await Promise.resolve(Ec2InstanceCreate.rsaKeyPair());
        await this.formatPrivateKeyAndUpload({
            privateKey: privateKey,
            account: account,
            encoder: encoder,
        });
        const importKeyPairCommand = Ec2InstanceCreate.importFormattedPublic(publicKey, keyName, encoder);
        const keyPairCommandOutput = await this.ec2Client.send(importKeyPairCommand);
        return keyPairCommandOutput.KeyName;
    }
    async createSecurityGroupIfNotFound({ securityGroupName: securityGroupName, securityGroupDescription: securityGroupDescription, }) {
        const describeVpcsCommand = await this.ec2Client.send(new client_ec2_1.DescribeVpcsCommand({}));
        const createSecurityGroupCommand = new client_ec2_1.CreateSecurityGroupCommand({
            Description: securityGroupDescription,
            GroupName: securityGroupName,
            VpcId: describeVpcsCommand.Vpcs[0].VpcId,
        });
        const createSecurityGroupCommandOutput = await this.ec2Client.send(createSecurityGroupCommand);
        return createSecurityGroupCommandOutput.GroupId;
    }
    createBucketWithPolicyAndUpload({ bucketParams, bucket, account, privateKey, }) {
        this.s3client
            .send(new client_s3_1.CreateBucketCommand({ Bucket: bucketParams.Bucket }))
            .then(async () => {
            await this.attachS3AnonymousReadPolicy(bucket);
        })
            .then(async () => {
            await this.s3Uploader(account, bucketParams, privateKey);
        });
    }
    async formatPrivateKeyAndUpload({ privateKey, account, encoder, }) {
        const privateKeyPem = sshpk.parsePrivateKey(privateKey, "pem");
        await this.uploadPrivateKeyToS3({
            account: account,
            privateKey: encoder.encode(privateKeyPem),
        });
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