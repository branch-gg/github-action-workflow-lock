import * as core from '@actions/core';
import { getOrCreateLockData, updateLockData } from './meta';
import { ActionParams } from './types';

export async function releaseLock(params: ActionParams): Promise<void> {
  const { octokit, owner, repo, lockFilePath, lockBranch, lockKey, runId } =
    params;

  try {
    const { lockData, sha } = await getOrCreateLockData(
      octokit,
      owner,
      repo,
      lockFilePath,
      lockBranch,
    );

    if (!lockData[lockKey]) {
      core.warning('Lock key not found during release.');
      return;
    }

    const currentEntries = lockData[lockKey];
    const index = currentEntries.indexOf(runId);
    if (index !== -1) {
      currentEntries.splice(index, 1);
      if (currentEntries.length === 0) delete lockData[lockKey];

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
        `Release lock by ${runId}`,
      );
      if (updated) {
        core.info(`Lock released by ${runId}`);
      } else {
        core.warning('Failed to update lock file during release.');
      }
    } else {
      core.warning('Run ID not found in lock entries during release.');
    }
  } catch (error: any) {
    core.error(`Error during lock release: ${error.message}`);
    throw error;
  }
}
