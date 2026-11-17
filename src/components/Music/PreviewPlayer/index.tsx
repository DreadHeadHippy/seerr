import MusicRequestModal from '@app/components/RequestModal/MusicRequestModal';
import { encodeURIExtraParams } from '@app/hooks/useDiscover';
import { useToasts } from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import {
  BackwardIcon,
  CheckCircleIcon,
  ForwardIcon,
  PauseIcon,
  PlayIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';
import type {
  MusicArtistResult,
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
  volume: 'Volume',
  mute: 'Mute',
  unmute: 'Unmute',
  requestArtist: 'Request {artist}',
  inLidarr: '{artist} is in Lidarr',
});

const VOLUME_KEY = 'music-preview-volume';

/** The volume the viewer last chose, kept between visits. */
const loadVolume = (): number => {
  try {
    const saved = Number(localStorage.getItem(VOLUME_KEY));

    if (Number.isFinite(saved) && saved > 0 && saved <= 1) {
      return saved;
    }
  } catch {
    // Storage can be blocked (private windows); fall back to the default.
  }

  return 0.8;
};

/**
 * A silent clip played straight from the click, before the previews load.
 * Mobile Safari only lets an audio element play after it has been started
 * from a user gesture, and the gesture is gone once the request returns.
 */
const SILENCE =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

interface PreviewQueue {
  artist: MusicArtistResult;
  tracks: MusicPreviewTrack[];
}

interface MusicPreviewContextValue {
  /** The artist whose songs are loaded, if any. */
  artistName?: string;
  /** The artist whose songs are being fetched, if any. */
  loadingArtist?: string;
  isPlaying: boolean;
  /** Plays the artist's top songs, or pauses/resumes if they are loaded. */
  playArtist: (artist: MusicArtistResult) => void;
  /**
   * Artists added to Lidarr on this page, by foreignArtistId, so the player
   * and every card showing the artist agree after a request from either.
   */
  addedArtists: Record<string, MusicArtistResult>;
  markAdded: (artist: MusicArtistResult) => void;
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
  const { hasPermission } = useUser();
  const audioRef = useRef<HTMLAudioElement>(null);
  const requestRef = useRef(0);
  const [queue, setQueue] = useState<PreviewQueue>();
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadingArtist, setLoadingArtist] = useState<string>();
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [addedArtists, setAddedArtists] = useState<
    Record<string, MusicArtistResult>
  >({});
  const [showRequestModal, setShowRequestModal] = useState(false);

  const markAdded = useCallback((artist: MusicArtistResult) => {
    setAddedArtists((current) => ({
      ...current,
      [artist.foreignArtistId]: artist,
    }));
  }, []);

  const canRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_MUSIC],
    { type: 'or' }
  );

  // Read after mount so server and client render the same markup.
  useEffect(() => {
    setVolume(loadVolume());
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = isMuted;
    }
  }, [volume, isMuted]);

  const changeVolume = (value: number) => {
    setVolume(value);
    setIsMuted(value === 0);

    if (value > 0) {
      try {
        localStorage.setItem(VOLUME_KEY, String(value));
      } catch {
        // Not saved; the slider still works for this visit.
      }
    }
  };

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
    async (artist: MusicArtistResult) => {
      const { artistName } = artist;

      if (queue?.artist.artistName === artistName) {
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
        // The API validator rejects reserved characters in query values,
        // including the "+" axios uses for spaces and the ' ( ) ! * that
        // encodeURIComponent leaves alone (Guns N' Roses, Panic! at the Disco).
        const response = await axios.get<MusicPreviewResponse>(
          `/api/v1/music/preview?artist=${encodeURIExtraParams(artistName)}`
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

        setQueue({ artist, tracks: response.data.tracks });
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
      artistName: queue?.artist.artistName,
      loadingArtist,
      isPlaying,
      playArtist,
      addedArtists,
      markAdded,
    }),
    [
      queue?.artist.artistName,
      loadingArtist,
      isPlaying,
      playArtist,
      addedArtists,
      markAdded,
    ]
  );

  // The playing artist as it is now, if it was added since playback began.
  const artist = queue
    ? (addedArtists[queue.artist.foreignArtistId] ?? queue.artist)
    : undefined;

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
      {artist && (
        <MusicRequestModal
          show={showRequestModal}
          artist={artist}
          onComplete={(added) => {
            markAdded({ ...artist, ...added, inLidarr: true });
            setShowRequestModal(false);
          }}
          onCancel={() => setShowRequestModal(false)}
        />
      )}
      {queue && artist && track && (
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
                  {artist.artistName}
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
                {!artist.inLidarr && canRequest && (
                  <button
                    type="button"
                    className="mr-1 flex items-center gap-1 rounded-full bg-indigo-600 p-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 sm:px-3"
                    onClick={() => setShowRequestModal(true)}
                    aria-label={intl.formatMessage(messages.requestArtist, {
                      artist: artist.artistName,
                    })}
                    title={intl.formatMessage(messages.requestArtist, {
                      artist: artist.artistName,
                    })}
                  >
                    <ArrowDownTrayIcon className="h-5 w-5 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">
                      {intl.formatMessage(globalMessages.request)}
                    </span>
                  </button>
                )}
                {artist.inLidarr && (
                  <span
                    className="mr-1 p-1.5 text-green-400"
                    role="img"
                    aria-label={intl.formatMessage(messages.inLidarr, {
                      artist: artist.artistName,
                    })}
                    title={intl.formatMessage(messages.inLidarr, {
                      artist: artist.artistName,
                    })}
                  >
                    <CheckCircleIcon className="h-5 w-5" />
                  </span>
                )}
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
                {/* Phones (iOS ignores volume changes) use their own buttons. */}
                <div className="ml-1 hidden items-center gap-1 sm:flex">
                  <button
                    type="button"
                    className="rounded-full p-1.5 transition hover:bg-gray-700 hover:text-white"
                    onClick={() =>
                      volume === 0
                        ? changeVolume(loadVolume())
                        : setIsMuted(!isMuted)
                    }
                    aria-label={intl.formatMessage(
                      isMuted || volume === 0 ? messages.unmute : messages.mute
                    )}
                    title={intl.formatMessage(
                      isMuted || volume === 0 ? messages.unmute : messages.mute
                    )}
                  >
                    {isMuted || volume === 0 ? (
                      <SpeakerXMarkIcon className="h-5 w-5" />
                    ) : (
                      <SpeakerWaveIcon className="h-5 w-5" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => changeVolume(Number(e.target.value))}
                    aria-label={intl.formatMessage(messages.volume)}
                    title={intl.formatMessage(messages.volume)}
                    className="h-1 w-20 cursor-pointer accent-indigo-500"
                  />
                </div>
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
