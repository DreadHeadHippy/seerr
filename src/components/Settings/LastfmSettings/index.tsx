import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import SensitiveInput from '@app/components/Common/SensitiveInput';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownOnSquareIcon } from '@heroicons/react/24/outline';
import type { LastfmSettings as LastfmSettingsType } from '@server/lib/settings';
import axios from 'axios';
import { Formik } from 'formik';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.Settings.LastfmSettings', {
  lastfmSettings: 'Last.fm',
  lastfmSettingsDescription:
    'Optionally add a Last.fm API key to fill the Music page with Top Artists, genre charts and artists similar to your Lidarr library. You can create a free key at {link}.',
  apiKey: 'API Key',
  toastLastfmSettingsSuccess: 'Last.fm settings saved successfully!',
  toastLastfmSettingsFailure:
    'Something went wrong while saving Last.fm settings. Check the API key.',
});

const LastfmSettings = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { data, error } = useSWR<LastfmSettingsType>('/api/v1/settings/lastfm');

  return (
    <>
      <div className="mb-6 mt-10">
        <h3 className="heading">
          {intl.formatMessage(messages.lastfmSettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.lastfmSettingsDescription, {
            link: (
              <a
                href="https://www.last.fm/api/account/create"
                className="text-white transition duration-300 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                last.fm/api
              </a>
            ),
          })}
        </p>
      </div>
      {!data && !error ? (
        <LoadingSpinner />
      ) : (
        <Formik
          initialValues={{ lastfmApiKey: data?.apiKey ?? '' }}
          enableReinitialize
          onSubmit={async (values) => {
            try {
              await axios.post('/api/v1/settings/lastfm', {
                apiKey: values.lastfmApiKey,
              } as LastfmSettingsType);
              // Discovery availability is part of the public settings.
              mutate('/api/v1/settings/public');
              mutate('/api/v1/settings/lastfm');

              addToast(
                intl.formatMessage(messages.toastLastfmSettingsSuccess),
                { autoDismiss: true, appearance: 'success' }
              );
            } catch {
              addToast(
                intl.formatMessage(messages.toastLastfmSettingsFailure),
                { autoDismiss: true, appearance: 'error' }
              );
            }
          }}
        >
          {({ handleSubmit, isSubmitting }) => (
            <form className="section" onSubmit={handleSubmit}>
              <div className="form-row">
                <label htmlFor="lastfmApiKey" className="text-label">
                  {intl.formatMessage(messages.apiKey)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <SensitiveInput
                      as="field"
                      id="lastfmApiKey"
                      name="lastfmApiKey"
                      autoComplete="off"
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

export default LastfmSettings;
