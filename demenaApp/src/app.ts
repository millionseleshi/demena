import { Ec2InstanceCreate } from "./ec2InstanceCreate";
import { EC2Client } from "@aws-sdk/client-ec2";
import { S3Client } from "@aws-sdk/client-s3";

const awsregion = process.env.AWS_REGION;

export const lambdaHandler = async (event) => {
  if (event.httpMethod !== "POST") {
    throw new Error(
      `postMethod only accepts POST method, you tried: ${event.httpMethod} method.`
    );
  }
  const body = JSON.parse(event.body);
  const account: string = body.account;
  const maxCount: number = body.maxCount;
  const vCpu: number = body.vcpu;
  const ram: number = body.ram;
  const volumeSize: number = body.volumeSize;

  const ec2InstanceCreate = new Ec2InstanceCreate(
    new EC2Client({ region: awsregion }),
    new S3Client({ region: awsregion })
  );
  await ec2InstanceCreate
    .createEc2Instance({
      account: account,
      maxCount: maxCount,
      vCpu: vCpu,
      ram: ram,
      volumeSize: volumeSize,
      amiId: "ami-09e67e426f25ce0d7",
    })
    .then((result) => {
      console.log("Instance ID" + result[0].InstanceId);
    });
};
