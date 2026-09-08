import { useInkUI } from '@app/components/providers/InkUIProvider';
import {
  CURRENT_BUILD_ID,
  fetchLatestBuildId,
  isNewBuildAvailable,
  reloadIntoLatestVersion,
} from '@app/lib/appVersion';
import { useEffect, useRef } from 'react';

const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function AppVersionNotifier() {
  const { dismissToast, pushToast } = useInkUI();
  const checkInFlightRef = useRef(false);
  const promptedBuildIdRef = useRef<string | null>(null);
  const promptToastIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD) {
      return;
    }

    let active = true;

    const checkForUpdate = async () => {
      if (document.visibilityState === 'hidden' || checkInFlightRef.current) {
        return;
      }

      checkInFlightRef.current = true;
      try {
        const latestBuildId = await fetchLatestBuildId();
        if (
          !active ||
          !isNewBuildAvailable(latestBuildId, CURRENT_BUILD_ID) ||
          promptedBuildIdRef.current === latestBuildId
        ) {
          return;
        }

        if (promptToastIdRef.current) {
          dismissToast(promptToastIdRef.current);
        }

        promptedBuildIdRef.current = latestBuildId;
        promptToastIdRef.current = pushToast({
          // v1.0.11：废土叙事风（替换「天地法则」修仙风）
          message: '通讯台重新收到总部短波——幸存者档案已更新版本。刷新页面即可重返废土，旧档无缝衔接。',
          tone: 'warning',
          duration: 0,
          actionLabel: '重新接入新版图',
          onAction: reloadIntoLatestVersion,
        });
      } finally {
        checkInFlightRef.current = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkForUpdate();
      }
    };

    void checkForUpdate();
    const intervalId = window.setInterval(
      () => void checkForUpdate(),
      VERSION_CHECK_INTERVAL_MS,
    );
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [dismissToast, pushToast]);

  return null;
}
