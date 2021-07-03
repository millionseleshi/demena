"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.S3BucketCreate = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
class S3BucketCreate {
    constructor(s3Client) {
        this.s3Client = s3Client;
        this.s3Client = new client_s3_1.S3Client({});
    }
    async createFreeAccountKeyBucket(account) {
        new client_s3_1.CreateBucketCommand({ Bucket: account + "-bucket-" + Date.now().toLocaleString() });
    }
}
exports.S3BucketCreate = S3BucketCreate;
//# sourceMappingURL=s3BucketCreate.js.map