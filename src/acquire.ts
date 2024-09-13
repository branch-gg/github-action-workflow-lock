import * as core from '@actions/core';
import { ActionParams } from './types';
import { getOrCreateLockData, updateLockData } from './meta';

export async function acquireLock(params: ActionParams): Promise<void> {
  const {
    octokit,
    owner,
    repo,
    lockFilePath,
    lockBranch,
    lockKey,
    maxConcurrent,
    pollingInterval,
    runId,
  } = params;

  let acquired = false;
  while (!acquired) {
    try {
      const { lockData, sha } = await getOrCreateLockData(
        octokit,
        owner,
        repo,
        lockFilePath,
        lockBranch,
      );

      if (!lockData[lockKey]) lockData[lockKey] = [];
      const currentEntries = lockData[lockKey];

      if (currentEntries.includes(runId)) {
        core.info(`Lock already acquired by this run (${runId}).`);
        acquired = true;
        break;
      }

      if (currentEntries.length < (maxConcurrent || 1)) {
        currentEntries.push(runId);
        const newContent = Buffer.from(
          JSON.stringify(lockData, null, 2),
        ).toString('base64');

        const updated = await updateLockData(
          octokit,
          owner,
          repo,
          lockFilePath,
          lockBranch,
          newContent,
          sha,
          `Acquire lock by ${runId}`,
        );
        if (updated) {
          acquired = true;
          core.info(`Lock acquired by ${runId}`);
        } else {
          core.info('Conflict detected, retrying...');
        }
      } else {
        core.info(`Max concurrency reached (${maxConcurrent}), waiting...`);
        await new Promise(resolve =>
          setTimeout(resolve, pollingInterval || 10000),
        );
      }
    } catch (error: any) {
      core.error(`Error during lock acquisition: ${error.message}`);
      throw error;
    }
  }
}
