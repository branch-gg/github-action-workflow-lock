import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { acquireLock } from './acquire';
import { releaseLock } from './release';

export async function run(): Promise<void> {
  try {
    const mode = core.getInput('mode') || 'acquire';
    const githubToken = core.getInput('github-token', { required: true });
    const lockFilePath = core.getInput('lock-file-path', { required: true });
    const lockBranch = core.getInput('lock-branch') || 'locks';
    const lockKey = core.getInput('lock-key', { required: true });
    const maxConcurrent = parseInt(core.getInput('max-concurrent') || '2');
    const pollingInterval =
      parseInt(core.getInput('polling-interval') || '10', 10) * 1000; // Convert to milliseconds

    const octokit = getOctokit(githubToken);

    const owner = core.getInput('owner') || context.repo.owner;
    const repo = core.getInput('repo') || context.repo.repo;

    const runId = `${context.workflow}:${context.runId}:${context.job}`;

    if (mode === 'acquire') {
      await acquireLock({
        octokit,
        owner,
        repo,
        lockFilePath,
        lockBranch,
        lockKey,
        maxConcurrent,
        pollingInterval,
        runId,
      });
    } else if (mode === 'release') {
      await releaseLock({
        octokit,
        owner,
        repo,
        lockFilePath,
        lockBranch,
        lockKey,
        runId,
      });
    } else {
      core.setFailed(`Invalid mode: ${mode}. Use 'acquire' or 'release'.`);
    }
  } catch (error: any) {
    core.setFailed(error.message);
  }
}
