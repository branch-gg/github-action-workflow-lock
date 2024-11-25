import * as core from '@actions/core';
import { getOctokit } from '@actions/github';

export async function getOrCreateLockData(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  lockFilePath: string,
  lockBranch: string,
): Promise<{ lockData: Record<string, string[]>; sha: string | null }> {
  let lockData: Record<string, string[]> = {};
  let sha: string | null = null;

  // Check if the branch exists
  const branchExistsResult = await branchExists(
    octokit,
    owner,
    repo,
    lockBranch,
  );

  if (!branchExistsResult) {
    core.error(
      `Branch ${lockBranch} does not exist. Please create it manually.`,
    );
    throw new Error(
      `Branch ${lockBranch} does not exist. Please create it manually.`,
    );
  }

  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: lockFilePath,
      ref: lockBranch,
    });

    if (!('content' in response.data)) {
      throw new Error(
        'Unexpected response from GitHub API: content not found.',
      );
    }

    const content = Buffer.from(response.data.content, 'base64').toString();
    sha = response.data.sha;

    try {
      lockData = JSON.parse(content);
    } catch (error) {
      core.warning('Failed to parse lock file. Reinitializing.');
      lockData = {};
    }
  } catch (error: any) {
    if (error.status === 404) {
      // Lock file not found; create it
      core.info(
        `Lock file not found at ${lockFilePath} on branch ${lockBranch}. Creating new lock file.`,
      );
      lockData = {};
      sha = null;

      // Initialize lock file
      const initialContent = Buffer.from(
        JSON.stringify(lockData, null, 2),
      ).toString('base64');

      try {
        await octokit.rest.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: lockFilePath,
          message: `Initialize lock file at ${lockFilePath}`,
          content: initialContent,
          branch: lockBranch,
        });
        core.info(`Lock file ${lockFilePath} created on branch ${lockBranch}.`);
      } catch (createError: any) {
        if (createError.status === 409) {
          // File was created by another process, retry
          core.info('Lock file created by another process, retrying...');
        } else {
          throw createError;
        }
      }

      // After creating the lock file, retry fetching it
      return await getOrCreateLockData(
        octokit,
        owner,
        repo,
        lockFilePath,
        lockBranch,
      );
    } else {
      // Unknown error
      core.error(`Error fetching lock file: ${error.message}`);
      throw error;
    }
  }

  return { lockData, sha };
}

export async function updateLockData(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  lockFilePath: string,
  lockBranch: string,
  newContent: string,
  sha: string | null,
  commitMessage: string,
): Promise<boolean> {
  try {
    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: lockFilePath,
      message: commitMessage,
      content: newContent,
      sha: sha || undefined,
      branch: lockBranch,
    });
    return true;
  } catch (error: any) {
    if (error.status === 409) {
      // Conflict occurred, return false to retry
      return false;
    } else {
      throw error;
    }
  }
}

async function branchExists(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  branch: string,
): Promise<boolean> {
  try {
    await octokit.rest.repos.getBranch({
      owner,
      repo,
      branch,
    });
    return true;
  } catch (error: any) {
    if (error.status === 404) {
      return false;
    } else {
      throw error;
    }
  }
}
