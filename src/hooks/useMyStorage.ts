import { useUser } from '@app/hooks/useUser';
import type { StorageUsage } from '@server/lib/storage';
import useSWR from 'swr';

export type MyStorage = StorageUsage & {
  deletionMode: 'none' | 'request' | 'direct';
};

/** The signed-in user's storage use, limit and deletion mode. */
const useMyStorage = () => {
  const { user } = useUser();

  return useSWR<MyStorage>(user ? `/api/v1/user/${user.id}/storage` : null, {
    refreshInterval: 5 * 60 * 1000,
  });
};

export default useMyStorage;
