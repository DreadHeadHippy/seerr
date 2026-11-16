import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import ArtistCard from '@app/components/Music/ArtistCard';
import useDebouncedState from '@app/hooks/useDebouncedState';
import useSettings from '@app/hooks/useSettings';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { MagnifyingGlassIcon } from '@heroicons/react/24/solid';
import type { MusicSearchResponse } from '@server/interfaces/api/musicInterfaces';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Music', {
  music: 'Music',
  searchPlaceholder: 'Search Artists',
  searchHint:
    'Search for an artist to add them to Lidarr. Lidarr will download the monitored albums and import them into your library.',
  notConfigured:
    'No Lidarr server is configured. An administrator can add one under Settings → Services.',
});

const Music = () => {
  const intl = useIntl();
  const router = useRouter();
  const { currentSettings } = useSettings();
  const initialQuery =
    typeof router.query.query === 'string' ? router.query.query : '';
  const [searchValue, debouncedValue, setSearchValue] =
    useDebouncedState(initialQuery);

  useEffect(() => {
    if (router.isReady && initialQuery && !searchValue) {
      setSearchValue(initialQuery);
    }
    // Only sync once the router has the query from the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  useEffect(() => {
    const query = debouncedValue.trim();

    if ((router.query.query ?? '') !== query) {
      router.replace(
        { pathname: router.pathname, query: query ? { query } : {} },
        undefined,
        { shallow: true }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedValue]);

  const query = debouncedValue.trim();
  const { data, error, isLoading } = useSWR<MusicSearchResponse>(
    currentSettings.musicEnabled && query
      ? `/api/v1/music/search?query=${encodeURIComponent(query)}`
      : null,
    { revalidateOnFocus: false }
  );

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.music)} />
      <div className="mb-5 mt-1">
        <Header>{intl.formatMessage(messages.music)}</Header>
      </div>
      {!currentSettings.musicEnabled ? (
        <div className="mt-16 w-full text-center text-xl text-gray-400">
          {intl.formatMessage(messages.notConfigured)}
        </div>
      ) : (
        <>
          <div className="mb-6 flex w-full max-w-xl">
            <div className="relative w-full text-white focus-within:text-gray-200">
              <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center">
                <MagnifyingGlassIcon className="h-5 w-5" />
              </div>
              <input
                id="music_search_field"
                className="block w-full rounded-full border border-gray-600 bg-gray-900/80 py-2 pl-11 text-white placeholder-gray-300 hover:border-gray-500 focus:border-gray-500 focus:bg-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-0 sm:text-base"
                placeholder={intl.formatMessage(messages.searchPlaceholder)}
                type="search"
                autoComplete="off"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
              />
            </div>
          </div>
          {!query && (
            <div className="mt-16 w-full text-center text-xl text-gray-400">
              {intl.formatMessage(messages.searchHint)}
            </div>
          )}
          {query && isLoading && <LoadingSpinner />}
          {query && data && data.results.length === 0 && (
            <div className="mt-16 w-full text-center text-2xl text-gray-400">
              {intl.formatMessage(globalMessages.noresults)}
            </div>
          )}
          {query && data && data.results.length > 0 && (
            <ul className="cards-vertical">
              {data.results.map((artist) => (
                <li key={`artist-${artist.foreignArtistId}`}>
                  <ArtistCard artist={artist} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
};

export default Music;
