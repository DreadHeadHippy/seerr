const GB = 1024 ** 3;

/** "12.4 GB", "350 GB", "800 MB": sizes people can read at a glance. */
export const formatSize = (bytes: number): string =>
  bytes >= 100 * GB
    ? `${Math.round(bytes / GB)} GB`
    : bytes >= GB
      ? `${(bytes / GB).toFixed(1)} GB`
      : bytes > 0
        ? `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
        : '0 GB';
