import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

let active: AudioPlayer | null = null;

const RING_URI =
  "https://actions.google.com/sounds/v1/alarms/phone_alerts_and_rings.ogg";

export async function playRingtone(loop = true) {
  try {
    await stopRingtone();
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "duckOthers",
    });
    const player = createAudioPlayer({ uri: RING_URI });
    player.loop = loop;
    player.volume = 0.85;
    player.play();
    active = player;
  } catch (e) {
    console.warn("[ringtone] play failed", e);
  }
}

export async function stopRingtone() {
  try {
    if (active) {
      active.pause();
      active.release();
      active = null;
    }
  } catch {
    active = null;
  }
}
