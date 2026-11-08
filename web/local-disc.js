export async function selectedDisc(list) {
  if (!list.length) return null;
  const files = Array.from(list);
  const cues = files.filter((file) => /\.cue$/i.test(file.name));
  if (cues.length !== 1) throw new Error('Select one CUE and all its BIN tracks together');
  const cue = cues[0];
  const names = Array.from((await cue.text()).matchAll(/^FILE "([^"]+)" BINARY\s*$/gm), (match) => match[1]);
  if (names.length !== 11 || new Set(names).size !== names.length)
    throw new Error('This build requires the audited Europe CUE with eleven BIN tracks');
  const tracks = names.map((name) => {
    const track = files.find((file) => file.name === name);
    if (!track) throw new Error(`Missing local track: ${name}`);
    return track;
  });
  return [cue, ...tracks].map((data) => ({ name: data.name, size: data.size, data }));
}
