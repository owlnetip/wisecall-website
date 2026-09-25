/**
 * WiseCall SMS: the "WC Controller" in the BetterMove SMS architecture.
 *
 *   Automation / Flow ──► WiseCallSms.sendFromFlow (queued, callout-safe)
 *   Aung's Apex action ─► WiseCallSms.send(recordId, phone, content)  (call inside @Future/Queueable)
 *   SMS button (LWC) ───► WiseCallSmsController.sendNow ─► WiseCallSms.send + logTask
 *
 * Content must already be merged (templates stay in BetterMove's Apex).
 * WiseCall stores the record id so replies come back to the right record via
 * WiseCallSmsReplyResource. Calls go through the WiseCall_SMS Named Credential.
 */
public with sharing class WiseCallSms {

    public static final Integer MAX_CONTENT_LENGTH = 1000;

    /** Written into SMS Task descriptions so delivery receipts can find the Task. */
    public static final String MESSAGE_ID_PREFIX = 'WiseCall message id: ';

    /** Description note for an outbound Task; pass it to logTask. */
    public static String messageIdNote(String messageId) {
        return String.isBlank(messageId) ? null : MESSAGE_ID_PREFIX + messageId;
    }

    public class Result {
        @AuraEnabled public Boolean success = false;
        @AuraEnabled public Integer statusCode;
        @AuraEnabled public String messageId;
        @AuraEnabled public String error;
    }

    public class SendRequest {
        @InvocableVariable(label='Record ID' description='Lead, Contact or Person Account the SMS is about. Replies are matched back to it.' required=true)
        public Id recordId;
        @InvocableVariable(label='Phone' description='Mobile number to text, e.g. 07700 900123 or +447700900123.' required=true)
        public String phone;
        @InvocableVariable(label='SMS Content' description='Final message text, with merge fields already replaced. Max 1000 characters.' required=true)
        public String content;
        @InvocableVariable(label='Save As Activity' description='Log a completed Task (Type SMS, Direction Outbound). Defaults to true.')
        public Boolean saveAsActivity;
    }

    /**
     * Flow / automation entry point. Queued so it works from record-triggered
     * flows, where a direct callout is not allowed.
     */
    @InvocableMethod(label='WiseCall: Send SMS' description='Send an SMS through WiseCall and log it on the record.' category='WiseCall')
    public static void sendFromFlow(List<SendRequest> requests) {
        List<SendRequest> batch = new List<SendRequest>();
        for (SendRequest request : requests) {
            batch.add(request);
            if (batch.size() == WiseCallSmsSendJob.MAX_PER_JOB) {
                System.enqueueJob(new WiseCallSmsSendJob(batch));
                batch = new List<SendRequest>();
            }
        }
        if (!batch.isEmpty()) System.enqueueJob(new WiseCallSmsSendJob(batch));
    }

    /**
     * Sends one SMS now. Makes a callout, so call it from a @Future(callout=true),
     * a Queueable with Database.AllowsCallouts, or an @AuraEnabled method.
     * Does not create a Task: call logTask if the caller wants one.
     */
    public static Result send(Id recordId, String phone, String content) {
        return send(recordId, phone, content, null);
    }

    public static Result send(Id recordId, String phone, String content, String idempotencyKey) {
        Result result = new Result();
        String problem = validate(recordId, phone, content);
        if (problem != null) {
            result.error = problem;
            return result;
        }
        HttpRequest request = new HttpRequest();
        request.setEndpoint('callout:WiseCall_SMS/api/integrations/salesforce/sms/send');
        request.setMethod('POST');
        request.setTimeout(20000);
        request.setHeader('Content-Type', 'application/json');
        request.setHeader('Idempotency-Key', String.isBlank(idempotencyKey) ? newKey(recordId) : idempotencyKey);
        request.setBody(JSON.serialize(new Map<String, Object>{
            'profile_id' => System.Label.WiseCall_SMS_Profile_Id,
            'from' => System.Label.WiseCall_SMS_Sender,
            'record_id' => String.valueOf(recordId),
            'phone' => phone.trim(),
            'text' => content.trim()
        }));
        try {
            HttpResponse response = new Http().send(request);
            result.statusCode = response.getStatusCode();
            Map<String, Object> body = parse(response.getBody());
            result.success = response.getStatusCode() == 200 && body.get('ok') == true;
            result.messageId = (String) body.get('message_id');
            if (!result.success) {
                result.error = body.get('error') != null
                    ? String.valueOf(body.get('error'))
                    : 'WiseCall returned HTTP ' + response.getStatusCode() + '.';
            }
        } catch (Exception e) {
            result.error = 'WiseCall could not be reached: ' + e.getMessage();
        }
        return result;
    }

    /**
     * Logs a completed SMS Task using BetterMove's convention (Type SMS,
     * Direction__c Inbound/Outbound). Person Accounts log against their
     * PersonContactId so the Task shows on the account timeline.
     */
    public static Id logTask(Id recordId, String content, String direction, Id ownerId) {
        return logTask(recordId, content, direction, ownerId, null);
    }

    /** As above; note is appended to the Description only (e.g. the WiseCall message id). */
    public static Id logTask(Id recordId, String content, String direction, Id ownerId, String note) {
        if (recordId == null) return null;
        Task activity = new Task();
        activity.Subject = subjectFor(direction, content);
        activity.Status = 'Completed';
        activity.Priority = 'Normal';
        activity.Description = String.isBlank(note) ? content : content + '\n\n' + note;
        activity.ActivityDate = Date.today();
        activity.Type = 'SMS';
        try {
            activity.put('Direction__c', direction);
        } catch (Exception e) {
            // Field missing in this org: the Task is still worth logging.
        }
        Id whoId = whoIdFor(recordId);
        if (whoId != null) activity.WhoId = whoId;
        else activity.WhatId = recordId;
        if (ownerId != null && String.valueOf(ownerId).startsWith('005')) activity.OwnerId = ownerId;
        insert activity;
        return activity.Id;
    }

    @TestVisible
    static String subjectFor(String direction, String content) {
        String label = direction == 'Inbound' ? 'SMS received: ' : 'SMS sent: ';
        String text = String.isBlank(content) ? '' : content.replaceAll('[\\r\\n]+', ' ').normalizeSpace();
        if (text.length() > 80) text = text.substring(0, 79) + '…';
        return label + text;
    }

    public static Id whoIdFor(Id recordId) {
        Schema.SObjectType type = recordId.getSObjectType();
        if (type == Lead.SObjectType || type == Contact.SObjectType) return recordId;
        if (type == Account.SObjectType) {
            List<Account> accounts = [SELECT PersonContactId FROM Account WHERE Id = :recordId LIMIT 1];
            if (!accounts.isEmpty() && accounts[0].PersonContactId != null) return accounts[0].PersonContactId;
        }
        return null;
    }

    @TestVisible
    static String validate(Id recordId, String phone, String content) {
        if (recordId == null) return 'Record ID is required.';
        Schema.SObjectType type = recordId.getSObjectType();
        if (type != Lead.SObjectType && type != Contact.SObjectType && type != Account.SObjectType) {
            return 'SMS can only be sent for a Lead, Contact or Person Account.';
        }
        if (String.isBlank(phone) || phone.replaceAll('[^0-9]', '').length() < 10) return 'A valid phone number is required.';
        if (String.isBlank(content)) return 'SMS content is required.';
        if (content.trim().length() > MAX_CONTENT_LENGTH) return 'SMS content is over ' + MAX_CONTENT_LENGTH + ' characters.';
        return null;
    }

    private static String newKey(Id recordId) {
        return String.valueOf(recordId) + ':' + EncodingUtil.convertToHex(Crypto.generateAESKey(128));
    }

    private static Map<String, Object> parse(String body) {
        try {
            Object value = JSON.deserializeUntyped(body);
            if (value instanceof Map<String, Object>) return (Map<String, Object>) value;
        } catch (Exception e) {
            // Non-JSON response; handled by the caller as a failure.
        }
        return new Map<String, Object>();
    }
}
