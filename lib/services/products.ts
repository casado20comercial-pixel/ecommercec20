import { supabaseAdmin } from '@/lib/supabaseClient';

export interface ProductData {
    id: string;
    ref: string;
    name: string;
    price: number;
    image: string;
    images?: string[];
    category: string;
    stock: number;
    material?: string;
    masterBox?: number;
    ipi?: number;
}

/**
 * Service to handle product data fetching from the Supabase Mirror table.
 */
export const ProductService = {
    async getAll(page: number = 1, limit: number = 24, category?: string | null, search?: string | null): Promise<{ products: ProductData[], hasMore: boolean, totalCount: number }> {
        if (!supabaseAdmin) throw new Error('Supabase Admin not initialized');

        const from = (page - 1) * limit;
        const to = from + limit - 1;

        let query = supabaseAdmin
            .from('products')
            .select('*', { count: 'exact' }) // Removed the product_images join
            .gt('stock', 0);

        if (category) {
            if (category === 'price-under-25') {
                query = query.lte('price', 25);
            } else if (category === 'price-over-25') {
                query = query.gt('price', 25);
            } else {
                query = query.eq('category', category);
            }
        }

        if (search) {
            query = query.ilike('name', `%${search}%`);
        }

        const { data, error, count } = await query
            .order('name', { ascending: true })
            .range(from, to);

        if (error) {
            console.error('[ProductService] Error fetching products:', error);
            return { products: [], hasMore: false, totalCount: 0 };
        }

        // Fetch images separately for each product to avoid join issues if needed, 
        // but for list view, using just the main image is enough for performance.
        const mapped = (data || []).map(p => ({
            id: p.id,
            ref: p.ean || 'N/A',
            name: p.name,
            price: Number(p.price || 0),
            image: p.image_url || '/images/placeholder.png',
            images: [], // Default empty, can be hydrated in detail view
            category: p.category || 'Geral',
            stock: Number(p.stock || 0),
            material: p.brand || null
        }));

        const total = count || 0;
        const hasMore = from + mapped.length < total;

        return { products: mapped, hasMore, totalCount: total };
    },

    async getById(id: string): Promise<ProductData | null> {
        if (!supabaseAdmin) throw new Error('Supabase Admin not initialized');

        // Fetch product first
        const { data: product, error: productError } = await supabaseAdmin
            .from('products')
            .select('*')
            .eq('id', id)
            .single();

        if (productError || !product) {
            console.error('[ProductService] Error fetching product by id:', productError);
            return null;
        }

        // Fetch images separately (Safe way)
        const { data: images } = await supabaseAdmin
            .from('product_images')
            .select('image_url')
            .eq('sku', product.id);

        return {
            id: product.id,
            ref: product.ean || 'N/A',
            name: product.name,
            price: Number(product.price || 0),
            image: product.image_url || '/images/placeholder.png',
            images: images?.map(img => img.image_url) || [product.image_url || '/images/placeholder.png'],
            category: product.category || 'Geral',
            stock: Number(product.stock || 0),
            material: product.brand || null
        };
    }
};
