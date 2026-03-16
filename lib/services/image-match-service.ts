import { supabaseAdmin } from '../supabaseClient';

export interface MatchResult {
    productId: string;
    productName: string;
    bankImageId: string;
    imageUrl: string;
    score: number;
    reason: string;
}

export class ImageMatchService {
    // Mapa de abreviações comuns em nomes de produtos
    private static readonly ABBREVIATIONS: Record<string, string> = {
        'jg': 'jogo',
        'cx': 'caixa',
        'pcs': 'pecas',
        'un': 'unidade',
        'unid': 'unidade',
        'conj': 'conjunto',
        'c': 'com',
        'p': 'para',
        'qte': 'quantidade',
        'qt': 'quantidade',
        'gde': 'grande',
        'peq': 'pequeno',
        'med': 'medio',
        'inox': 'inox',
    };

    private normalizeText(text: string): string {
        return (text || '')
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "") // Remove acentos
            .replace(/[^\w\s]/gi, ' ') // Remove pontuação
            .replace(/\s+/g, ' ') // Espaços extras
            .trim();
    }

    /**
     * Normalização leve de plural PT-BR: remove -s, -es, -ões finais comuns
     */
    private stemToken(token: string): string {
        if (token.length <= 3) return token;
        if (token.endsWith('oes')) return token.slice(0, -3) + 'ao';
        if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
        if (token.endsWith('s')) return token.slice(0, -1);
        return token;
    }

    /**
     * Expande abreviações e aplica stemming nos tokens
     */
    private expandToken(token: string): string {
        const expanded = ImageMatchService.ABBREVIATIONS[token];
        return expanded || token;
    }

    private getTokens(text: string): string[] {
        const stopWords = new Set(['de', 'para', 'com', 'sem', 'em', 'um', 'uma', 'os', 'as', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'por', 'ao', 'aos', 'ou', 'e', 'x', 'a', 'o', 'le', 'la', 'les', 'des', 'du', 'au', 'aux']);
        const units = /^\d+(ml|l|kg|g|cm|mm|pcs|un|unid|pecas|jog|jogo|kit|conjunto)$/i;

        return this.normalizeText(text)
            .split(' ')
            .filter(w => w.length >= 2 && !stopWords.has(w) && !units.test(w));
    }

    /**
     * Retorna tokens normalizados (expandidos + stemmed) para comparação
     */
    private getNormalizedTokens(text: string): string[] {
        return this.getTokens(text).map(t => this.stemToken(this.expandToken(t)));
    }

    private extractSpecs(text: string) {
        const normalized = this.normalizeText(text);

        // Melhoria no Regex para capturar volume e quantidade com mais precisão
        const volumeMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|litro|litros)/i);
        const qtyMatch = normalized.match(/(\d+)\s*(pcs|un|unid|pecas|jog|jogo|kit|conjunto)/i);
        const dimMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*(cm|mm)/i);

        return {
            volume: volumeMatch ? volumeMatch[1].replace(',', '.') + (volumeMatch[2].toLowerCase().startsWith('l') ? 'l' : 'ml') : null,
            quantity: qtyMatch ? qtyMatch[1] : null,
            dimension: dimMatch ? dimMatch[1].replace(',', '.') + dimMatch[2].toLowerCase() : null,
            isKit: /kit|conjunto|jogo|jg\b/i.test(normalized)
        };
    }

    /**
     * Busca o melhor match no banco de imagens para um produto específico
     */
    async findMatchForProduct(product: any, candidatesList?: any[]): Promise<MatchResult | null> {
        if (!supabaseAdmin) return null;

        // --- 1. REGRA DE OURO: MATCH POR EAN (Soberania Total) ---
        // Se bater o EAN, para tudo e vincula. Confiança 100%.
        if (!candidatesList) {
            const { data: eanMatch } = await supabaseAdmin
                .from('catalog_images_bank')
                .select('*')
                .eq('ean', product.ean)
                .not('ean', 'is', null)
                .limit(1);

            if (eanMatch?.length) {
                const best = eanMatch[0];
                return {
                    productId: product.id,
                    productName: product.name,
                    bankImageId: best.id,
                    imageUrl: best.image_url,
                    score: 500, // Score altíssimo para priorizar EAN
                    reason: `EAN Identico (${product.ean})`
                };
            }
        }

        const productSpecs = this.extractSpecs(product.name);
        let candidates = candidatesList;

        if (!candidates) {
            // Busca candidatos usando múltiplos tokens (não apenas o primeiro)
            // Filtra tokens genéricos/curtos e pega os mais descritivos
            const searchTokens = this.getTokens(product.name)
                .filter(t => t.length >= 3 && !ImageMatchService.ABBREVIATIONS[t]);

            // Busca por cada token significativo e une os resultados (sem duplicatas)
            const candidateMap = new Map<string, any>();
            const tokensToSearch = searchTokens.slice(0, 4); // Top 4 tokens descritivos

            for (const token of tokensToSearch) {
                const { data } = await supabaseAdmin
                    .from('catalog_images_bank')
                    .select('*')
                    .ilike('name', `%${token}%`)
                    .limit(200);

                if (data) {
                    for (const item of data) {
                        if (!candidateMap.has(item.id)) {
                            candidateMap.set(item.id, item);
                        }
                    }
                }
            }
            candidates = Array.from(candidateMap.values());
        }

        if (!candidates || candidates.length === 0) return null;

        let bestMatch: MatchResult | null = null;
        let highestScore = 0;

        const productTokens = this.getTokens(product.name);
        const productNormTokens = this.getNormalizedTokens(product.name);
        if (productTokens.length === 0) return null;

        for (const cand of candidates) {
            // Re-checagem de EAN se estiver na lista da memória
            if (product.ean && cand.ean && product.ean === cand.ean) {
                return {
                    productId: product.id,
                    productName: product.name,
                    bankImageId: cand.id,
                    imageUrl: cand.image_url,
                    score: 500,
                    reason: 'EAN Identico (Scan)'
                };
            }

            const candSpecs = this.extractSpecs(cand.name);

            // 🚫 TRAVA RADICAL 1: Conflito de Especificações Físicas
            if (productSpecs.volume && candSpecs.volume && productSpecs.volume !== candSpecs.volume) continue;
            if (productSpecs.quantity && candSpecs.quantity && productSpecs.quantity !== candSpecs.quantity) continue;
            if (productSpecs.dimension && candSpecs.dimension && productSpecs.dimension !== candSpecs.dimension) continue;
            if (productSpecs.isKit !== candSpecs.isKit) continue;

            // 🚫 TRAVA RADICAL 2: Divergência de Preço (RELAXADA para Migração)
            // Na migração entre empresas, os preços podem variar drasticamente (ex: atacado vs varejo)
            if (product.price && cand.price) {
                const priceDiff = Math.abs(product.price - cand.price) / (product.price || 1);
                if (priceDiff > 0.95) continue; // Só trava se a diferença for absurda (95%)
            }

            const candTokens = this.getTokens(cand.name);
            const candNormTokens = this.getNormalizedTokens(cand.name);
            if (candTokens.length === 0) continue;

            // Pontuação por Tokens (com expansão de abreviações e stemming)
            let matchedTokens = 0;
            productNormTokens.forEach((pt, idx) => {
                const rawPt = productTokens[idx];
                if (candNormTokens.includes(pt) || candTokens.includes(rawPt) || cand.name.toLowerCase().includes(rawPt)) {
                    matchedTokens++;
                }
            });

            let candMatched = 0;
            candNormTokens.forEach((ct, idx) => {
                const rawCt = candTokens[idx];
                if (productNormTokens.includes(ct) || productTokens.includes(rawCt) || product.name.toLowerCase().includes(rawCt)) {
                    candMatched++;
                }
            });

            const coverage = matchedTokens / productTokens.length;
            const candCoverage = candMatched / candTokens.length;

            let score = Math.round((coverage * 60) + (candCoverage * 40));
            let reasons = [];

            if (coverage > 0.6) reasons.push(`Tokens (${Math.round(coverage * 100)}%)`);

            // Bônus de Ref (Muito valioso)
            if (cand.ref_id && product.name.toLowerCase().includes(cand.ref_id.toLowerCase())) {
                score += 40;
                reasons.push(`Ref OK: ${cand.ref_id}`);
            }

            // Critério de Aceitação: Mínimo 45 para ser AGRESSIVO na migração
            if (score > highestScore && score >= 45) {
                highestScore = score;
                bestMatch = {
                    productId: product.id,
                    productName: product.name,
                    bankImageId: cand.id,
                    imageUrl: cand.image_url,
                    score: score,
                    reason: reasons.join(', ')
                };
            }
        }

        return bestMatch;
    }

    /**
     * Executa a reconciliação ROBUSTA (Nuclear Mode)
     */
    async reconcileMissingImages(onProgress?: (msg: string) => void) {
        if (!supabaseAdmin) return;

        onProgress?.('🚀 Iniciando Varredura Radical (Anti-Erro)...');

        let allBankImages: any[] = [];
        let from = 0;
        const step = 1000;
        let hasMore = true;

        while (hasMore) {
            const { data, error: bankError } = await supabaseAdmin
                .from('catalog_images_bank')
                .select('*')
                .range(from, from + step - 1);

            if (bankError) {
                onProgress?.('❌ Erro ao carregar acervo.');
                return;
            }

            if (data && data.length > 0) {
                allBankImages = [...allBankImages, ...data];
                from += step;
                onProgress?.(`📚 Carregando acervo: ${allBankImages.length} imagens...`);
                if (data.length < step) hasMore = false;
            } else {
                hasMore = false;
            }
        }

        onProgress?.('🔍 Buscando produtos sem imagem...');
        const { data: products, error } = await supabaseAdmin
            .from('products')
            .select('*')
            .is('image_url', null);

        if (error || !products) return;

        let matchesFound = 0;
        for (let i = 0; i < products.length; i++) {
            const product = products[i];
            const match = await this.findMatchForProduct(product, allBankImages);

            if (match) {
                console.log(`[RECONCILE] Linking ${product.id} to ${match.imageUrl}`);
                const { error: upError } = await supabaseAdmin.from('products').update({ image_url: match.imageUrl }).eq('id', product.id);
                if (upError) console.error(`[RECONCILE] Update Error for ${product.id}:`, upError.message);

                const { error: insError } = await supabaseAdmin.from('product_images').insert({
                    sku: product.id,
                    ean: product.ean || null,
                    image_url: match.imageUrl,
                    is_primary: true,
                    source: 'manual'
                });
                if (insError) console.error(`[RECONCILE] Insert Error for ${product.id}:`, insError.message);

                matchesFound++;
                onProgress?.(`✨ [VINCULADO] ${product.name} (Score: ${match.score})`);
            }
        }
        onProgress?.(`🏁 Finalizado. ${matchesFound} vínculos garantidos.`);
    }
}
