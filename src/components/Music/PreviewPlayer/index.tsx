import { useToasts } from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import {
  BackwardIcon,
  ForwardIcon,
  PauseIcon,
  PlayIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';
import type {
  MusicPreviewResponse,
  MusicPreviewTrack,
} from '@server/interfaces/api/musicInterfaces';
import axios from 'axios';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Music.PreviewPlayer', {
  noPreview: 'No song previews are available for {artist}.',
  previewFailed: 'Unable to load song previews for {artist}.',
  play: 'Play',
  pause: 'Pause',
  previous: 'Previous Song',
  next: 'Next Song',
  close: 'Stop Preview',
  trackCount: 'Song {current} of {total}',
});

/**
 * A silent clip played straight from the click, before the previews load.
 * Mobile Safari only lets an audio element play after it has been started
 * from a user gesture, and the gesture is gone once the request returns.
 */
const SILENCE =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

interface PreviewQueue {
  artistName: string;
  tracks: MusicPreviewTrack[];
}

interface MusicPreviewContextValue {
  /** The artist whose songs are loaded, if any. */
  artistName?: string;
  /** The artist whose songs are being fetched, if any. */
  loadingArtist?: string;
  isPlaying: boolean;
  /** Plays the artist's top songs, or pauses/resumes if they are loaded. */
  playArtist: (artistName: string) => void;
}

const MusicPreviewContext = createContext<MusicPreviewContextValue | undefined>(
  undefined
);

/** Undefined outside the Music page, where no player is mounted. */
export const useMusicPreview = () => useContext(MusicPreviewContext);

/**
 * Plays 30 second previews of an artist's most popular songs, one after
 * another, with a small player docked at the bottom of the page.
 */
