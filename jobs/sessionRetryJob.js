// jobs/sessionRetryJob.js - NIEUW BESTAND
const cron = require('node-cron');
const { supabase } = require('../config/database');
const { executeSessionBasedLinking, findPaymentBySession } = require('../services/sessionLinkingService');

const processSessionRetries = async () => {
    console.log('[Session Retry] Processing queued retries...');
    
    const { data: retryQueue, error } = await supabase
        .from('session_retry_queue')
        .select('*')
        .eq('processed', false)
        .lte('next_retry_at', new Date().toISOString())
        .lt('retry_count', 5)
        .order('created_at', { ascending: true });
    
    if (error || !retryQueue?.length) {
        console.log('[Session Retry] No pending retries found');
        return { processed: 0 };
    }
    
    let successCount = 0;
    
    for (const retry of retryQueue) {
        try {
            console.log(`[Session Retry] Processing retry for mosque ${retry.mosque_id}, session ${retry.session_id}`);
            
            const payment = await findPaymentBySession(retry.session_id);
            
            if (payment) {
                await executeSessionBasedLinking(retry.mosque_id, payment, retry.session_id);
                
                await supabase
                    .from('session_retry_queue')
                    .update({
                        processed: true,
                        processed_at: new Date().toISOString(),
                        success: true
                    })
                    .eq('id', retry.id);
                
                successCount++;
                console.log(`✅ [Session Retry] SUCCESS: Linked session ${retry.session_id} to mosque ${retry.mosque_id}`);
                
            } else {
                const nextRetry = new Date(Date.now() + (retry.retry_count + 1) * 600000);
                
                await supabase
                    .from('session_retry_queue')
                    .update({
                        retry_count: retry.retry_count + 1,
                        next_retry_at: nextRetry.toISOString(),
                        last_attempt_at: new Date().toISOString()
                    })
                    .eq('id', retry.id);
            }
            
        } catch (error) {
            console.error(`[Session Retry] Error processing retry ${retry.id}:`, error);
        }
    }
    
    console.log(`[Session Retry] Processed ${successCount}/${retryQueue.length} retries successfully`);
    return { processed: successCount, total: retryQueue.length };
};

// Run every 5 minutes
cron.schedule('*/5 * * * *', async () => {
    try {
        const result = await processSessionRetries();
        console.log(`[Cron] Session retry job completed: ${result.processed}/${result.total} processed`);
    } catch (error) {
        console.error('[Cron] Session retry job failed:', error);
    }
});

module.exports = { processSessionRetries };