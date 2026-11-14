// MPEG-2 Layer III, 24 kHz mono, 48 kbit/s. Zero side information encodes
// silent granules. This synthetic decoder fixture is NOT provider/voice evidence.
export function syntheticMp3(frames = 64) {
  const bytes = new Uint8Array(frames * 144);
  for (let offset = 0; offset < bytes.length; offset += 144) bytes.set([0xff, 0xf3, 0x64, 0xc4], offset);
  return bytes;
}
