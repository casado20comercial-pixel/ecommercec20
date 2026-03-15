import { NextRequest, NextResponse } from 'next/server';
import { ImageMatchService } from '@/lib/services/image-match-service';

export const maxDuration = 300; // 5 minutos para reconciliar imagens

export async function POST(req: NextRequest) {
    try {
        const matchService = new ImageMatchService();

        // Create a ReadableStream for SSE (Server-Sent Events)
        const stream = new ReadableStream({
            async start(controller) {
                const sendProgress = (msg: any) => {
                    controller.enqueue(new TextEncoder().encode(JSON.stringify(msg) + '\n'));
                };

                try {
                    await matchService.reconcileMissingImages((msg) => {
                        sendProgress({ type: 'progress', message: msg });
                    });

                    sendProgress({ type: 'complete', message: '🚀 Reconciliação de Imagens finalizada com sucesso!' });
                } catch (error: any) {
                    console.error('[MatchAPI] Error:', error);
                    sendProgress({ type: 'error', message: error.message });
                } finally {
                    controller.close();
                }
            }
        });

        return new NextResponse(stream, {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (error: any) {
        console.error('[MatchAPI] Fatal:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
