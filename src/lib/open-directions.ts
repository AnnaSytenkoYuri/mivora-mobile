import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';

import {
  appleMapsDirectionsUrl,
  googleMapsDirectionsUrl,
  type DirectionsDestination,
} from '@/lib/directions';

const FAILED_TITLE = 'Could not open Maps';
const FAILED_MESSAGE = 'Try Apple Maps or Google Maps, or try again later.';

async function openUrl(url: string): Promise<boolean> {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      return false;
    }

    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

async function openOrAlert(url: string): Promise<void> {
  const opened = await openUrl(url);
  if (!opened) {
    Alert.alert(FAILED_TITLE, FAILED_MESSAGE);
  }
}

export function openDirections(destination: DirectionsDestination): void {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Get directions',
        options: ['Apple Maps', 'Google Maps', 'Cancel'],
        cancelButtonIndex: 2,
      },
      (buttonIndex) => {
        if (buttonIndex === 0) {
          void openOrAlert(appleMapsDirectionsUrl(destination));
          return;
        }

        if (buttonIndex === 1) {
          void openOrAlert(googleMapsDirectionsUrl(destination));
        }
      },
    );
    return;
  }

  void openOrAlert(googleMapsDirectionsUrl(destination));
}
