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
import sshpk = require("sshpk");

export class Ec2InstanceCreate {
  constructor(private ec2Client: EC2Client) {
    this.ec2Client = new EC2Client({});
  }

  private static rsaKeyPair() {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
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

  async CreatEc2KeyPair(keyName: string) {
    const { publicKey, privateKey } = Ec2InstanceCreate.rsaKeyPair();
    await this.uploadPrivateKeytoS3(privateKey)
    const pemKey = sshpk.parseKey(publicKey, "pem");
    const encoder = new TextEncoder();
    const importKeyPairCommand = new ImportKeyPairCommand({
      KeyName: keyName,
      PublicKeyMaterial: encoder.encode(pemKey.toString("ssh")),
    });
    return this.ec2Client.send(importKeyPairCommand);
  }

  async CreatEc2SecurityGroup(account: string) {
    const describeVpcsCommand = await this.ec2Client.send(
      new DescribeVpcsCommand({})
    );
    const paramsSecurityGroup = {
      Description: account + "_security_group",
      GroupName: account + "_SECURITY_GROUP_NAME",
      VpcId: describeVpcsCommand.Vpcs[0].VpcId,
    };
    const securityGroupCommand = await this.ec2Client.send(
      new CreateSecurityGroupCommand(paramsSecurityGroup)
    );

    await this.defineInBoundTraffic(securityGroupCommand);

    return securityGroupCommand;
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

  private async downloadPrivateKey(privateKey: string) {
    //TODO S3 download key
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

  async  uploadPrivateKeytoS3(privateKey: string) {

  }
}
