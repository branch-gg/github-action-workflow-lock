import * as core from '@actions/core';
import { getOrCreateLockData, updateLockData } from './meta';
import { ActionParams } from './types';

export async function releaseLock(params: ActionParams): Promise<void> {
  const {
    octokit,
    owner,
    repo,
    lockFilePath,
    lockBranch,
    lockKey,
    runId,
    pollingInterval,
  } = params;

  let released = false;
  let retries = 0;
  while (!released) {
    ++retries;
    try {
      // Fetch lock file content
      const { lockData, sha } = await getOrCreateLockData(
        octokit,
        owner,
        repo,
        lockFilePath,
        lockBranch,
      );

      if (!lockData[lockKey]) {
        core.warning('Lock key not found during release.');
        released = true; // Exit the loop
        break;
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
          released = true; // Exit the loop
        } else {
          core.info('Conflict detected during release, retrying...');
          await new Promise(resolve =>
            setTimeout(resolve, pollingInterval || 10000),
          );
        }
      } else {
        core.warning('Run ID not found in lock entries during release.');
        released = true; // Exit the loop
      }
    } catch (error: any) {
      core.error(`Error during lock release: ${error.message}`);
      core.error(error);

      // Only throw if we've tried 3 times
      if (retries > 3) {
        throw error;
      }
    }
  }
}
