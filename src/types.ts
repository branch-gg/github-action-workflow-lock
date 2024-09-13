import { getOctokit } from '@actions/github';

export interface ActionParams {
  octokit: ReturnType<typeof getOctokit>;
  owner: string;
  repo: string;
  lockFilePath: string;
  lockBranch: string;
  lockKey: string;
  maxConcurrent?: number;
  pollingInterval?: number;
  runId: string;
}
