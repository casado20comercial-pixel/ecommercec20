import sharp from 'sharp';
import { spawn } from 'child_process';
import { MultiFormatReader, BarcodeFormat, RGBLuminanceSource, BinaryBitmap, HybridBinarizer } from '@zxing/library';
import { PNG } from 'pngjs';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini for Vision tasks
const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_SEARCH_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const visionModel = genAI ? genAI.getGenerativeModel({ model: "gemini-2.0-flash" }) : null;

interface ExtractedImage {
    ean: string;
    buffer?: Buffer;
    page: number;
}

/**
 * Gets the total number of pages in the PDF buffer using MuPDF (WASM).
 */
async function getNumPages(pdfBuffer: Buffer): Promise<number> {
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
    return doc.countPages();
}

/**
 * Renders a specific page of the PDF buffer to a PNG buffer using MuPDF at 300 DPI.
 */
async function renderPageToBuffer(pdfBuffer: Buffer, pageNumber: number): Promise<Buffer> {
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
    const page = doc.loadPage(pageNumber - 1); // 0-indexed
    const scale = 300 / 72; // 300 DPI
    const pixmap = page.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB,
        false
    );
    return Buffer.from(pixmap.asPNG());
}

interface DetectedBarcode {
    text: string;
    format: string;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    centerX: number;
    centerY: number;
}

/**
 * Scans a PNG buffer for barcodes using ZXing.
 */
async function scanBarcodes(pngBuffer: Buffer): Promise<DetectedBarcode[]> {
    return new Promise((resolve) => {
        const png = new PNG();
        png.parse(pngBuffer, (err, image) => {
            if (err || !image) {
                console.warn('[ZXING] Error parsing PNG buffer:', err);
                return resolve([]);
            }

            const width = image.width;
            const height = image.height;
            const len = width * height;
            const luminancesUint8Array = new Uint8ClampedArray(len);

            for (let i = 0; i < len; i++) {
                const offset = i * 4;
                const r = image.data[offset];
                const g = image.data[offset + 1];
                const b = image.data[offset + 2];
                luminancesUint8Array[i] = ((r + g + b) / 3) & 0xFF;
            }

            const luminanceSource = new RGBLuminanceSource(luminancesUint8Array, width, height);
            const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
            const reader = new MultiFormatReader();

            const results: DetectedBarcode[] = [];

            try {
                const result = reader.decode(binaryBitmap);
                if (result) {
                    const points = result.getResultPoints();
                    if (points && points.length >= 2) {
                        const xs = points.map(p => p.getX());
                        const ys = points.map(p => p.getY());
                        const minX = Math.min(...xs);
                        const maxX = Math.max(...xs);
                        const minY = Math.min(...ys);
                        const maxY = Math.max(...ys);

                        results.push({
                            text: result.getText(),
                            format: BarcodeFormat[result.getBarcodeFormat()],
                            minX,
                            minY,
                            maxX,
                            maxY,
                            centerX: (minX + maxX) / 2,
                            centerY: (minY + maxY) / 2
                        });
                    }
                }
            } catch (e) {
                // No barcode found
            }

            resolve(results);
        });
    });
}

/**
 * Extracts raw text from a specific page using pdftotext (lightweight).
 */
async function extractTextFromPage(pdfBuffer: Buffer, pageNumber: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const args = ['-f', pageNumber.toString(), '-l', pageNumber.toString(), '-layout', '-', '-'];
        const process = spawn('pdftotext', args);
        let stdout = '';
        let stderr = '';
        process.stdin.write(pdfBuffer);
        process.stdin.end();
        process.stdout.on('data', (data) => { stdout += data.toString(); });
        process.stderr.on('data', (data) => { stderr += data.toString(); });
        process.on('close', (code) => {
            if (code !== 0) console.warn(`[PDF] pdftotext warning for page ${pageNumber}: ${stderr}`);
            resolve(stdout);
        });
    });
}

/**
 * Asks Gemini Vision to perform an exhaustive analysis of the page,
 * extracting every product, its name, reference ID (EAN/NCM) and bounding box.
 * This is based on the 'GERADOR CATALOGO' n8n workflow logic.
 */
