import { Audio } from "expo-av";

let active: Audio.Sound | null = null;

const RING_URI =
  "https://actions.google.com/sounds/v1/alarms/phone_alerts_and_rings.ogg";

export async function playRingtone(loop = true) {
  try {
    await stopRingtone();
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
    });
    const { sound } = await Audio.Sound.createAsync(
      { uri: RING_URI },
      { isLooping: loop, volume: 0.85, shouldPlay: true }
    );
    active = sound;
  } catch (e) {
    console.warn("[ringtone] play failed", e);
  }
}

export async function stopRingtone() {
  try {
    if (active) {
      await active.stopAsync();
      await active.unloadAsync();
      active = null;
    }
  } catch {
    active = null;
  }
}
