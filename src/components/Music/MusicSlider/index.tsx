import ArtistCard from '@app/components/Music/ArtistCard';
import Slider from '@app/components/Slider';
import type { MusicSearchResponse } from '@server/interfaces/api/musicInterfaces';
import useSWR from 'swr';

interface MusicSliderProps {
  sliderKey: string;
  title: React.ReactNode;
  url: string;
  emptyMessage?: React.ReactNode;
  headerExtra?: React.ReactNode;
}

const MusicSlider = ({
  sliderKey,
  title,
  url,
  emptyMessage,
  headerExtra,
}: MusicSliderProps) => {
  const { data, error } = useSWR<MusicSearchResponse>(url, {
    revalidateOnFocus: false,
  });

  // Hide a slider whose source failed rather than showing an error per row.
  if (error) {
    return null;
  }

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
        isEmpty={!!data && data.results.length === 0}
        emptyMessage={emptyMessage}
        items={data?.results.map((artist) => (
          <ArtistCard
            key={`${sliderKey}-${artist.foreignArtistId}`}
            artist={artist}
          />
        ))}
      />
    </>
  );
};

export default MusicSlider;
