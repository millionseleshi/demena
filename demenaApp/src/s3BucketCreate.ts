import {CreateBucketCommand, S3Client} from "@aws-sdk/client-s3";

export class S3BucketCreate {
    constructor(private s3Client: S3Client) {
        this.s3Client = new S3Client({});
    }

    async createFreeAccountKeyBucket(account: string) {
        new CreateBucketCommand({Bucket: account + "-bucket-" + Date.now().toLocaleString()})
    }
}
