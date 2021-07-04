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
    async CreatEc2KeyPair(account) {
        const encoder = new TextEncoder();
        const { publicKey, privateKey } = await Promise.resolve(Ec2InstanceCreate.rsaKeyPair());
        const privateKeyPem = sshpk.parsePrivateKey(privateKey, "pem");
        await this.uploadPrivateKeyToS3(account, encoder.encode(privateKeyPem));
        const pemKey = sshpk.parseKey(publicKey, "pem");
        const importKeyPairCommand = new client_ec2_1.ImportKeyPairCommand({
            KeyName: `${account}_key_pair`,
            PublicKeyMaterial: encoder.encode(pemKey.toString("ssh")),
        });
        return this.ec2Client.send(importKeyPairCommand);
    }
    async CreatEc2SecurityGroup(account) {
        const describeVpcsCommand = await this.ec2Client.send(new client_ec2_1.DescribeVpcsCommand({}));
        const paramsSecurityGroup = {
            Description: `${account}_security_group`,
            GroupName: `${account}_SECURITY_GROUP_NAME`,
            VpcId: describeVpcsCommand.Vpcs[0].VpcId,
        };
        const securityGroupCommand = await this.ec2Client.send(new client_ec2_1.CreateSecurityGroupCommand(paramsSecurityGroup));
        await this.defineInBoundTraffic(securityGroupCommand);
        return securityGroupCommand;
    }
    async uploadPrivateKeyToS3(account, privateKey) {
        const bucketParams = {
            Bucket: `account-private-key`,
        };
        await this.checkForBucket().then((buckets) => {
            buckets.Buckets.forEach((bucket) => {
                if (bucket.Name.toLocaleLowerCase() ==
                    bucketParams.Bucket.toLocaleLowerCase()) {
                    this.s3Uploader(account, bucketParams, privateKey);
                }
                else {
                    this.s3client
                        .send(new client_s3_1.CreateBucketCommand({ Bucket: bucketParams.Bucket }))
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
                        await this.s3client.send(new client_s3_1.PutBucketPolicyCommand(bucketPolicyParams));
                    })
                        .then(async () => {
                        await this.s3Uploader(account, bucketParams, privateKey);
                    });
                }
            });
        });
    }
    async checkForBucket() {
        const listBucketsCommand = new client_s3_1.ListBucketsCommand({});
        return await this.s3client.send(listBucketsCommand);
    }
    async createEc2Instance(account, maxCount, instanceType, volumeSize, amiId) {
        const groupId = await this.CreatEc2SecurityGroup(account).then((result) => {
            return result.GroupId;
        });
        const keyPair = await this.CreatEc2KeyPair(account).then((result) => {
            return result.KeyName;
        });
        const runInstancesCommand = new client_ec2_1.RunInstancesCommand({
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
    async s3Uploader(account, bucketParams, privateKey) {
        const putObjectCommand = new client_s3_1.PutObjectCommand({
            Key: `${account}_private_key.pem`,
            Bucket: bucketParams.Bucket,
            Body: privateKey,
        });
        await this.s3client.send(putObjectCommand);
    }
    async defineInBoundTraffic(securityGroupCommand) {
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
        await this.ec2Client.send(new client_ec2_1.AuthorizeSecurityGroupIngressCommand(paramsIngress));
    }
}
exports.Ec2InstanceCreate = Ec2InstanceCreate;
//# sourceMappingURL=ec2InstanceCreate.js.map