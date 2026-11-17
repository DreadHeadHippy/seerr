import {
  DeletionMode,
  DeletionRequestStatus,
} from '@server/constants/deletion';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import DeletionRequest from '@server/entity/DeletionRequest';
import Media from '@server/entity/Media';
import type {
  DeletionOptions,
  SerializedDeletionRequest,
} from '@server/interfaces/api/deletionInterfaces';
import {
  approveDeletion,
  deleteMedia,
  deletionModeFor,
  loadOwnership,
  requestDeletion,
} from '@server/lib/deletion';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

const deletionRoutes = Router();

/** Users without their private fields. */
const serialize = (request: DeletionRequest): SerializedDeletionRequest => ({
  ...request,
  requestedBy: request.requestedBy?.filter(),
  modifiedBy: request.modifiedBy?.filter() ?? null,
});

const findMedia = (id: number) =>
  getRepository(Media).findOneOrFail({ where: { id } });

/** What the current user can do about deleting this title. */
deletionRoutes.get<{ mediaId: string }, DeletionOptions>(
  '/media/:mediaId',
  async (req, res, next) => {
    try {
      const user = req.user!;
      const media = await findMedia(Number(req.params.mediaId));
      const pending = await getRepository(DeletionRequest).findOne({
        where: {
          media: { id: media.id },
          requestedBy: { id: user.id },
          status: DeletionRequestStatus.PENDING,
        },
      });

      return res.status(200).json({
        mode: deletionModeFor(user),
        ...(await loadOwnership(user, media)),
        pending: pending ? serialize(pending) : null,
      });
    } catch {
      return next({ status: 404, message: 'Media not found.' });
    }
  }
);

/**
 * Delete their part of a title, or ask for it to be deleted. Deletes right
 * away only in direct mode and when nothing chosen is shared with another
 * requester; otherwise it becomes a request for an admin.
 */
deletionRoutes.post<
  { mediaId: string },
  { result: 'deleted' | 'requested'; request?: SerializedDeletionRequest },
  { seasons?: number[]; reason?: string }
>('/media/:mediaId', async (req, res, next) => {
  const user = req.user!;
  const mode = deletionModeFor(user);

  if (mode === DeletionMode.NONE) {
    return next({
      status: 403,
      message: 'You do not have permission to delete media.',
    });
  }

  try {
    const media = await findMedia(Number(req.params.mediaId));
    const owned = await loadOwnership(user, media);
    const isAdmin = user.hasPermission(Permission.MANAGE_REQUESTS);

    if (!owned.owns && !isAdmin) {
      return next({
        status: 403,
        message: 'You can only delete media you requested.',
      });
    }

    const seasons =
      media.mediaType === MediaType.TV
        ? [...new Set(req.body.seasons ?? [])].filter((n) => n > 0)
        : [];

    if (media.mediaType === MediaType.TV && seasons.length === 0) {
      return next({ status: 400, message: 'Choose the seasons to delete.' });
    }

    const ownedSeasons = new Map(
      owned.seasons.map((s) => [s.seasonNumber, s.shared])
    );

    if (!isAdmin && seasons.some((n) => !ownedSeasons.has(n))) {
      return next({
        status: 403,
        message: 'You can only delete seasons you requested.',
      });
    }

    const shared =
      media.mediaType === MediaType.MOVIE
        ? owned.shared
        : seasons.some((n) => ownedSeasons.get(n));

    if (isAdmin || (mode === DeletionMode.DIRECT && !shared)) {
      await deleteMedia(media, seasons);
      logger.info('Media deleted by its requester', {
        label: 'Deletion',
        userId: user.id,
        mediaId: media.id,
        seasons,
      });
      return res.status(200).json({ result: 'deleted' });
    }

    const request = await requestDeletion(
      user,
      media,
      seasons,
      req.body.reason?.toString().slice(0, 500)
    );
    return res
      .status(201)
      .json({ result: 'requested', request: serialize(request) });
  } catch (e) {
    logger.error('Unable to delete media', {
      label: 'Deletion',
      userId: user.id,
      mediaId: req.params.mediaId,
      errorMessage: e.message,
    });
    return next({ status: 500, message: 'Unable to delete media.' });
  }
});

/** Withdraw their own pending request. */
deletionRoutes.delete<{ id: string }>(
  '/requests/:id',
  async (req, res, next) => {
    const repository = getRepository(DeletionRequest);
    const request = await repository.findOne({
      where: { id: Number(req.params.id) },
    });

    if (!request) {
      return res.status(204).send();
    }

    if (
      request.requestedBy.id !== req.user?.id &&
      !req.user?.hasPermission(Permission.MANAGE_REQUESTS)
    ) {
      return next({ status: 403, message: 'Not your deletion request.' });
    }

    await repository.remove(request);
    return res.status(204).send();
  }
);

/** Deletion requests for admins, pending first. */
deletionRoutes.get<
  Record<string, never>,
  { results: SerializedDeletionRequest[]; pending: number },
  unknown,
  { status?: string }
>(
  '/requests',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res) => {
    const repository = getRepository(DeletionRequest);
    const status =
      req.query.status === 'all' ? undefined : DeletionRequestStatus.PENDING;
    const results = await repository.find({
      where: status ? { status } : {},
      order: { status: 'ASC', createdAt: 'DESC' },
      take: 100,
    });
    const pending = await repository.count({
      where: { status: DeletionRequestStatus.PENDING },
    });

    return res.status(200).json({ results: results.map(serialize), pending });
  }
);

const handle =
  (action: 'approve' | 'decline') =>
  async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    const repository = getRepository(DeletionRequest);
    const request = await repository.findOne({
      where: { id: Number(req.params.id) },
    });

    if (!request) {
      return next({ status: 404, message: 'Deletion request not found.' });
    }

    if (request.status !== DeletionRequestStatus.PENDING) {
      return next({ status: 409, message: 'Already handled.' });
    }

    if (action === 'decline') {
      request.status = DeletionRequestStatus.DECLINED;
      request.modifiedBy = req.user!;
      return res.status(200).json(serialize(await repository.save(request)));
    }

    const result = await approveDeletion(request, req.user!);

    return result.status === DeletionRequestStatus.FAILED
      ? next({
          status: 500,
          message: 'Approved, but deleting it from Radarr/Sonarr failed.',
        })
      : res.status(200).json(serialize(result));
  };

deletionRoutes.post(
  '/requests/:id/approve',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  handle('approve')
);
deletionRoutes.post(
  '/requests/:id/decline',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  handle('decline')
);

export default deletionRoutes;
