export interface SnapshotInfo {
  name: string;
  creationTime: string;
}

export interface SnapshotListItem {
  name: string | undefined;
  creationTime: string | undefined;
  postgresVersion: string | undefined;
  backupUrl: string | undefined;
  status: boolean | undefined;
}

export interface VolumeSnapshotList {
  items: {
    metadata?: {
      name?: string;
      creationTimestamp?: string;
      annotations?: {
        [key: string]: string;
      };
    };
    status?: {
      readyToUse?: boolean;
    };
  }[];
}