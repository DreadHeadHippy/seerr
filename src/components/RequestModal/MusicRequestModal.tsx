import Alert from '@app/components/Common/Alert';
import Modal from '@app/components/Common/Modal';
import useToasts from '@app/hooks/useToasts';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import type {
  LidarrMonitorNewItemsOption,
  LidarrMonitorOption,
} from '@server/api/servarr/lidarr';
import type {
  MusicAlbumAddBody,
  MusicAlbumResult,
  MusicArtistAddBody,
  MusicArtistResult,
} from '@server/interfaces/api/musicInterfaces';
import type {
  ServiceCommonServer,
  ServiceCommonServerWithDetails,
} from '@server/interfaces/api/serviceInterfaces';
import { Permission } from '@server/lib/permissions';
import axios, { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.RequestModal.MusicRequestModal', {
  requestartisttitle: 'Request Artist',
  requestalbumtitle: 'Request Album',
  albumsubtitle: '{title} by {artist}',
  requestalbuminfo:
    "This album will be monitored and searched for in Lidarr. If {artist} isn't in Lidarr yet, they'll be added with only this album monitored.",
  requestalbumerror:
    'Something went wrong while requesting the album in Lidarr.',
  requestSuccess: '<strong>{title}</strong> added to Lidarr!',
  requesterror: 'Something went wrong while adding the artist to Lidarr.',
  requestinfo:
    'This artist will be added to Lidarr, which will search for and download the monitored albums.',
  monitor: 'Monitor',
  monitorNewItems: 'Monitor New Albums',
  monitorAll: 'All Albums',
  monitorFuture: 'Future Albums',
  monitorMissing: 'Missing Albums',
  monitorExisting: 'Existing Albums',
  monitorLatest: 'Latest Album',
  monitorFirst: 'First Album',
  monitorNone: 'None',
  monitorNewAll: 'All New Albums',
  monitorNewNew: 'New Albums Only',
  monitorNewNone: 'None',
  advancedoptions: 'Advanced',
  destinationserver: 'Destination Server',
  qualityprofile: 'Quality Profile',
  metadataprofile: 'Metadata Profile',
  rootfolder: 'Root Folder',
  default: '{name} (Default)',
});

type MusicRequestModalProps = {
  show: boolean;
  onCancel?: () => void;
} & (
  | {
      artist: MusicArtistResult;
      album?: never;
      onComplete?: (artist: MusicArtistResult) => void;
    }
  | {
      album: MusicAlbumResult;
      artist?: never;
      onComplete?: (album: Partial<MusicAlbumResult>) => void;
    }
);

