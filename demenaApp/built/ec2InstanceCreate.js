"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ec2InstanceCreate = void 0;
const client_ec2_1 = require("@aws-sdk/client-ec2");
const crypto_1 = require("crypto");
const sshpk = require("sshpk");
class Ec2InstanceCreate {
    constructor(ec2Client) {
        this.ec2Client = ec2Client;
        this.ec2Client = new client_ec2_1.EC2Client({});
    }
    static rsaKeyPair() {
        const { publicKey, privateKey } = crypto_1.generateKeyPairSync("rsa", {
            modulusLength: 2048,
            publicKeyEncoding: {
                type: "pkcs1",
                format: "pem",
            },
            privateKeyEncoding: {
                type: "pkcs8",
                format: "pem",
            },
        });
        return { publicKey, privateKey };
    }
    async CreatEc2KeyPair(keyName) {
        const { publicKey, privateKey } = Ec2InstanceCreate.rsaKeyPair();
        await this.uploadPrivateKeytoS3(privateKey);
        const pemKey = sshpk.parseKey(publicKey, "pem");
        const encoder = new TextEncoder();
        const importKeyPairCommand = new client_ec2_1.ImportKeyPairCommand({
            KeyName: keyName,
            PublicKeyMaterial: encoder.encode(pemKey.toString("ssh")),
        });
        return this.ec2Client.send(importKeyPairCommand);
    }
    async CreatEc2SecurityGroup(account) {
        const describeVpcsCommand = await this.ec2Client.send(new client_ec2_1.DescribeVpcsCommand({}));
        const paramsSecurityGroup = {
            Description: account + "_security_group",
            GroupName: account + "_SECURITY_GROUP_NAME",
            VpcId: describeVpcsCommand.Vpcs[0].VpcId,
        };
        const securityGroupCommand = await this.ec2Client.send(new client_ec2_1.CreateSecurityGroupCommand(paramsSecurityGroup));
        await this.defineInBoundTraffic(securityGroupCommand);
        return securityGroupCommand;
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
            AdditionalInfo: account + "_EC2_Instance",
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
    async downloadPrivateKey(privateKey) {
        //TODO S3 download key
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
    async uploadPrivateKeytoS3(privateKey) {
    }
}
exports.Ec2InstanceCreate = Ec2InstanceCreate;
//# sourceMappingURL=ec2InstanceCreate.js.map