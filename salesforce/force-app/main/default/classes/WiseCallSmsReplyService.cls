/**
 * Routes an inbound SMS reply (posted by WiseCall) to a Salesforce record.
 *
 * Matching, in order:
 *   1. The record id WiseCall stored when the SMS was sent. A converted Lead
 *      follows ConvertedAccountId (Person Account) / ConvertedContactId.
 *   2. The phone number: Person Account first, then an unconverted Lead.
 *   3. No match: email the fallback inbox (label WiseCall_SMS_Fallback_Email).
 *
 * A match gets a completed Task (Type SMS, Direction Inbound) owned by the
 * record owner, plus a WiseCall SMS reply bell notification to that owner.
 * Runs as the WiseCall integration user, so it needs to see all records.
 */
public without sharing class WiseCallSmsReplyService {

    public class Reply {
        public String phone;
        public String content;
        public String recordId;
        public String messageId;
    }

    public class Outcome {
        public Boolean ok = true;
        public String matchType = 'none';   // record | converted | person_account | lead | none
        public Id recordId;
        public Id taskId;
        public Boolean notified = false;
        public Boolean fallbackEmailSent = false;
        public String error;
    }

    @TestVisible
    class Target {
        Id recordId;     // Account or Lead or Contact shown to users
        Id ownerId;
        String matchType;
    }

    public static Outcome handle(Reply reply) {
        Outcome outcome = new Outcome();
        if (reply == null || String.isBlank(reply.content) || String.isBlank(reply.phone)) {
            outcome.ok = false;
            outcome.error = 'phone and content are required';
            return outcome;
        }
        Target target = fromRecordId(reply.recordId);
        if (target == null) target = fromPhone(reply.phone);

        if (target == null) {
            outcome.fallbackEmailSent = sendFallbackEmail(reply);
            return outcome;
        }
        outcome.matchType = target.matchType;
        outcome.recordId = target.recordId;
        String note = WiseCallSms.messageIdNote(reply.messageId);
        outcome.taskId = WiseCallSms.logTask(target.recordId, reply.content.trim(), 'Inbound', target.ownerId, note);
        outcome.notified = notifyOwner(target, reply);
        return outcome;
    }

    @TestVisible
    static Target fromRecordId(String rawId) {
        if (String.isBlank(rawId)) return null;
        Id recordId;
        try {
            recordId = Id.valueOf(rawId);
        } catch (Exception e) {
            return null;
        }
        Schema.SObjectType type = recordId.getSObjectType();
        if (type == Lead.SObjectType) {
            List<Lead> leads = [SELECT Id, OwnerId, IsConverted, ConvertedAccountId, ConvertedContactId FROM Lead WHERE Id = :recordId LIMIT 1];
            if (leads.isEmpty()) return null;
            Lead lead = leads[0];
            if (lead.IsConverted) {
                Id converted = lead.ConvertedAccountId != null ? lead.ConvertedAccountId : lead.ConvertedContactId;
                Target target = converted == null ? null : fromRecordId(String.valueOf(converted));
                if (target != null) target.matchType = 'converted';
                return target;
            }
            return target(lead.Id, lead.OwnerId, 'record');
        }
        if (type == Account.SObjectType) {
            List<Account> accounts = [SELECT Id, OwnerId FROM Account WHERE Id = :recordId LIMIT 1];
            return accounts.isEmpty() ? null : target(accounts[0].Id, accounts[0].OwnerId, 'record');
        }
        if (type == Contact.SObjectType) {
            List<Contact> contacts = [SELECT Id, OwnerId, AccountId, Account.IsPersonAccount FROM Contact WHERE Id = :recordId LIMIT 1];
            if (contacts.isEmpty()) return null;
            Contact contact = contacts[0];
            if (contact.AccountId != null && contact.Account.IsPersonAccount) {
                return target(contact.AccountId, contact.OwnerId, 'record');
            }
            return target(contact.Id, contact.OwnerId, 'record');
        }
        return null;
    }

    @TestVisible
    static Target fromPhone(String phone) {
        String digits = normalise(phone);
        if (digits.length() < 10) return null;
        String national = '0' + digits.substring(2);
        String query = 'FIND {' + national + ' OR ' + digits + '} IN PHONE FIELDS RETURNING '
            + 'Account(Id, OwnerId, Phone, PersonMobilePhone, PersonHomePhone, PersonOtherPhone WHERE IsPersonAccount = true ORDER BY LastModifiedDate DESC LIMIT 20), '
            + 'Lead(Id, OwnerId, Phone, MobilePhone WHERE IsConverted = false ORDER BY LastModifiedDate DESC LIMIT 20)';
        List<List<SObject>> results = Search.query(query);
        for (SObject account : results[0]) {
            if (phoneMatches(account, new List<String>{'Phone', 'PersonMobilePhone', 'PersonHomePhone', 'PersonOtherPhone'}, digits)) {
                return target(account.Id, (Id) account.get('OwnerId'), 'person_account');
            }
        }
        for (SObject lead : results[1]) {
            if (phoneMatches(lead, new List<String>{'Phone', 'MobilePhone'}, digits)) {
                return target(lead.Id, (Id) lead.get('OwnerId'), 'lead');
            }
        }
        return null;
    }

    /** UK-normalised digits: 07…, +44…, 0044… and 44… all become 44…. */
    @TestVisible
    static String normalise(String raw) {
        String digits = raw == null ? '' : raw.replaceAll('[^0-9]', '');
        if (digits.startsWith('00')) digits = digits.substring(2);
        if (digits.startsWith('0')) digits = '44' + digits.substring(1);
        return digits;
    }

    private static Boolean phoneMatches(SObject record, List<String> fields, String digits) {
        for (String field : fields) {
            Object value;
            try {
                value = record.get(field);
            } catch (Exception e) {
                continue;
            }
            if (value != null && normalise(String.valueOf(value)) == digits) return true;
        }
        return false;
    }

    private static Target target(Id recordId, Id ownerId, String matchType) {
        Target t = new Target();
        t.recordId = recordId;
        t.ownerId = ownerId;
        t.matchType = matchType;
        return t;
    }

    private static Boolean notifyOwner(Target target, Reply reply) {
        if (target.ownerId == null || !String.valueOf(target.ownerId).startsWith('005')) return false;
        try {
            List<CustomNotificationType> types = [SELECT Id FROM CustomNotificationType WHERE DeveloperName = 'WiseCall_SMS_Reply' LIMIT 1];
            if (types.isEmpty()) return false;
            Messaging.CustomNotification notification = new Messaging.CustomNotification();
            notification.setNotificationTypeId(types[0].Id);
            notification.setTitle('SMS reply from ' + reply.phone);
            String body = reply.content.normalizeSpace();
            notification.setBody(body.length() > 300 ? body.substring(0, 299) + '…' : body);
            notification.setTargetId(target.recordId);
            notification.send(new Set<String>{ String.valueOf(target.ownerId) });
            return true;
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'WiseCall SMS reply notification failed: ' + e.getMessage());
            return false;
        }
    }

    private static Boolean sendFallbackEmail(Reply reply) {
        String address = System.Label.WiseCall_SMS_Fallback_Email;
        if (String.isBlank(address) || !address.contains('@')) return false;
        try {
            Messaging.SingleEmailMessage email = new Messaging.SingleEmailMessage();
            email.setToAddresses(new List<String>{ address.trim() });
            email.setSubject('SMS received with no matching Salesforce record: ' + reply.phone);
            email.setPlainTextBody(
                'An SMS reply came in through WiseCall but no Lead, Contact or Person Account matched.\n\n'
                + 'From: ' + reply.phone + '\n'
                + 'Message: ' + reply.content + '\n'
                + (String.isNotBlank(reply.recordId) ? 'Last known record id: ' + reply.recordId + '\n' : '')
                + (String.isNotBlank(reply.messageId) ? 'WiseCall message id: ' + reply.messageId + '\n' : '')
            );
            Messaging.sendEmail(new List<Messaging.SingleEmailMessage>{ email });
            return true;
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'WiseCall SMS fallback email failed: ' + e.getMessage());
            return false;
        }
    }
}
