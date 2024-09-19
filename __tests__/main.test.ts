// tests/index.test.ts
import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { run } from '../src/main';
import { acquireLock } from '../src/acquire';
import { releaseLock } from '../src/release';

jest.mock('@actions/core');
jest.mock('@actions/github');

jest.setTimeout(10000);

describe('Distributed Lock Action', () => {
  const owner = 'test-owner';
  const repo = 'test-repo';
  const lockFilePath = 'locks/lock.json';
  const lockBranch = 'locks';
  const lockKey = 'test-lock-key';
  const runId = 'test-workflow:12345:test-job';
  const githubToken = 'mock-token';
  let mode = 'acquire';

  let octokit: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock Octokit methods
    octokit = {
      rest: {
        repos: {
          getContent: jest.fn(),
          createOrUpdateFileContents: jest.fn(),
          getBranch: jest.fn(),
        },
      },
    };

    (getOctokit as jest.Mock).mockReturnValue(octokit);

    (core.getInput as jest.Mock).mockImplementation((name: string) => {
      switch (name) {
        case 'mode':
          return mode;
        case 'owner':
          return 'mock-owner';
        case 'repo':
          return 'mock-repo';
        case 'github-token':
          return githubToken;
        case 'lock-file-path':
          return lockFilePath;
        case 'lock-branch':
          return lockBranch;
        case 'lock-key':
          return lockKey;
        case 'max-concurrent':
          return '2';
        case 'polling-interval':
          return '1';
        default:
          return '';
      }
    });

    // Mock core methods to prevent actual logging
    (core.info as jest.Mock).mockImplementation(console.log);
    (core.warning as jest.Mock).mockImplementation(console.warn);
    (core.error as jest.Mock).mockImplementation(console.error);
    (core.setFailed as jest.Mock).mockImplementation(console.error);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should acquire the lock end to end', async () => {
    context.workflow = 'test-workflow';
    context.runId = 12345;
    context.job = 'test-job';

    // Mock getContent to return existing lock file with empty lock data
    octokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(JSON.stringify({})).toString('base64'),
        sha: 'test-sha',
      },
    });

    // Mock createOrUpdateFileContents to succeed
    octokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({
      data: {
        content: {},
        commit: { sha: 'new-sha' },
      },
    });

    await run();

    // Verify that the lock was acquired
    expect(core.info).toHaveBeenCalledWith(`Lock acquired by ${runId}`);
    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('acquires the lock successfully when lock is available', async () => {
    // Mock getContent to return existing lock file with empty lock data
    octokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(JSON.stringify({})).toString('base64'),
        sha: 'test-sha',
      },
    });

    // Mock createOrUpdateFileContents to succeed
    octokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({
      data: {
        content: {},
        commit: { sha: 'new-sha' },
      },
    });

    await acquireLock({
      octokit,
      owner,
      repo,
      lockFilePath,
      lockBranch,
      lockKey,
      maxConcurrent: 2,
      pollingInterval: 1000,
      runId,
    });

    // Verify that the lock was acquired
    expect(core.info).toHaveBeenCalledWith(`Lock acquired by ${runId}`);
    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalled();
  });

  it('waits when max concurrency is reached', async () => {
    // Initial lock data with max concurrency reached
    const lockData = { [lockKey]: ['run1', 'run2'] };

    // Mock getBranch to indicate the branch exists
    octokit.rest.repos.getBranch.mockResolvedValue({
      data: {
        name: lockBranch,
        commit: {
          sha: 'branch-sha',
        },
      },
    });

    // Mock getContent to return the current lock data on each call
    octokit.rest.repos.getContent.mockImplementation(() => {
      return Promise.resolve({
        data: {
          content: Buffer.from(JSON.stringify(lockData)).toString('base64'),
          sha: 'test-sha',
        },
      });
    });

    // Create a variable to control the availability of the lock
    let lockReleased = false;

    // Modify the lock data to simulate a slot becoming available after 2 seconds
    setTimeout(() => {
      lockData[lockKey].pop(); // Remove one entry to simulate a free slot
      lockReleased = true;
    }, 2000);

    // Mock createOrUpdateFileContents to succeed when the slot is available
    octokit.rest.repos.createOrUpdateFileContents.mockImplementation(() => {
      if (lockReleased) {
        return Promise.resolve({
          data: {
            content: {},
            commit: { sha: 'new-sha' },
          },
        });
      } else {
        // Simulate a conflict to make the action retry
        return Promise.reject({
          status: 409,
          message: 'Conflict',
        });
      }
    });

    await acquireLock({
      octokit,
      owner,
      repo,
      lockFilePath,
      lockBranch,
      lockKey,
      maxConcurrent: 2,
      pollingInterval: 500, // Shorter interval for the test
      runId,
    });

    // Verify that the lock was eventually acquired
    expect(core.info).toHaveBeenCalledWith(`Lock acquired by ${runId}`);
  });

  it('creates the lock file if it does not exist', async () => {
    // Mock getBranch to return that the branch exists
    octokit.rest.repos.getBranch.mockResolvedValueOnce({
      data: {
        name: lockBranch,
        commit: {
          sha: 'branch-sha',
        },
      },
    });

    // Mock getContent to return 404 (file not found)
    octokit.rest.repos.getContent
      .mockRejectedValueOnce({
        status: 404,
        message: 'Not Found',
      })
      // After creating the lock file, mock getContent to return the new lock file
      .mockResolvedValueOnce({
        data: {
          content: Buffer.from(JSON.stringify({})).toString('base64'),
          sha: 'initial-sha',
        },
      });

    // Mock createOrUpdateFileContents to create the lock file
    octokit.rest.repos.createOrUpdateFileContents
      .mockResolvedValueOnce({
        data: {
          content: {},
          commit: { sha: 'initial-sha' },
        },
      })
      // Mock createOrUpdateFileContents to succeed in acquiring the lock
      .mockResolvedValueOnce({
        data: {
          content: {},
          commit: { sha: 'new-sha' },
        },
      });

    await acquireLock({
      octokit,
      owner,
      repo,
      lockFilePath,
      lockBranch,
      lockKey,
      maxConcurrent: 2,
      pollingInterval: 1000,
      runId,
    });

    // Verify that the lock was acquired
    expect(core.info).toHaveBeenCalledWith(`Lock acquired by ${runId}`);
    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(
      2,
    );
  });

  it('releases the lock successfully', async () => {
    // Mock getContent to return lock data with the run ID
    const lockData = { [lockKey]: [runId] };

    octokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(JSON.stringify(lockData)).toString('base64'),
        sha: 'test-sha',
      },
    });

    // Mock createOrUpdateFileContents to succeed
    octokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({
      data: {
        content: {},
        commit: { sha: 'new-sha' },
      },
    });

    await releaseLock({
      octokit,
      owner,
      repo,
      lockFilePath,
      lockBranch,
      lockKey,
      runId,
    });

    // Verify that the lock was released
    expect(core.info).toHaveBeenCalledWith(`Lock released by ${runId}`);
    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalled();
  });

  it('handles conflicts during update and retries', async () => {
    // Mock getContent to return existing lock file
    octokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(JSON.stringify({})).toString('base64'),
        sha: 'test-sha',
      },
    });

    // Mock createOrUpdateFileContents to fail with a conflict first
    octokit.rest.repos.createOrUpdateFileContents
      .mockRejectedValueOnce({
        status: 409,
        message: 'Conflict',
      })
      .mockResolvedValueOnce({
        data: {
          content: {},
          commit: { sha: 'new-sha' },
        },
      });

    await acquireLock({
      octokit,
      owner,
      repo,
      lockFilePath,
      lockBranch,
      lockKey,
      maxConcurrent: 2,
      pollingInterval: 500,
      runId,
    });

    // Verify that the lock was eventually acquired after retry
    expect(core.info).toHaveBeenCalledWith(`Lock acquired by ${runId}`);
  });

  it('fails when the lock branch does not exist', async () => {
    // Mock getBranch to return 404 (branch not found)
    octokit.rest.repos.getBranch.mockRejectedValueOnce({
      status: 404,
      message: 'Branch not found',
    });

    await expect(
      acquireLock({
        octokit,
        owner,
        repo,
        lockFilePath,
        lockBranch,
        lockKey,
        maxConcurrent: 2,
        pollingInterval: 1000,
        runId,
      }),
    ).rejects.toThrow(
      `Branch ${lockBranch} does not exist. Please create it manually.`,
    );

    // Verify that an error was logged
    expect(core.error).toHaveBeenCalledWith(
      `Branch ${lockBranch} does not exist. Please create it manually.`,
    );
  });

  it('releases lock when run ID not present', async () => {
    // Mock getContent to return lock data without the run ID
    const lockData = { [lockKey]: ['some-other-run'] };

    octokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(JSON.stringify(lockData)).toString('base64'),
        sha: 'test-sha',
      },
    });

    // Since run ID is not present, createOrUpdateFileContents should not be called
    octokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({
      data: {
        content: {},
        commit: { sha: 'new-sha' },
      },
    });

    await releaseLock({
      octokit,
      owner,
      repo,
      lockFilePath,
      lockBranch,
      lockKey,
      runId,
    });

    // Verify that a warning was logged and no update was made
    expect(core.warning).toHaveBeenCalledWith(
      'Run ID not found in lock entries during release.',
    );
    expect(
      octokit.rest.repos.createOrUpdateFileContents,
    ).not.toHaveBeenCalled();
  });

  it('handles lock file parsing errors', async () => {
    // Mock getContent to return invalid JSON content
    octokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from('Invalid JSON').toString('base64'),
        sha: 'test-sha',
      },
    });

    // Mock createOrUpdateFileContents to succeed
    octokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({
      data: {
        content: {},
        commit: { sha: 'new-sha' },
      },
    });

    await acquireLock({
      octokit,
      owner,
      repo,
      lockFilePath,
      lockBranch,
      lockKey,
      maxConcurrent: 2,
      pollingInterval: 1000,
      runId,
    });

    // Verify that a warning was logged about parsing
    expect(core.warning).toHaveBeenCalledWith(
      'Failed to parse lock file. Reinitializing.',
    );
    // Verify that the lock was acquired
    expect(core.info).toHaveBeenCalledWith(`Lock acquired by ${runId}`);
  });

  it('retries on conflict during release and eventually releases the lock', async () => {
    // Mock getBranch to indicate the branch exists
    octokit.rest.repos.getBranch.mockResolvedValue({
      data: {
        name: lockBranch,
        commit: {
          sha: 'branch-sha',
        },
      },
    });

    // Initial lock data with the run ID
    const lockData = { [lockKey]: [runId] };

    // Mock getContent to return the current lock data on each call
    octokit.rest.repos.getContent.mockImplementation(() => {
      return Promise.resolve({
        data: {
          content: Buffer.from(JSON.stringify(lockData)).toString('base64'),
          sha: 'test-sha',
        },
      });
    });

    // Mock createOrUpdateFileContents to simulate conflict on first attempt, then succeed
    octokit.rest.repos.createOrUpdateFileContents
      .mockRejectedValueOnce({
        status: 409,
        message: 'Conflict',
      })
      .mockResolvedValueOnce({
        data: {
          content: {},
          commit: { sha: 'new-sha' },
        },
      });

    await releaseLock({
      octokit,
      owner,
      repo,
      lockFilePath,
      lockBranch,
      lockKey,
      pollingInterval: 100, // Short polling interval for the test
      runId,
    });

    // Verify that the lock was eventually released
    expect(core.info).toHaveBeenCalledWith(`Lock released by ${runId}`);
  });
});
