/**
 * Inbound endpoint WiseCall posts SMS replies (and, with "type":"status",
 * delivery receipts for outbound SMS) to:
 *   POST /services/apexrest/wisecall/sms/reply
 *   { "phone": "+447700900123", "content": "…", "record_id": "00Q…" | null, "message_id": "…" }
 * Called as the WiseCall integration user (OAuth client credentials).
 */
@RestResource(urlMapping='/wisecall/sms/reply')
global without sharing class WiseCallSmsReplyResource {

    @HttpPost
    global static void receive() {
        RestResponse response = RestContext.response;
        response.addHeader('Content-Type', 'application/json');
        WiseCallSmsReplyService.Outcome outcome;
        try {
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(RestContext.request.requestBody.toString());
            if (body.get('type') == 'status') {
                WiseCallSmsStatusService.Result status = WiseCallSmsStatusService.apply(
                    (String) body.get('record_id'), (String) body.get('message_id'),
                    (String) body.get('status'), (String) body.get('error'), (String) body.get('at')
                );
                response.statusCode = status.ok ? 200 : 400;
                response.responseBody = Blob.valueOf(JSON.serialize(new Map<String, Object>{
                    'ok' => status.ok, 'task_id' => status.taskId, 'delivered' => status.delivered, 'error' => status.error
                }));
                return;
            }
            WiseCallSmsReplyService.Reply reply = new WiseCallSmsReplyService.Reply();
            reply.phone = (String) body.get('phone');
            reply.content = (String) body.get('content');
            reply.recordId = (String) body.get('record_id');
            reply.messageId = (String) body.get('message_id');
            outcome = WiseCallSmsReplyService.handle(reply);
            response.statusCode = outcome.ok ? 200 : 400;
        } catch (Exception e) {
            outcome = new WiseCallSmsReplyService.Outcome();
            outcome.ok = false;
            outcome.error = e.getMessage();
            response.statusCode = 500;
        }
        response.responseBody = Blob.valueOf(JSON.serialize(new Map<String, Object>{
            'ok' => outcome.ok,
            'match_type' => outcome.matchType,
            'record_id' => outcome.recordId,
            'task_id' => outcome.taskId,
            'notified' => outcome.notified,
            'fallback_email_sent' => outcome.fallbackEmailSent,
            'error' => outcome.error
        }));
    }
}
