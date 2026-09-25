/**
 * Sends queued WiseCall SMS (from the "WiseCall: Send SMS" Flow action) and
 * logs each successful send as an outbound SMS Task.
 */
public with sharing class WiseCallSmsSendJob implements Queueable, Database.AllowsCallouts {

    // Stay well inside the 100-callouts-per-transaction limit.
    public static final Integer MAX_PER_JOB = 50;

    private final List<WiseCallSms.SendRequest> requests;

    public WiseCallSmsSendJob(List<WiseCallSms.SendRequest> requests) {
        this.requests = requests;
    }

    public void execute(QueueableContext context) {
        for (WiseCallSms.SendRequest request : requests) {
            WiseCallSms.Result result = WiseCallSms.send(request.recordId, request.phone, request.content);
            if (result.success) {
                if (request.saveAsActivity != false) {
                    WiseCallSms.logTask(request.recordId, request.content, 'Outbound', UserInfo.getUserId(), WiseCallSms.messageIdNote(result.messageId));
                }
            } else {
                System.debug(LoggingLevel.ERROR, 'WiseCall SMS failed for ' + request.recordId + ': ' + result.error);
            }
        }
    }
}
