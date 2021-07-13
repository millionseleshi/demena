"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lambdaHandler = void 0;
const ec2InstanceCreate_1 = require("./ec2InstanceCreate");
const client_ec2_1 = require("@aws-sdk/client-ec2");
const client_s3_1 = require("@aws-sdk/client-s3");
const awsregion = process.env.AWS_REGION;
const lambdaHandler = async (event) => {
    if (event.httpMethod !== "POST") {
        throw new Error(`postMethod only accepts POST method, you tried: ${event.httpMethod} method.`);
    }
    const body = JSON.parse(event.body);
    const account = body.account;
    const maxCount = body.maxCount;
    const vCpu = body.vcpu;
    const ram = body.ram;
    const volumeSize = body.volumeSize;
    const ec2InstanceCreate = new ec2InstanceCreate_1.Ec2InstanceCreate(new client_ec2_1.EC2Client({ region: awsregion }), new client_s3_1.S3Client({ region: awsregion }));
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
exports.lambdaHandler = lambdaHandler;
//# sourceMappingURL=app.js.map