async function analyzePageWithVision(pngBuffer: Buffer): Promise<any[]> {
    if (!visionModel) return [];

    let retries = 3;
    while (retries > 0) {
        try {
            const prompt = `Você é um especialista em extração visual de dados com foco em processamento exaustivo de documentos. Sua tarefa é analisar todas as páginas do arquivo fornecido e extrair absolutamente todos os produtos sem deixar nenhum para trás.

REGRAS
1. Realize uma varredura completa em cada página. Garanta que a transição entre páginas não cause a perda de nenhum item.
2. Localize o nome do produto, o preço e o código de referência conhecido como Ref ID.
3. O Ref ID pode estar posicionado em qualquer local próximo ao produto. Identifique padrões de códigos alfanuméricos ou sequências numéricas.
4. Mesmo que o termo ESGOTADO esteja presente, você deve obrigatoriamente extrair o preço numérico original associado ao produto. Não ignore o valor nem o defina como zero caso o preço esteja visível no documento.
5. O nome do produto deve conter todos os detalhes extras como medidas e cores.

INSTRUÇÕES DE VARREDURA
Certifique se de percorrer o documento do início ao fim. Verifique cada canto da página para encontrar produtos que possam estar em layouts não convencionais. A extração deve ser total e sem omissões. O fato de um item estar marcado como esgotado não deve impedir a coleta de seu valor monetário.

SAÍDA OBRIGATÓRIA
Retorne apenas um array JSON puro com todos os produtos. Não inclua explicações ou comentários.
IMPORTANTE: Para cada produto, incluiu a chave "box_2d": [ymin, xmin, ymax, xmax] englobando a IMAGEM do produto.

Exemplo de saída:
[{"product_name": "Nome", "ref_id": "ID", "price": 0.00, "box_2d": [0,0,0,0]}]`;

            const imagePart = {
                inlineData: {
                    data: pngBuffer.toString('base64'),
                    mimeType: 'image/png',
                },
            };

            // Respect rate limits with a small delay
            await delay(2000);
            const result = await visionModel.generateContent([prompt, imagePart]);
            const responseText = result.response.text();

            // Clean markdown and parse
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            const jsonText = jsonMatch ? jsonMatch[0] : '[]';
            const detected = JSON.parse(jsonText);

            return Array.isArray(detected) ? detected : [];
        } catch (err: any) {
            if (err.status === 429) {
                console.warn(`[VISION] Rate limit hit (429) on page analysis. Retrying in 12s...`);
                await delay(12000);
                retries--;
            } else {
                console.error('[VISION] Page analysis error:', err);
                return [];
            }
        }
    }
    return [];
}

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

/**
 * Parses a PDF buffer using native tools (poppler), renders pages, uses Gemini Vision for ROI detection, and extracts products.
 */
export async function processPdfBuffer(pdfBuffer: Buffer, validIds?: Set<string>, onProgress?: (msg: string) => void, targetPage?: number, onlyMapping: boolean = false): Promise<ExtractedImage[]> {
    const results: ExtractedImage[] = [];

    try {
        const numPages = await getNumPages(pdfBuffer);
        console.log(`[PDF] Total Pages: ${numPages}`);

        let pagesToProcess: number[] = [];

        if (targetPage) {
            pagesToProcess = [targetPage];
            onProgress?.(`Usando índice: indo direto para a página ${targetPage}...`);
        } else {
            for (let i = 1; i <= numPages; i++) pagesToProcess.push(i);
        }

        for (const i of pagesToProcess) {
            console.log(`[PDF] Processing Page ${i}...`);
            onProgress?.(`Processando página ${i}/${numPages}...`);

            try {
                const pageImageBuffer = await renderPageToBuffer(pdfBuffer, i);

                // Unified Gemini Vision Analysis (n8n style)
                const productsInPage = await analyzePageWithVision(pageImageBuffer);

                if (productsInPage.length === 0) {
                    console.log(`   ⚠️ Ninguém encontrado na página ${i}.`);
                    continue;
                }

                console.log(`   💎 Gemini encontrou ${productsInPage.length} produtos na página ${i}.`);

                const metadata = await sharp(pageImageBuffer).metadata();
                const width = metadata.width || 1;
                const height = metadata.height || 1;

                for (const product of productsInPage) {
                    const ean = String(product.ref_id || '').trim();

                    // Filter if validIds is provided
                    if (validIds && !validIds.has(ean)) continue;

                    if (onlyMapping) {
                        results.push({ ean, page: i });
                        continue;
                    }

                    // Proceed to Crop if we have coordinates
                    if (product.box_2d && Array.isArray(product.box_2d)) {
                        try {
                            let [ymin, xmin, ymax, xmax] = product.box_2d;

                            // Transform normalized (0-1000) to pixel coordinates
                            const left = Math.floor((Math.min(xmin, xmax) / 1000) * width);
                            const top = Math.floor((Math.min(ymin, ymax) / 1000) * height);
                            const cropWidth = Math.ceil((Math.abs(xmax - xmin) / 1000) * width);
                            const cropHeight = Math.ceil((Math.abs(ymax - ymin) / 1000) * height);

                            console.log(`   ✂️ Recortando ${ean} (${product.product_name})...`);

                            const extractedImageBuffer = await sharp(pageImageBuffer)
                                .extract({
                                    left: Math.max(0, left),
                                    top: Math.max(0, top),
                                    width: Math.min(width - left, cropWidth),
                                    height: Math.min(height - top, cropHeight)
                                })
                                .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
                                .sharpen({ sigma: 0.5 })
                                .webp({ quality: 90 })
                                .toBuffer();

                            results.push({ ean, buffer: extractedImageBuffer, page: i });
                        } catch (cropErr: any) {
                            console.error(`   ❌ Erro ao recortar ${ean}:`, cropErr.message);
                        }
                    }
                }

            } catch (pageError) {
                console.error(`[PDF] Error on page ${i}:`, pageError);
            }
        }

    } catch (err) {
        console.error('[PDF] Critical error:', err);
        throw err;
    }

    return results;
}

