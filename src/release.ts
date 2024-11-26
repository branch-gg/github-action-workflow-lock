import * as core from '@actions/core';
import { getOrCreateLockData, updateLockData } from './meta';
import { ActionParams } from './types';
import retry from './retry';

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

  await retry(async () => {
    while (true) {
      try {
        // Fetch lock file content
        const { lockData, sha } = await retry(async () => {
          const { lockData, sha } = await getOrCreateLockData(
            octokit,
            owner,
            repo,
            lockFilePath,
            lockBranch,
          );

          return { lockData, sha };
        });

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
            break;
          } else {
            core.info('Conflict detected during release, retrying...');
            await new Promise(resolve =>
              setTimeout(resolve, pollingInterval || 10000),
            );
          }
        } else {
          core.warning('Run ID not found in lock entries during release.');
          break;
        }
      } catch (error: any) {
        core.error(`Error during lock release: ${error.message}`);
        core.error(error);
        throw error;
      }
    }
  });
}
