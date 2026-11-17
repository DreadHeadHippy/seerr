import Alert from '@app/components/Common/Alert';
import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import ArtistCard from '@app/components/Music/ArtistCard';
import MusicSlider from '@app/components/Music/MusicSlider';
import { MusicPreviewProvider } from '@app/components/Music/PreviewPlayer';
import useDebouncedState from '@app/hooks/useDebouncedState';
import { encodeURIExtraParams } from '@app/hooks/useDiscover';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { MagnifyingGlassIcon } from '@heroicons/react/24/solid';
import type {
  MusicPersonalResponse,
  MusicSearchResponse,
} from '@server/interfaces/api/musicInterfaces';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Music', {
  music: 'Music',
  searchPlaceholder: 'Search Artists',
  searchresults: 'Search Results',
  notConfigured:
    'No Lidarr server is configured. An administrator can add one under Settings → Services.',
  recentlyAdded: 'Recently Added',
  recentlyAddedEmpty: 'No artists have been added to Lidarr yet.',
  recommendedForYou: 'Recommended for You',
  newFromYourArtists: 'New from Your Artists',
  newThisWeek: 'New This Week',
  becauseYouLike: 'Because You Like {artist}',
  moreGenre: 'More {genre}',
  similarToLibraryEmpty:
    'Add a few artists to Lidarr to get recommendations based on your library.',
  topArtists: 'Top Artists',
  topArtistsByGenre: 'Top Artists by Genre',
  lastfmNotConfigured:
    'Add a Last.fm API key under Settings → Services to see Top Artists, genre charts and artists similar to your library.',
  genreRock: 'Rock',
  genrePop: 'Pop',
  genreHipHop: 'Hip-Hop',
  genreElectronic: 'Electronic',
  genreRnb: 'R&B',
  genreCountry: 'Country',
  genreIndie: 'Indie',
  genreMetal: 'Metal',
  genreAlternative: 'Alternative',
  genreJazz: 'Jazz',
  genreFolk: 'Folk',
  genrePunk: 'Punk',
  genreSoul: 'Soul',
  genreBlues: 'Blues',
  genreClassical: 'Classical',
  genreReggae: 'Reggae',
  genreLatin: 'Latin',
  genreKpop: 'K-Pop',
});

// Keys are Last.fm tags; values are the message used for the label.
const GENRES: { tag: string; message: keyof typeof messages }[] = [
  { tag: 'rock', message: 'genreRock' },
  { tag: 'pop', message: 'genrePop' },
  { tag: 'hip-hop', message: 'genreHipHop' },
  { tag: 'electronic', message: 'genreElectronic' },
  { tag: 'rnb', message: 'genreRnb' },
  { tag: 'country', message: 'genreCountry' },
  { tag: 'indie', message: 'genreIndie' },
  { tag: 'metal', message: 'genreMetal' },
  { tag: 'alternative', message: 'genreAlternative' },
  { tag: 'jazz', message: 'genreJazz' },
  { tag: 'folk', message: 'genreFolk' },
  { tag: 'punk', message: 'genrePunk' },
  { tag: 'soul', message: 'genreSoul' },
  { tag: 'blues', message: 'genreBlues' },
  { tag: 'classical', message: 'genreClassical' },
  { tag: 'reggae', message: 'genreReggae' },
  { tag: 'latin', message: 'genreLatin' },
  { tag: 'k-pop', message: 'genreKpop' },
];

