/** What the tools need from the outside world; adapters implement it, tests fake it. */

export interface DriveReader {
  /** Id of the child with this exact name, or null. */
  findChild(parentId: string, name: string): Promise<string | null>;
  downloadJson(fileId: string): Promise<unknown>;
}

export interface WorkflowRun {
  readonly id: number;
  readonly status: string;
  readonly conclusion: string | null;
  readonly htmlUrl: string;
  readonly createdAt: string;
}

export interface WorkflowRunner {
  dispatch(inputs: Readonly<Record<string, string>>): Promise<void>;
  /** Most recent manual run created at or after `since`, or null. */
  latestRunSince(since: Date): Promise<WorkflowRun | null>;
}

export interface LocalFiles {
  read(path: string): Promise<Uint8Array>;
}

export interface Dependencies {
  readonly drive: DriveReader | null;
  readonly driveRootFolderId: string | null;
  readonly workflow: WorkflowRunner | null;
  readonly files: LocalFiles;
  readonly now: () => Date;
  /** IANA zone used to decide what "today" is. */
  readonly timeZone: string;
  readonly sleep: (ms: number) => Promise<void>;
}
