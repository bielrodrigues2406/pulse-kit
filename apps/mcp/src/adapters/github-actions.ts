/** Triggers and watches the polar-drive-sync workflow through the GitHub REST API. */

import type { WorkflowRun, WorkflowRunner } from '../ports.js';

const API = 'https://api.github.com';

export interface WorkflowTarget {
  /** owner/repo */
  readonly repository: string;
  readonly workflowFile: string;
  readonly ref: string;
  /** Fine-grained token with Actions: read and write on that repository only. */
  readonly token: string;
}

interface RunsResponse {
  readonly workflow_runs?: readonly {
    readonly id: number;
    readonly status: string;
    readonly conclusion: string | null;
    readonly html_url: string;
    readonly created_at: string;
  }[];
}

export function createGithubWorkflowRunner(target: WorkflowTarget): WorkflowRunner {
  const base = `${API}/repos/${target.repository}/actions/workflows/${encodeURIComponent(target.workflowFile)}`;
  const headers = {
    Authorization: `Bearer ${target.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  return {
    async dispatch(inputs) {
      const res = await fetch(`${base}/dispatches`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: target.ref, inputs }),
      });
      if (res.status !== 204) throw new Error(`O GitHub recusou o disparo (${String(res.status)}): ${await res.text()}`);
    },

    async latestRunSince(since: Date): Promise<WorkflowRun | null> {
      const params = new URLSearchParams({ event: 'workflow_dispatch', per_page: '5' });
      const res = await fetch(`${base}/runs?${params.toString()}`, { headers });
      if (!res.ok) throw new Error(`GitHub respondeu ${String(res.status)} ao listar execuções`);
      const data = (await res.json()) as RunsResponse;
      const run = (data.workflow_runs ?? []).find((r) => Date.parse(r.created_at) >= since.getTime());
      return run === undefined
        ? null
        : { id: run.id, status: run.status, conclusion: run.conclusion, htmlUrl: run.html_url, createdAt: run.created_at };
    },
  };
}
