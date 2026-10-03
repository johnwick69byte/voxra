import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { Asset } from "expo-asset";

let active: AudioPlayer | null = null;

/**
 * Loop the ringback/ringtone.
 *
 * Uses the bundled asset for reliable offline ringing.
 */
const RING_SOURCE = require("../../assets/sounds/ringing.mp3");

export async function playRingtone(loop = true) {
  try {
    await stopRingtone();
    // Pre-load the asset
    const asset = Asset.fromModule(require("../../assets/sounds/ringing.mp3"));
    await asset.downloadAsync();
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "duckOthers",
    });
    const player = createAudioPlayer(RING_SOURCE);
    player.loop = loop;
    player.volume = 0.9;
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