const Music = () => {
  const intl = useIntl();
  const router = useRouter();
  const { currentSettings } = useSettings();
  const { hasPermission } = useUser();
  const [genre, setGenre] = useState(GENRES[0].tag);
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
      ? `/api/v1/music/search?query=${encodeURIExtraParams(query)}`
      : null,
    { revalidateOnFocus: false }
  );

  const { data: personal } = useSWR<MusicPersonalResponse>(
    currentSettings.musicDiscoveryEnabled && !query
      ? '/api/v1/music/discover/personal'
      : null,
    { revalidateOnFocus: false }
  );

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  const recentlyAddedRow = (
    <MusicSlider
      sliderKey="music-recent"
      title={intl.formatMessage(messages.recentlyAdded)}
      url="/api/v1/music/discover/recent"
      emptyMessage={intl.formatMessage(messages.recentlyAddedEmpty)}
    />
  );

  // "Because You Like {artist}" rows, seeded from the library (rotates daily).
  const becauseRow = (index: number) => {
    const seed = personal?.seeds[index];

    return seed ? (
      <MusicSlider
        key={`music-because-${seed.foreignArtistId}`}
        sliderKey={`music-because-${seed.foreignArtistId}`}
        title={intl.formatMessage(messages.becauseYouLike, {
          artist: seed.artistName,
        })}
        url={`/api/v1/music/discover/similar/${seed.foreignArtistId}`}
        hideWhenEmpty
      />
    ) : null;
  };

  // "More {genre}" rows for the library's most common genres.
  const genreRow = (index: number) => {
    const libraryGenre = personal?.genres[index];

    return libraryGenre ? (
      <MusicSlider
        key={`music-more-${libraryGenre}`}
        sliderKey={`music-more-${libraryGenre}`}
        title={intl.formatMessage(messages.moreGenre, {
          genre: libraryGenre,
        })}
        url={`/api/v1/music/discover/genre/${encodeURIComponent(
          libraryGenre.toLowerCase()
        )}`}
        hideWhenEmpty
      />
    ) : null;
  };

  return (
    <MusicPreviewProvider>
      <PageTitle title={intl.formatMessage(messages.music)} />
      <div className="mb-5 mt-1">
        <Header>
          {intl.formatMessage(query ? messages.searchresults : messages.music)}
        </Header>
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
          {query ? (
            <>
              {isLoading && <LoadingSpinner />}
              {data && data.results.length === 0 && (
                <div className="mt-16 w-full text-center text-2xl text-gray-400">
                  {intl.formatMessage(globalMessages.noresults)}
                </div>
              )}
              {data && data.results.length > 0 && (
                <ul className="cards-vertical">
                  {data.results.map((artist) => (
                    <li key={`artist-${artist.foreignArtistId}`}>
                      <ArtistCard artist={artist} canExpand />
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <MusicSlider
                sliderKey="music-new-library"
                kind="album"
                title={intl.formatMessage(messages.newFromYourArtists)}
                url="/api/v1/music/discover/new-from-library"
                hideWhenEmpty
              />
              {currentSettings.musicDiscoveryEnabled ? (
                <>
                  <MusicSlider
                    sliderKey="music-similar"
                    title={intl.formatMessage(messages.recommendedForYou)}
                    url="/api/v1/music/discover/similar"
                    emptyMessage={intl.formatMessage(
                      messages.similarToLibraryEmpty
                    )}
                  />
                  <MusicSlider
                    sliderKey="music-new-week"
                    kind="album"
                    title={intl.formatMessage(messages.newThisWeek)}
                    url="/api/v1/music/discover/new-this-week"
                    hideWhenEmpty
                  />
                  {becauseRow(0)}
                  {recentlyAddedRow}
                  {becauseRow(1)}
                  {genreRow(0)}
                  {becauseRow(2)}
                  <MusicSlider
                    sliderKey="music-top"
                    title={intl.formatMessage(messages.topArtists)}
                    url="/api/v1/music/discover/top"
                  />
                  {genreRow(1)}
                  {becauseRow(3)}
                  <MusicSlider
                    sliderKey={`music-genre-${genre}`}
                    title={intl.formatMessage(messages.topArtistsByGenre)}
                    url={`/api/v1/music/discover/genre/${encodeURIComponent(
                      genre
                    )}`}
                    headerExtra={
                      <div className="mb-4 flex flex-wrap gap-2">
                        {GENRES.map((g) => (
                          <button
                            key={`genre-${g.tag}`}
                            type="button"
                            onClick={() => setGenre(g.tag)}
                            className={`rounded-full border px-3 py-1 text-sm font-medium transition duration-150 ${
                              genre === g.tag
                                ? 'border-indigo-500 bg-indigo-600 text-white'
                                : 'border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-500 hover:bg-gray-700'
                            }`}
                          >
                            {intl.formatMessage(messages[g.message])}
                          </button>
                        ))}
                      </div>
                    }
                  />
                </>
              ) : (
                <>
                  {recentlyAddedRow}
                  {hasPermission(Permission.ADMIN) && (
                    <div className="mt-6">
                      <Alert
                        title={intl.formatMessage(messages.lastfmNotConfigured)}
                        type="info"
                      />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </MusicPreviewProvider>
  );
};

export default Music;
