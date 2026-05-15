/**
 * SPZ Decoder — shared utility for decompressing Niantic/Scaniverse .spz files.
 *
 * spz is a zstd-compressed binary format. We use the official @nianticlabs/spz
 * WASM package from CDN to decompress to raw PLY bytes.
 */

let spzModule = null;

/**
 * Load the SPZ WASM decoder module from CDN (cached).
 * @returns {Promise<Object>} The initialized spz module with decompress() method
 */
export async function loadSpzDecoder() {
    if (spzModule) return spzModule;

    const { default: initSpz } = await import(
        'https://cdn.jsdelivr.net/npm/@nianticlabs/spz@1.0.5/dist/spz.js'
    ).catch(() => ({ default: null }));

    if (!initSpz) {
        throw new Error('Failed to load SPZ decoder from CDN. Check your internet connection.');
    }

    spzModule = await initSpz();
    return spzModule;
}

/**
 * Decompress SPZ binary data to PLY bytes.
 * @param {ArrayBuffer} arrayBuffer - The .spz file data
 * @returns {Promise<ArrayBuffer>} Decompressed PLY bytes
 */
export async function decompressSpz(arrayBuffer) {
    const mod = await loadSpzDecoder();
    const input = new Uint8Array(arrayBuffer);
    const result = mod.decompress(input);
    if (!result || result.length === 0) {
        throw new Error('SPZ decompression returned empty data');
    }
    return result.buffer;
}
