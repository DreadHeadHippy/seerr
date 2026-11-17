import useDebouncedState from '@app/hooks/useDebouncedState';
import defineMessages from '@app/utils/defineMessages';
import { XCircleIcon } from '@heroicons/react/24/outline';
import { MagnifyingGlassIcon } from '@heroicons/react/24/solid';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Layout.SearchInput', {
  searchArtistsPlaceholder: 'Search Artists',
});

const queryFromRouter = (query: string | string[] | undefined) =>
  typeof query === 'string' ? query : '';

/**
 * The top bar search on the Music page. It searches artists in place (the
 * Music page reads `?query=`) instead of going to the movie and series
 * search, so the Music page needs no search box of its own.
 */
const MusicSearchInput = () => {
  const intl = useIntl();
  const router = useRouter();
  const [searchValue, debouncedValue, setSearchValue] = useDebouncedState(
    queryFromRouter(router.query.query)
  );

  // Follow the URL when it changes elsewhere (back button, a link).
  useEffect(() => {
    const fromUrl = queryFromRouter(router.query.query);

    if (fromUrl !== debouncedValue.trim()) {
      setSearchValue(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query.query]);

  useEffect(() => {
    const query = debouncedValue.trim();

    if (queryFromRouter(router.query.query) !== query) {
      router.replace(
        { pathname: router.pathname, query: query ? { query } : {} },
        undefined,
        { shallow: true }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedValue]);

  return (
    <div className="flex flex-1">
      <div className="flex w-full">
        <label htmlFor="search_field" className="sr-only">
          Search
        </label>
        <div className="relative flex w-full items-center text-white focus-within:text-gray-200">
          <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center">
            <MagnifyingGlassIcon className="h-5 w-5" />
          </div>
          <input
            id="search_field"
            style={{ paddingRight: searchValue.length > 0 ? '1.75rem' : '' }}
            className="block w-full rounded-full border border-gray-600 bg-gray-900/80 py-2 pl-10 text-white placeholder-gray-300 hover:border-gray-500 focus:border-gray-500 focus:bg-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-0 sm:text-base"
            placeholder={intl.formatMessage(messages.searchArtistsPlaceholder)}
            type="search"
            autoComplete="off"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyUp={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {searchValue.length > 0 && (
            <button
              className="absolute inset-y-0 right-2 m-auto h-7 w-7 border-none p-1 text-gray-400 outline-none transition hover:text-white focus:border-none focus:outline-none"
              onClick={() => setSearchValue('')}
            >
              <XCircleIcon className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MusicSearchInput;
