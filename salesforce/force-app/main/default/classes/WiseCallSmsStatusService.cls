/**
 * Applies an SMS delivery receipt (from Vonage, via WiseCall) to the outbound
 * SMS Task. The Task is found by the "WiseCall message id: …" line in its
 * Description (WiseCallSms.messageIdNote), on the record or its person contact.
 *   delivered  → "Delivered to handset <time>" appended to the Task
 *   otherwise  → Subject becomes "SMS not delivered: …", reason appended, and
 *                the Task owner gets a WiseCall SMS reply bell notification
 */
public without sharing class WiseCallSmsStatusService {

    public class Result {
        public Boolean ok = true;
        public Id taskId;
        public Boolean delivered;
        public String error;
    }

    public static Result apply(String recordId, String messageId, String status, String reason, String at) {
        Result result = new Result();
        if (String.isBlank(messageId) || String.isBlank(status)) {
            result.ok = false;
            result.error = 'message_id and status are required';
            return result;
        }
        result.delivered = status.equalsIgnoreCase('delivered');
        Task task = findTask(recordId, messageId);
        if (task == null) return result; // e.g. a Task logged without the message id

        String stamp = formatTime(at);
        String line = result.delivered
            ? 'Delivered to handset ' + stamp
            : 'NOT delivered (' + status + (String.isBlank(reason) ? '' : ': ' + reason) + ') ' + stamp;
        if (task.Description != null && task.Description.contains(line)) {
            result.taskId = task.Id;
            return result;
        }
        task.Description = (task.Description == null ? '' : task.Description + '\n') + line;
        if (!result.delivered) {
            String subject = task.Subject == null ? '' : task.Subject.removeStart('SMS sent: ');
            task.Subject = ('SMS not delivered: ' + subject).left(255);
        }
        update task;
        result.taskId = task.Id;
        if (!result.delivered) notifyOwner(task, status, reason);
        return result;
    }

    @TestVisible
    static Task findTask(String recordId, String messageId) {
        Set<Id> ids = new Set<Id>();
        if (String.isNotBlank(recordId)) {
            try {
                Id record = Id.valueOf(recordId);
                ids.add(record);
                Id who = WiseCallSms.whoIdFor(record);
                if (who != null) ids.add(who);
            } catch (Exception e) {
                // Not an id; fall through to no match.
            }
        }
        if (ids.isEmpty()) return null;
        String marker = WiseCallSms.MESSAGE_ID_PREFIX + messageId;
        for (Task candidate : [
            SELECT Id, Subject, Description, OwnerId, WhoId, WhatId
            FROM Task
            WHERE (WhoId IN :ids OR WhatId IN :ids) AND Type = 'SMS' AND CreatedDate = LAST_N_DAYS:14
            ORDER BY CreatedDate DESC
            LIMIT 200
        ]) {
            if (candidate.Description != null && candidate.Description.contains(marker)) return candidate;
        }
        return null;
    }

    private static String formatTime(String at) {
        Datetime value;
        try {
            value = String.isBlank(at) ? Datetime.now() : (Datetime) JSON.deserialize('"' + at + '"', Datetime.class);
        } catch (Exception e) {
            value = Datetime.now();
        }
        return value.format('dd/MM/yyyy HH:mm', 'Europe/London');
    }

    private static void notifyOwner(Task task, String status, String reason) {
        if (task.OwnerId == null || !String.valueOf(task.OwnerId).startsWith('005')) return;
        try {
            List<CustomNotificationType> types = [SELECT Id FROM CustomNotificationType WHERE DeveloperName = 'WiseCall_SMS_Reply' LIMIT 1];
            if (types.isEmpty()) return;
            Messaging.CustomNotification notification = new Messaging.CustomNotification();
            notification.setNotificationTypeId(types[0].Id);
            notification.setTitle('SMS not delivered');
            notification.setBody((task.Subject + (String.isBlank(reason) ? '' : ' (' + reason + ')')).left(300));
            notification.setTargetId(task.WhatId != null ? task.WhatId : task.WhoId);
            notification.send(new Set<String>{ String.valueOf(task.OwnerId) });
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'WiseCall SMS delivery notification failed: ' + e.getMessage());
        }
    }
}
