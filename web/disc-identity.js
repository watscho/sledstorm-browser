const hex = bytes => Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
export async function identifyDisc(files, report = () => {}) {
  const manifest = [];
  let pal = false;
  for (const [index, file] of files.entries()) {
    report(`Verifying local file ${index + 1}/${files.length}: ${file.name}`);
    const bytes = await file.data.arrayBuffer();
    manifest.push([file.name, file.size, hex(await crypto.subtle.digest('SHA-256', bytes))]);
    if (index === 1) pal = hex(await crypto.subtle.digest('SHA-1', bytes)) === 'c5506c3eb3601d68d11f2c8754e03a6b06be5f2d';
  }
  return { disc: hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(manifest)))), pal };
}
