// Keep the authored skeleton and footwork, but retain the relaxed sword grip
// while walking. The original Walk arm channels held the sword wide and made
// the character look like a T-pose during slow movement.
export function prepareAerenClips(clips) {
  const idle = clips.find(clip => clip.name === 'Idle');
  if (!idle) return clips;
  return clips.map(clip => {
    if (clip.name !== 'Walk') return clip;
    const repaired = clip.clone();
    repaired.tracks = repaired.tracks.map(track => {
      if (clip.name === 'Walk' && /^(Shoulder_R|UpperArm_R|ForeArm_R|Hand_R)\.(position|quaternion|scale)$/.test(track.name)) {
        const source = idle.tracks.find(candidate => candidate.name === track.name);
        if (source) {
          const pose = Array.from(source.createInterpolant().evaluate(0));
          track.times = new Float32Array([0, repaired.duration]);
          track.values = new Float32Array([...pose, ...pose]);
        }
      }
      return track;
    });
    return repaired;
  });
}
