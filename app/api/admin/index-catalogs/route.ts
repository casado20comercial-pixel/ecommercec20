import { NextRequest } from 'next/server';
import { CatalogIndexingService } from '@/lib/services/catalog-indexer';

export const maxDuration = 300; // 5 minutos para indexar catálogos

const indexer = new CatalogIndexingService();

export async function POST(req: NextRequest) {
    try {
        const encoder = new TextEncoder();
        const stream = new TransformStream();
        const writer = stream.writable.getWriter();

        const send = (data: any) => {
            writer.write(encoder.encode(JSON.stringify(data) + '\n'));
        };

        (async () => {
            try {
                await indexer.syncAndIndex((msg) => send({ type: 'progress', message: msg }));
                send({ type: 'result', success: true });
            } catch (error: any) {
                console.error('[API] Indexing Error:', error);
                send({ type: 'error', error: error.message });
            } finally {
                writer.close();
            }
        })();

        return new Response(stream.readable, {
            headers: {
                'Content-Type': 'application/x-ndjson',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (error: any) {
        console.error('[API] Indexing Request Error:', error);
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
