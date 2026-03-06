import { NextResponse } from 'next/server'
import { categories } from '@/lib/products'
import { ProductService } from '@/lib/services/products'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '24');
    const category = searchParams.get('category');
    const search = searchParams.get('q');

    const result = await ProductService.getAll(page, limit, category, search);

    return NextResponse.json({
      products: result.products,
      hasMore: result.hasMore,
      totalCount: result.totalCount,
      categories,
      source: 'hiper'
    })

  } catch (error) {
    console.error('[PRODUCTS_GET] Failed to fetch from Hiper.', error)

    return NextResponse.json({
      products: [],
      categories,
      error: 'Falha ao conectar com o ERP Hiper. Tente novamente mais tarde.',
      source: 'hiper_error'
    }, { status: 502 })
  }
}
