import useReadyEta from '@app/hooks/useReadyEta';
import type { MusicDownload } from '@server/interfaces/api/musicInterfaces';

/** The ready estimate for a downloading artist or album. */
export const useMusicEta = (download?: MusicDownload) =>
  useReadyEta(!!download, download?.readyAt);

/** A small always-visible pill for artist and album cards. */
export const MusicEtaPill = ({ download }: { download?: MusicDownload }) => {
  const eta = useMusicEta(download);

  if (!eta) {
    return null;
  }

  return (
    <div
      className="pointer-events-none z-40 whitespace-nowrap rounded-full border border-indigo-400 bg-indigo-500/80 px-2 text-xs font-medium leading-5 text-indigo-100 shadow-md"
      title={eta.full}
    >
      {eta.short}
    </div>
  );
};
