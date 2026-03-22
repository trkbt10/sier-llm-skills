/**
 * @file スクリーンショットエビデンスの型定義。
 */

export type EvidenceStep = {
  readonly stepNumber: number;
  readonly action: string;
  readonly url: string;
  readonly expected: string;
  readonly actual: string;
  readonly screenshot: Uint8Array;
  readonly screenshotFormat: "png" | "jpeg" | "webp";
  readonly timestamp: Date;
};

export type EvidenceTestCase = {
  readonly name: string;
  readonly url: string;
  readonly status: "pass" | "fail" | "error";
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly steps: readonly EvidenceStep[];
};

export type EvidenceReport = {
  readonly title: string;
  readonly createdAt: Date;
  readonly testCases: readonly EvidenceTestCase[];
};
