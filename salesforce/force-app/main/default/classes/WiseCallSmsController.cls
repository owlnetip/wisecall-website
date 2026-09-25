/**
 * Backs the SMS button / Flow screen component (LWC wiseCallSendSms).
 * The record the user is on is the record the SMS is about: WiseCall stores
 * its id and replies come back to it (WiseCallSmsReplyResource).
 */
public with sharing class WiseCallSmsController {

    public class Context {
        @AuraEnabled public String name;
        @AuraEnabled public List<String> phones;
        @AuraEnabled public String sender;
    }

    @AuraEnabled
    public static Context getContext(Id recordId) {
        if (recordId == null) throw new AuraHandledException('Open a Lead, Contact or Person Account.');
        Context result = new Context();
        result.phones = new List<String>();
        SObject record;
        List<String> fields;
        Schema.SObjectType type = recordId.getSObjectType();
        if (type == Contact.SObjectType) {
            record = [SELECT Id, Name, MobilePhone, Phone, HomePhone, OtherPhone FROM Contact WHERE Id = :recordId WITH USER_MODE];
            fields = new List<String>{'MobilePhone', 'Phone', 'HomePhone', 'OtherPhone'};
        } else if (type == Lead.SObjectType) {
            record = [SELECT Id, Name, MobilePhone, Phone FROM Lead WHERE Id = :recordId WITH USER_MODE];
            fields = new List<String>{'MobilePhone', 'Phone'};
        } else if (type == Account.SObjectType) {
            record = Database.query('SELECT Id, Name, IsPersonAccount, PersonMobilePhone, Phone, PersonHomePhone, PersonOtherPhone FROM Account WHERE Id = :recordId WITH USER_MODE');
            if (record.get('IsPersonAccount') != true) {
                throw new AuraHandledException('For a business Account, open the person’s Contact to send an SMS.');
            }
            fields = new List<String>{'PersonMobilePhone', 'Phone', 'PersonHomePhone', 'PersonOtherPhone'};
        } else {
            throw new AuraHandledException('SMS can be sent from a Lead, Contact or Person Account.');
        }
        result.name = (String) record.get('Name');
        for (String field : fields) {
            String phone = (String) record.get(field);
            if (String.isNotBlank(phone) && !result.phones.contains(phone)) result.phones.add(phone);
        }
        result.sender = System.Label.WiseCall_SMS_Sender;
        return result;
    }

    /** Sends now and logs an outbound SMS Task owned by the user who sent it. */
    @AuraEnabled
    public static String sendNow(Id recordId, String phone, String message, String requestId) {
        Context context = getContext(recordId);
        if (!context.phones.contains(phone)) throw new AuraHandledException('Choose a phone number stored on this record.');
        WiseCallSms.Result result = WiseCallSms.send(
            recordId, phone, message,
            String.isBlank(requestId) ? null : UserInfo.getUserId() + ':' + requestId
        );
        if (!result.success) throw new AuraHandledException('SMS not sent: ' + result.error);
        WiseCallSms.logTask(recordId, message.trim(), 'Outbound', UserInfo.getUserId(), WiseCallSms.messageIdNote(result.messageId));
        return 'SMS sent to ' + phone + '.';
    }
}
