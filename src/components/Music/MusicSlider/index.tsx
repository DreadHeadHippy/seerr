import AlbumCard from '@app/components/Music/AlbumCard';
import ArtistCard from '@app/components/Music/ArtistCard';
import Slider from '@app/components/Slider';
import type {
  MusicAlbumsResponse,
  MusicSearchResponse,
} from '@server/interfaces/api/musicInterfaces';
import useSWR from 'swr';

interface MusicSliderProps {
  sliderKey: string;
  title: React.ReactNode;
  url: string;
  /** Whether the row shows artists (default) or album releases. */
  kind?: 'artist' | 'album';
  emptyMessage?: React.ReactNode;
  /** Hide the whole row instead of showing an empty message. */
  hideWhenEmpty?: boolean;
  headerExtra?: React.ReactNode;
}

const MusicSlider = ({
  sliderKey,
  title,
  url,
  kind = 'artist',
  emptyMessage,
  hideWhenEmpty,
  headerExtra,
}: MusicSliderProps) => {
  const { data, error } = useSWR<MusicSearchResponse | MusicAlbumsResponse>(
    url,
    { revalidateOnFocus: false }
  );

  const isEmpty = !!data && data.results.length === 0;

  // Hide a row whose source failed rather than showing an error per row.
  if (error || (hideWhenEmpty && isEmpty)) {
    return null;
  }

  const items =
    kind === 'album'
      ? (data as MusicAlbumsResponse | undefined)?.results.map((album) => (
          <AlbumCard
            key={`${sliderKey}-${album.foreignAlbumId}`}
            album={album}
          />
        ))
      : (data as MusicSearchResponse | undefined)?.results.map((artist) => (
          <ArtistCard
            key={`${sliderKey}-${artist.foreignArtistId}`}
            artist={artist}
          />
        ));

  return (
    <>
      <div className="slider-header">
        <div className="slider-title">
          <span>{title}</span>
        </div>
      </div>
      {headerExtra}
      <Slider
        sliderKey={sliderKey}
        isLoading={!data}
        isEmpty={isEmpty}
        emptyMessage={emptyMessage}
        items={items}
      />
    </>
  );
};

export default MusicSlider;