/** Requests an artist (with monitor options) or a single album from Lidarr. */
const MusicRequestModal = (props: MusicRequestModalProps) => {
  const { show, artist, album, onCancel } = props;
  const intl = useIntl();
  const { addToast } = useToasts();
  const { hasPermission } = useUser();
  const [isUpdating, setIsUpdating] = useState(false);
  const [monitor, setMonitor] = useState<LidarrMonitorOption>('all');
  const [monitorNewItems, setMonitorNewItems] =
    useState<LidarrMonitorNewItemsOption>('all');
  const [selectedServer, setSelectedServer] = useState<number | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<number | null>(null);
  const [selectedMetadataProfile, setSelectedMetadataProfile] = useState<
    number | null
  >(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  const canOverride = hasPermission(
    [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
    { type: 'or' }
  );

  const { data: servers } = useSWR<ServiceCommonServer[]>(
    show && canOverride ? '/api/v1/service/lidarr' : null
  );
  const { data: serverData, isValidating } =
    useSWR<ServiceCommonServerWithDetails>(
      show && canOverride && selectedServer !== null
        ? `/api/v1/service/lidarr/${selectedServer}`
        : null
    );

  useEffect(() => {
    if (servers && selectedServer === null && servers.length > 0) {
      const defaultServer =
        servers.find((server) => server.isDefault) ?? servers[0];
      setSelectedServer(defaultServer.id);
    }
  }, [servers, selectedServer]);

  useEffect(() => {
    if (serverData) {
      setSelectedProfile(serverData.server.activeProfileId);
      setSelectedMetadataProfile(
        serverData.server.activeMetadataProfileId ?? null
      );
      setSelectedFolder(serverData.server.activeDirectory);
    }
  }, [serverData]);

  const sendRequest = async () => {
    setIsUpdating(true);

    const overrides =
      canOverride && selectedServer !== null
        ? {
            serverId: selectedServer,
            profileId: selectedProfile ?? undefined,
            metadataProfileId: selectedMetadataProfile ?? undefined,
            rootFolder: selectedFolder ?? undefined,
          }
        : {};

    try {
      if (props.album) {
        const response = await axios.post<Partial<MusicAlbumResult>>(
          '/api/v1/music/album',
          {
            foreignAlbumId: props.album.foreignAlbumId,
            ...overrides,
          } as MusicAlbumAddBody
        );

        props.onComplete?.(response.data);
      } else {
        const response = await axios.post<MusicArtistResult>(
          '/api/v1/music/artist',
          {
            foreignArtistId: props.artist.foreignArtistId,
            monitor,
            monitorNewItems,
            ...overrides,
          } as MusicArtistAddBody
        );

        props.onComplete?.(response.data);
      }

      addToast(
        <span>
          {intl.formatMessage(messages.requestSuccess, {
            title: album ? album.title : artist?.artistName,
            strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
          })}
        </span>,
        { appearance: 'success', autoDismiss: true }
      );
    } catch (e) {
      const serverMessage =
        album && isAxiosError(e) ? e.response?.data?.message : undefined;

      addToast(
        serverMessage ??
          intl.formatMessage(
            album ? messages.requestalbumerror : messages.requesterror
          ),
        { appearance: 'error', autoDismiss: true }
      );
    } finally {
      setIsUpdating(false);
    }
  };

  const monitorOptions: { value: LidarrMonitorOption; label: string }[] = [
    { value: 'all', label: intl.formatMessage(messages.monitorAll) },
    { value: 'future', label: intl.formatMessage(messages.monitorFuture) },
    { value: 'missing', label: intl.formatMessage(messages.monitorMissing) },
    { value: 'existing', label: intl.formatMessage(messages.monitorExisting) },
    { value: 'latest', label: intl.formatMessage(messages.monitorLatest) },
    { value: 'first', label: intl.formatMessage(messages.monitorFirst) },
    { value: 'none', label: intl.formatMessage(messages.monitorNone) },
  ];

  const monitorNewItemsOptions: {
    value: LidarrMonitorNewItemsOption;
    label: string;
  }[] = [
    { value: 'all', label: intl.formatMessage(messages.monitorNewAll) },
    { value: 'new', label: intl.formatMessage(messages.monitorNewNew) },
    { value: 'none', label: intl.formatMessage(messages.monitorNewNone) },
  ];

  const sortByName = <T extends { name: string }>(items: T[]) =>
    items.toSorted((a, b) =>
      a.name.localeCompare(b.name, intl.locale, {
        numeric: true,
        sensitivity: 'base',
      })
    );

  return (
    <Transition
      as="div"
      enter="transition-opacity duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
      show={show}
    >
      <Modal
        backgroundClickable
        onCancel={onCancel}
        onOk={sendRequest}
        okDisabled={isUpdating}
        title={intl.formatMessage(
          album ? messages.requestalbumtitle : messages.requestartisttitle
        )}
        subTitle={
          album
            ? intl.formatMessage(messages.albumsubtitle, {
                title: album.title,
                artist: album.artistName,
              })
            : artist?.artistName
        }
        okText={
          isUpdating
            ? intl.formatMessage(globalMessages.requesting)
            : intl.formatMessage(globalMessages.request)
        }
        okButtonType="primary"
        backdrop={album ? album.coverUrl : artist?.fanartUrl}
      >
        <div className="mt-6">
          <Alert
            title={
              album
                ? intl.formatMessage(messages.requestalbuminfo, {
                    artist: album.artistName,
                  })
                : intl.formatMessage(messages.requestinfo)
            }
            type="info"
          />
        </div>
        <div className={album ? 'hidden' : 'flex flex-col md:flex-row'}>
          <div className="mb-3 w-full flex-shrink-0 flex-grow last:pr-0 md:w-1/2 md:pr-4">
            <label htmlFor="monitor">
              {intl.formatMessage(messages.monitor)}
            </label>
            <select
              id="monitor"
              name="monitor"
              value={monitor}
              onChange={(e) =>
                setMonitor(e.target.value as LidarrMonitorOption)
              }
              className="border-gray-700 bg-gray-800"
            >
              {monitorOptions.map((option) => (
                <option key={`monitor-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-3 w-full flex-shrink-0 flex-grow last:pr-0 md:w-1/2 md:pr-4">
            <label htmlFor="monitorNewItems">
              {intl.formatMessage(messages.monitorNewItems)}
            </label>
            <select
              id="monitorNewItems"
              name="monitorNewItems"
              value={monitorNewItems}
              onChange={(e) =>
                setMonitorNewItems(
                  e.target.value as LidarrMonitorNewItemsOption
                )
              }
              className="border-gray-700 bg-gray-800"
            >
              {monitorNewItemsOptions.map((option) => (
                <option key={`monitornew-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {canOverride && servers && servers.length > 0 && (
          <>
            <div className="mb-2 mt-4 flex items-center text-lg font-semibold">
              {intl.formatMessage(messages.advancedoptions)}
            </div>
            <div className="flex flex-col md:flex-row md:flex-wrap">
              {servers.length > 1 && (
                <div className="mb-3 w-full flex-shrink-0 flex-grow last:pr-0 md:w-1/4 md:pr-4">
                  <label htmlFor="server">
                    {intl.formatMessage(messages.destinationserver)}
                  </label>
                  <select
                    id="server"
                    name="server"
                    value={selectedServer ?? ''}
                    onChange={(e) => setSelectedServer(Number(e.target.value))}
                    className="border-gray-700 bg-gray-800"
                  >
                    {servers.map((server) => (
                      <option
                        key={`server-list-${server.id}`}
                        value={server.id}
                      >
                        {server.isDefault
                          ? intl.formatMessage(messages.default, {
                              name: server.name,
                            })
                          : server.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="mb-3 w-full flex-shrink-0 flex-grow last:pr-0 md:w-1/4 md:pr-4">
                <label htmlFor="profile">
                  {intl.formatMessage(messages.qualityprofile)}
                </label>
                <select
                  id="profile"
                  name="profile"
                  value={selectedProfile ?? ''}
                  onChange={(e) => setSelectedProfile(Number(e.target.value))}
                  className="border-gray-700 bg-gray-800"
                  disabled={isValidating || !serverData}
                >
                  {(isValidating || !serverData) && (
                    <option value="">
                      {intl.formatMessage(globalMessages.loading)}
                    </option>
                  )}
                  {!isValidating &&
                    serverData &&
                    sortByName(serverData.profiles).map((profile) => (
                      <option
                        key={`profile-list-${profile.id}`}
                        value={profile.id}
                      >
                        {serverData.server.activeProfileId === profile.id
                          ? intl.formatMessage(messages.default, {
                              name: profile.name,
                            })
                          : profile.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="mb-3 w-full flex-shrink-0 flex-grow last:pr-0 md:w-1/4 md:pr-4">
                <label htmlFor="metadataProfile">
                  {intl.formatMessage(messages.metadataprofile)}
                </label>
                <select
                  id="metadataProfile"
                  name="metadataProfile"
                  value={selectedMetadataProfile ?? ''}
                  onChange={(e) =>
                    setSelectedMetadataProfile(Number(e.target.value))
                  }
                  className="border-gray-700 bg-gray-800"
                  disabled={isValidating || !serverData}
                >
                  {(isValidating || !serverData) && (
                    <option value="">
                      {intl.formatMessage(globalMessages.loading)}
                    </option>
                  )}
                  {!isValidating &&
                    serverData &&
                    sortByName(serverData.metadataProfiles ?? []).map(
                      (profile) => (
                        <option
                          key={`metadata-profile-list-${profile.id}`}
                          value={profile.id}
                        >
                          {serverData.server.activeMetadataProfileId ===
                          profile.id
                            ? intl.formatMessage(messages.default, {
                                name: profile.name,
                              })
                            : profile.name}
                        </option>
                      )
                    )}
                </select>
              </div>
              <div className="mb-3 w-full flex-shrink-0 flex-grow last:pr-0 md:w-1/4 md:pr-4">
                <label htmlFor="folder">
                  {intl.formatMessage(messages.rootfolder)}
                </label>
                <select
                  id="folder"
                  name="folder"
                  value={selectedFolder ?? ''}
                  onChange={(e) => setSelectedFolder(e.target.value)}
                  className="border-gray-700 bg-gray-800"
                  disabled={isValidating || !serverData}
                >
                  {(isValidating || !serverData) && (
                    <option value="">
                      {intl.formatMessage(globalMessages.loading)}
                    </option>
                  )}
                  {!isValidating &&
                    serverData &&
                    serverData.rootFolders.map((folder) => (
                      <option
                        key={`folder-list-${folder.id}`}
                        value={folder.path}
                      >
                        {serverData.server.activeDirectory === folder.path
                          ? intl.formatMessage(messages.default, {
                              name: folder.path,
                            })
                          : folder.path}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </>
        )}
      </Modal>
    </Transition>
  );
};

export default MusicRequestModal;