export const MusicPreviewProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const audioRef = useRef<HTMLAudioElement>(null);
  const requestRef = useRef(0);
  const [queue, setQueue] = useState<PreviewQueue>();
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadingArtist, setLoadingArtist] = useState<string>();
  const [progress, setProgress] = useState(0);

  const track = queue?.tracks[index];

  // Events from the silent unlock clip are not about a preview.
  const isPreview = () =>
    !!audioRef.current && !audioRef.current.src.startsWith('data:');

  const stop = useCallback(() => {
    requestRef.current++;
    audioRef.current?.pause();
    setQueue(undefined);
    setLoadingArtist(undefined);
    setIsPlaying(false);
    setProgress(0);
  }, []);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (audio.paused) {
      // Replay the queue from the start once it has finished.
      if (audio.ended && queue && index === queue.tracks.length - 1) {
        setIndex(0);
        audio.currentTime = 0;
      }
      audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, [index, queue]);

  const playArtist = useCallback(
    async (artistName: string) => {
      if (queue?.artistName === artistName) {
        togglePlayback();
        return;
      }

      const audio = audioRef.current;
      const requestId = ++requestRef.current;

      if (audio) {
        audio.src = SILENCE;
        audio.play().catch(() => undefined);
      }

      setIsPlaying(false);
      setLoadingArtist(artistName);

      try {
        const response = await axios.get<MusicPreviewResponse>(
          '/api/v1/music/preview',
          { params: { artist: artistName } }
        );

        if (requestId !== requestRef.current) {
          return;
        }

        if (response.data.tracks.length === 0) {
          setQueue(undefined);
          addToast(
            intl.formatMessage(messages.noPreview, { artist: artistName }),
            { appearance: 'info', autoDismiss: true }
          );
          return;
        }

        setQueue({ artistName, tracks: response.data.tracks });
        setIndex(0);
      } catch {
        if (requestId === requestRef.current) {
          setQueue(undefined);
          addToast(
            intl.formatMessage(messages.previewFailed, { artist: artistName }),
            { appearance: 'error', autoDismiss: true }
          );
        }
      } finally {
        if (requestId === requestRef.current) {
          setLoadingArtist(undefined);
        }
      }
    },
    [addToast, intl, queue, togglePlayback]
  );

  // Start each song as the queue moves along.
  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !track) {
      return;
    }

    audio.src = track.previewUrl;
    setProgress(0);
    audio.play().catch(() => undefined);
  }, [track]);

  const skip = useCallback(
    (step: number) => {
      if (!queue) {
        return;
      }

      const nextIndex = index + step;

      if (nextIndex >= 0 && nextIndex < queue.tracks.length) {
        setIndex(nextIndex);
      } else if (step < 0 && audioRef.current) {
        audioRef.current.currentTime = 0;
      }
    },
    [index, queue]
  );

  const handleEnded = () => {
    if (isPreview() && queue && index < queue.tracks.length - 1) {
      setIndex(index + 1);
    }
  };

  const handleError = () => {
    // A preview that fails to load (expired link, region lock) is skipped.
    if (isPreview() && queue && index < queue.tracks.length - 1) {
      setIndex(index + 1);
    } else if (isPreview()) {
      setIsPlaying(false);
    }
  };

  // Stop playback when leaving the page.
  useEffect(() => {
    const audio = audioRef.current;

    return () => audio?.pause();
  }, []);

  const value = useMemo<MusicPreviewContextValue>(
    () => ({
      artistName: queue?.artistName,
      loadingArtist,
      isPlaying,
      playArtist,
    }),
    [queue?.artistName, loadingArtist, isPlaying, playArtist]
  );

  return (
    <MusicPreviewContext.Provider value={value}>
      {children}
      {/* Room for the player so it does not cover the last row. */}
      {queue && <div className="h-20" />}
      {/* Song previews have no captions to offer. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => isPreview() && setIsPlaying(true)}
        onPause={() => isPreview() && setIsPlaying(false)}
        onEnded={handleEnded}
        onError={handleError}
        onTimeUpdate={(e) => {
          const audio = e.currentTarget;

          if (isPreview() && audio.duration) {
            setProgress(audio.currentTime / audio.duration);
          }
        }}
      />
      {queue && track && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 sm:bottom-4 lg:pl-[17rem]">
          <div className="pointer-events-auto relative w-full max-w-xl overflow-hidden rounded-xl border border-gray-700 bg-gray-800/95 shadow-xl backdrop-blur">
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gray-700">
              <div
                className="h-full bg-indigo-500 transition-[width] duration-300 ease-linear"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <div className="flex items-center gap-3 p-2 pr-3">
              {track.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={track.coverUrl}
                  alt=""
                  className="h-12 w-12 flex-shrink-0 rounded-md object-cover"
                />
              ) : (
                <div className="h-12 w-12 flex-shrink-0 rounded-md bg-gray-700" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">
                  {track.title}
                </div>
                <div className="truncate text-xs text-gray-400">
                  {queue.artistName}
                  {track.albumTitle ? ` · ${track.albumTitle}` : ''}
                </div>
                <div className="text-xs text-gray-500">
                  {intl.formatMessage(messages.trackCount, {
                    current: index + 1,
                    total: queue.tracks.length,
                  })}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1 text-gray-300">
                <button
                  type="button"
                  className="rounded-full p-1.5 transition hover:bg-gray-700 hover:text-white"
                  onClick={() => skip(-1)}
                  aria-label={intl.formatMessage(messages.previous)}
                  title={intl.formatMessage(messages.previous)}
                >
                  <BackwardIcon className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  className="rounded-full bg-white p-2 text-gray-900 transition hover:scale-105"
                  onClick={togglePlayback}
                  aria-label={intl.formatMessage(
                    isPlaying ? messages.pause : messages.play
                  )}
                  title={intl.formatMessage(
                    isPlaying ? messages.pause : messages.play
                  )}
                >
                  {isPlaying ? (
                    <PauseIcon className="h-5 w-5" />
                  ) : (
                    <PlayIcon className="h-5 w-5" />
                  )}
                </button>
                <button
                  type="button"
                  className="rounded-full p-1.5 transition hover:bg-gray-700 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent"
                  onClick={() => skip(1)}
                  disabled={index >= queue.tracks.length - 1}
                  aria-label={intl.formatMessage(messages.next)}
                  title={intl.formatMessage(messages.next)}
                >
                  <ForwardIcon className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  className="ml-1 rounded-full p-1.5 transition hover:bg-gray-700 hover:text-white"
                  onClick={stop}
                  aria-label={intl.formatMessage(messages.close)}
                  title={intl.formatMessage(messages.close)}
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </MusicPreviewContext.Provider>
  );
};
