import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import type { MusicArtistResult } from '@server/interfaces/api/musicInterfaces';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useSWRConfig } from 'swr';

/**
 * Blocklists or unblocks an artist (admin only, enforced by the server), with
 * the same toasts as the movie and series blocklist.
 */
const useArtistBlocklist = (
  artist: Pick<
    MusicArtistResult,
    'foreignArtistId' | 'artistName' | 'blocklisted'
  >
) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { mutate } = useSWRConfig();
  const [blocklisted, setBlocklisted] = useState(!!artist.blocklisted);
  const [isUpdating, setIsUpdating] = useState(false);

  // Follow fresh data: a cached search result is shown first, then replaced.
  useEffect(() => {
    setBlocklisted(!!artist.blocklisted);
  }, [artist.foreignArtistId, artist.blocklisted]);

  // Refresh the music rows, search and the blocklist so they agree.
  const refreshMusic = () =>
    mutate(
      (key) => typeof key === 'string' && key.startsWith('/api/v1/music/')
    );

  const toggle = async () => {
    const title = artist.artistName;
    const strong = (msg: React.ReactNode) => <strong>{msg}</strong>;

    setIsUpdating(true);

    try {
      if (blocklisted) {
        await axios.delete(`/api/v1/music/blocklist/${artist.foreignArtistId}`);
        setBlocklisted(false);
        addToast(
          <span>
            {intl.formatMessage(globalMessages.removeFromBlocklistSuccess, {
              title,
              strong,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      } else {
        await axios.post('/api/v1/music/blocklist', {
          foreignArtistId: artist.foreignArtistId,
          artistName: artist.artistName,
        });
        setBlocklisted(true);
        addToast(
          <span>
            {intl.formatMessage(globalMessages.blocklistSuccess, {
              title,
              strong,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 412) {
        setBlocklisted(true);
        addToast(
          <span>
            {intl.formatMessage(globalMessages.blocklistDuplicateError, {
              title,
              strong,
            })}
          </span>,
          { appearance: 'info', autoDismiss: true }
        );
      } else {
        addToast(intl.formatMessage(globalMessages.blocklistError), {
          appearance: 'error',
          autoDismiss: true,
        });
      }
    } finally {
      setIsUpdating(false);
      refreshMusic();
    }
  };

  return { blocklisted, isUpdating, toggle };
};

export default useArtistBlocklist;
