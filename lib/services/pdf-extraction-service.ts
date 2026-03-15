import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabaseAdmin } from '../supabaseClient';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

interface ExtractedProduct {
    product_name: string;
    ref_id: string;
    price: number;
    box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] standard Gemini format
    ean?: string;
    ncm?: string;
    unit?: string;
    category?: string;
    master_pack?: string;
}

export class PdfExtractionService {
    private genAI: GoogleGenerativeAI;

    constructor() {
        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is required');
        this.genAI = new GoogleGenerativeAI(apiKey);
    }

    /**
     * Gera um Hash SHA-256 do conteúdo do arquivo para identificação única
     */
    async calculateFileHash(filePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(filePath);
            stream.on('data', (data) => hash.update(data));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', (err) => reject(err));
        });
    }

    /**
     * Verifica se o catálogo (pelo hash) já foi processado
     */
    async isCatalogProcessed(fileHash: string): Promise<boolean> {
        if (!supabaseAdmin) return false;
        const { data } = await supabaseAdmin
            .from('processed_catalogs')
            .select('id')
            .eq('file_hash', fileHash)
            .maybeSingle();
        return !!data;
    }

    /**
     * Marca o catálogo como processado no banco de dados
     */
    async markCatalogAsProcessed(fileName: string, fileHash: string, totalPages: number) {
        if (!supabaseAdmin) return;
        await supabaseAdmin.from('processed_catalogs').insert({
            file_name: fileName,
            file_hash: fileHash,
            total_pages: totalPages
        });
    }

    /**
     * Converte as páginas de um PDF em imagens PNG com 300 DPI usando MuPDF (WASM)
     */
    async convertPdfToImages(pdfPath: string, maxPages: number = 999): Promise<string[]> {
        const outputDir = path.join(os.tmpdir(), 'pdf_processing', path.basename(pdfPath, '.pdf'));
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        const mupdf = await import('mupdf');
        const pdfData = fs.readFileSync(pdfPath);
        const doc = mupdf.Document.openDocument(pdfData, 'application/pdf');
        const totalPages = doc.countPages();
        const pagesToConvert = Math.min(totalPages, maxPages);

        console.log(`[PDF] Detectadas ${totalPages} páginas. Convertendo ${pagesToConvert} em 300 DPI via MuPDF...`);

        const scale = 300 / 72; // 300 DPI (PDF padrão é 72 DPI)
        const files: string[] = [];

        for (let i = 0; i < pagesToConvert; i++) {
            const page = doc.loadPage(i);
            const pixmap = page.toPixmap(
                mupdf.Matrix.scale(scale, scale),
                mupdf.ColorSpace.DeviceRGB,
                false
            );
            const pngData = pixmap.asPNG();
            const outputPath = path.join(outputDir, `page-${String(i + 1).padStart(3, '0')}.png`);
            fs.writeFileSync(outputPath, pngData);
            files.push(outputPath);
            console.log(`[PDF] Página ${i + 1}/${pagesToConvert} convertida.`);
        }

        return files;
    }

    /**
     * Gera um Perceptual Hash (dHash) simples de 64 bits para deduplicação visual
     */
    async calculatePHash(buffer: Buffer): Promise<string> {
        try {
            const { data } = await sharp(buffer)
                .grayscale()
                .resize(9, 8, { fit: 'fill' })
                .raw()
                .toBuffer({ resolveWithObject: true });

            let hash = "";
            for (let row = 0; row < 8; row++) {
                for (let col = 0; col < 8; col++) {
                    const left = data[row * 9 + col];
                    const right = data[row * 9 + col + 1];
                    hash += left < right ? "1" : "0";
                }
            }
            return BigInt("0b" + hash).toString(16).padStart(16, '0');
        } catch (e) {
            return "0000000000000000";
        }
    }

    /**
     * Envia a imagem da página para o Gemini extrair produtos com o motor exaustivo
     */
    async extractProductsFromImage(imagePath: string): Promise<ExtractedProduct[]> {
        const model = this.genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

        const imageData = fs.readFileSync(imagePath);
        const imagePart = {
            inlineData: {
                data: imageData.toString('base64'),
                mimeType: 'image/png'
            }
        };

        const prompt = `Você é um especialista em extração visual de dados focado em catálogos técnicos. Sua tarefa é analisar esta página e extrair TODOS os produtos com precisão cirúrgica.

REGRAS DE OURO:
1. NCM (ALTA PRIORIDADE): Localize o NCM (ex: 8302.20.00).
2. MASTER PACK (NOVA): Localize informações de caixa master, como "C. MASTER: 12", "CX: 60" ou "PCS/CX: 40". Extraia apenas o número.
3. CÓDIGO FORNECEDOR: Localize o "ITEM NO." ou códigos de fábrica.
4. EAN: Localize códigos de 13 dígitos numéricos.
5. PREÇO UNITÁRIO: Valor para 1 unidade.
6. DESCRIÇÃO: Nome técnico completo.
7. BOUNDING BOX (box_2d) CRÍTICO: O array [ymin, xmin, ymax, xmax] DEVE envolver ESTREITAMENTE APENAS A FOTO/IMAGEM do produto. DEIXE DE FORA TODO E QUALQUER TEXTO, títulos, códigos, preços, ou letras ao redor da imagem ou abaixo dela. A caixa não pode englobar textos!

SAÍDA:
Retorne EXCLUSIVAMENTE um array JSON puro. Não retorne conversação, saudações ou explicações textuais em hipótese alguma. Se não houver produtos, retorne []. O campo "master_pack" deve conter apenas o número da caixa master. O campo "ref_id" deve conter o Código do Fornecedor.

Exemplo: [{"product_name": "Nome", "ref_id": "QH-3921", "ncm": "8302.20.00", "price": 4.73, "master_pack": "12", "unit": "UN", "box_2d": [0,0,0,0]}]`;

        console.log(`[Gemini] Analisando página (Vision Engine)...`);

        let retries = 3;
        while (retries > 0) {
            try {
                // Aumento do delay para 4 segundos para respeitar o limite de 15 RPM do plano grátis
                await new Promise(res => setTimeout(res, 4000));
                const result = await model.generateContent([prompt, imagePart]);
                const response = await result.response;
                let text = response.text().replace(/```json|```/g, '').trim();

                // Tratamento de segurança contra falha de JSON do Gemini
                if (!text.startsWith('[')) {
                    // Usando [\s\S] como alternativa ao /s (dotAll) para targets antigos
                    const match = text.match(/\[[\s\S]*\]/);
                    if (match) {
                        text = match[0];
                    } else {
                        console.warn(`[Gemini] Resposta fora do padrão (sem JSON válido). Retornando vazio. Texto recebido:`, text);
                        return [];
                    }
                }

                return JSON.parse(text);
            } catch (error: any) {
                if (error.status === 429) {
                    console.warn(`⚠️ Rate limit (15 RPM) atingido. Aguardando 30 segundos para limpar a cota...`);
                    await new Promise(res => setTimeout(res, 30000));
                    retries--;
                } else {
                    throw error;
                }
            }
        }
        return [];
    }

    /**
     * Recorta e salva na catalog_images_bank (O Novo Banco de Imagens)
     */
    async processProductToBank(imagePath: string, extracted: ExtractedProduct, pdfName: string, pageNum: number) {
        if (!supabaseAdmin) return null;

        const image = sharp(imagePath);
        const metadata = await image.metadata();
        if (!metadata.width || !metadata.height) return null;

        const box = extracted.box_2d;
        // Normalização + Clamp 0-1000
        const ymin = Math.max(0, Math.min(1000, box[0]));
        const xmin = Math.max(0, Math.min(1000, box[1]));
        const ymax = Math.max(0, Math.min(1000, box[2]));
        const xmax = Math.max(0, Math.min(1000, box[3]));

        // Calcular coordenadas originais
        let top = Math.round((ymin / 1000) * metadata.height);
        let left = Math.round((xmin / 1000) * metadata.width);
        let height = Math.round(((ymax - ymin) / 1000) * metadata.height);
        let width = Math.round(((xmax - xmin) / 1000) * metadata.width);

        // --- Redução (Shrink) de Segurança (1.5%) ---
        // Ao invés de *adicionarmos* padding para fora e corrermos o risco de pegar textos (ruídos),
        // Vamos aplicar um encolhimento, garantindo um "crop interno" que foca no núcleo da imagem.
        const shrinkY = Math.round(height * 0.005);
        const shrinkX = Math.round(width * 0.005);

        top = Math.min(metadata.height, top + shrinkY);
        left = Math.min(metadata.width, left + shrinkX);
        height = Math.max(10, height - (shrinkY * 2));
        width = Math.max(10, width - (shrinkX * 2));

        try {
            const buffer = await image
                .extract({ left, top, width, height })
                .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
                .sharpen({ sigma: 0.5 })
                .webp({ quality: 90 })
                .toBuffer();

            // Calcular pHash para deduplicação
            const phash = await this.calculatePHash(buffer);

            // Nome do arquivo: Sanitizado
            const safeRef = (extracted.ref_id || 'unkn').replace(/[^a-z0-9]/gi, '_');
            const fileName = `${safeRef}_${Date.now()}.webp`;

            // 1. Upload para Storage
            const { error: uploadError } = await supabaseAdmin.storage
                .from('products')
                .upload(fileName, buffer, { contentType: 'image/webp', upsert: true });

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabaseAdmin.storage.from('products').getPublicUrl(fileName);

            // 2. Salvar na Tabela Mestre (catalog_images_bank)
            const { error: dbError } = await supabaseAdmin.from('catalog_images_bank').insert({
                image_url: publicUrl,
                phash,
                ref_id: extracted.ref_id,
                ean: extracted.ean,
                name: extracted.product_name,
                price: extracted.price,
                unit: extracted.unit,
                category: extracted.master_pack ? `MP:${extracted.master_pack}` : extracted.category,
                source_pdf: pdfName,
                page_number: pageNum,
                bbox_json: { ymin, xmin, ymax, xmax },
                width: width,
                height: height,
                model_version: 'gemini-flash-latest'
            });

            if (dbError) {
                if (dbError.code === '23505') { // Unique violation (Deduplicação)
                    console.log(`[BANK] Imagem duplicada detectada (pHash). Ignorando.`);
                } else {
                    throw dbError;
                }
            }

            return publicUrl;
        } catch (err: any) {
            console.error(`[BANK] Erro ao processar ${extracted.product_name}:`, err.message);
            return null;
        }
    }

    /**
     * Orquestra a criação do Banco de Imagens
     */
    async processCatalogToBank(pdfPath: string, originalName: string, maxPages: number = 999, onProgress?: (msg: string) => void) {
        const fileHash = await this.calculateFileHash(pdfPath);

        // 1. Verificar se já foi processado
        const alreadyProcessed = await this.isCatalogProcessed(fileHash);
        if (alreadyProcessed) {
            onProgress?.(`⏭️ [SKIP] Este catálogo já foi processado anteriormente. Ignorando para evitar duplicidade.`);
            return true;
        }

        const pageImages = await this.convertPdfToImages(pdfPath, maxPages);
        const pdfName = path.basename(pdfPath);

        onProgress?.(`✅ PDF convertido. Iniciando extração exaustiva...`);

        for (let i = 0; i < pageImages.length; i++) {
            const imagePath = pageImages[i];
            onProgress?.(`📄 Analisando página ${i + 1}/${pageImages.length}...`);

            try {
                const extracted = await this.extractProductsFromImage(imagePath);
                onProgress?.(`💎 Encontrados ${extracted.length} itens na página ${i + 1}. Salvando no banco...`);

                for (const item of extracted) {
                    const url = await this.processProductToBank(imagePath, item, pdfName, i + 1);
                    if (url) {
                        onProgress?.(`✅ Salvo: ${item.product_name} (${item.ref_id})`);
                    }
                }
            } catch (err: any) {
                onProgress?.(`❌ Erro na página ${i + 1}: ${err.message}`);
                console.error(err);
            }
        }

        // 2. Registrar como processado
        await this.markCatalogAsProcessed(originalName, fileHash, pageImages.length);

        // Cleanup temp
        try {
            const dir = path.dirname(pageImages[0]);
            fs.rmSync(dir, { recursive: true, force: true });
        } catch (e) { }

        return true;
    }
}
