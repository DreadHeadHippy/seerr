import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import SensitiveInput from '@app/components/Common/SensitiveInput';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownOnSquareIcon } from '@heroicons/react/24/outline';
import type { QbittorrentSettings as QbittorrentSettingsType } from '@server/lib/settings';
import axios from 'axios';
import { Field, Formik } from 'formik';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.Settings.QbittorrentSettings', {
  qbittorrentSettings: 'qBittorrent',
  qbittorrentSettingsDescription:
    'Optional. Radarr, Sonarr and Lidarr only check on downloads about once a minute, so their progress lags. Connect qBittorrent to show requesters live progress and a more accurate "Ready in" time. Use the address Seerr can reach it on, for example http://192.168.1.10:8080. Leave the URL empty to turn this off.',
  url: 'URL',
  username: 'Username',
  password: 'Password',
  toastSuccess: 'qBittorrent settings saved successfully!',
  toastFailure:
    'Could not connect to qBittorrent. Check the URL, username and password.',
});

const QbittorrentSettings = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { data, error } = useSWR<QbittorrentSettingsType>(
    '/api/v1/settings/qbittorrent'
  );

  return (
    <>
      <div className="mb-6 mt-10">
        <h3 className="heading">
          {intl.formatMessage(messages.qbittorrentSettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.qbittorrentSettingsDescription)}
        </p>
      </div>
      {!data && !error ? (
        <LoadingSpinner />
      ) : (
        <Formik
          initialValues={{
            qbitUrl: data?.url ?? '',
            qbitUsername: data?.username ?? '',
            qbitPassword: data?.password ?? '',
          }}
          enableReinitialize
          onSubmit={async (values) => {
            try {
              await axios.post('/api/v1/settings/qbittorrent', {
                url: values.qbitUrl,
                username: values.qbitUsername,
                password: values.qbitPassword,
              } as QbittorrentSettingsType);
              mutate('/api/v1/settings/qbittorrent');

              addToast(intl.formatMessage(messages.toastSuccess), {
                autoDismiss: true,
                appearance: 'success',
              });
            } catch {
              addToast(intl.formatMessage(messages.toastFailure), {
                autoDismiss: true,
                appearance: 'error',
              });
            }
          }}
        >
          {({ handleSubmit, isSubmitting }) => (
            <form className="section" onSubmit={handleSubmit}>
              <div className="form-row">
                <label htmlFor="qbitUrl" className="text-label">
                  {intl.formatMessage(messages.url)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      id="qbitUrl"
                      name="qbitUrl"
                      type="text"
                      inputMode="url"
                      placeholder="http://192.168.1.10:8080"
                      autoComplete="off"
                    />
                  </div>
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="qbitUsername" className="text-label">
                  {intl.formatMessage(messages.username)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      id="qbitUsername"
                      name="qbitUsername"
                      type="text"
                      autoComplete="off"
                    />
                  </div>
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="qbitPassword" className="text-label">
                  {intl.formatMessage(messages.password)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <SensitiveInput
                      as="field"
                      id="qbitPassword"
                      name="qbitPassword"
                      autoComplete="new-password"
                    />
                  </div>
                </div>
              </div>
              <div className="actions">
                <div className="flex justify-end">
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="primary"
                      type="submit"
                      disabled={isSubmitting}
                    >
                      <ArrowDownOnSquareIcon />
                      <span>
                        {isSubmitting
                          ? intl.formatMessage(globalMessages.saving)
                          : intl.formatMessage(globalMessages.save)}
                      </span>
                    </Button>
                  </span>
                </div>
              </div>
            </form>
          )}
        </Formik>
      )}
    </>
  );
};

export default QbittorrentSettings;
