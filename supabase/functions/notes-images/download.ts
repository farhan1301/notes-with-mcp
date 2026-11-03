// URL downloads are opt-in. Base64 uploads work without a host allowlist.
export async function downloadImage(rawUrl: string, allowedHosts: string[], maxBytes: number): Promise<Uint8Array> {
  let url = new URL(rawUrl);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowedHosts.includes(url.hostname)) {
      throw new Error('image_url must use an HTTPS host in NOTES_IMAGE_URL_HOSTS. Send image_base64 instead.');
    }
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('Image redirect has no destination.');
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Image download failed (${response.status}).`); }
    if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
      await response.body?.cancel(); throw new Error('The image is larger than 10 MB.');
    }
    if (!response.body) throw new Error('Empty image response.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) throw new Error('The image is larger than 10 MB.');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  }
  throw new Error('Too many image redirects. Send image_base64 instead.');
}
